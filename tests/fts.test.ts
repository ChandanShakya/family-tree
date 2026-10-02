import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { applyPragmas, ftsConsistencyCheck, rebuildFts } from '$lib/db/index.js';

const DIR = './.test-tmp-fts';
const DB = `${DIR}/fts-smoke.db`;

function freshDb(): Database.Database {
	if (existsSync(DB)) rmSync(DB);
	mkdirSync(DIR, { recursive: true });
	const raw = new Database(DB);
	applyPragmas(raw);
	// Every migration, in order, applied statement by statement.
	const dir = './src/lib/db/migrations';
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const sql of files.map((f) => readFileSync(`${dir}/${f}`, 'utf8'))) {
		for (const stmt of sql.split('--> statement-breakpoint')) {
			const s = stmt.trim();
			if (s) raw.exec(s);
		}
	}
	return raw;
}

describe('AT-35: FTS smoke incl Devanagari vowel-sign isolation', () => {
	let raw: Database.Database;
	beforeEach(() => {
		raw = freshDb();
		raw.prepare("INSERT INTO trees (id, name, createdAt, updatedAt) VALUES ('t1', 'T', 'x', 'x')").run();
	});
	afterEach(() => {
		raw.close();
	});

	test('AT-35: pragmas applied, insert/update/soft-delete stay in sync', () => {
		expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(raw.pragma('foreign_keys', { simple: true })).toBe(1);
		raw
			.prepare("INSERT INTO persons (id, treeId, firstName, lastName, createdAt, updatedAt) VALUES ('p1', 't1', 'Ram', 'Sharma', 'x', 'x')")
			.run();
		let n = (raw.prepare('SELECT COUNT(*) AS c FROM persons_fts').get() as { c: number }).c;
		expect(n).toBe(1);
		raw.prepare("UPDATE persons SET lastName = 'Verma' WHERE id = 'p1'").run();
		const row = raw.prepare("SELECT name FROM persons_fts WHERE personId = 'p1'").get() as { name: string };
		expect(row.name).toContain('Verma');
		raw.prepare("UPDATE persons SET deletedAt = 'now' WHERE id = 'p1'").run();
		n = (raw.prepare('SELECT COUNT(*) AS c FROM persons_fts').get() as { c: number }).c;
		expect(n).toBe(0);
		// Restore from soft-delete re-indexes.
		raw.prepare('UPDATE persons SET deletedAt = NULL WHERE id = ?').run('p1');
		n = (raw.prepare('SELECT COUNT(*) AS c FROM persons_fts').get() as { c: number }).c;
		expect(n).toBe(1);
	});

	test('AT-35: Devanagari names differing only in vowel sign do not cross-match', () => {
		raw
			.prepare("INSERT INTO persons (id, treeId, firstName, createdAt, updatedAt) VALUES ('p-nepal', 't1', 'नेपाल', 'x', 'x')")
			.run();
		raw
			.prepare("INSERT INTO persons (id, treeId, firstName, createdAt, updatedAt) VALUES ('p-niipal', 't1', 'नीपाल', 'x', 'x')")
			.run();
		const exact = raw
			.prepare("SELECT personId FROM persons_fts WHERE persons_fts MATCH '\"नेपाल\"'")
			.all() as Array<{ personId: string }>;
		expect(exact.map((r) => r.personId)).toEqual(['p-nepal']);
		const exact2 = raw
			.prepare("SELECT personId FROM persons_fts WHERE persons_fts MATCH '\"नीपाल\"'")
			.all() as Array<{ personId: string }>;
		expect(exact2.map((r) => r.personId)).toEqual(['p-niipal']);
	});

	test('AT-35: consistency check detects a missing FTS row and rebuild fixes it', () => {
		raw
			.prepare("INSERT INTO persons (id, treeId, firstName, createdAt, updatedAt) VALUES ('p1', 't1', 'A', 'x', 'x')")
			.run();
		raw.prepare("DELETE FROM persons_fts WHERE personId = 'p1'").run();
		const before = ftsConsistencyCheck(raw);
		expect(before.match).toBe(false);
		rebuildFts(raw);
		const after = ftsConsistencyCheck(raw);
		expect(after.match).toBe(true);
	});
});
