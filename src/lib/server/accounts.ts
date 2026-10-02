import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '$lib/db/schema.js';
import {
	emailVerificationTokens,
	oauthAccounts,
	passwordResetTokens,
	persons,
	sessions,
	treeMembers,
	trees,
	users
} from '$lib/db/schema.js';
import { RATE_LIMITS } from '$lib/config.js';
import { checkRateLimit } from './rate-limit.js';
import { comparePassword, dummyCompare, hashPassword } from './passwords.js';
import { createSession, deleteSession as deleteSessionByToken, hashToken } from './auth.js';
import { sendMail } from './mail.js';
import { commitThenDelete } from './storage.js';

type Db = BetterSQLite3Database<typeof schema>;

export type ServiceError = { ok: false; code: string; status: number; message: string; retryAfter?: number };
export type ServiceOk<T> = { ok: true } & T;
export type Result<T> = ServiceOk<T> | ServiceError;

const GENERIC_AUTH = 'Invalid email or password';
const GENERIC_TOKEN = 'Invalid or expired token';

function err(code: string, status: number, message: string, retryAfter?: number): ServiceError {
	return { ok: false, code, status, message, retryAfter };
}

function newId(): string {
	return randomUUID();
}

function rateLimited(key: string, limit: number, windowMs: number, retryAfterSec: number): ServiceError | null {
	if (!checkRateLimit(key, limit, windowMs)) {
		return err('RATE_LIMITED', 429, 'Too many requests', retryAfterSec);
	}
	return null;
}

// --- Login account lock: 10 failures in 15 min lock the account for 15 min (§8). ---

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 10;
const accountFailures = new Map<string, number[]>();

/** Visible for tests. */
export function _clearAccountFailures(): void {
	accountFailures.clear();
}

