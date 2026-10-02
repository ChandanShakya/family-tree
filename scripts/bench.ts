import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import Database from 'better-sqlite3';
import { migrateAndCheck } from '../src/lib/db/index.js';

// §3 benchmark harness: seeds 50 000 people, starts the built server and measures it over HTTP.
// Usage: npm run build && npm run bench   (writes docs/project/BENCHMARKS.md; exits non-zero when search p95 is over 3x its target)

const PEOPLE = 50_000;
const DIR = './.bench-tmp';
const PORT = 4240;
const BASE = `http://localhost:${PORT}`;
const TARGET = { read: 25, fts: 150, fuzzy: 300, coldMs: 2000, rssMb: 200, loopMs: 100, importMs: 5000 };

const FIRST = ['Ram', 'Sita', 'Hari', 'Gita', 'Bishnu', 'Maya', 'Krishna', 'Laxmi', 'Dev', 'Anita', 'Suresh', 'Mina', 'Prakash', 'Sunita', 'Bikash', 'Radha', 'Kamal', 'Sabina', 'Nabin', 'Puja', 'नेपाल', 'सीता', 'हरि', 'गीता'];
const LAST = Array.from({ length: 1500 }, (_, i) => `Fam${i}`).concat(['थापा', 'श्रेष्ठ', 'गुरुङ', 'राई']);
const PLACES = ['Pokhara', 'Kathmandu', 'Lamjung', 'Dharan', 'Biratnagar', 'Butwal', 'Bhaktapur', 'Gorkha', 'Ilam', 'Janakpur'];

const pct = (xs: number[], p: number): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const fmt = (n: number, d = 1) => n.toFixed(d);

function vmKb(pid: number, key: 'VmRSS' | 'VmHWM'): number {
	try {
		const m = new RegExp(`${key}:\\s+(\\d+) kB`).exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
		return m ? Number(m[1]) : 0;
	} catch {
		return 0; // not Linux: reported as n/a
	}
}

function seed(dbPath: string): { tree: string; token: string; ids: string[]; names: string[]; seedMs: number } {
	const t0 = performance.now();
	migrateAndCheck(dbPath, './src/lib/db/migrations');
	const db = new Database(dbPath);
	for (const p of ['journal_mode = WAL', 'synchronous = OFF', 'foreign_keys = ON', 'temp_store = MEMORY']) db.pragma(p);
	const now = new Date().toISOString();
	const user = randomUUID();
	const tree = randomUUID();
	const token = randomBytes(32).toString('base64url');
	db.prepare(`INSERT INTO users (id, email, displayName, emailVerifiedAt, createdAt) VALUES (?, 'bench@example.com', 'Bench', ?, ?)`).run(user, now, now);
	db.prepare(`INSERT INTO trees (id, name, ownerId, createdAt, updatedAt) VALUES (?, 'Bench Tree', ?, ?, ?)`).run(tree, user, now, now);
	db.prepare(`INSERT INTO treeMembers (id, treeId, userId, role, status, joinedAt, joinedViaType) VALUES (?, ?, ?, 'owner', 'active', ?, 'manual')`).run(randomUUID(), tree, user, now);
	db.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)`).run(
		randomUUID(),
		user,
		createHash('sha256').update(token).digest('hex'),
		new Date(Date.now() + 864e5).toISOString(),
		now,
		now
	);
	const ids: string[] = [];
	const names: string[] = [];
	const ins = db.prepare(
		`INSERT INTO persons (id, treeId, firstName, lastName, birthDate, birthDateNorm, birthPlace, isLiving, version, createdBy, createdAt, updatedAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
	);
	const rel = db.prepare(`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdBy, createdAt) VALUES (?, ?, ?, ?, 'parent', ?, ?)`);
	db.transaction(() => {
		for (let i = 0; i < PEOPLE; i++) {
			const id = randomUUID();
			ids.push(id);
			const year = 1850 + (i % 170);
			if (i % 100 === 0) names.push(`${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`);
			ins.run(id, tree, FIRST[i % FIRST.length], LAST[(i * 7) % LAST.length], String(year), `${year}-00-00`, PLACES[i % PLACES.length], year < 1920 ? 0 : null, user, now, now);
			if (i > 0) rel.run(randomUUID(), tree, ids[Math.floor((i - 1) / 2)], id, user, now); // a binary forest, 15 generations deep
		}
	}).immediate();
	db.pragma('wal_checkpoint(TRUNCATE)');
	db.close();
	return { tree, token, ids, names, seedMs: performance.now() - t0 };
}

