import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { IMAGE_MAX_PIXELS, UPLOAD_MAX_BYTES } from '$lib/config.js';
import { media, persons, trees, users } from '$lib/db/schema.js';
import { writeHistory } from './audit.js';
import {
	commitThenDelete,
	deleteFiles,
	newFileName,
	photoUrl,
	relFromUrl,
	writeFiles
} from './storage.js';
import { notifyEdit } from './notifications.js';
import { writeTx, type Handles } from './tx.js';

// §6.7: sharp re-encodes every upload (strips EXIF/GPS) under hard pixel and
// concurrency caps so one bomb cannot exhaust memory.
// sharp is loaded on the first upload (it costs ~25 MB resident) and capped once: one libvips thread, no cache.
let sharpModule: Promise<typeof import('sharp')> | null = null;
function loadSharp(): Promise<typeof import('sharp')> {
	sharpModule ??= import('sharp').then((m) => {
		m.default.concurrency(1);
		m.default.cache(false);
		return m;
	});
	return sharpModule;
}

export type MediaError = 'UNSUPPORTED_MEDIA' | 'TOO_LARGE' | 'IMAGE_TOO_LARGE' | 'NOT_FOUND';

type Fmt = { ext: 'jpg' | 'png' | 'gif' | 'webp'; mime: string; sharpFmt: 'jpeg' | 'png' | 'gif' | 'webp' };

export function sniff(b: Buffer): Fmt | null {
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
		return { ext: 'jpg', mime: 'image/jpeg', sharpFmt: 'jpeg' };
	if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
		return { ext: 'png', mime: 'image/png', sharpFmt: 'png' };
	if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')))
		return { ext: 'gif', mime: 'image/gif', sharpFmt: 'gif' };
	if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP')
		return { ext: 'webp', mime: 'image/webp', sharpFmt: 'webp' };
	return null;
}

export interface Processed {
	fmt: Fmt;
	main: Buffer;
	thumb: Buffer;
}

export async function processImage(buf: Buffer): Promise<Processed | { error: MediaError }> {
	if (buf.length > UPLOAD_MAX_BYTES) return { error: 'TOO_LARGE' };
	const fmt = sniff(buf);
	if (!fmt) return { error: 'UNSUPPORTED_MEDIA' };
	try {
		const sharp = (await loadSharp()).default;
		const src = () => sharp(buf, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: 'error' }).rotate();
		const main = await src().toFormat(fmt.sharpFmt).toBuffer();
		const thumb = await src()
			.resize(400, 400, { fit: 'inside', withoutEnlargement: true })
			.webp()
			.toBuffer();
		return { fmt, main, thumb };
	} catch (e) {
		if (/pixel limit/i.test(String((e as Error).message))) return { error: 'IMAGE_TOO_LARGE' };
		// Right magic bytes but undecodable body.
		return { error: 'UNSUPPORTED_MEDIA' };
	}
}

export type MediaRow = typeof media.$inferSelect;

export async function addMedia(
	h: Handles,
	actorId: string,
	treeId: string,
	input: { personId?: string | null; buf: Buffer; caption?: string; makePrimary?: boolean }
): Promise<{ media: MediaRow; batchId: string } | { error: MediaError }> {
	const personId = input.personId ?? null;
	if (personId) {
		const p = h.raw.prepare(`SELECT id FROM visible_persons WHERE id = ? AND treeId = ?`).get(personId, treeId);
		if (!p) return { error: 'NOT_FOUND' };
	}
	const img = await processImage(input.buf);
	if ('error' in img) return img;
	const base = randomUUID();
	const dir = `${treeId}/${personId ?? '_tree'}`;
	const storagePath = `${dir}/${base}.${img.fmt.ext}`;
	const thumbPath = `${dir}/${base}-thumb.webp`;
	writeFiles([
		{ rel: storagePath, data: img.main },
		{ rel: thumbPath, data: img.thumb }
	]);
	const id = randomUUID();
	let batchId: string;
	try {
		batchId = writeTx(h.db, (tx) => {
			tx.insert(media)
				.values({
					id,
					personId,
					treeId,
					uploadedBy: actorId,
					storagePath,
					thumbPath,
					mime: img.fmt.mime,
					sizeBytes: img.main.length,
					type: 'photo',
					caption: input.caption ?? null,
					createdAt: new Date().toISOString()
				})
				.run();
			if (input.makePrimary && personId) {
				tx.update(persons).set({ photoUrl: photoUrl(storagePath) }).where(eq(persons.id, personId)).run();
			}
			const b = writeHistory(tx, { treeId, entityType: 'media', entityId: id, changedBy: actorId, action: 'create' });
			if (personId) notifyEdit(tx, { treeId, personId, actorId });
			return b;
		});
	} catch (e) {
		deleteFiles([storagePath, thumbPath]);
		throw e;
	}
	return { media: h.db.select().from(media).where(eq(media.id, id)).get() as MediaRow, batchId };
}

