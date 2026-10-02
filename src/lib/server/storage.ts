import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { writeTx, type Db } from './tx.js';

// File layout under PHOTO_PATH (§6.7):
//   <treeId>/<personId | _tree>/<uuid>.<ext>   media (+ <uuid>-thumb.webp)
//   <treeId>/_cover/<uuid>.<ext>               tree cover
//   _avatars/<userId>/<uuid>.<ext>             user avatar
// Dynamic components must match SAFE; the three markers are fixed strings.

const SAFE = /^[A-Za-z0-9-]+$/;
const FILE = /^[A-Za-z0-9-]+\.(jpg|png|gif|webp)$/;

export function photoRoot(): string {
	return resolve(process.env.PHOTO_PATH ?? './photos');
}

export function isSafeSegment(s: string): boolean {
	return SAFE.test(s);
}

export type PhotoPath =
	| { kind: 'media'; treeId: string; owner: string; file: string }
	| { kind: 'cover'; treeId: string; file: string }
	| { kind: 'avatar'; userId: string; file: string };

/** Strict parse of a `/photos/…` path; null for anything off-layout (incl. `..`). */
export function parsePhotoPath(parts: string[]): PhotoPath | null {
	if (parts.length !== 3 || !FILE.test(parts[2] as string)) return null;
	const [a, b, file] = parts as [string, string, string];
	if (a === '_avatars') return SAFE.test(b) ? { kind: 'avatar', userId: b, file } : null;
	if (!SAFE.test(a)) return null;
	if (b === '_cover') return { kind: 'cover', treeId: a, file };
	return b === '_tree' || SAFE.test(b) ? { kind: 'media', treeId: a, owner: b, file } : null;
}

export function newFileName(ext: string): string {
	return `${randomUUID()}.${ext}`;
}

function abs(rel: string): string {
	const root = photoRoot();
	const full = resolve(root, rel);
	if (!full.startsWith(root + sep)) throw new Error('path escapes PHOTO_PATH');
	return full;
}

export function absPath(rel: string): string {
	return abs(rel);
}

export function writeFiles(files: Array<{ rel: string; data: Buffer }>): void {
	const done: string[] = [];
	try {
		for (const f of files) {
			const full = abs(f.rel);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, f.data, { flag: 'wx' });
			done.push(f.rel);
		}
	} catch (e) {
		deleteFiles(done);
		throw e;
	}
}

/** Best-effort removal; a missing file is fine, anything else is logged. */
export function deleteFiles(rels: string[]): void {
	for (const rel of rels) {
		try {
			rmSync(abs(rel), { force: true });
		} catch (e) {
			console.warn(`storage: could not delete ${rel}`, e);
		}
	}
}

export function deleteDirs(rels: string[]): void {
	for (const rel of rels) {
		try {
			rmSync(abs(rel), { force: true, recursive: true });
		} catch (e) {
			console.warn(`storage: could not delete dir ${rel}`, e);
		}
	}
}

export interface AfterCommit {
	files?: string[];
	dirs?: string[];
}

/**
 * Run `fn` in one immediate transaction and delete the files it names only
 * after the commit. A throw rolls back and removes nothing (§6.7, AT-27).
 */
export function commitThenDelete<T>(db: Db, fn: (tx: Db) => { value: T; after: AfterCommit }): T {
	const { value, after } = writeTx(db, fn);
	deleteFiles(after.files ?? []);
	deleteDirs(after.dirs ?? []);
	return value;
}

export function photoUrl(rel: string): string {
	return `/photos/${rel}`;
}

export function relFromUrl(url: string | null | undefined): string | null {
	return url?.startsWith('/photos/') ? url.slice('/photos/'.length) : null;
}