async function stopServer(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const done = new Promise<void>((r) => child.once('exit', () => r()));
	child.kill('SIGTERM');
	await done;
}

async function startServer(dbPath: string, extra: Record<string, string> = {}): Promise<{ child: ChildProcess; coldMs: number; out: string[] }> {
	const out: string[] = [];
	// A stale server on the port would answer the health check and be measured instead of this one.
	if (await fetch(`${BASE}/api/health`).then(() => true, () => false)) throw new Error(`port ${PORT} is already in use`);
	const t0 = performance.now();
	// The same flags as the image's CMD: a small young generation keeps resident memory low (§3, R-PERF-6).
	const child = spawn('node', ['--max-semi-space-size=2', 'build'], {
		env: {
			...process.env,
			PORT: String(PORT),
			ORIGIN: BASE,
			DATABASE_PATH: dbPath,
			PHOTO_PATH: `${DIR}/photos`,
			ADDRESS_HEADER: 'x-bench-ip',
			RATE_LIMIT_API_MAX: '10000000',
			BODY_SIZE_LIMIT: '12M',
			...extra
		}
	});
	child.stdout?.on('data', (d) => out.push(String(d)));
	child.stderr?.on('data', (d) => out.push(String(d)));
	for (;;) {
		if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
		if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}: ${out.join('').slice(-300)}`);
		if (performance.now() - t0 > 60_000) throw new Error('server did not start');
		await new Promise((r) => setTimeout(r, 20));
	}
	return { child, coldMs: performance.now() - t0, out };
}

let ipSeq = 0;
async function timed(path: string, token: string, init?: RequestInit): Promise<number> {
	const t = performance.now();
	const r = await fetch(`${BASE}${path}`, { ...init, headers: { cookie: `session=${token}`, 'x-bench-ip': `10.1.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`, ...(init?.headers ?? {}) } });
	await r.arrayBuffer();
	if (!r.ok) throw new Error(`${path} -> ${r.status}`);
	return performance.now() - t;
}

async function series(n: number, fn: (i: number) => Promise<number>): Promise<number[]> {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(await fn(i));
	return out;
}

function capFile(): { text: string; persons: number; links: number } {
	const lines = ['0 HEAD', '1 CHAR UTF-8'];
	for (let i = 0; i < 10_000; i++) lines.push(`0 @I${i}@ INDI`, `1 NAME Imp${i} /Fam${i % 97}/`, '1 BIRT', `2 DATE ${1900 + (i % 100)}`);
	let links = 0;
	let f = 0;
	for (let i = 1; i < 10_000; i++) {
		const p1 = Math.floor((i - 1) / 2);
		lines.push(`0 @F${f++}@ FAM`, `1 HUSB @I${p1}@`, `1 CHIL @I${i}@`);
		links++;
		if (p1 - 1 >= 0 && links < 20_000) {
			lines.push(`0 @F${f++}@ FAM`, `1 HUSB @I${p1 - 1}@`, `1 CHIL @I${i}@`);
			links++;
		}
	}
	lines.push('0 TRLR');
	return { text: lines.join('\n') + '\n', persons: 10_000, links };
}

async function main() {
	if (!existsSync('./build/index.js')) {
		console.error('build/ is missing: run `npm run build` first');
		process.exit(2);
	}
	rmSync(DIR, { force: true, recursive: true });
	mkdirSync(`${DIR}/photos`, { recursive: true });

	// 1. cold start on an empty database (the deployment case) ------------------------------------------
	const emptyDb = `${DIR}/empty.db`;
	const cold = await startServer(emptyDb);
	const coldEmptyMs = cold.coldMs;
	await stopServer(cold.child);

	// 2. seed 50 000 people ------------------------------------------------------------------------------
	const dbPath = `${DIR}/bench.db`;
	console.log(`seeding ${PEOPLE} people…`);
	const s = seed(dbPath);
	console.log(`seeded in ${fmt(s.seedMs / 1000)} s`);

	if (process.env.BENCH_SEED_ONLY) {
		writeFileSync(`${DIR}/seed.json`, JSON.stringify({ tree: s.tree, token: s.token, ids: s.ids.slice(0, 200) }));
		console.log(`seed only: ${dbPath}`);
		return;
	}
	// 3. cold start on the seeded database -----------------------------------------------------------------
	const srv = await startServer(dbPath);
	const pid = srv.child.pid ?? 0;
	const coldSeededMs = srv.coldMs;
	const rssAtStartKb = vmKb(pid, 'VmRSS');

	// 4. warm-up, then steady-state RSS ------------------------------------------------------------------
	const pick = () => s.ids[Math.floor(Math.random() * s.ids.length)] as string;
	for (let i = 0; i < 300; i++) await timed(`/api/persons/${pick()}`, s.token);
	await timed(`/api/search?q=Ram&treeId=${s.tree}`, s.token);
	await new Promise((r) => setTimeout(r, 500));
	const rssWarmKb = vmKb(pid, 'VmRSS');

	// 5. latency over HTTP (single user) -----------------------------------------------------------------
	const readPerson = await series(500, () => timed(`/api/persons/${pick()}`, s.token));
	const readRelatives = await series(500, () => timed(`/api/persons/${pick()}/relatives`, s.token));
	const readTree = await series(100, () => timed(`/api/trees/${s.tree}`, s.token));
	const readStats = await series(50, () => timed(`/api/trees/${s.tree}/stats`, s.token));
	const ftsPrefix = await series(300, (i) => timed(`/api/search?q=${encodeURIComponent(FIRST[i % FIRST.length]!.slice(0, 3))}&treeId=${s.tree}`, s.token));
	const ftsName = await series(300, (i) => timed(`/api/search?q=${encodeURIComponent(s.names[i % s.names.length] as string)}&treeId=${s.tree}`, s.token));
	const fuzzy = await series(60, (i) => timed(`/api/search?q=${encodeURIComponent(`${FIRST[i % 20]}x Fam${(i * 11) % 1500}z`)}&treeId=${s.tree}`, s.token));

	// 6. load: concurrent readers and searchers while a GEDCOM import at the caps commits ------------------
	const owner = new Database(dbPath, { readonly: true });
	const importTree = randomUUID();
	const w = new Database(dbPath);
	w.pragma('busy_timeout = 5000');
	const uid = (owner.prepare('SELECT ownerId FROM trees WHERE id = ?').get(s.tree) as { ownerId: string }).ownerId;
	w.prepare(`INSERT INTO trees (id, name, ownerId, createdAt, updatedAt) VALUES (?, 'Import Target', ?, 'n', 'n')`).run(importTree, uid);
	w.prepare(`INSERT INTO treeMembers (id, treeId, userId, role, status, joinedAt, joinedViaType) VALUES (?, ?, ?, 'owner', 'active', 'n', 'manual')`).run(randomUUID(), importTree, uid);
	w.close();
	owner.close();
	await fetch(`${BASE}/api/health`); // reset the loop-delay window
	const file = capFile();
	const form = new FormData();
	form.set('treeId', importTree);
	form.set('file', new Blob([file.text]), 'caps.ged');
	const t0 = performance.now();
	const importing = fetch(`${BASE}/api/gedcom/import`, { method: 'POST', headers: { cookie: `session=${s.token}`, 'x-bench-ip': '10.9.9.9', origin: BASE }, body: form }).then((r) => ({ status: r.status, ms: performance.now() - t0 }));
	let stop = false;
	const loadLat: number[] = [];
	const readers = Array.from({ length: 8 }, async (_, k) => {
		while (!stop) {
			try {
				loadLat.push(k % 3 === 0 ? await timed(`/api/search?q=${encodeURIComponent(FIRST[k % 20]!.slice(0, 3))}&treeId=${s.tree}`, s.token) : await timed(`/api/persons/${pick()}`, s.token));
			} catch {
				// a request that raced the shutdown of the load window
			}
			await new Promise((r) => setTimeout(r, 100)); // think time: about 10 requests/s per client, so ~80 requests/s in all (a single-threaded server is saturated well above that, and loop delay then only measures the queue)
		}
	});
	const imp = await importing;
	await new Promise((r) => setTimeout(r, 1500));
	stop = true;
	await Promise.all(readers);
	const health = (await (await fetch(`${BASE}/api/health`)).json()) as { data: { eventLoopDelayP99Ms: number } };
	const rssPeakKb = vmKb(pid, 'VmHWM');
	await new Promise((r) => setTimeout(r, 2000));
	const rssAfterKb = vmKb(pid, 'VmRSS');
	await stopServer(srv.child);

	// 7. report ----------------------------------------------------------------------------------------------
	const mb = (kb: number) => (kb ? kb / 1024 : NaN);
	const row = (id: string, what: string, target: string, value: string, ok: boolean | null) => `| ${id} | ${what} | ${target} | ${value} | ${ok === null ? 'n/a' : ok ? 'meets target' : 'over target'} |`;
	const q = (xs: number[]) => `p50 ${fmt(pct(xs, 50))} / p95 ${fmt(pct(xs, 95))} / max ${fmt(Math.max(...xs))} ms`;
	const cpu = cpus();
	const results = {
		read: Math.max(pct(readPerson, 95), pct(readRelatives, 95)),
		whole: Math.max(pct(readTree, 95), pct(readStats, 95)),
		fts: Math.max(pct(ftsPrefix, 95), pct(ftsName, 95)),
		fuzzy: pct(fuzzy, 95)
	};
	const md = `# BENCHMARKS.md

Generated by \`npm run bench\` on ${new Date().toISOString()}. Numbers are **measured and reported, not asserted** (SPECS §3); the script fails only when search p95 is over 3x its target.

## Machine

| | |
|---|---|
| CPU | ${cpu[0]?.model ?? 'unknown'} × ${cpu.length} |
| Memory | ${fmt(totalmem() / 1024 ** 3)} GiB |
| OS | ${platform()} ${release()} |
| Node | ${process.version} |
| Data | ${PEOPLE} people, ${PEOPLE - 1} parent links, one tree, SQLite WAL, loopback HTTP, one signed-in user |

Latencies include the HTTP round trip over loopback. The target machine is a Raspberry Pi 4: run \`npm run bench\` there once and keep that file; expect roughly 3–6× slower CPU-bound numbers than a laptop.

## Results

| ID | Measure | Target | Measured | Verdict |
|---|---|---|---|---|
${row('R-PERF-2', 'typical read p95 (person, relatives)', `< ${TARGET.read} ms`, `${fmt(results.read)} ms`, results.read < TARGET.read)}
${row('R-PERF-2', 'whole-tree reads p95 (tree view, stats; bounded traversals of a 50 000-person tree), reported', 'no target', `${fmt(results.whole)} ms`, null)}
${row('R-PERF-3', 'FTS search p95 (prefix and name+surname) in a 50 000-person tree', `< ${TARGET.fts} ms`, `${fmt(results.fts)} ms`, results.fts < TARGET.fts)}
${row('R-PERF-3', 'fuzzy search p95 (typo in both name parts)', `< ${TARGET.fuzzy} ms`, `${fmt(results.fuzzy)} ms`, results.fuzzy < TARGET.fuzzy)}
${row('R-PERF-5', 'cold start, empty database (spawn → first healthy response)', `< ${TARGET.coldMs} ms`, `${fmt(coldEmptyMs, 0)} ms`, coldEmptyMs < TARGET.coldMs)}
${row('R-PERF-5', 'cold start, 50 000-person database', `< ${TARGET.coldMs} ms`, `${fmt(coldSeededMs, 0)} ms`, coldSeededMs < TARGET.coldMs)}
${row('R-PERF-6', 'RSS steady state after warm-up', `≤ ${TARGET.rssMb} MB`, Number.isNaN(mb(rssWarmKb)) ? 'n/a (no /proc)' : `${fmt(mb(rssWarmKb))} MB`, Number.isNaN(mb(rssWarmKb)) ? null : mb(rssWarmKb) <= TARGET.rssMb)}
${row('R-PERF-6', 'RSS peak (import at the caps plus 8 concurrent clients), reported only', 'no target', Number.isNaN(mb(rssPeakKb)) ? 'n/a' : `${fmt(mb(rssPeakKb))} MB (back to ${fmt(mb(rssAfterKb))} MB)`, null)}
${row('R-PERF-7', 'event-loop delay p99 during the import and 8 clients (~80 requests/s)', `< ${TARGET.loopMs} ms`, `${health.data.eventLoopDelayP99Ms} ms`, health.data.eventLoopDelayP99Ms < TARGET.loopMs)}
${row('R-PERF-8', `GEDCOM import at the caps (${file.persons} people, ${file.links} links), commit time`, `< ${TARGET.importMs} ms`, `${fmt(imp.ms, 0)} ms (HTTP ${imp.status})`, imp.status === 201 && imp.ms < TARGET.importMs)}

## Detail

| Query | Latency |
|---|---|
| GET /api/persons/:id (500 random people) | ${q(readPerson)} |
| GET /api/persons/:id/relatives | ${q(readRelatives)} |
| GET /api/trees/:id (50 000 people → bounded focus view) | ${q(readTree)} |
| GET /api/trees/:id/stats (bounded traversals) | ${q(readStats)} |
| Search, 3-letter prefix (FTS5) | ${q(ftsPrefix)} |
| Search, existing name + surname (FTS5) | ${q(ftsName)} |
| Search, typos (fuzzy worker) | ${q(fuzzy)} |
| 8 clients (100 ms think time) during the import (${loadLat.length} requests) | ${q(loadLat.length ? loadLat : [0])} |

Seeding ${PEOPLE} people took ${fmt(s.seedMs / 1000)} s. RSS right after start: ${fmt(mb(rssAtStartKb))} MB.

## Reading the numbers

- Cold start includes Node boot, migrations, the full-text-index count check and the listener; the first request pays route-chunk loading.
- RSS is the resident set of the server process (workers included) read from \`/proc\`; the import's parse buffers show up in the peak, not in steady state.
- Event-loop delay is \`monitorEventLoopDelay\` p99 since the previous \`/api/health\` call, read after the import and its client load.
`;
	mkdirSync('docs/project', { recursive: true });
	writeFileSync('docs/project/BENCHMARKS.md', md);
	rmSync(DIR, { force: true, recursive: true });
	console.log(md.split('## Results')[1]?.split('## Detail')[0]);
	if (results.fts > 3 * TARGET.fts || results.fuzzy > 3 * TARGET.fuzzy) {
		console.error('search p95 is more than 3x its target');
		process.exit(1);
	}
}

await main();
