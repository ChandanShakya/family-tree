import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import tar from 'tar-stream';
import { openDb, rebuildFts } from '../../src/lib/db/index.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/lib/db/schema.js';

// Instance backup and restore (§6.9, §11). A live WAL database is never copied as a file: the SQLite
// backup API produces a page-exact snapshot while the app keeps running.

export async function backupDatabase(dbPath: string, dest: string): Promise<void> {
	mkdirSync(dirname(dest), { recursive: true });
	const src = new Database(dbPath, { readonly: true, fileMustExist: true });
	src.pragma('busy_timeout = 5000');
	try {
		await src.backup(dest);
	} finally {
		src.close();
	}
}

export async function tarPhotos(photoDir: string, dest: string): Promise<number> {
	const pack = tar.pack();
	const out = createWriteStream(dest);
	const done = pipeline(pack, out);
	let n = 0;
	const walk = async (dir: string) => {
		if (!existsSync(dir)) return;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) {
				await walk(p);
				continue;
			}
			await new Promise<void>((resolve, reject) => {
				const entry = pack.entry({ name: relative(resolvePath(photoDir), resolvePath(p)), size: statSync(p).size }, (err) => (err ? reject(err) : resolve()));
				createReadStream(p).on('error', reject).pipe(entry);
			});
			n++;
		}
	};
	await walk(photoDir);
	pack.finalize();
	await done;
	return n;
}

export async function untarPhotos(tarFile: string, photoDir: string): Promise<number> {
	const extract = tar.extract();
	let n = 0;
	extract.on('entry', (header, stream, next) => {
		const root = resolvePath(photoDir);
		const target = resolvePath(root, header.name);
		// entries stay inside the photo directory
		if (!target.startsWith(root + sep)) {
			stream.resume();
			return next();
		}
		mkdirSync(dirname(target), { recursive: true });
		pipeline(stream, createWriteStream(target)).then(() => {
			n++;
			next();
		}, next);
	});
	await pipeline(createReadStream(tarFile), extract);
	return n;
}

/**
 * Put a snapshot in place: remove stale WAL/SHM files, copy, migrate to the current schema and rebuild
 * the full-text index (a restored index is never trusted).
 */
export function restoreDatabase(backupFile: string, dbPath: string, migrationsPath: string): void {
	mkdirSync(dirname(dbPath), { recursive: true });
	for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
	copyFileSync(backupFile, dbPath);
	const { raw } = openDb(dbPath);
	try {
		migrate(drizzle(raw, { schema }), { migrationsFolder: migrationsPath });
		rebuildFts(raw);
	} finally {
		raw.close();
	}
}
