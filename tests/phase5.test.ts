import { stopServer } from './helpers.js';
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import sharp from 'sharp';
import * as schema from '$lib/db/schema.js';
import { treeMembers, trees, users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createSession } from '$lib/server/auth.js';
import { createTree } from '$lib/server/trees.js';
import { createPerson } from '$lib/server/persons.js';
import { createLink } from '$lib/server/relations.js';
import { createEvent } from '$lib/server/events.js';
import { addMedia } from '$lib/server/media.js';

const DIR = './.test-tmp-p5';
const DB = `${DIR}/p5.db`;
const PHOTOS = `${DIR}/photos`;
const PORT = 4220;
const BASE = `http://localhost:${PORT}`;
process.env.PHOTO_PATH = PHOTOS;

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let h: { raw: Database.Database; db: typeof db };
let server: ChildProcess;
const cookie: Record<string, string> = {};
const ids: Record<string, string> = {};
let pub = '';
let priv = '';
let photoLiving = '';
let photoDead = '';

const SECRET_PLACE = 'Secretville';
const SECRET_BIO = 'secretbio-living';

async function user(name: string): Promise<string> {
	const id = randomUUID();
	db.insert(users).values({ id, email: `${id}@example.com`, displayName: name, emailVerifiedAt: 'n', createdAt: 'n' }).run();
	cookie[name] = (await createSession(db, id, null)).token;
	return id;
}

const get = (path: string, who?: string) =>
	fetch(`${BASE}${path}`, { headers: who ? { cookie: `session=${cookie[who]}` } : {} }).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }));

beforeAll(async () => {
	rmSync(DIR, { force: true, recursive: true });
	mkdirSync(DIR, { recursive: true });
	raw = new Database(DB);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	db = drizzle(raw, { schema });
	h = { raw, db };
	const owner = await user('owner');
	const editor = await user('editor');
	const contrib = await user('contrib');
	const viewer = await user('viewer');
	await user('outsider');
	pub = createTree(h, owner, { name: 'Public Family' }).id;
	priv = createTree(h, owner, { name: 'Private Family' }).id;
	db.update(trees).set({ isPublic: 1 }).where(eqId(pub)).run();
	for (const [u, role] of [[editor, 'editor'], [contrib, 'contributor'], [viewer, 'viewer']] as const) {
		db.insert(treeMembers).values({ id: randomUUID(), treeId: pub, userId: u, role, status: 'active', joinedAt: 'n', joinedViaType: 'manual' }).run();
	}
	const mk = (key: string, p: Parameters<typeof createPerson>[3]) => (ids[key] = createPerson(h, owner, pub, p).id);
	mk('living', { firstName: 'Lila', lastName: 'Living', birthDate: '1990-04-02', birthPlace: SECRET_PLACE, bio: SECRET_BIO, isLiving: true, gender: 'F' });
	mk('unknown', { firstName: 'Uma', lastName: 'Unknown', birthDate: '1985', birthPlace: SECRET_PLACE, bio: SECRET_BIO }); // isLiving unknown, born recently
	mk('dead', { firstName: 'Dev', lastName: 'Deceased', birthDate: '1900-01-05', deathDate: '1980-03-04', birthPlace: 'Oldtown', bio: 'public-bio-dead', isLiving: false, gender: 'M' });
	mk('old', { firstName: 'Ona', lastName: 'Old', birthDate: '1850', birthPlace: 'Ancientburg', bio: 'old-bio' }); // unknown but > 110 years ago
	mk('nobirth', { firstName: 'Nia', lastName: 'Nobirth', birthPlace: SECRET_PLACE, bio: SECRET_BIO }); // unknown, no dates: living
	createLink(h, owner, pub, { person1Id: ids.dead!, person2Id: ids.living!, type: 'parent' });
	createLink(h, owner, pub, { person1Id: ids.old!, person2Id: ids.dead!, type: 'parent' });
	createLink(h, owner, pub, { person1Id: ids.living!, person2Id: ids.unknown!, type: 'spouse', startDate: '2012' });
	createEvent(h, owner, pub, { personId: ids.living!, type: 'residence', place: SECRET_PLACE });
	createEvent(h, owner, pub, { personId: ids.dead!, type: 'burial', place: 'Oldtown cemetery' });
	const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#255' } }).png().toBuffer();
	const pl = await addMedia(h, owner, pub, { personId: ids.living!, buf: png, makePrimary: true });
	const pd = await addMedia(h, owner, pub, { personId: ids.dead!, buf: png, makePrimary: true });
	if ('error' in pl || 'error' in pd) throw new Error('media');
	photoLiving = `/photos/${pl.media.storagePath}`;
	photoDead = `/photos/${pd.media.storagePath}`;
	createPerson(h, owner, priv, { firstName: 'Priv', lastName: 'Ate', isLiving: false });
	raw.close();
	server = spawn('node', ['build'], {
		env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ORIGIN: BASE, PHOTO_PATH: PHOTOS, RATE_LIMIT_API_MAX: '100000', BODY_SIZE_LIMIT: '12M' }
	});
	for (let i = 0; i < 80; i++) {
		if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
		await new Promise((r) => setTimeout(r, 400));
	}
	raw = new Database(DB);
	applyPragmas(raw);
	db = drizzle(raw, { schema });
	h = { raw, db };
}, 90_000);

