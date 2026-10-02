import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export const PRAGMAS: Array<[string, string]> = [
	['journal_mode', 'WAL'],
	['synchronous', 'NORMAL'],
	['foreign_keys', 'ON'],
	['busy_timeout', '5000'],
	['cache_size', '-64000'],
	['mmap_size', '268435456'],
	['temp_store', 'MEMORY']
];

export function applyPragmas(db: Database.Database): void {
	for (const [key, value] of PRAGMAS) {
		db.pragma(`${key} = ${value}`);
	}
}

export function openDb(path: string): { raw: Database.Database; db: BetterSQLite3Database<typeof schema> } {
	const raw = new Database(path);
	applyPragmas(raw);
	const db = drizzle(raw, { schema });
	return { raw, db };
}

export function runMigrations(dbPath: string, migrationsPath: string): void {
	const { raw } = openDb(dbPath);
	try {
		migrate(drizzle(raw, { schema }), { migrationsFolder: migrationsPath });
	} finally {
		raw.close();
	}
}

export function ftsConsistencyCheck(raw: Database.Database): { ftsCount: number; personsCount: number; match: boolean } {
	const ftsCount = (raw.prepare('SELECT COUNT(*) AS c FROM persons_fts').get() as { c: number }).c;
	const personsCount = (raw.prepare('SELECT COUNT(*) AS c FROM persons WHERE deletedAt IS NULL').get() as {
		c: number;
	}).c;
	return { ftsCount, personsCount, match: ftsCount === personsCount };
}

export function rebuildFts(raw: Database.Database): void {
	raw.exec('DELETE FROM persons_fts');
	raw.exec('DELETE FROM person_fts_map');
	const rows = raw
		.prepare(
			"SELECT id, treeId, trim(firstName || ' ' || coalesce(middleName,'') || ' ' || coalesce(lastName,'') || ' ' || coalesce(maidenName,'')) AS name, CASE WHEN birthDateNorm IS NULL OR substr(birthDateNorm,1,4) = '0000' THEN '' ELSE substr(birthDateNorm,1,4) END AS birthYear, trim(coalesce(birthPlace,'') || ' ' || coalesce(deathPlace,'')) AS place FROM persons WHERE deletedAt IS NULL"
		)
		.all() as Array<{ id: string; treeId: string; name: string; birthYear: string; place: string }>;
	const insertMap = raw.prepare('INSERT OR IGNORE INTO person_fts_map (personId) VALUES (?)');
	const getFtsId = raw.prepare('SELECT fts_id AS id FROM person_fts_map WHERE personId = ?');
	const insertFts = raw.prepare(
		'INSERT INTO persons_fts (rowid, name, birthYear, place, personId, treeId) VALUES (?, ?, ?, ?, ?, ?)'
	);
	const txn = raw.transaction((list: typeof rows) => {
		for (const r of list) {
			insertMap.run(r.id);
			const map = getFtsId.get(r.id) as { id: number };
			insertFts.run(map.id, r.name, r.birthYear, r.place, r.id, r.treeId);
		}
	});
	txn(rows);
}

export function migrateAndCheck(dbPath: string, migrationsPath: string): { rebuilt: boolean } {
	const { raw } = openDb(dbPath);
	try {
		migrate(drizzle(raw, { schema }), { migrationsFolder: migrationsPath });
		const check = ftsConsistencyCheck(raw);
		if (!check.match) {
			console.warn(
				`FTS consistency mismatch: persons_fts=${check.ftsCount} persons=${check.personsCount}, rebuilding`
			);
			rebuildFts(raw);
			return { rebuilt: true };
		}
		return { rebuilt: false };
	} finally {
		raw.close();
	}
}
