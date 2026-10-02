import { stopServer } from './helpers.js';
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { treeMembers, users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createSession } from '$lib/server/auth.js';
import { createTree } from '$lib/server/trees.js';
import { IMPORT_MAX_PERSONS, IMPORT_MAX_RELATIONSHIPS } from '$lib/config.js';

const DIR = './.test-tmp-load';
const DB = `${DIR}/l.db`;
const PORT = 4221;
const BASE = `http://localhost:${PORT}`;

let raw: Database.Database;
let server: ChildProcess;
let tree = '';
let writeTree = '';
const cookies: string[] = [];

/** A file at both caps: 10 000 people, ~20 000 parent links, depth ~14 (second parent always has a lower index: no cycles). */
function capFile(): { text: string; persons: number; links: number } {
	const lines = ['0 HEAD', '1 CHAR UTF-8'];
	for (let i = 0; i < IMPORT_MAX_PERSONS; i++) lines.push(`0 @I${i}@ INDI`, `1 NAME Person${i} /Fam${i % 97}/`, `1 BIRT`, `2 DATE ${1900 + (i % 100)}`);
	let links = 0;
	let f = 0;
	for (let i = 1; i < IMPORT_MAX_PERSONS; i++) {
		const p1 = Math.floor((i - 1) / 2);
		const p2 = p1 - 1;
		// single-parent families, so no spouse links are produced
		lines.push(`0 @F${f++}@ FAM`, `1 HUSB @I${p1}@`, `1 CHIL @I${i}@`);
		links++;
		if (p2 >= 0 && links < IMPORT_MAX_RELATIONSHIPS) {
			lines.push(`0 @F${f++}@ FAM`, `1 HUSB @I${p2}@`, `1 CHIL @I${i}@`);
			links++;
		}
	}
	lines.push('0 TRLR');
	return { text: lines.join('\n') + '\n', persons: IMPORT_MAX_PERSONS, links };
}

beforeAll(async () => {
	rmSync(DIR, { force: true, recursive: true });
	mkdirSync(DIR, { recursive: true });
	raw = new Database(DB);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	const db = drizzle(raw, { schema });
	const h = { raw, db };
	const mk = async (name: string) => {
		const id = randomUUID();
		db.insert(users).values({ id, email: `${id}@example.com`, displayName: name, emailVerifiedAt: 'n', createdAt: 'n' }).run();
		cookies.push((await createSession(db, id, null)).token);
		return id;
	};
	const owner = await mk('owner');
	tree = createTree(h, owner, { name: 'Import Target' }).id;
	writeTree = createTree(h, owner, { name: 'Writers' }).id;
	for (let i = 0; i < 10; i++) {
		const u = await mk(`w${i}`);
		db.insert(treeMembers).values({ id: randomUUID(), treeId: writeTree, userId: u, role: 'contributor', status: 'active', joinedAt: 'n', joinedViaType: 'manual' }).run();
	}
	server = spawn('node', ['build'], {
		env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ORIGIN: BASE, RATE_LIMIT_API_MAX: '100000', BODY_SIZE_LIMIT: '12M' }
	});
	for (let i = 0; i < 80; i++) {
		if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
		await new Promise((r) => setTimeout(r, 400));
	}
}, 90_000);

afterAll(async () => {
	await stopServer(server);
	raw?.close();
	rmSync(DIR, { force: true, recursive: true });
});

