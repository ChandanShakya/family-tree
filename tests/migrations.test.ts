import { describe, expect, test } from 'vitest';
import { mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { applyPragmas, ftsConsistencyCheck, rebuildFts } from '$lib/db/index.js';

const DIR = './.test-tmp-mig';
const MIGRATIONS = './src/lib/db/migrations';

// Simulates "upgrade from the previous migration with data present": apply
// only the base schema migration, insert rows, then run the full migrator.
describe('AT-35: migrations fresh and upgrade', () => {
	test('AT-35: fresh DB has complete schema', () => {
		const path = `${DIR}/fresh.db`;
		rmSync(path, { force: true });
		mkdirSync(DIR, { recursive: true });
		const raw = new Database(path);
		try {
			applyPragmas(raw);
			migrate(drizzle(raw), { migrationsFolder: MIGRATIONS });
			const tables = raw
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
				.all() as Array<{ name: string }>;
			const names = tables.map((t) => t.name);
			for (const t of [
				'users',
				'oauthAccounts',
				'trees',
				'persons',
				'treeMembers',
				'relationships',
				'joinCodes',
				'profileClaims',
				'verificationQuestions',
				'claimAttempts',
				'changeHistory',
				'events',
				'media',
				'sessions',
				'notifications',
				'passwordResetTokens',
				'emailVerificationTokens',
				'person_fts_map',
				'persons_fts'
			]) {
				expect(names, `table ${t}`).toContain(t);
			}
			const views = raw
				.prepare("SELECT name FROM sqlite_master WHERE type = 'view'")
				.all() as Array<{ name: string }>;
			expect(views.map((v) => v.name)).toContain('visible_persons');
			expect(ftsConsistencyCheck(raw).match).toBe(true);
		} finally {
			raw.close();
		}
	});

	test('AT-35: upgrade from base migration preserves data and installs FTS', () => {
		const path = `${DIR}/upgrade.db`;
		rmSync(path, { force: true });
		mkdirSync(DIR, { recursive: true });
		const raw = new Database(path);
		try {
			applyPragmas(raw);
			// Apply base migration statements only (files are ordered; entry 0000 first).
			const first = readdirSync(MIGRATIONS)
				.filter((f) => f.endsWith('.sql'))
				.sort()[0] as string;
			for (const stmt of readFileSync(`${MIGRATIONS}/${first}`, 'utf8').split('--> statement-breakpoint')) {
				if (stmt.trim()) raw.exec(stmt);
			}
			// Mark 0000 as applied so the migrator only runs the rest (drizzle
			// skips migrations with folderMillis <= last created_at in
			// __drizzle_migrations).
			const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
				entries: Array<{ tag: string; when: number }>;
			};
			const baseWhen = journal.entries.find((e) => e.tag === first.replace(/\.sql$/, ''))?.when;
			if (!baseWhen) throw new Error(`no journal entry for ${first}`);
			raw.exec(
				`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`
			);
			raw.prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`).run(first, baseWhen);
			const now = new Date().toISOString();
			raw.prepare("INSERT INTO users (id, email, displayName, createdAt) VALUES ('u1', 'a@b.c', 'A', ?)").run(now);
			raw.prepare("INSERT INTO trees (id, name, ownerId, createdAt, updatedAt) VALUES ('t1', 'T', 'u1', ?, ?)").run(now, now);
			raw.prepare("INSERT INTO persons (id, treeId, firstName, createdAt, updatedAt) VALUES ('p1', 't1', 'Keep', ?, ?)").run(now, now);
			// Now run the real migrator over the rest.
			migrate(drizzle(raw), { migrationsFolder: MIGRATIONS });
			const person = raw.prepare("SELECT firstName FROM persons WHERE id = 'p1'").get() as {
				firstName: string;
			};
			expect(person.firstName).toBe('Keep');
			// Pre-FTS row has no index entry; consistency check must catch and rebuild must fix.
			const check = ftsConsistencyCheck(raw);
			expect(check.match).toBe(false);
			rebuildFts(raw);
			expect(ftsConsistencyCheck(raw).match).toBe(true);
		} finally {
			raw.close();
		}
	});
});
