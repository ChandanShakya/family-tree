import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import Database from 'better-sqlite3';
import { migrateAndCheck, openDb } from '$lib/db/index.js';
import { validateSession } from '$lib/server/auth.js';
import { RATE_LIMITS } from '$lib/config.js';
import { startMaintenance } from '$lib/server/maintenance.js';
import { checkRateLimit } from '$lib/server/rate-limit.js';
import { parseDate } from '$lib/utils/dates.js';

function clientIp(request: Request): string {
	const header = env.ADDRESS_HEADER;
	if (header) {
		const v = request.headers.get(header);
		if (v) return v.split(',')[0]?.trim() || 'unknown';
	}
	return 'unknown';
}

const dbPath = (): string => env.DATABASE_PATH ?? './data/family.db';

// BS dates saved while the production build could not convert them have a NULL norm; fill them in.
function backfillBsNorms(): void {
	const db = new Database(dbPath());
	try {
		let n = 0;
		for (const [table, text, norm] of [
			['persons', 'birthDate', 'birthDateNorm'],
			['persons', 'deathDate', 'deathDateNorm'],
			['events', 'date', 'dateNorm']
		] as const) {
			const cal = text === 'date' ? 'dateCal' : `${text}Cal`;
			const rows = db.prepare(`SELECT id, ${text} AS t FROM ${table} WHERE ${cal} = 'BS' AND ${norm} IS NULL AND ${text} <> ''`).all() as { id: string; t: string }[];
			const upd = db.prepare(`UPDATE ${table} SET ${norm} = ? WHERE id = ?`);
			for (const r of rows) {
				const v = parseDate(r.t, 'BS').norm;
				if (v) n += upd.run(v, r.id).changes;
			}
		}
		if (n) console.warn(`backfilled ${n} Bikram Sambat date norms`);
	} finally {
		db.close();
	}
}

// Runs once before the server accepts requests (§5 migration mechanics, §3 shutdown).
export const init: ServerInit = async () => {
	mkdirSync(dirname(dbPath()), { recursive: true });
	// The migrations folder is passed explicitly: a path relative to the bundled output breaks in production.
	const { rebuilt } = migrateAndCheck(dbPath(), env.MIGRATIONS_PATH ?? './src/lib/db/migrations');
	if (rebuilt) console.warn('persons_fts was rebuilt at startup');
	backfillBsNorms();

	// Production refuses to start without real secrets (§11).
	if (env.NODE_ENV === 'production') {
		for (const k of ['SESSION_SECRET', 'VERIFICATION_PEPPER'] as const) {
			if ((env[k] ?? '').length < 32) throw new Error(`${k} must be set to at least 32 characters in production`);
		}
		if (!env.SMTP_HOST) {
			console.warn('[mail] SMTP_HOST is not set: password-reset and verification links are written to this log. Anyone who can read it can take over accounts.');
		}
	}
	startMaintenance();

	// adapter-node stops accepting connections and lets in-flight requests finish, then emits this event.
	// Only then is the WAL folded into the main file (retrying while a reader holds it) and the process left (§3).
	process.once('sveltekit:shutdown' as never, async () => {
		for (let attempt = 1; attempt <= 3; attempt++) {
			const { raw } = openDb(dbPath());
			try {
				const r = raw.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
				if (!r[0]?.busy) break;
				if (attempt === 3) console.warn('wal_checkpoint still busy; the WAL is recovered at next start');
			} finally {
				raw.close();
			}
			await new Promise((r) => setTimeout(r, 1000));
		}
		probe?.close();
		process.exit(0);
	});
};

// better-sqlite3 waits for a held write lock synchronously, which would freeze every request while a worker
// (GEDCOM import) commits. Writers therefore wait here, asynchronously, until the lock is free; the
// synchronous busy_timeout only covers the rare race after this probe (§3, R-PERF-7).
let probe: Database.Database | null = null;
function writeLockFree(): boolean {
	probe ??= (() => {
		const d = new Database(dbPath());
		d.pragma('busy_timeout = 0');
		return d;
	})();
	try {
		probe.exec('BEGIN IMMEDIATE');
		probe.exec('ROLLBACK');
		return true;
	} catch (e) {
		if (isBusy(e)) return false;
		throw e;
	}
}