afterAll(async () => {
	await stopServer(server);
	raw?.close();
	rmSync(DIR, { force: true, recursive: true });
});

import { eq } from 'drizzle-orm';
function eqId(id: string) {
	return eq(trees.id, id);
}

type P = { id: string; firstName: string; lastName: string | null; birthDate: string | null; birthPlace: string | null; deathDate: string | null; bio: string | null; photoUrl: string | null; gender: string; userId?: unknown };

describe('AT-23: privacy-filtered export', () => {
	const living = () => ['living', 'unknown', 'nobirth'].map((k) => ids[k]!);

	test('AT-23: non-owner JSON export anonymises living and unknown persons; ids and edges intact; no events or photos for them', async () => {
		const full = JSON.parse((await get(`/api/trees/${pub}/export?format=json`, 'owner')).text);
		const r = await get(`/api/trees/${pub}/export?format=json`, 'viewer');
		expect(r.status).toBe(200);
		expect(r.headers.get('content-disposition')).toContain('attachment');
		expect(r.headers.get('cache-control')).toBe('private, no-store');
		const out = JSON.parse(r.text);
		expect(out.filtered).toBe(true);
		const people = out.persons as P[];
		expect(people.map((p) => p.id).sort()).toEqual(full.persons.map((p: P) => p.id).sort());
		for (const id of living()) {
			expect(people.find((p) => p.id === id)).toMatchObject({ firstName: 'Living', lastName: null, birthDate: null, birthPlace: null, deathDate: null, bio: null, photoUrl: null, gender: 'U' });
		}
		// deceased and long-dead people are not anonymised
		expect(people.find((p) => p.id === ids.dead)).toMatchObject({ firstName: 'Dev', birthPlace: 'Oldtown', bio: 'public-bio-dead' });
		expect(people.find((p) => p.id === ids.old)).toMatchObject({ firstName: 'Ona', birthPlace: 'Ancientburg' });
		// edges intact, details of edges to living people dropped
		expect(out.relationships.map((x: { id: string }) => x.id).sort()).toEqual(full.relationships.map((x: { id: string }) => x.id).sort());
		expect(out.relationships.find((x: { type: string }) => x.type === 'spouse').startDate).toBeNull();
		// events: none for living people, kept for the deceased; no media rows at all
		expect(out.events.map((e: { personId: string }) => e.personId)).toEqual([ids.dead]);
		expect(out.media).toEqual([]);
		// account ids never leave
		expect(r.text).not.toMatch(/"userId"|"createdBy"/);
	});

	test('AT-23: every format and role: filtered unless owner/editor, and excludeLiving filters owners too', async () => {
		for (const format of ['json', 'gedcom', 'csv']) {
			for (const who of ['contrib', 'viewer']) {
				const t = (await get(`/api/trees/${pub}/export?format=${format}`, who)).text;
				expect(t, `${format} as ${who}`).not.toContain(SECRET_PLACE);
				expect(t, `${format} as ${who}`).not.toContain(SECRET_BIO);
				expect(t).toContain('Living');
				expect(t).toContain('Oldtown');
			}
			const ownerFull = (await get(`/api/trees/${pub}/export?format=${format}`, 'owner')).text;
			expect(ownerFull, format).toContain(SECRET_PLACE);
			const editorFull = (await get(`/api/trees/${pub}/export?format=${format}`, 'editor')).text;
			expect(editorFull).toContain(SECRET_BIO);
			const excluded = (await get(`/api/trees/${pub}/export?format=${format}&excludeLiving=1`, 'owner')).text;
			expect(excluded, `${format} excludeLiving`).not.toContain(SECRET_PLACE);
		}
		expect((await get(`/api/trees/${pub}/export?format=pdf`, 'owner')).status).toBe(400);
		expect((await get(`/api/trees/${pub}/export?format=json`, 'outsider')).status).toBe(404);
		expect((await get(`/api/trees/${pub}/export?format=json`)).status).toBe(401);
	});

	test('AT-23: CSV cells that look like formulas are neutralised', async () => {
		createPerson(h, (db.select().from(users).get() as { id: string }).id, priv, { firstName: '=HYPERLINK("http://x")', lastName: 'Csv', isLiving: false });
		const csv = (await get(`/api/trees/${priv}/export?format=csv`, 'owner')).text;
		expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
	});
});