function pruneFailures(userId: string, now: number): number[] {
	const list = (accountFailures.get(userId) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
	accountFailures.set(userId, list);
	return list;
}

export function accountLockRemainingMs(userId: string, now = Date.now()): number {
	const list = pruneFailures(userId, now);
	if (list.length < LOGIN_MAX_FAILURES) return 0;
	const oldest = Math.min(...list);
	return Math.max(0, oldest + LOGIN_WINDOW_MS - now);
}

function recordAccountFailure(userId: string, now = Date.now()): void {
	const list = pruneFailures(userId, now);
	list.push(now);
	accountFailures.set(userId, list);
}

/** Unverified users cannot make a tree public or mint join codes (§5.1). */
export function isEmailVerified(db: Db, userId: string): boolean {
	return !!db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).get()?.v;
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function findUserByEmail(db: Db, email: string) {
	return db
		.select()
		.from(users)
		.where(and(eq(users.email, normalizeEmail(email)), isNull(users.deletedAt)))
		.get();
}

// --- Register (§6.1: generic response, no enumeration). No session is created. ---

export async function register(
	db: Db,
	input: { email: string; password: string; displayName: string },
	ctx: { ip: string; baseUrl: string }
): Promise<Result<{ message: string }>> {
	const limited = rateLimited(
		`register:${ctx.ip}`,
		RATE_LIMITS.register.limit,
		RATE_LIMITS.register.windowMs,
		60
	);
	if (limited) return limited;
	const message = 'Check your email to verify your account';
	const existing = findUserByEmail(db, input.email);
	if (existing) return { ok: true, message };
	const now = new Date().toISOString();
	const id = newId();
	db.insert(users)
		.values({
			id,
			email: normalizeEmail(input.email),
			passwordHash: await hashPassword(input.password),
			displayName: input.displayName,
			createdAt: now
		})
		.run();
	issueVerificationEmail(db, id, normalizeEmail(input.email), ctx.baseUrl);
	return { ok: true, message };
}

function issueVerificationEmail(db: Db, userId: string, email: string, baseUrl: string): void {
	const token = randomBytes(32).toString('base64url');
	const now = new Date();
	db.insert(emailVerificationTokens)
		.values({
			id: newId(),
			userId,
			tokenHash: hashToken(token),
			expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
			createdAt: now.toISOString()
		})
		.run();
	void sendMail({
		to: email,
		subject: 'Verify your email',
		text: `${baseUrl}/verify/${token}`
	});
}

// --- Login (§6.1, §8). ---

export async function login(
	db: Db,
	input: { email: string; password: string },
	ctx: { ip: string; userAgent: string | null }
): Promise<Result<{ token: string; userId: string }>> {
	const limited = rateLimited(`login:${ctx.ip}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs, 60);
	if (limited) return limited;
	const user = findUserByEmail(db, input.email);
	if (!user || !user.passwordHash) {
		await dummyCompare();
		return err('UNAUTHENTICATED', 401, GENERIC_AUTH);
	}
	const lockedMs = accountLockRemainingMs(user.id);
	if (lockedMs > 0) {
		return err('LOCKED', 429, 'Account locked. Try again later or reset your password.', Math.ceil(lockedMs / 1000));
	}
	const valid = await comparePassword(input.password, user.passwordHash);
	if (!valid) {
		recordAccountFailure(user.id);
		return err('UNAUTHENTICATED', 401, GENERIC_AUTH);
	}
	const session = await createSession(db, user.id, ctx.userAgent);
	return { ok: true, token: session.token, userId: user.id };
}

export function logout(db: Db, token: string | undefined): Result<{ message: string }> {
	if (token) deleteSessionByToken(db, token);
	return { ok: true, message: 'Logged out' };
}

// --- Forgot / reset (§6.1: generic response; reset clears lock + sessions). ---

export async function forgotPassword(
	db: Db,
	input: { email: string },
	ctx: { ip: string; baseUrl: string }
): Promise<Result<{ message: string }>> {
	const message = 'If an account exists for that email, a reset link was sent';
	const byIp = rateLimited(`forgot:ip:${ctx.ip}`, RATE_LIMITS.forgot.limit, RATE_LIMITS.forgot.windowMs, 3600);
	if (byIp) return byIp;
	const email = normalizeEmail(input.email);
	const byEmail = rateLimited(
		`forgot:email:${email}`,
		RATE_LIMITS.forgot.limit,
		RATE_LIMITS.forgot.windowMs,
		3600
	);
	if (byEmail) return byEmail;
	const user = findUserByEmail(db, email);
	if (!user) return { ok: true, message };
	const token = randomBytes(32).toString('base64url');
	const now = new Date();
	db.insert(passwordResetTokens)
		.values({
			id: newId(),
			userId: user.id,
			tokenHash: hashToken(token),
			expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
			createdAt: now.toISOString()
		})
		.run();
	void sendMail({
		to: email,
		subject: 'Reset your password',
		text: `${ctx.baseUrl}/reset/${token}`
	});
	return { ok: true, message };
}

export async function resetPassword(
	db: Db,
	input: { token: string; password: string }
): Promise<Result<{ message: string }>> {
	const row = db
		.select()
		.from(passwordResetTokens)
		.where(eq(passwordResetTokens.tokenHash, hashToken(input.token)))
		.get();
	if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
		return err('VALIDATION', 400, GENERIC_TOKEN);
	}
	const now = new Date().toISOString();
	const passwordHash = await hashPassword(input.password);
	db.update(users).set({ passwordHash }).where(eq(users.id, row.userId)).run();
	db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, row.id)).run();
	db.delete(sessions).where(eq(sessions.userId, row.userId)).run();
	accountFailures.delete(row.userId);
	return { ok: true, message: 'Password reset. You can now log in.' };
}

// --- Email verification. ---

export function verifyEmail(db: Db, input: { token: string }): Result<{ message: string }> {
	const row = db
		.select()
		.from(emailVerificationTokens)
		.where(eq(emailVerificationTokens.tokenHash, hashToken(input.token)))
		.get();
	if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
		return err('VALIDATION', 400, GENERIC_TOKEN);
	}
	const now = new Date().toISOString();
	db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, row.userId)).run();
	db.update(emailVerificationTokens).set({ usedAt: now }).where(eq(emailVerificationTokens.id, row.id)).run();
	return { ok: true, message: 'Email verified' };
}

export function resendVerification(
	db: Db,
	userId: string,
	ctx: { baseUrl: string }
): Result<{ message: string }> {
	const limited = rateLimited(`verify-resend:${userId}`, 3, 3_600_000, 3600);
	if (limited) return limited;
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || user.deletedAt) return err('UNAUTHENTICATED', 401, 'Not signed in');
	if (user.emailVerifiedAt) return { ok: true, message: 'Email already verified' };
	issueVerificationEmail(db, user.id, user.email, ctx.baseUrl);
	return { ok: true, message: 'Check your email to verify your account' };
}

// --- Password change (current required; revokes every other session). ---

export async function changePassword(
	db: Db,
	userId: string,
	sessionId: string,
	input: { currentPassword: string; password: string }
): Promise<Result<{ message: string }>> {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || user.deletedAt || !user.passwordHash) {
		return err('UNAUTHENTICATED', 401, 'Not signed in');
	}
	const valid = await comparePassword(input.currentPassword, user.passwordHash);
	if (!valid) return err('UNAUTHENTICATED', 401, 'Current password is incorrect');
	db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, userId)).run();
	// Revoke every other session; the caller stays signed in.
	const others = db
		.select({ id: sessions.id })
		.from(sessions)
		.where(eq(sessions.userId, userId))
		.all()
		.filter((s) => s.id !== sessionId);
	for (const s of others) db.delete(sessions).where(eq(sessions.id, s.id)).run();
	return { ok: true, message: 'Password changed' };
}

// --- Profile (display name + prefs; avatar upload arrives with the media pipeline in Phase 2). ---

export function updateAccount(
	db: Db,
	userId: string,
	input: { displayName?: string; themePref?: string; dateDisplayPref?: string; notifyPrefs?: Record<string, boolean> }
): Result<{ message: string }> {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || user.deletedAt) return err('UNAUTHENTICATED', 401, 'Not signed in');
	db.update(users)
		.set({
			...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
			...(input.themePref !== undefined ? { themePref: input.themePref } : {}),
			...(input.dateDisplayPref !== undefined ? { dateDisplayPref: input.dateDisplayPref } : {}),
			...(input.notifyPrefs !== undefined ? { notifyPrefs: JSON.stringify(input.notifyPrefs) } : {})
		})
		.where(eq(users.id, userId))
		.run();
	return { ok: true, message: 'Profile updated' };
}

// --- Account deletion (§6.1). ---

export function deleteAccount(db: Db, userId: string): Result<{ message: string }> {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || user.deletedAt) return err('UNAUTHENTICATED', 401, 'Not signed in');
	const owned = db.select().from(trees).where(eq(trees.ownerId, userId)).all();
	if (owned.length > 0) {
		return err('VALIDATION', 400, 'Transfer ownership or delete your trees first');
	}
	commitThenDelete(db, (tx) => {
		const now = new Date().toISOString();
		tx.update(users)
			.set({
				email: `deleted+${userId}@invalid.invalid`,
				passwordHash: null,
				displayName: 'Deleted user',
				avatarUrl: null,
				deletedAt: now
			})
			.where(eq(users.id, userId))
			.run();
		tx.delete(sessions).where(eq(sessions.userId, userId)).run();
		tx.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId)).run();
		tx.update(persons).set({ userId: null, claimedAt: null }).where(eq(persons.userId, userId)).run();
		tx.delete(treeMembers).where(eq(treeMembers.userId, userId)).run();
		return { value: null, after: { dirs: [`_avatars/${userId}`] } };
	});
	return { ok: true, message: 'Account deleted' };
}
