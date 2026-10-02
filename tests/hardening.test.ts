import { stopServer } from './helpers.js';
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createSession } from '$lib/server/auth.js';
import { RATE_LIMITS } from '$lib/config.js';

// Live server with default limits (no RATE_LIMIT_API_MAX override).
const DIR = './.test-tmp-hardening';
const DB = `${DIR}/h.db`;
const PORT = 4194;
const BASE = `http://localhost:${PORT}`;
let server: ReturnType<typeof import('node:child_process').spawn>;
let cookie = '';

beforeAll(async () => {
	rmSync(DIR, { force: true, recursive: true });
	mkdirSync(DIR, { recursive: true });
	const raw = new Database(DB);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	const db = drizzle(raw, { schema });
	const id = randomUUID();
	db.insert(users).values({ id, email: 'h@example.com', displayName: 'H', emailVerifiedAt: 'n', createdAt: 'n' }).run();
	cookie = (await createSession(db, id, null)).token;
	raw.close();
	const { spawn } = await import('node:child_process');
	server = spawn('node', ['build'], { env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ORIGIN: BASE } });
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(`${BASE}/api/health`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
}, 60_000);

afterAll(async () => {
	await stopServer(server);
	rmSync(DIR, { force: true, recursive: true });
});

const call = (method: string, path: string, body?: unknown) =>
	fetch(`${BASE}${path}`, {
		method,
		headers: { cookie: `session=${cookie}`, ...(body ? { 'content-type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined
	});

describe('hardening (§3, §8)', () => {
	test('a foreign, "null" or malformed Origin is refused with 403, never a 500', async () => {
		for (const origin of ['https://evil.example', 'null', 'not a url']) {
			const res = await fetch(`${BASE}/api/trees`, {
				method: 'POST',
				headers: { cookie: `session=${cookie}`, origin, 'content-type': 'application/json' },
				body: '{}'
			});
			expect(res.status, origin).toBe(403);
		}
	});

	test('a writer that outlasts busy_timeout gets 503 BUSY with Retry-After, never 500', async () => {
		const lock = new Database(DB);
		lock.pragma('busy_timeout = 0');
		lock.exec('BEGIN IMMEDIATE');
		try {
			const r = await call('POST', '/api/trees', { name: 'Blocked' });
			expect(r.status).toBe(503);
			expect(r.headers.get('retry-after')).toBe('2');
			expect((await r.json()).error.code).toBe('BUSY');
		} finally {
			lock.exec('ROLLBACK');
			lock.close();
		}
		expect((await call('POST', '/api/trees', { name: 'After' })).status).toBe(201);
	}, 30_000);

	test('every response carries an X-Request-Id', async () => {
		const r = await fetch(`${BASE}/api/health`);
		expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
	});

	test('other /api routes share a 100/min/IP limit and answer 429 with Retry-After', async () => {
		let last = 0;
		let retry: string | null = null;
		for (let i = 0; i < RATE_LIMITS.api.limit + 5; i++) {
			const r = await call('GET', '/api/trees');
			last = r.status;
			retry = r.headers.get('retry-after');
			if (last === 429) break;
		}
		expect(last).toBe(429);
		expect(retry).toBe('60');
		// Health stays outside the shared bucket.
		expect((await fetch(`${BASE}/api/health`)).status).toBe(200);
	}, 60_000);

	test('a fresh server creates and migrates its database, then exits 0 on SIGTERM', async () => {
		const dir = `${DIR}/fresh/nested`;
		const port = 4195;
		const { spawn } = await import('node:child_process');
		const child = spawn('node', ['build'], {
			env: { ...process.env, PORT: String(port), DATABASE_PATH: `${dir}/f.db`, ORIGIN: `http://localhost:${port}` }
		});
		const exited = new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
		let up = false;
		for (let i = 0; i < 60 && !up; i++) {
			up = await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false);
			if (!up) await new Promise((r) => setTimeout(r, 500));
		}
		expect(up).toBe(true);
		const raw = new Database(`${dir}/f.db`, { readonly: true });
		const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE name IN ('persons','persons_fts','visible_persons')`).all();
		raw.close();
		expect(tables.length).toBe(3);
		child.kill('SIGTERM');
		expect(await exited).toBe(0);
	}, 60_000);
});
