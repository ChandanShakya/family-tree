import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { joinCodes, treeMembers, users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createSession } from '$lib/server/auth.js';
import { createTree } from '$lib/server/trees.js';
import { createPerson } from '$lib/server/persons.js';
import { createDirectCode, redeemCode } from '$lib/server/codes.js';
import { getFamilyCode, regenerateFamilyCode } from '$lib/server/join-codes.js';
import { getQuestions, setQuestions } from '$lib/server/claims.js';

// Real contention: SERVERS separate Node processes, each with its own better-sqlite3
// connection per request, all writing one database file. `BEGIN IMMEDIATE` collisions
// happen between processes, not inside one synchronous event loop (§12).

process.env.VERIFICATION_PEPPER = 'test-pepper-test-pepper-test-pepper'; // same pepper in the test and the servers

const DIR = './.test-tmp-conc';
const DB = `${DIR}/c.db`;
const BASE_PORT = 4210;
const SERVERS = 4;

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let h: { raw: Database.Database; db: typeof db };
const procs: ChildProcess[] = [];
let ownerId = '';
let tree = '';
let anchor = '';
let seq = 0;
const cookieOf = new Map<string, string>();

async function newUser(name: string): Promise<string> {
	const id = randomUUID();
	db.insert(users).values({ id, email: `${id}@example.com`, displayName: name, emailVerifiedAt: 'n', createdAt: 'n' }).run();
	cookieOf.set(id, (await createSession(db, id, null)).token);
	return id;
}

/** Request `i` goes to server `i % SERVERS` with its own client IP so the limiters never interfere. */
function call(i: number, method: string, path: string, userId?: string, body?: unknown, ip = `10.0.0.${++seq % 250}.${i}`) {
	return fetch(`http://localhost:${BASE_PORT + (i % SERVERS)}${path}`, {
		method,
		headers: {
			'x-test-ip': ip,
			...(userId ? { cookie: `session=${cookieOf.get(userId)}` } : {}),
			...(body !== undefined ? { 'content-type': 'application/json' } : {})
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	}).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }));
}

beforeAll(async () => {
	rmSync(DIR, { force: true, recursive: true });
	mkdirSync(DIR, { recursive: true });
	raw = new Database(DB);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	db = drizzle(raw, { schema });
	h = { raw, db };
	ownerId = await newUser('Owner');
	tree = createTree(h, ownerId, { name: 'Conc' }).id;
	anchor = createPerson(h, ownerId, tree, { firstName: 'Anchor' }).id;
	for (let i = 0; i < SERVERS; i++) {
		procs.push(
			spawn('node', ['build'], {
				env: {
					...process.env,
					PORT: String(BASE_PORT + i),
					DATABASE_PATH: DB,
					ORIGIN: `http://localhost:${BASE_PORT + i}`,
					ADDRESS_HEADER: 'x-test-ip',
					RATE_LIMIT_API_MAX: '100000',
					VERIFICATION_PEPPER: 'test-pepper-test-pepper-test-pepper'
				}
			})
		);
	}
	await Promise.all(
		procs.map(async (_, i) => {
			for (let k = 0; k < 80; k++) {
				if (await fetch(`http://localhost:${BASE_PORT + i}/api/health`).then((r) => r.ok, () => false)) return;
				await new Promise((r) => setTimeout(r, 400));
			}
			throw new Error(`server ${i} did not start`);
		})
	);
}, 90_000);

afterAll(async () => {
	// Wait for the servers to exit before removing their database directory.
	await Promise.all(procs.map((p) => (p.exitCode === null ? new Promise((r) => (p.once('exit', r), p.kill())) : null)));
	raw?.close();
	rmSync(DIR, { force: true, recursive: true, maxRetries: 5 });
});

const count = (sql: string, ...args: unknown[]) => (raw.prepare(sql).get(...args) as { c: number }).c;

