import { mkdirSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { applyPragmas } from '$lib/db/index.js';
import * as schema from '$lib/db/schema.js';
import { users } from '$lib/db/schema.js';

// One directory per test file (module instance): files run in parallel and each cleans up after itself.
const DIR = `./.test-tmp-h-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const MIGRATIONS = './src/lib/db/migrations';
let n = 0;

export interface TestHandles {
	raw: Database.Database;
	db: ReturnType<typeof drizzle<typeof schema>>;
	path: string;
}

const open: TestHandles[] = [];

export function freshHandles(): TestHandles {
	const path = `${DIR}/p2-${process.pid}-${n++}.db`;
	rmSync(path, { force: true });
	mkdirSync(DIR, { recursive: true });
	const raw = new Database(path);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: MIGRATIONS });
	const h = { raw, db: drizzle(raw, { schema }), path };
	open.push(h);
	return h;
}

export function closeAllHandles(): void {
	for (const h of open.splice(0)) {
		try {
			h.raw.close();
		} catch {
			// ignore
		}
		rmSync(h.path, { force: true });
	}
	rmSync(DIR, { force: true, recursive: true });
}

let userN = 0;

export function makeUser(
	db: TestHandles['db'],
	email?: string,
	displayName = 'Test User'
): { id: string; email: string } {
	const address = email ?? `p2user${userN++}@example.com`;
	const id = `u-${address}`;
	const now = new Date().toISOString();
	db.insert(users)
		.values({ id, email: address, displayName, createdAt: now })
		.run();
	return { id, email: address };
}

export function userRow(db: TestHandles['db'], id: string) {
	return db.select().from(users).where(eq(users.id, id)).get();
}

/** Stop a spawned server and wait for it to exit, so its shutdown checkpoint never races directory removal. */
export async function stopServer(proc: import('node:child_process').ChildProcess | null | undefined): Promise<void> {
	if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
	const exited = new Promise((r) => proc.once('exit', r));
	proc.kill();
	await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
}
