import { describe, expect, test, beforeEach, afterEach, vi, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import {
	_clearAccountFailures,
	accountLockRemainingMs,
	forgotPassword,
	login,
	register,
	resetPassword
} from '$lib/server/accounts.js';
import * as passwords from '$lib/server/passwords.js';
import { hashToken } from '$lib/server/auth.js';
import { clearAllRateLimits } from '$lib/server/rate-limit.js';
import { oauthAccounts, passwordResetTokens, sessions, users } from '$lib/db/schema.js';
import { googleCallback, issueOAuthState } from '$lib/server/oauth.js';
import { setSessionCookie, isSecure } from '$lib/server/api.js';

const DIR = './.test-tmp-auth';
const MIGRATIONS = './src/lib/db/migrations';
let n = 0;

function freshDb() {
	const path = `${DIR}/auth-${process.pid}-${n++}.db`;
	rmSync(path, { force: true });
	mkdirSync(DIR, { recursive: true });
	const raw = new Database(path);
	applyPragmas(raw);
	migrate(drizzle(raw, { schema }), { migrationsFolder: MIGRATIONS });
	return { raw, db: drizzle(raw, { schema }), path };
}

let dbs: Array<{ raw: Database.Database; path: string }> = [];

function db() {
	const f = freshDb();
	dbs.push(f);
	return f.db;
}

beforeEach(() => {
	clearAllRateLimits();
	_clearAccountFailures();
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	for (const d of dbs) {
		try {
			d.raw.close();
		} catch {
			// ignore
		}
		rmSync(d.path, { force: true });
	}
	dbs = [];
});

afterAll(() => {
	rmSync(DIR, { force: true, recursive: true });
});

const PW = 'correct-horse-batter';

async function makeUser(database: ReturnType<typeof db>, email: string, password = PW) {
	const res = await register(
		database,
		{ email, password, displayName: 'Test User' },
		{ ip: `reg-${email}`, baseUrl: 'http://localhost' }
	);
	expect(res.ok).toBe(true);
	return database.select().from(users).where(eq(users.email, email)).get();
}

describe('AT-18: login rate limit and account lockout', () => {
	test('AT-18: 6th login attempt in one minute from one IP is 429 with Retry-After', async () => {
		const database = db();
		await makeUser(database, 'rate@example.com');
		let last: unknown = null;
		for (let i = 0; i < 6; i++) {
			last = await login(
				database,
				{ email: 'rate@example.com', password: 'wrong-password' },
				{ ip: '10.0.0.1', userAgent: null }
			);
		}
		expect(last).toMatchObject({ ok: false, code: 'RATE_LIMITED', status: 429 });
		expect((last as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
	}, 30_000);

	test('AT-18: 10 failures in 15 min lock the account from another IP; reset clears the lock', async () => {
		const database = db();
		const user = await makeUser(database, 'locked@example.com');
		if (!user) throw new Error('no user');
		for (let i = 0; i < 10; i++) {
			const r = await login(
				database,
				{ email: 'locked@example.com', password: 'wrong-password' },
				{ ip: `10.0.1.${i}`, userAgent: null }
			);
			expect(r).toMatchObject({ ok: false, status: 401 });
		}
		expect(accountLockRemainingMs(user.id)).toBeGreaterThan(0);
		const locked = await login(
			database,
			{ email: 'locked@example.com', password: PW },
			{ ip: '10.0.2.99', userAgent: null }
		);
		expect(locked).toMatchObject({ ok: false, code: 'LOCKED', status: 429 });
		expect((locked as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
		// Password reset clears the lock and the session set is fresh afterwards.
		const raw = 'reset-token-abc';
		database
			.insert(passwordResetTokens)
			.values({
				id: 'prt1',
				userId: user.id,
				tokenHash: hashToken(raw),
				expiresAt: new Date(Date.now() + 3600_000).toISOString(),
				createdAt: new Date().toISOString()
			})
			.run();
		const reset = await resetPassword(database, { token: raw, password: 'new-correct-horse' });
		expect(reset.ok).toBe(true);
		const after = await login(
			database,
			{ email: 'locked@example.com', password: 'new-correct-horse' },
			{ ip: '10.0.2.99', userAgent: null }
		);
		expect(after.ok).toBe(true);
	}, 90_000);
});

describe('AT-36: auth hygiene', () => {
	test('AT-36: register and forgot return identical responses for existing and unknown emails', async () => {
		const database = db();
		const first = await register(
			database,
			{ email: 'same@example.com', password: PW, displayName: 'Same' },
			{ ip: '11.0.0.1', baseUrl: 'http://localhost' }
		);
		const second = await register(
			database,
			{ email: 'same@example.com', password: PW, displayName: 'Same' },
			{ ip: '11.0.0.2', baseUrl: 'http://localhost' }
		);
		expect(second).toEqual(first);
		const known = await forgotPassword(
			database,
			{ email: 'same@example.com' },
			{ ip: '11.0.0.3', baseUrl: 'http://localhost' }
		);
		const unknown = await forgotPassword(
			database,
			{ email: 'nobody@example.com' },
			{ ip: '11.0.0.4', baseUrl: 'http://localhost' }
		);
		expect(unknown).toEqual(known);
	}, 30_000);

	test('AT-36: login for an unknown email still runs a bcrypt compare', async () => {
		const database = db();
		const spy = vi.spyOn(passwords, 'dummyCompare');
		const res = await login(
			database,
			{ email: 'ghost@example.com', password: 'whatever-password' },
			{ ip: '12.0.0.1', userAgent: null }
		);
		expect(res).toMatchObject({ ok: false, status: 401 });
		expect(spy).toHaveBeenCalledTimes(1);
	});

	test('AT-36: passwords over 72 bytes are rejected', async () => {
		await expect(passwords.hashPassword('x'.repeat(73))).rejects.toThrow(/72 bytes/);
		const database = db();
		// The service hashing layer refuses oversize input (the route's Zod
		// schema rejects it first with a 400).
		await expect(
			register(
				database,
				{ email: 'long@example.com', password: 'x'.repeat(73), displayName: 'Long' },
				{ ip: '13.0.0.1', baseUrl: 'http://localhost' }
			)
		).rejects.toThrow(/72 bytes/);
	});

	test('AT-36: reset token is single-use and deletes all of the user sessions', async () => {
		const database = db();
		const user = await makeUser(database, 'sessions@example.com');
		if (!user) throw new Error('no user');
		const a = await login(
			database,
			{ email: 'sessions@example.com', password: PW },
			{ ip: '14.0.0.1', userAgent: null }
		);
		const b = await login(
			database,
			{ email: 'sessions@example.com', password: PW },
			{ ip: '14.0.0.2', userAgent: null }
		);
		expect(a.ok && b.ok).toBe(true);
		expect(database.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toHaveLength(2);
		const raw = 'single-use-token';
		database
			.insert(passwordResetTokens)
			.values({
				id: 'prt2',
				userId: user.id,
				tokenHash: hashToken(raw),
				expiresAt: new Date(Date.now() + 3600_000).toISOString(),
				createdAt: new Date().toISOString()
			})
			.run();
		expect((await resetPassword(database, { token: raw, password: 'brand-new-password' })).ok).toBe(true);
		expect(database.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toHaveLength(0);
		const reuse = await resetPassword(database, { token: raw, password: 'another-password' });
		expect(reuse).toMatchObject({ ok: false, status: 400 });
	}, 60_000);

	test('AT-36: session cookie is httpOnly, sameSite lax, scoped to / with a 30-day lifetime', () => {
		const seen: Array<{ name: string; value: string; opts: Record<string, unknown> }> = [];
		setSessionCookie(
			{
				cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => seen.push({ name, value, opts }) },
				url: new URL('http://localhost/')
			} as never,
			'token-value'
		);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.name).toBe('session');
		expect(seen[0]?.opts).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			secure: false,
			path: '/',
			maxAge: 30 * 24 * 60 * 60
		});
		// The production branch of isSecure() reads a snapshotted env in tests,
		// so cover both branches directly.
		expect(isSecure({ url: new URL('http://localhost/') } as never, 'production')).toBe(true);
		expect(isSecure({ url: new URL('https://localhost/') } as never, 'test')).toBe(true);
		expect(isSecure({ url: new URL('http://localhost/') } as never, 'test')).toBe(false);
	});

	test('AT-36: no more than PASSWORD_HASH_CONCURRENCY hashes run at once', async () => {
		let maxRunning = 0;
		let maxQueued = 0;
		const jobs = Array.from({ length: 6 }, () => passwords.hashPassword('concurrency-probe-pw'));
		const poll = (async () => {
			for (let i = 0; i < 200; i++) {
				const d = passwords._hashQueueDepth();
				maxRunning = Math.max(maxRunning, d.running);
				maxQueued = Math.max(maxQueued, d.queued);
				if (d.running === 0 && d.queued === 0 && i > 5) break;
				await new Promise((r) => setTimeout(r, 5));
			}
		})();
		const hashes = await Promise.all(jobs);
		await poll;
		expect(new Set(hashes).size).toBe(6);
		expect(maxRunning).toBeLessThanOrEqual(2);
		expect(maxQueued).toBeGreaterThanOrEqual(1);
		expect(passwords._hashQueueDepth()).toEqual({ running: 0, queued: 0 });
	}, 60_000);

	test('AT-36: Google sign-in with an unverified local account clears password and sessions before linking', async () => {
		const database = db();
		const user = await makeUser(database, 'pre@example.com');
		if (!user) throw new Error('no user');
		const logged = await login(
			database,
			{ email: 'pre@example.com', password: PW },
			{ ip: '15.0.0.1', userAgent: null }
		);
		expect(logged.ok).toBe(true);
		const fetcher = async (url: string | URL | Request) => {
			const u = String(url);
			if (u.includes('oauth2.googleapis.com/token')) {
				return new Response(JSON.stringify({ access_token: 'at123' }), { status: 200 });
			}
			return new Response(
				JSON.stringify({ sub: 'google-1', email: 'pre@example.com', email_verified: true, name: 'Pre' }),
				{ status: 200 }
			);
		};
		const secret = 'test-session-secret-32-chars-minimum!!';
		const verifier = 'verifier-value';
		const { state, cookie } = issueOAuthState(secret, verifier);
		const res = await googleCallback(
			database,
			{ code: 'authcode', state, stateCookie: cookie, redirectUri: 'http://localhost/api/auth/google/callback' },
			{ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec', SESSION_SECRET: secret },
			fetcher as typeof fetch
		);
		expect(res.ok).toBe(true);
		const after = database.select().from(users).where(eq(users.id, user.id)).get();
		expect(after?.passwordHash).toBeNull();
		expect(database.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toHaveLength(1);
		expect(
			database.select().from(oauthAccounts).where(eq(oauthAccounts.userId, user.id)).all()
		).toHaveLength(1);
	}, 30_000);
});