describe('concurrent redemption and claims (separate processes)', () => {
	test('AT-01: 20 concurrent redemptions of one direct code → exactly 1 success, 1 person, 1 membership, 1 relationship', async () => {
		const code = createDirectCode(h, ownerId, 'owner', tree, { linkedPersonId: anchor, linkedRelationType: 'child' }) as { code: string };
		const people0 = count(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`, tree);
		const members0 = count(`SELECT COUNT(*) AS c FROM treeMembers WHERE treeId = ?`, tree);
		const rels0 = count(`SELECT COUNT(*) AS c FROM relationships WHERE treeId = ?`, tree);
		const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => newUser(`R${i}`)));
		const res = await Promise.all(ids.map((u, i) => call(i, 'POST', `/api/join/${code.code}`, u, { firstName: `R${i}` })));
		const ok = res.filter((r) => r.status === 201);
		expect(ok).toHaveLength(1);
		expect(res.filter((r) => r.status === 404)).toHaveLength(19);
		// every failure is the same bytes
		expect(new Set(res.filter((r) => r.status === 404).map((r) => r.text)).size).toBe(1);
		expect(count(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ?`, tree) - people0).toBe(1);
		expect(count(`SELECT COUNT(*) AS c FROM treeMembers WHERE treeId = ?`, tree) - members0).toBe(1);
		expect(count(`SELECT COUNT(*) AS c FROM relationships WHERE treeId = ?`, tree) - rels0).toBe(1);
		expect(count(`SELECT currentUses AS c FROM joinCodes WHERE code = ?`, code.code)).toBe(1);
	}, 60_000);

	test('AT-02: family code with maxUses=3 and 10 concurrent redemptions → exactly 3 pending memberships', async () => {
		regenerateFamilyCode(db, tree, ownerId);
		const fam = getFamilyCode(db, tree)!;
		db.update(joinCodes).set({ maxUses: 3 }).where(eq3(fam.id)).run();
		const pending0 = count(`SELECT COUNT(*) AS c FROM treeMembers WHERE treeId = ? AND status = 'pending'`, tree);
		const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => newUser(`F${i}`)));
		const res = await Promise.all(ids.map((u, i) => call(i, 'POST', `/api/join/${fam.code}`, u, { firstName: `F${i}` })));
		expect(res.filter((r) => r.status === 201)).toHaveLength(3);
		expect(res.filter((r) => r.status === 404)).toHaveLength(7);
		expect(count(`SELECT COUNT(*) AS c FROM treeMembers WHERE treeId = ? AND status = 'pending'`, tree) - pending0).toBe(3);
		expect(count(`SELECT currentUses AS c FROM joinCodes WHERE id = ?`, fam.id)).toBe(3);
		// pending members see nothing (AT-10, live)
		const pendingUser = (raw.prepare(`SELECT userId FROM treeMembers WHERE treeId = ? AND status = 'pending' LIMIT 1`).get(tree) as { userId: string }).userId;
		for (const path of [`/api/trees/${tree}`, `/api/persons/${anchor}`, `/api/search?q=Anchor&treeId=${tree}`, `/api/trees/${tree}/stats`]) {
			expect((await call(0, 'GET', path, pendingUser)).status, path).toBe(404);
		}
	}, 60_000);

	test('AT-03: two users claim the same unclaimed person simultaneously → exactly one userId set; the loser\'s claim is rejected', async () => {
		for (let round = 0; round < 6; round++) {
			const pid = createPerson(h, ownerId, tree, { firstName: `Target${round}` }).id;
			setQuestions(h, ownerId, tree, pid, [1, 2, 3].map((i) => ({ question: `q${i}`, answer: `a${i}` })));
			const answers = getQuestions(db, pid).map((q) => ({ questionId: q.id, answer: `a${q.question.slice(1)}` }));
			const [a, b] = await Promise.all([newUser(`A${round}`), newUser(`B${round}`)]);
			for (const u of [a, b]) {
				db.insert(treeMembers).values({ id: randomUUID(), treeId: tree, userId: u, role: 'viewer', status: 'active', joinedAt: 'n', joinedViaType: 'manual' }).run();
			}
			const res = await Promise.all([a, b].map((u, i) => call(i, 'PUT', `/api/claims/questions/verify/${pid}`, u, { answers })));
			const wins = res.filter((r) => r.status === 200);
			expect(wins, `round ${round}`).toHaveLength(1);
			expect(res.find((r) => r.status !== 200)!.status).toBe(409);
			const owner = (raw.prepare(`SELECT userId FROM persons WHERE id = ?`).get(pid) as { userId: string }).userId;
			expect([a, b]).toContain(owner);
			const claims = raw.prepare(`SELECT userId, status FROM profileClaims WHERE personId = ?`).all(pid) as Array<{ userId: string; status: string }>;
			expect(claims.map((c) => c.status).sort()).toEqual(['auto_approved', 'rejected']);
			expect(claims.find((c) => c.status === 'auto_approved')!.userId).toBe(owner);
		}
	}, 90_000);
});

