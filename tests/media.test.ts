import { stopServer } from './helpers.js';
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import * as schema from '$lib/db/schema.js';
import { persons, treeMembers, users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createSession } from '$lib/server/auth.js';
import { createTree, deleteTree } from '$lib/server/trees.js';
import { createPerson } from '$lib/server/persons.js';
import { addMedia, deleteMedia, purgePerson, setAvatar } from '$lib/server/media.js';
import { commitThenDelete, parsePhotoPath } from '$lib/server/storage.js';
import { deleteAccount } from '$lib/server/accounts.js';

const DIR = './.test-tmp-media';
const DB = `${DIR}/media.db`;
const PHOTOS = `${DIR}/photos`;
const PORT = 4193;
const BASE = `http://localhost:${PORT}`;

process.env.PHOTO_PATH = PHOTOS;

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let h: { raw: Database.Database; db: typeof db };
let server: ReturnType<typeof import('node:child_process').spawn>;
let ownerId: string, viewerId: string, outsiderId: string;
let treeA: string, treeB: string, personA: string;
let cookies: { owner: string; viewer: string; outsider: string };

const png = (w: number, hgt: number) =>
	sharp({ create: { width: w, height: hgt, channels: 3, background: '#38b' } }).png().toBuffer();

function allFiles(dir = PHOTOS): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)]
	);
}

async function upload(
	cookie: string | undefined,
	file: Buffer,
	fields: Record<string, string>,
	name = 'x.png'
) {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	f.set('file', new Blob([new Uint8Array(file)]), name);
	const res = await fetch(`${BASE}/api/media`, {
		method: 'POST',
		headers: { origin: BASE, ...(cookie ? { cookie: `session=${cookie}` } : {}) },
		body: f
	});
	return { status: res.status, json: (await res.json().catch(() => ({}))) as {
			data: { storagePath: string; thumbPath: string };
			error: { code: string };
		} };
}

const get = (path: string, cookie?: string) =>
	fetch(`${BASE}${path}`, { headers: cookie ? { cookie: `session=${cookie}` } : {} });

beforeAll(async () => {
	rmSync(DIR, { force: true, recursive: true });
	mkdirSync(DIR, { recursive: true });
	raw = new Database(DB);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	db = drizzle(raw, { schema });
	h = { raw, db };
	const now = new Date().toISOString();
	const addUser = (email: string) => {
		const id = randomUUID();
		db.insert(users).values({ id, email, displayName: email, createdAt: now }).run();
		return id;
	};
	ownerId = addUser('m-owner@example.com');
	viewerId = addUser('m-viewer@example.com');
	outsiderId = addUser('m-outsider@example.com');
	treeA = createTree(h, ownerId, { name: 'A' }).id;
	treeB = createTree(h, outsiderId, { name: 'B' }).id;
	db.insert(treeMembers)
		.values({ id: randomUUID(), treeId: treeA, userId: viewerId, role: 'viewer', status: 'active', joinedAt: now, joinedViaType: 'manual' })
		.run();
	personA = createPerson(h, ownerId, treeA, { firstName: 'Pa' }).id;
	const tok = async (u: string) => (await createSession(db, u, null)).token;
	cookies = { owner: await tok(ownerId), viewer: await tok(viewerId), outsider: await tok(outsiderId) };
	raw.close();
	const { spawn } = await import('node:child_process');
	server = spawn('node', ['build'], {
		env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ORIGIN: BASE, RATE_LIMIT_API_MAX: '100000', PHOTO_PATH: PHOTOS, BODY_SIZE_LIMIT: '12M' }
	});
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(`${BASE}/api/health`)).ok) break;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	// Reopen for service-level (AT-27) work in this process.
	raw = new Database(DB);
	applyPragmas(raw);
	db = drizzle(raw, { schema });
	h = { raw, db };
}, 60_000);

afterAll(async () => {
	await stopServer(server);
	raw?.close();
	rmSync(DIR, { force: true, recursive: true });
});

describe('AT-16: upload validation', () => {
	test('AT-16: wrong magic bytes 415, oversize 413, bomb 413 IMAGE_TOO_LARGE, none write a file', async () => {
		const before = allFiles().length;
		const bad = await upload(cookies.owner, Buffer.from('not an image at all'), { treeId: treeA });
		expect(bad.status).toBe(415);
		const huge = Buffer.concat([await png(10, 10), Buffer.alloc(10 * 1024 * 1024)]);
		const big = await upload(cookies.owner, huge, { treeId: treeA });
		expect(big.status).toBe(413);
		const bomb = await upload(cookies.owner, await png(6000, 6000), { treeId: treeA });
		expect(bomb.status).toBe(413);
		expect(bomb.json.error.code).toBe('IMAGE_TOO_LARGE');
		expect(allFiles().length).toBe(before);
	}, 60_000);

	test('AT-16: path components with .. or off-layout names are rejected', async () => {
		expect(parsePhotoPath(['a', '..', 'x.png'])).toBeNull();
		expect(parsePhotoPath(['a', 'b', '..'])).toBeNull();
		expect(parsePhotoPath(['a', 'b', 'x.svg'])).toBeNull();
		expect(parsePhotoPath(['a_b', 'c', 'x.png'])).toBeNull();
		expect(parsePhotoPath([treeA, '_tree', 'x.png'])).not.toBeNull();
		const res = await get(`/photos/${treeA}/%2e%2e/%2e%2e/etc/passwd`, cookies.owner);
		expect(res.status).toBe(404);
	});

	test('AT-16: valid upload is re-encoded without EXIF and gets a thumbnail ≤400px', async () => {
		const withExif = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#a52' } })
			.withExif({ IFD0: { Copyright: 'secret-gps-marker' } })
			.jpeg()
			.toBuffer();
		expect((await sharp(withExif).metadata()).exif).toBeDefined();
		const r = await upload(cookies.owner, withExif, { treeId: treeA, personId: personA, makePrimary: 'true' }, 'p.jpg');
		expect(r.status).toBe(201);
		const row = r.json.data;
		const stored = await sharp(join(PHOTOS, row.storagePath)).metadata();
		expect(stored.exif).toBeUndefined();
		const thumb = await sharp(join(PHOTOS, row.thumbPath)).metadata();
		expect(Math.max(thumb.width!, thumb.height!)).toBeLessThanOrEqual(400);
		const p = db.select().from(persons).where(eq(persons.id, personA)).get();
		expect(p?.photoUrl).toBe(`/photos/${row.storagePath}`);
		expect(row.storagePath).toMatch(new RegExp(`^${treeA}/${personA}/[0-9a-f-]{36}\\.jpg$`));
	});
});

