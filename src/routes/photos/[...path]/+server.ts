import { readFile } from 'node:fs/promises';
import { eq, or } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { media, trees, users } from '$lib/db/schema.js';
import { personVisibleToPublic } from '$lib/server/public-access.js';
import { requireTreeAccess } from '$lib/server/permissions.js';
import { absPath, parsePhotoPath, photoUrl } from '$lib/server/storage.js';

const TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp'
};

// Errors are never cacheable by shared caches either.
const fail = (status: number, code: string): Response =>
	new Response(JSON.stringify({ error: { code, message: status === 401 ? 'Not signed in' : 'Not found' } }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }
	});

// Always `private`: no shared cache (a Cloudflare rule included) may keep a photo (§6.7).
async function serve(rel: string, file: string): Promise<Response> {
	const data = await readFile(absPath(rel)).catch(() => null);
	if (!data) return fail(404, 'NOT_FOUND');
	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': TYPES[file.split('.').pop() as string] ?? 'application/octet-stream',
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-disposition': 'inline'
		}
	});
}

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	const parts = (event.params.path ?? '').split('/');
	const parsed = parsePhotoPath(parts);
	if (!user && !parsed) return fail(401, 'UNAUTHENTICATED');
	if (!parsed) return fail(404, 'NOT_FOUND');
	const rel = parts.join('/');
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		if (!user) {
			// Anonymous: only a non-living person's photo in a public tree. Private, unknown and
			// non-media paths are the same 401; a living person's photo in a public tree is a 404 (§4).
			if (parsed.kind !== 'media') return fail(401, 'UNAUTHENTICATED');
			const row = db
				.select({ treeId: media.treeId, personId: media.personId, pub: trees.isPublic })
				.from(media)
				.innerJoin(trees, eq(trees.id, media.treeId))
				.where(or(eq(media.storagePath, rel), eq(media.thumbPath, rel)))
				.get();
			if (!row || row.pub !== 1) return fail(401, 'UNAUTHENTICATED');
			if (!row.personId || !personVisibleToPublic(raw, row.personId)) return fail(404, 'NOT_FOUND');
			return serve(rel, parsed.file);
		}
		let allowed = false;
		if (parsed.kind === 'media') {
			// The row, not the path, decides which tree owns the file.
			const row = db
				.select({ treeId: media.treeId, personId: media.personId })
				.from(media)
				.where(or(eq(media.storagePath, rel), eq(media.thumbPath, rel)))
				.get();
			if (row) {
				const live =
					!row.personId ||
					raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ?`).get(row.personId) !== undefined;
				allowed = live && requireTreeAccess(db, user.id, row.treeId, 'view').ok;
			}
		} else if (parsed.kind === 'cover') {
			const t = db.select({ cover: trees.coverImage }).from(trees).where(eq(trees.id, parsed.treeId)).get();
			allowed = t?.cover === photoUrl(rel) && requireTreeAccess(db, user.id, parsed.treeId, 'view').ok;
		} else {
			const u = db.select({ avatar: users.avatarUrl }).from(users).where(eq(users.id, parsed.userId)).get();
			if (u?.avatar === photoUrl(rel)) {
				allowed =
					parsed.userId === user.id ||
					raw
						.prepare(
							`SELECT 1 FROM treeMembers a JOIN treeMembers b ON a.treeId = b.treeId
							 WHERE a.userId = ? AND b.userId = ? AND a.status = 'active' AND b.status = 'active' LIMIT 1`
						)
						.get(user.id, parsed.userId) !== undefined;
			}
		}
		if (!allowed) return fail(404, 'NOT_FOUND');
		return serve(rel, parsed.file);
	} finally {
		raw.close();
	}
};