describe('code endpoints over HTTP', () => {
	test('AT-12: unknown, expired, exhausted and deactivated codes return byte-identical status and body', async () => {
		const mk = () => createDirectCode(h, ownerId, 'owner', tree, { linkedPersonId: anchor, linkedRelationType: 'sibling' }) as { id: string; code: string };
		const expired = createDirectCode(h, ownerId, 'owner', tree, { linkedPersonId: anchor, linkedRelationType: 'sibling', expiresAt: '2001-01-01T00:00:00.000Z' }) as { code: string };
		const used = mk();
		const user = await newUser('Used');
		redeemCode(h, user, used.code, { firstName: 'U' });
		const off = mk();
		raw.prepare(`UPDATE joinCodes SET isActive = 0 WHERE id = ?`).run(off.id);
		const codes = ['NOPE-ABCDEFGH', expired.code, used.code, off.code];
		const out = [];
		for (const [i, c] of codes.entries()) {
			const g = await call(i, 'GET', `/api/join/${c}`);
			const p = await call(i, 'POST', `/api/join/${c}`, await newUser(`P${i}`), { firstName: 'P' });
			out.push([g.status, g.text, p.status, p.text]);
		}
		expect(new Set(out.map((o) => JSON.stringify([o[0], o[1]]))).size).toBe(1);
		expect(new Set(out.map((o) => JSON.stringify([o[2], o[3]]))).size).toBe(1);
		expect(out[0]![0]).toBe(404);
		expect(JSON.parse(out[0]![1] as string).error.code).toBe('JOIN_UNAVAILABLE');
	}, 60_000);

	test('AT-31: 5 failures from one IP block it for 15 minutes with Retry-After; other IPs and login are unaffected', async () => {
		const ip = '203.0.113.7';
		const statuses: number[] = [];
		let last!: Awaited<ReturnType<typeof call>>;
		for (let i = 0; i < 6; i++) {
			last = await call(0, 'GET', `/api/join/NOPE-${i}AAAAAAA`, undefined, undefined, ip);
			statuses.push(last.status);
		}
		expect(statuses).toEqual([404, 404, 404, 404, 404, 429]);
		expect(JSON.parse(last.text).error.code).toBe('LOCKED');
		const retry = Number(last.headers.get('retry-after'));
		expect(retry).toBeGreaterThan(890);
		expect(retry).toBeLessThanOrEqual(900);
		// even a valid code is refused while blocked (and POST shares the counter)
		const fam = getFamilyCode(db, tree)!;
		expect((await call(0, 'GET', `/api/join/${fam.code}`, undefined, undefined, ip)).status).toBe(429);
		// another IP is fine
		expect((await call(0, 'GET', `/api/join/${fam.code}`, undefined, undefined, '203.0.113.8')).status).not.toBe(429);
		// login from the blocked IP is not subject to these tiers
		const login = await call(0, 'POST', '/api/auth/login', undefined, { email: 'nobody@example.com', password: 'wrong password!' }, ip);
		expect(login.status).toBe(401);
	}, 60_000);

	test('AT-44: a direct code above the creator\'s role is refused with 403; the role of a redeemed code is applied', async () => {
		const contrib = await newUser('Cora');
		db.insert(treeMembers).values({ id: randomUUID(), treeId: tree, userId: contrib, role: 'contributor', status: 'active', joinedAt: 'n', joinedViaType: 'manual' }).run();
		const body = (role: string) => ({ treeId: tree, type: 'direct', linkedPersonId: anchor, linkedRelationType: 'child', role });
		expect((await call(0, 'POST', '/api/join-codes', contrib, body('editor'))).status).toBe(403);
		const ok = await call(0, 'POST', '/api/join-codes', contrib, body('viewer'));
		expect(ok.status).toBe(201);
		const joiner = await newUser('Vee');
		const r = await call(1, 'POST', `/api/join/${JSON.parse(ok.text).data.code}`, joiner, { firstName: 'Vee' });
		expect(r.status).toBe(201);
		expect(raw.prepare(`SELECT role, status FROM treeMembers WHERE userId = ?`).get(joiner)).toEqual({ role: 'viewer', status: 'active' });
	}, 60_000);
});

import { eq } from 'drizzle-orm';
function eq3(id: string) {
	return eq(joinCodes.id, id);
}
