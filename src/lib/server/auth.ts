import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SESSION_DAYS } from '$lib/config.js';
import { sessions } from '$lib/db/schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '$lib/db/schema.js';

type Db = BetterSQLite3Database<typeof schema>;

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function randomId(): string {
	return randomUUID();
}

export async function createSession(
	db: Db,
	userId: string,
	userAgent: string | null
): Promise<{ id: string; token: string; expiresAt: string }> {
	const token = randomBytes(32).toString('base64url');
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const id = randomId();
	db.insert(sessions)
		.values({
			id,
			userId,
			tokenHash: hashToken(token),
			expiresAt,
			createdAt: now.toISOString(),
			lastSeenAt: now.toISOString(),
			userAgent
		})
		.run();
	return { id, token, expiresAt };
}

export function validateSession(
	db: Db,
	token: string
): { userId: string; sessionId: string } | null {
	const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
	if (!row) return null;
	if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
	const lastSeen = new Date(row.lastSeenAt).getTime();
	if (Date.now() - lastSeen > 24 * 60 * 60 * 1000) {
		const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
		db.update(sessions)
			.set({ lastSeenAt: new Date().toISOString(), expiresAt })
			.where(eq(sessions.id, row.id))
			.run();
	} else if (Date.now() - lastSeen > 5 * 60 * 1000) {
		// Not a write per request: lastSeenAt is coarse by design.
		db.update(sessions)
			.set({ lastSeenAt: new Date().toISOString() })
			.where(eq(sessions.id, row.id))
			.run();
	}
	return { userId: row.userId, sessionId: row.id };
}

export function deleteSession(db: Db, token: string): void {
	db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}