describe('AT-17: /photos access', () => {
	test('AT-17: anonymous 401, other-tree member 404, member 200; headers private never public', async () => {
		const up = await upload(cookies.owner, await png(50, 50), { treeId: treeA });
		expect(up.status).toBe(201);
		const url = `/photos/${up.json.data.storagePath}`;
		const anon = await get(url);
		expect(anon.status).toBe(401);
		const out = await get(url, cookies.outsider);
		expect(out.status).toBe(404);
		for (const r of [anon, out]) expect(r.headers.get('cache-control') ?? '').not.toContain('public');
		const ok = await get(url, cookies.viewer);
		expect(ok.status).toBe(200);
		const cc = ok.headers.get('cache-control') ?? '';
		expect(cc).toContain('private');
		expect(cc).not.toContain('public');
		expect(cc).toContain('immutable');
		expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
		expect(ok.headers.get('content-type')).toBe('image/png');
		expect(ok.headers.get('content-disposition')).toBe('inline');
		// thumbnail follows the same rule
		const th = await get(`/photos/${up.json.data.thumbPath}`, cookies.outsider);
		expect(th.status).toBe(404);
		// A same-name file path under another tree id does not leak: the row decides.
		const forged = url.replace(treeA, treeB);
		expect((await get(forged, cookies.outsider)).status).toBe(404);
	});

	test('AT-17: avatar served only to the owner and users sharing an active tree', async () => {
		const set = await setAvatar(h, ownerId, await png(30, 30));
		expect('url' in set).toBe(true);
		const url = (set as { url: string }).url;
		expect((await get(url, cookies.owner)).status).toBe(200);
		expect((await get(url, cookies.viewer)).status).toBe(200);
		expect((await get(url, cookies.outsider)).status).toBe(404);
		expect((await get(url)).status).toBe(401);
	});
});

describe('AT-27: files removed after commit only', () => {
	test('AT-27: deleting a photo, a person and a tree removes their files; delete clears primary', async () => {
		const t = createTree(h, ownerId, { name: 'Files' }).id;
		const p1 = createPerson(h, ownerId, t, { firstName: 'P1' }).id;
		const mk = async (personId: string, primary = false) => {
			const r = await addMedia(h, ownerId, t, { personId, buf: await png(40, 40), makePrimary: primary });
			if ('error' in r) throw new Error(r.error);
			return r.media;
		};
		const m1 = await mk(p1, true);
		const files = (m: { storagePath: string; thumbPath: string | null }) => [m.storagePath, m.thumbPath!].map((f) => join(PHOTOS, f));
		expect(files(m1).every(existsSync)).toBe(true);
		expect(deleteMedia(h, ownerId, m1.id)).toEqual({ deleted: true });
		expect(files(m1).some(existsSync)).toBe(false);
		expect(h.db.select().from(persons).where(eq(persons.id, p1)).get()?.photoUrl).toBeNull();

		const m2 = await mk(p1);
		expect(purgePerson(h, p1)).toEqual({ purged: true });
		expect(files(m2).some(existsSync)).toBe(false);

		const p2 = createPerson(h, ownerId, t, { firstName: 'P2' }).id;
		const m3 = await mk(p2);
		expect(deleteTree(h.db, t)).toEqual({ deleted: true });
		expect(files(m3).some(existsSync)).toBe(false);
		expect(existsSync(join(PHOTOS, t))).toBe(false);
	}, 30_000);

	test('AT-27: a rolled-back transaction removes no file', async () => {
		const r = await addMedia(h, ownerId, treeA, { buf: await png(20, 20) });
		if ('error' in r) throw new Error(r.error);
		const f = join(PHOTOS, r.media.storagePath);
		expect(() =>
			commitThenDelete(h.db, () => {
				// Files are named, then the transaction fails before commit.
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(existsSync(f)).toBe(true);
		expect(() =>
			commitThenDelete(h.db, (tx) => {
				tx.delete(schema.media).where(eq(schema.media.id, r.media.id)).run();
				const e = new Error('late failure');
				throw e;
			})
		).toThrow('late failure');
		expect(existsSync(f)).toBe(true);
		expect(h.db.select().from(schema.media).where(eq(schema.media.id, r.media.id)).get()).toBeDefined();
	});

	test('AT-27: account deletion removes the avatar directory', async () => {
		const id = randomUUID();
		h.db.insert(users).values({ id, email: 'gone@example.com', displayName: 'g', createdAt: new Date().toISOString() }).run();
		const a = await setAvatar(h, id, await png(20, 20));
		expect('url' in a).toBe(true);
		expect(existsSync(join(PHOTOS, '_avatars', id))).toBe(true);
		expect(deleteAccount(h.db, id)).toMatchObject({ ok: true });
		expect(existsSync(join(PHOTOS, '_avatars', id))).toBe(false);
	});
});
