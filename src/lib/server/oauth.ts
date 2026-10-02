import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '$lib/db/schema.js';
import { oauthAccounts, sessions, users } from '$lib/db/schema.js';
import { createSession, hashToken } from './auth.js';
import type { Result } from './accounts.js';

type Db = BetterSQLite3Database<typeof schema>;

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

function newId(): string {
	return randomUUID();
}

export function googleConfigured(env: Record<string, string | undefined>): boolean {
	return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function base64url(data: string): string {
	return Buffer.from(data, 'utf8').toString('base64url');
}

function signState(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('hex');
}

export function issueOAuthState(secret: string, verifier: string): { state: string; cookie: string } {
	const state = randomBytes(16).toString('base64url');
	const exp = Date.now() + 10 * 60_000;
	const payload = base64url(JSON.stringify({ state, verifier, exp }));
	return { state, cookie: `${payload}.${signState(payload, secret)}` };
}

export function readOAuthState(
	secret: string,
	cookie: string | undefined,
	state: string
): { verifier: string } | null {
	if (!cookie) return null;
	const dot = cookie.lastIndexOf('.');
	if (dot < 0) return null;
	const payload = cookie.slice(0, dot);
	const sig = cookie.slice(dot + 1);
	const expected = signState(payload, secret);
	if (sig.length !== expected.length) return null;
	let diff = 0;
	for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
	if (diff !== 0) return null;
	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
			state: string;
			verifier: string;
			exp: number;
		};
		if (data.state !== state || typeof data.verifier !== 'string' || data.exp <= Date.now()) return null;
		return { verifier: data.verifier };
	} catch {
		return null;
	}
}

function challenge(verifier: string): string {
	return createHash('sha256').update(verifier).digest('base64url');
}

export function googleAuthUrl(
	clientId: string,
	redirectUri: string,
	state: string,
	verifier: string
): string {
	const q = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'openid email profile',
		state,
		code_challenge: challenge(verifier),
		code_challenge_method: 'S256'
	});
	return `${GOOGLE_AUTHORIZE}?${q.toString()}`;
}

interface GoogleUser {
	sub: string;
	email: string;
	email_verified: boolean;
	name?: string;
}

/** Exchange code + fetch profile. `fetcher` is injectable for tests. */
export async function googleCallback(
	db: Db,
	input: { code: string; state: string; stateCookie: string | undefined; redirectUri: string },
	env: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; SESSION_SECRET: string },
	fetcher: typeof fetch = fetch
): Promise<Result<{ token: string; userId: string }>> {
	const oauth = readOAuthState(env.SESSION_SECRET, input.stateCookie, input.state);
	if (!oauth) {
		return { ok: false, code: 'VALIDATION', status: 400, message: 'Invalid OAuth state' };
	}
	const tokenRes = await fetcher(GOOGLE_TOKEN, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code: input.code,
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			redirect_uri: input.redirectUri,
			grant_type: 'authorization_code',
			code_verifier: oauth.verifier
		}).toString()
	});
	if (!tokenRes.ok) {
		return { ok: false, code: 'VALIDATION', status: 400, message: 'Google sign-in failed' };
	}
	const tokens = (await tokenRes.json()) as { access_token?: string };
	if (!tokens.access_token) {
		return { ok: false, code: 'VALIDATION', status: 400, message: 'Google sign-in failed' };
	}
	const infoRes = await fetcher(GOOGLE_USERINFO, {
		headers: { authorization: `Bearer ${tokens.access_token}` }
	});
	if (!infoRes.ok) {
		return { ok: false, code: 'VALIDATION', status: 400, message: 'Google sign-in failed' };
	}
	const info = (await infoRes.json()) as GoogleUser;
	if (!info.email_verified || !info.email || !info.sub) {
		return { ok: false, code: 'VALIDATION', status: 400, message: 'Google sign-in failed' };
	}
	const email = info.email.trim().toLowerCase();
	const now = new Date().toISOString();
	const existing = db
		.select()
		.from(oauthAccounts)
		.where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerUserId, info.sub)))
		.get();
	if (existing) {
		const session = await createSession(db, existing.userId, null);
		return { ok: true, token: session.token, userId: existing.userId };
	}
	const local = db.select().from(users).where(eq(users.email, email)).get();
	let userId: string;
	if (local) {
		userId = local.id;
		if (!local.emailVerifiedAt) {
			// Stop pre-registration takeover: wipe local credential + sessions, then link.
			db.update(users).set({ passwordHash: null, emailVerifiedAt: now }).where(eq(users.id, userId)).run();
			db.delete(sessions).where(eq(sessions.userId, userId)).run();
		}
	} else {
		userId = newId();
		db.insert(users)
			.values({
				id: userId,
				email,
				displayName: info.name?.slice(0, 100) || email.split('@')[0] || 'User',
				emailVerifiedAt: now,
				createdAt: now
			})
			.run();
	}
	db.insert(oauthAccounts)
		.values({ id: newId(), userId, provider: 'google', providerUserId: info.sub })
		.run();
	const session = await createSession(db, userId, null);
	return { ok: true, token: session.token, userId };
}

export { hashToken };
