import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';

/** Remove files under `photoPath` that no row references (§6.7). Returns the relative paths removed. */
export function sweepOrphans(dbPath: string, photoPath: string): string[] {
	const root = resolve(photoPath);
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	const referenced = new Set<string>();
	try {
		for (const r of db.prepare('SELECT storagePath, thumbPath FROM media').all() as Array<{ storagePath: string; thumbPath: string | null }>) {
			referenced.add(r.storagePath);
			if (r.thumbPath) referenced.add(r.thumbPath);
		}
		// Avatars and tree covers live outside the media table.
		const urls = [
			...(db.prepare('SELECT avatarUrl AS u FROM users WHERE avatarUrl IS NOT NULL').all() as Array<{ u: string }>),
			...(db.prepare('SELECT coverImage AS u FROM trees WHERE coverImage IS NOT NULL').all() as Array<{ u: string }>)
		];
		for (const { u } of urls) if (u.startsWith('/photos/')) referenced.add(u.slice('/photos/'.length));
	} finally {
		db.close();
	}
	const removed: string[] = [];
	const walk = (dir: string) => {
		if (!existsSync(dir)) return;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, e.name);
			if (e.isDirectory()) {
				walk(full);
				continue;
			}
			const rel = relative(root, full).split(/[\\/]/).join('/');
			if (!referenced.has(rel)) {
				rmSync(full, { force: true });
				removed.push(rel);
			}
		}
	};
	walk(root);
	return removed;
}