describe('AT-26: live fuzzy fallback', () => {
	test('AT-26: a typo finds the person through the fuzzy worker over HTTP; an exact prefix stays on FTS', async () => {
		const typo = JSON.parse((await get(`/api/search?q=Deceasd&treeId=${pub}`, 'viewer')).text).data;
		expect(typo.via).toBe('fuzzy');
		expect(typo.hits.map((h: { id: string }) => h.id)).toEqual([ids.dead]);
		const two = JSON.parse((await get(`/api/search?q=${encodeURIComponent('Dve Decesed')}&treeId=${pub}`, 'viewer')).text).data;
		expect(two.hits.map((h: { id: string }) => h.id)).toEqual([ids.dead]);
		const exact = JSON.parse((await get(`/api/search?q=Dec&treeId=${pub}`, 'viewer')).text).data;
		expect(exact.via).toBe('fts');
		expect(JSON.parse((await get(`/api/search?q=Qqqqqq&treeId=${pub}`, 'viewer')).text).data.hits).toEqual([]);
		// the worker honours visibility: a pending person is never a fuzzy hit (checked by the id join)
		expect((await get(`/api/search?q=Deceasd&treeId=${pub}`, 'outsider')).status).toBe(404);
	});
});

describe('AT-22: tree backup route', () => {
	test('AT-22: owner/editor get a tar with the full tree JSON and only that tree\'s photos; others are refused', async () => {
		const tar = (await import('tar-stream')).default;
		const res = await fetch(`${BASE}/api/trees/${pub}/backup`, { headers: { cookie: `session=${cookie.editor}` } });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/x-tar');
		expect(res.headers.get('cache-control')).toBe('private, no-store');
		const extract = tar.extract();
		const names: string[] = [];
		let json = '';
		extract.on('entry', (header, stream, next) => {
			names.push(header.name);
			const chunks: Buffer[] = [];
			stream.on('data', (c: unknown) => chunks.push(c as Buffer));
			stream.on('end', () => {
				if (header.name === 'tree.json') json = Buffer.concat(chunks).toString('utf8');
				next();
			});
		});
		extract.end(Buffer.from(await res.arrayBuffer()));
		await new Promise<void>((r) => extract.on('finish', () => r()));
		expect(names).toContain('tree.json');
		expect(names.filter((n) => n.startsWith('photos/'))).toHaveLength(4); // two photos, each with a thumbnail
		expect(names.every((n) => n === 'tree.json' || n.startsWith(`photos/${pub}/`))).toBe(true);
		const data = JSON.parse(json);
		expect(data.filtered).toBe(false);
		expect(JSON.stringify(data)).toContain(SECRET_PLACE); // a backup is complete, not privacy-filtered
		expect(data.media).toHaveLength(2);
		for (const who of ['viewer', 'contrib', 'outsider']) {
			expect((await get(`/api/trees/${pub}/backup`, who)).status, who).toBe(who === 'outsider' ? 404 : 403);
		}
	}, 30_000);
});