describe('AT-39: import at the caps in a worker', () => {
	test('AT-39: 50 concurrent health calls answer within 1 s, 10 concurrent writes succeed or return 503 BUSY (never 500), the import is atomic', async () => {
		// warm the server (route chunks, worker module graph), then clear the delay histogram
		await fetch(`${BASE}/api/health`);
		await new Promise((r) => setTimeout(r, 300));
		await fetch(`${BASE}/api/health`);
		const file = capFile();
		expect(file.persons).toBe(IMPORT_MAX_PERSONS);
		expect(file.links).toBeGreaterThan(IMPORT_MAX_RELATIONSHIPS - 20);
		expect(file.links).toBeLessThanOrEqual(IMPORT_MAX_RELATIONSHIPS);
		const form = new FormData();
		form.set('treeId', tree);
		form.set('file', new Blob([file.text]), 'big.ged');
		const t0 = performance.now();
		const importing = fetch(`${BASE}/api/gedcom/import`, { method: 'POST', headers: { cookie: `session=${cookies[0]}`, origin: BASE }, body: form }).then(async (r) => ({
			status: r.status,
			ms: performance.now() - t0,
			json: await r.json()
		}));
		// while the worker holds the write lock: health checks and writes from other users
		// wait until the worker really holds the write lock, so the writers below collide with it
		const probe = new Database(DB);
		probe.pragma('busy_timeout = 0');
		let locked = false;
		for (let i = 0; i < 400 && !locked; i++) {
			try {
				probe.exec('BEGIN IMMEDIATE');
				probe.exec('ROLLBACK');
				await new Promise((r) => setTimeout(r, 5));
			} catch {
				locked = true;
			}
		}
		probe.close();
		expect(locked, 'the import worker held the write lock').toBe(true);
		const writes = Array.from({ length: 10 }, (_, i) =>
			fetch(`${BASE}/api/persons`, {
				method: 'POST',
				headers: { cookie: `session=${cookies[i + 1]}`, 'content-type': 'application/json' },
				body: JSON.stringify({ treeId: writeTree, firstName: `W${i}` })
			}).then(async (r) => ({ status: r.status, retry: r.headers.get('retry-after'), body: await r.text() }))
		);
		const health = Array.from({ length: 50 }, async () => {
			const s = performance.now();
			const r = await fetch(`${BASE}/api/health`);
			return { status: r.status, ms: performance.now() - s };
		});
		const [imp, hs, ws] = await Promise.all([importing, Promise.all(health), Promise.all(writes)]);
		expect(hs.every((x) => x.status === 200)).toBe(true);
		expect(Math.max(...hs.map((x) => x.ms))).toBeLessThan(1000);
		for (const w of ws) {
			expect([201, 503], w.body).toContain(w.status);
			if (w.status === 503) expect(w.retry).toBe('2');
		}
		expect(imp.status).toBe(201);
		expect(imp.json.data).toMatchObject({ persons: IMPORT_MAX_PERSONS, relationships: file.links, imported: true });
		// all or nothing: every person and link, one audit batch
		const count = (sql: string, ...a: unknown[]) => (raw.prepare(sql).get(...a) as { c: number }).c;
		expect(count(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`, tree)).toBe(IMPORT_MAX_PERSONS);
		expect(count(`SELECT COUNT(*) AS c FROM relationships WHERE treeId = ?`, tree)).toBe(file.links);
		expect(count(`SELECT COUNT(DISTINCT batchId) AS c FROM changeHistory WHERE treeId = ? AND note = 'gedcom import'`, tree)).toBe(1);
		const health2 = await (await fetch(`${BASE}/api/health`)).json();
		console.log(`R-PERF-8 import at caps (${file.persons} people, ${file.links} links): ${imp.ms.toFixed(0)} ms; max health latency ${Math.max(...hs.map((x) => x.ms)).toFixed(0)} ms; p99 event-loop delay ${health2.data.eventLoopDelayP99Ms} ms; writes: ${ws.map((w) => w.status).join(',')}`);
		expect(imp.ms).toBeLessThan(15_000);
	}, 120_000);

	test('AT-39: an invalid file at the caps writes nothing', async () => {
		const bad = capFile().text + `0 @Z@ INDI\n1 NAME Z\n0 @F9@ FAM\n1 HUSB @I9999@\n1 CHIL @Z@\n0 @F10@ FAM\n1 HUSB @Z@\n1 CHIL @I0@\n`;
		const t2 = (raw.prepare(`SELECT id FROM trees WHERE name = 'Writers'`).get() as { id: string }).id;
		const before = (raw.prepare(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`).get(t2) as { c: number }).c;
		const form = new FormData();
		form.set('treeId', t2);
		form.set('file', new Blob([bad]), 'bad.ged');
		const r = await fetch(`${BASE}/api/gedcom/import`, { method: 'POST', headers: { cookie: `session=${cookies[0]}`, origin: BASE }, body: form });
		expect(r.status).toBe(413); // one more person than the cap
		expect((raw.prepare(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`).get(t2) as { c: number }).c).toBe(before);
	}, 120_000);
});