export function updateMedia(
	h: Handles,
	actorId: string,
	mediaId: string,
	patch: { caption?: string | null; makePrimary?: boolean }
): { media: MediaRow; batchId?: string } | { error: 'NOT_FOUND' } {
	const row = h.db.select().from(media).where(eq(media.id, mediaId)).get();
	if (!row) return { error: 'NOT_FOUND' };
	const batchId = writeTx(h.db, (tx) => {
		let batch: string | undefined;
		if (patch.caption !== undefined && patch.caption !== row.caption) {
			tx.update(media).set({ caption: patch.caption }).where(eq(media.id, mediaId)).run();
			batch = writeHistory(tx, {
				treeId: row.treeId,
				entityType: 'media',
				entityId: mediaId,
				changedBy: actorId,
				action: 'update',
				field: 'caption',
				oldValue: row.caption,
				newValue: patch.caption
			});
		}
		if (patch.makePrimary && row.personId) {
			tx.update(persons).set({ photoUrl: photoUrl(row.storagePath) }).where(eq(persons.id, row.personId)).run();
			batch = writeHistory(tx, {
				treeId: row.treeId,
				entityType: 'media',
				entityId: mediaId,
				changedBy: actorId,
				action: 'update',
				field: 'primary',
				newValue: true,
				batchId: batch
			});
		}
		if (batch && row.personId) notifyEdit(tx, { treeId: row.treeId, personId: row.personId, actorId });
		return batch;
	});
	return { media: h.db.select().from(media).where(eq(media.id, mediaId)).get() as MediaRow, batchId };
}

export function deleteMedia(h: Handles, actorId: string, mediaId: string): { deleted: true } | { error: 'NOT_FOUND' } {
	const row = h.db.select().from(media).where(eq(media.id, mediaId)).get();
	if (!row) return { error: 'NOT_FOUND' };
	commitThenDelete(h.db, (tx) => {
		tx.delete(media).where(eq(media.id, mediaId)).run();
		if (row.personId) {
			// Clear the primary pointer only when it pointed at this row.
			tx.update(persons)
				.set({ photoUrl: null })
				.where(and(eq(persons.id, row.personId), eq(persons.photoUrl, photoUrl(row.storagePath))))
				.run();
		}
		writeHistory(tx, {
			treeId: row.treeId,
			entityType: 'media',
			entityId: mediaId,
			changedBy: actorId,
			action: 'delete',
			snapshot: row
		});
		if (row.personId) notifyEdit(tx, { treeId: row.treeId, personId: row.personId, actorId });
		return { value: null, after: { files: [row.storagePath, ...(row.thumbPath ? [row.thumbPath] : [])] } };
	});
	return { deleted: true };
}

/** Hard purge of one person and dependents; files go after commit (§6.7, §5.1). */
export function purgePerson(h: Handles, personId: string): { purged: true } | { error: 'NOT_FOUND' } {
	const p = h.db.select().from(persons).where(eq(persons.id, personId)).get();
	if (!p) return { error: 'NOT_FOUND' };
	commitThenDelete(h.db, (tx) => {
		const rows = tx.select().from(media).where(eq(media.personId, personId)).all();
		tx.delete(persons).where(eq(persons.id, personId)).run(); // events, relationships, media cascade
		return {
			value: null,
			after: { files: rows.flatMap((r) => [r.storagePath, ...(r.thumbPath ? [r.thumbPath] : [])]) }
		};
	});
	return { purged: true };
}

/** Tree gallery, newest first, cursor = `createdAt|id`. */
export function listTreeMedia(h: Handles, treeId: string, cursor?: string, limit = 40) {
	const [cAt, cId] = cursor?.split('|') ?? [];
	const rows = h.db
		.select()
		.from(media)
		.where(
			and(
				eq(media.treeId, treeId),
				cAt && cId
					? or(lt(media.createdAt, cAt), and(eq(media.createdAt, cAt), lt(media.id, cId)))
					: undefined
			)
		)
		.orderBy(desc(media.createdAt), desc(media.id))
		.limit(limit + 1)
		.all();
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return { data: page, nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null };
}

/** Single-image pipeline for avatars and covers: re-encoded, no thumbnail row. */
async function putSingle(
	rel: (file: string) => string,
	buf: Buffer
): Promise<{ rel: string } | { error: MediaError }> {
	const img = await processImage(buf);
	if ('error' in img) return img;
	const path = rel(newFileName(img.fmt.ext));
	writeFiles([{ rel: path, data: img.main }]);
	return { rel: path };
}

export async function setAvatar(h: Handles, userId: string, buf: Buffer): Promise<{ url: string } | { error: MediaError }> {
	const put = await putSingle((f) => `_avatars/${userId}/${f}`, buf);
	if ('error' in put) return put;
	try {
		commitThenDelete(h.db, (tx) => {
			const old = relFromUrl(tx.select().from(users).where(eq(users.id, userId)).get()?.avatarUrl);
			tx.update(users).set({ avatarUrl: photoUrl(put.rel) }).where(eq(users.id, userId)).run();
			return { value: null, after: { files: old ? [old] : [] } };
		});
	} catch (e) {
		deleteFiles([put.rel]);
		throw e;
	}
	return { url: photoUrl(put.rel) };
}

export async function setCover(
	h: Handles,
	actorId: string,
	treeId: string,
	buf: Buffer
): Promise<{ url: string } | { error: MediaError }> {
	const put = await putSingle((f) => `${treeId}/_cover/${f}`, buf);
	if ('error' in put) return put;
	try {
		commitThenDelete(h.db, (tx) => {
			const old = relFromUrl(tx.select().from(trees).where(eq(trees.id, treeId)).get()?.coverImage);
			tx.update(trees).set({ coverImage: photoUrl(put.rel) }).where(eq(trees.id, treeId)).run();
			writeHistory(tx, {
				treeId,
				entityType: 'tree',
				entityId: treeId,
				changedBy: actorId,
				action: 'update',
				field: 'coverImage',
				newValue: photoUrl(put.rel)
			});
			return { value: null, after: { files: old ? [old] : [] } };
		});
	} catch (e) {
		deleteFiles([put.rel]);
		throw e;
	}
	return { url: photoUrl(put.rel) };
}