describe('AT-24: GEDCOM round trip and import', () => {
	const makeTree = async (name: string) => {
		const owner = (db.select().from(users).where(eq(users.email, (db.select().from(users).all().find((u) => u.displayName === 'owner')!).email)).get() as { id: string }).id;
		return createTree(h, owner, { name }).id;
	};
	const importFile = (treeId: string, text: string, who = 'owner', preview = false) => {
		const f = new FormData();
		f.set('treeId', treeId);
		f.set('file', new Blob([text], { type: 'text/plain' }), 'tree.ged');
		return fetch(`${BASE}/api/gedcom/import${preview ? '?preview=1' : ''}`, { method: 'POST', headers: { cookie: `session=${cookie[who]}`, origin: BASE }, body: f }).then(async (r) => ({ status: r.status, json: (await r.json()) as { data?: Record<string, unknown>; error?: { code: string } } }));
	};

	test('AT-24: export then import into a fresh tree yields the same people, relationships and dates', async () => {
		const ged = (await get(`/api/trees/${pub}/export?format=gedcom`, 'owner')).text;
		expect(ged.startsWith('0 HEAD')).toBe(true);
		const target = await makeTree('Round Trip');
		const before = (raw.prepare(`SELECT COUNT(*) AS c FROM changeHistory WHERE treeId = ?`).get(target) as { c: number }).c;
		const pv = await importFile(target, ged, 'owner', true);
		expect(pv.status).toBe(200);
		expect(pv.json.data).toMatchObject({ persons: 5, relationships: 3, imported: false });
		expect((raw.prepare(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`).get(target) as { c: number }).c).toBe(0); // a preview writes nothing
		const res = await importFile(target, ged);
		expect(res.status).toBe(201);
		expect(res.json.data).toMatchObject({ persons: 5, relationships: 3, imported: true });
		const cols = `firstName, lastName, birthDateNorm, deathDateNorm, birthPlace, deathPlace, gender, bio, isLiving`;
		const src = raw.prepare(`SELECT ${cols} FROM persons WHERE treeId = ? AND firstName != 'Living' ORDER BY firstName`).all(pub) as Array<Record<string, unknown>>;
		const dst = raw.prepare(`SELECT ${cols} FROM persons WHERE treeId = ? ORDER BY firstName`).all(target) as Array<Record<string, unknown>>;
		expect(dst).toHaveLength(5);
		for (const s of src) {
			const d = dst.find((x) => x.firstName === s.firstName)!;
			expect(d, String(s.firstName)).toBeDefined();
			expect({ ...d, isLiving: null }).toEqual({ ...s, isLiving: null });
		}
		expect(dst.every((d) => d.isLiving === null)).toBe(true); // imports never decide who is living
		const rel = (t: string) => raw.prepare(`SELECT type, COUNT(*) AS c FROM relationships WHERE treeId = ? GROUP BY type ORDER BY type`).all(t);
		expect(rel(target)).toEqual(rel(pub));
		// audited as one create row per entity sharing one batch, tagged as an import
		const rows = raw.prepare(`SELECT DISTINCT batchId, note, action FROM changeHistory WHERE treeId = ? AND entityType IN ('person', 'relationship')`).all(target) as Array<{ batchId: string; note: string; action: string }>;
		expect(rows).toEqual([{ batchId: res.json.data!.batchId, note: 'gedcom import', action: 'create' }]);
		expect((raw.prepare(`SELECT COUNT(*) AS c FROM changeHistory WHERE treeId = ?`).get(target) as { c: number }).c - before).toBe(8);
		// imported people are searchable (FTS triggers) and the import appends: a second one adds, nothing merges
		expect((raw.prepare(`SELECT COUNT(*) AS c FROM persons_fts WHERE treeId = ?`).get(target) as { c: number }).c).toBe(5);
		expect((await importFile(target, ged)).status).toBe(201);
		expect((raw.prepare(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`).get(target) as { c: number }).c).toBe(10);
	}, 60_000);

	test('AT-24: a bad file writes nothing; roles, size and empty files are refused', async () => {
		const target = await makeTree('Rejects');
		const cycle = `0 @A@ INDI\n1 NAME A\n0 @B@ INDI\n1 NAME B\n0 @F1@ FAM\n1 HUSB @A@\n1 CHIL @B@\n0 @F2@ FAM\n1 HUSB @B@\n1 CHIL @A@\n`;
		const bad = await importFile(target, cycle);
		expect(bad.status).toBe(400);
		expect((raw.prepare(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`).get(target) as { c: number }).c).toBe(0);
		expect((await importFile(pub, '0 @A@ INDI\n1 NAME A\n', 'viewer')).status).toBe(403);
		expect((await importFile(pub, '0 @A@ INDI\n1 NAME A\n', 'contrib')).status).toBe(403);
		expect((await importFile(target, '0 HEAD\n0 TRLR\n')).status).toBe(400);
		expect((await importFile(target, 'x'.repeat(5 * 1024 * 1024 + 10))).status).toBe(413);
	}, 60_000);
});

describe('AT-32 / AT-33: public trees', () => {
	test('AT-32: an anonymous caller may read a public tree (filtered) on every allowPublic route', async () => {
		const t = await get(`/api/trees/${pub}`);
		expect(t.status).toBe(200);
		const view = JSON.parse(t.text).data;
		expect(view.members).toEqual([]);
		expect(view.tree).toEqual({ id: pub, name: 'Public Family', description: null, isPublic: 1 });
		expect(view.persons).toHaveLength(5);
		const byId = new Map<string, P>(view.persons.map((p: P) => [p.id, p]));
		for (const k of ['living', 'unknown', 'nobirth']) expect(byId.get(ids[k]!)).toMatchObject({ firstName: 'Living', lastName: null, birthDate: null, birthPlace: null, bio: null, photoUrl: null });
		expect(byId.get(ids.dead!)).toMatchObject({ firstName: 'Dev', birthPlace: 'Oldtown' });
		expect(t.text).not.toContain(SECRET_PLACE);
		expect(t.text).not.toContain(SECRET_BIO);
		expect(t.text).not.toMatch(/"userId"|"createdBy"|"lastEditedBy"/);
		const dead = JSON.parse((await get(`/api/persons/${ids.dead}`)).text).data;
		expect(dead).toMatchObject({ firstName: 'Dev', deathDate: '1980-03-04' });
		expect(dead.events).toHaveLength(1);
		expect(dead.media).toHaveLength(1);
		const liv = await get(`/api/persons/${ids.living}`);
		expect(liv.status).toBe(200);
		expect(JSON.parse(liv.text).data).toMatchObject({ firstName: 'Living', events: [], media: [], bio: null });
		expect(liv.text).not.toContain(SECRET_PLACE);
		const rel = JSON.parse((await get(`/api/persons/${ids.dead}/relatives`)).text).data;
		expect(rel.children).toEqual([ids.living]); // structure is public, names are not
		const how = await get(`/api/persons/${ids.old}/relation?to=${ids.living}`);
		expect(how.status).toBe(200);
		expect(JSON.parse(how.text).data.label).toBe('grandchild');
		// signed-in non-members get the same filtered view; members the full one
		expect((await get(`/api/trees/${pub}`, 'outsider')).text).not.toContain(SECRET_PLACE);
		expect((await get(`/api/persons/${ids.living}`, 'outsider')).text).not.toContain(SECRET_PLACE);
		expect((await get(`/api/trees/${pub}`, 'viewer')).text).toContain(SECRET_PLACE);
	});

	test('AT-32: a private tree and a nonexistent tree give the same 401 body; non-members of a private tree get 404', async () => {
		const a = await get(`/api/trees/${priv}`);
		const b = await get(`/api/trees/${randomUUID()}`);
		expect([a.status, b.status]).toEqual([401, 401]);
		expect(a.text).toBe(b.text);
		const privPerson = (raw.prepare(`SELECT id FROM persons WHERE treeId = ? LIMIT 1`).get(priv) as { id: string }).id;
		const pa = await get(`/api/persons/${privPerson}`);
		const pb = await get(`/api/persons/${randomUUID()}`);
		expect([pa.status, pb.status]).toEqual([401, 401]);
		expect(pa.text).toBe(pb.text);
		expect(pa.text).toBe(a.text);
		expect((await get(`/api/persons/${privPerson}/relatives`)).status).toBe(401);
		expect((await get(`/api/trees/${priv}`, 'outsider')).status).toBe(404);
	});

	test('AT-32: every other route (history, activity, members, codes, search, export, backup, notifications, writes) is 401 for anonymous callers, even on a public tree', async () => {
		const paths = [
			`/api/persons/${ids.dead}/history`,
			`/api/trees/${pub}/activity`,
			`/api/trees/${pub}/members`,
			`/api/trees/${pub}/join-codes`,
			`/api/trees/${pub}/stats`,
			`/api/trees/${pub}/surnames`,
			`/api/trees/${pub}/duplicates`,
			`/api/trees/${pub}/media`,
			`/api/search?q=Dev&treeId=${pub}`,
			`/api/trees/${pub}/export?format=json`,
			`/api/trees/${pub}/backup`,
			`/api/notifications`,
			`/api/claims?treeId=${pub}`
		];
		for (const p of paths) expect((await get(p)).status, p).toBe(401);
		const send = (method: string, path: string, body: unknown) => fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify(body) }).then((r) => r.status);
		expect(await send('POST', '/api/persons', { treeId: pub, firstName: 'X' })).toBe(401);
		expect(await send('PUT', `/api/persons/${ids.dead}`, { firstName: 'X', version: 1 })).toBe(401);
		expect(await send('DELETE', `/api/persons/${ids.dead}`, {})).toBe(401);
		expect(await send('POST', '/api/history/revert', { historyId: 'x' })).toBe(401);
		expect(await send('POST', '/api/media', {})).toBe(401);
	});

	test('AT-33: anonymous photo access: non-living person 200 with private cache headers, living person 404, private tree 401', async () => {
		const ok = await get(photoDead);
		expect(ok.status).toBe(200);
		const cc = ok.headers.get('cache-control') ?? '';
		expect(cc).toContain('private');
		expect(cc).not.toContain('public');
		expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
		expect((await get(photoLiving)).status).toBe(404);
		expect((await get(photoLiving, 'outsider')).status).toBe(404); // signed in but not a member: still not a living person's photo
		expect((await get(photoLiving, 'viewer')).status).toBe(200); // members see everything they are entitled to
		// a tree that is not public: same 401 as an unknown path
		db.update(trees).set({ isPublic: 0 }).where(eqId(pub)).run();
		expect((await get(photoDead)).status).toBe(401);
		expect((await get(`/api/trees/${pub}`)).status).toBe(401);
		db.update(trees).set({ isPublic: 1 }).where(eqId(pub)).run();
	});
});
