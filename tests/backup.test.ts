import { describe, expect, test, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createTree } from '$lib/server/trees.js';
import { createPerson } from '$lib/server/persons.js';
import { ftsSearch } from '$lib/server/search.js';
import { backupDatabase, restoreDatabase, tarPhotos, untarPhotos } from '../scripts/lib/backup.js';
import { makeUser } from './helpers.js';

const DIR = './.test-tmp-backup';
afterAll(() => rmSync(DIR, { force: true, recursive: true }));

describe('AT-22: backup and restore', () => {
	test('AT-22: backup, wipe, restore into a clean DB, then FTS search gives identical results and photos return', async () => {
		rmSync(DIR, { force: true, recursive: true });
		mkdirSync(`${DIR}/photos/t1/p1`, { recursive: true });
		const live = `${DIR}/live.db`;
		const raw = new Database(live);
		applyPragmas(raw);
		migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
		const db = drizzle(raw, { schema });
		const h = { raw, db };
		const owner = makeUser(db);
		const tree = createTree(h, owner.id, { name: 'Backup Tree' }).id;
		for (const [f, l] of [['Ramesh', 'Sharma'], ['नेपाल', 'थापा'], ['नीपाल', 'थापा'], ['Sita', 'Rai']] as const) createPerson(h, owner.id, tree, { firstName: f, lastName: l });
		writeFileSync(`${DIR}/photos/t1/p1/a.png`, 'photo-bytes');
		const queries = ['Rames', 'नेपाल', 'नीपाल', 'थापा', 'Sit'];
		const before = queries.map((q) => ftsSearch(h, tree, q).map((x) => x.id).sort());
		expect(before.every((b) => b.length > 0)).toBe(true);

		// snapshot while the connection stays open (the backup API, not a file copy)
		await backupDatabase(live, `${DIR}/out/family.db`);
		expect(await tarPhotos(`${DIR}/photos`, `${DIR}/out/photos.tar`)).toBe(1);
		raw.close();
		// wipe everything
		for (const s of ['', '-wal', '-shm']) rmSync(`${live}${s}`, { force: true });
		rmSync(`${DIR}/photos`, { recursive: true });

		const restored = `${DIR}/restored/new.db`;
		restoreDatabase(`${DIR}/out/family.db`, restored, './src/lib/db/migrations');
		expect(await untarPhotos(`${DIR}/out/photos.tar`, `${DIR}/photos`)).toBe(1);
		expect(readFileSync(`${DIR}/photos/t1/p1/a.png`, 'utf8')).toBe('photo-bytes');
		const r2 = new Database(restored);
		applyPragmas(r2);
		const h2 = { raw: r2, db: drizzle(r2, { schema }) };
		expect(queries.map((q) => ftsSearch(h2, tree, q).map((x) => x.id).sort())).toEqual(before);
		// the vowel-sign pair still never cross after the rebuild
		expect(ftsSearch(h2, tree, 'नेपाल')).toHaveLength(1);
		const counts = r2.prepare(`SELECT (SELECT COUNT(*) FROM persons) AS p, (SELECT COUNT(*) FROM persons_fts) AS f`).get();
		expect(counts).toEqual({ p: 4, f: 4 });
		r2.close();
		expect(existsSync(`${restored}-wal`)).toBe(false);
	}, 60_000);

	test('AT-22: untar refuses entries that escape the photo directory', async () => {
		const tar = (await import('tar-stream')).default;
		const pack = tar.pack();
		pack.entry({ name: '../evil.txt' }, 'x');
		pack.entry({ name: 'ok/a.txt' }, 'y');
		pack.finalize();
		const chunks: Buffer[] = [];
		for await (const c of pack) chunks.push(Buffer.from(c as Uint8Array));
		mkdirSync(DIR, { recursive: true });
		writeFileSync(`${DIR}/evil.tar`, Buffer.concat(chunks));
		expect(await untarPhotos(`${DIR}/evil.tar`, `${DIR}/safe`)).toBe(1);
		expect(existsSync(`${DIR}/evil.txt`)).toBe(false);
		expect(existsSync(join(`${DIR}/safe`, 'ok/a.txt'))).toBe(true);
	});
});
