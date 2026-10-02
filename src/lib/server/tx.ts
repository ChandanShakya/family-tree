import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '$lib/db/schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/** Raw + Drizzle handles over one connection (routes open both per request). */
export interface Handles {
	raw: Database.Database;
	db: Db;
}

// All multi-statement writes run as BEGIN IMMEDIATE (§3): a writer reserves
// the database up front instead of upgrading mid-transaction (which would
// deadlock under contention and surface SQLITE_BUSY as a 500).
export function writeTx<T>(db: Db, fn: (tx: Db) => T): T {
	return db.transaction(fn, { behavior: 'immediate' });
}

export function newBatchId(): string {
	return randomBytes(16).toString('hex');
}