async function waitForWriteLock(maxMs = 4500): Promise<boolean> {
	const until = Date.now() + maxMs;
	while (!writeLockFree()) {
		if (Date.now() > until) return false;
		await new Promise((r) => setTimeout(r, 20));
	}
	return true;
}

// Routes with their own, stricter limiter (§8); everything else under /api shares the 100/min/IP bucket.
const OWN_LIMIT = /^\/api\/(health$|search$|auth\/(register|login|logout|forgot)$)/;

function jsonError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify({ error: { code, message } }), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});
}

function isBusy(e: unknown): boolean {
	const c = (e as { code?: string } | null)?.code;
	return typeof c === 'string' && c.startsWith('SQLITE_BUSY');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	// Session -> locals.user
	const cookie = event.cookies.get('session');
	if (cookie) {
		try {
			const { raw, db } = openDb(dbPath());
			try {
				const s = validateSession(db, cookie);
				if (s) event.locals.user = { id: s.userId, sessionId: s.sessionId };
			} finally {
				raw.close();
			}
		} catch (e) {
			// A busy database is not "signed out": retry-able for the API, else fall through to the error page.
			if (isBusy(e)) {
				if (event.url.pathname.startsWith('/api/')) {
					return jsonError(503, 'BUSY', 'Server is busy, retry shortly', { 'retry-after': '2' });
				}
				throw e;
			}
			// DB may not exist yet (fresh checkout); treat as anonymous.
		}
	}

	// Explicit Origin check for JSON state-changing requests (§8).
	const method = event.request.method;
	if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
		const origin = event.request.headers.get('origin');
		const expected = env.ORIGIN;
		// Compare strings: a browser sends a serialized origin, and anything else ("null", junk) is a mismatch.
		if (origin && expected && origin !== new URL(expected).origin) {
			return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Bad origin' } }), {
				status: 403,
				headers: { 'content-type': 'application/json' }
			});
		}
	}

	const path = event.url.pathname;
	if (path.startsWith('/api/') && !OWN_LIMIT.test(path)) {
		// RATE_LIMIT_API_MAX lets test servers lift the cap; it is ignored in production.
		const override = env.NODE_ENV === 'production' ? 0 : Number(env.RATE_LIMIT_API_MAX);
		const limit = override || RATE_LIMITS.api.limit;
		if (!checkRateLimit(`api:${clientIp(event.request)}`, limit, RATE_LIMITS.api.windowMs)) {
			return jsonError(429, 'RATE_LIMITED', 'Too many requests', { 'retry-after': '60' });
		}
	}

	if (path.startsWith('/api/') && method !== 'GET' && method !== 'HEAD' && (await waitForWriteLock()) === false) {
		return jsonError(503, 'BUSY', 'Server is busy, retry shortly', { 'retry-after': '2' });
	}

	let response: Response;
	try {
		response = await resolve(event);
	} catch (e) {
		// A writer outlasted busy_timeout: tell the client to retry, never a 500 (§3).
		if (path.startsWith('/api/') && isBusy(e)) {
			console.warn(`[${event.locals.requestId}] SQLITE_BUSY on ${event.request.method} ${path}`);
			return jsonError(503, 'BUSY', 'Server is busy, retry shortly', { 'retry-after': '2' });
		}
		throw e;
	}
	// SvelteKit turns an endpoint throw into a 500 response (after handleError), so SQLITE_BUSY is mapped here.
	if (response.status === 500 && event.locals.busy && path.startsWith('/api/')) {
		return jsonError(503, 'BUSY', 'Server is busy, retry shortly', { 'retry-after': '2', 'x-request-id': event.locals.requestId });
	}
	response.headers.set('X-Request-Id', event.locals.requestId);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	if (env.NODE_ENV === 'production') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	return response;
};

// Details go to the log with the request ID; the client sees only a generic message (§8).
export const handleError: HandleServerError = ({ error, event }) => {
	const requestId = event.locals.requestId ?? 'unknown';
	if (isBusy(error)) event.locals.busy = true;
	console.error(`[${requestId}] ${event.request.method} ${event.url.pathname}`, error);
	return { message: 'Internal error', requestId };
};
