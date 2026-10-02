import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { treeMembers, users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createTree } from '$lib/server/trees.js';
import { createPerson } from '$lib/server/persons.js';
import { createLink } from '$lib/server/relations.js';
import { buildCombined, canOpen, relateInView, saveSettings, setMatch, settingsLog } from '$lib/server/combined.js';
import { updateTree } from '$lib/server/trees.js';

const DIR = './.test-tmp-combined';
let raw: Database.Database;
let h: { raw: Database.Database; db: ReturnType<typeof drizzle<typeof schema>> };
const ids: Record<string, string> = {};

beforeAll(() => {
	rmSync(DIR, { force: true, recursive: true });
	mkdirSync(DIR, { recursive: true });
	raw = new Database(`${DIR}/c.db`);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	h = { raw, db: drizzle(raw, { schema }) };
	const now = new Date().toISOString();
	const user = (n: string) => {
		const id = randomUUID();
		h.db.insert(users).values({ id, email: `${n}@example.com`, displayName: n, emailVerifiedAt: now, createdAt: now }).run();
		return (ids[n] = id);
	};
	const member = (treeId: string, userId: string) =>
		h.db.insert(treeMembers).values({ id: randomUUID(), treeId, userId, role: 'viewer', status: 'active', joinedAt: now, joinedViaType: 'manual' }).run();
	const shakyaOwner = user('shakyaOwner');
	const tuladharOwner = user('tuladharOwner');
	const bride = user('bride');
	user('husband');
	user('child');
	user('stranger');
	const shakya = (ids.shakya = createTree(h, shakyaOwner, { name: 'Shakya' }).id);
	const tuladhar = (ids.tuladhar = createTree(h, tuladharOwner, { name: 'Tuladhar' }).id);
	for (const [t, u] of [[shakya, bride], [tuladhar, bride], [shakya, ids.husband], [shakya, ids.child], [tuladhar, ids.child]] as const) member(t, u!);
	// Bride in both trees (claimed), her husband in Shakya, her father in Tuladhar.
	const bS = createPerson(h, shakyaOwner, shakya, { firstName: 'Bride' }).id;
	const bT = createPerson(h, tuladharOwner, tuladhar, { firstName: 'Bride' }).id;
	raw.prepare(`UPDATE persons SET userId = ?, claimedAt = ? WHERE id IN (?, ?)`).run(bride, now, bS, bT);
	ids.bS = bS;
	ids.bT = bT;
	ids.husbandP = createPerson(h, shakyaOwner, shakya, { firstName: 'Husband' }).id;
	ids.fatherP = createPerson(h, tuladharOwner, tuladhar, { firstName: 'Father' }).id;
	createLink(h, shakyaOwner, shakya, { person1Id: ids.husbandP, person2Id: bS, type: 'spouse' });
	createLink(h, tuladharOwner, tuladhar, { person1Id: ids.fatherP, person2Id: bT, type: 'parent' });
	// The bride's mother is recorded in both trees.
	ids.momS = createPerson(h, shakyaOwner, shakya, { firstName: 'Laxmi', lastName: 'Tuladhar' }).id;
	ids.momT = createPerson(h, tuladharOwner, tuladhar, { firstName: 'Laxmi', lastName: 'Tuladhar' }).id;
	createLink(h, shakyaOwner, shakya, { person1Id: ids.momS, person2Id: bS, type: 'parent' });
	createLink(h, tuladharOwner, tuladhar, { person1Id: ids.momT, person2Id: bT, type: 'parent' });
	createLink(h, tuladharOwner, tuladhar, { person1Id: ids.fatherP, person2Id: ids.momT, type: 'spouse' });
});
afterAll(() => {
	raw.close();
	rmSync(DIR, { force: true, recursive: true });
});

describe('D-035 combined family view', () => {
	test('the owner sees both trees joined at one node', () => {
		const v = buildCombined(h, ids.bride!, ids.bride!)!;
		expect(v.persons.map((p) => p.firstName).sort()).toEqual(['Bride', 'Father', 'Husband', 'Laxmi', 'Laxmi']);
		expect(v.centerId).toBe(ids.bS);
		expect(v.relationships.some((r) => r.person1Id === ids.fatherP && r.person2Id === ids.bS && r.type === 'parent')).toBe(true);
		expect(v.treesOf[ids.fatherP!]).toEqual([ids.tuladhar]);
	});

	test("default 'me' hides it from everyone else", () => {
		expect(canOpen(h, ids.bride!, ids.husband!)).toBe(false);
		expect(canOpen(h, ids.bride!, ids.child!)).toBe(false);
	});

	test("'members' opens it to members of two trees only", () => {
		saveSettings(h, ids.bride!, { share: 'members', depth: null, viewers: [] });
		expect(canOpen(h, ids.bride!, ids.child!)).toBe(true);
		expect(canOpen(h, ids.bride!, ids.husband!)).toBe(false);
	});

	test("'chosen' viewers see only the trees they belong to", () => {
		saveSettings(h, ids.bride!, { share: 'chosen', depth: null, viewers: [ids.husband!] });
		const v = buildCombined(h, ids.bride!, ids.husband!)!;
		expect(v.persons.map((p) => p.firstName).sort()).toEqual(['Bride', 'Husband', 'Laxmi']);
		expect(v.sides.find((s) => s.treeId === ids.tuladhar)?.visible).toBe(false);
		expect(canOpen(h, ids.bride!, ids.child!)).toBe(false);
	});

	test('only co-members can be chosen; strangers never open it', () => {
		expect(saveSettings(h, ids.bride!, { share: 'chosen', depth: null, viewers: [ids.stranger!] })).toEqual({ error: 'BAD_VIEWER' });
		expect(canOpen(h, ids.bride!, ids.stranger!)).toBe(false);
	});

	test('depth limits generations; an owner opt-out drops the tree', () => {
		saveSettings(h, ids.bride!, { share: 'me', depth: null, viewers: [] });
		raw.prepare(`UPDATE trees SET allowCrossTree = 0 WHERE id = ?`).run(ids.tuladhar);
		expect(buildCombined(h, ids.bride!, ids.bride!)!.sides.map((x) => x.treeId)).toEqual([ids.shakya]);
		raw.prepare(`UPDATE trees SET allowCrossTree = 1 WHERE id = ?`).run(ids.tuladhar);
		expect(buildCombined(h, ids.bride!, ids.bride!, 1)?.persons.length).toBe(5);
	});

	test('the same relative in both trees is suggested, joined on confirmation, and can be separated', () => {
		const v = buildCombined(h, ids.bride!, ids.bride!)!;
		expect(v.suggestions).toHaveLength(1);
		expect(v.suggestions[0]!.kind).toBe('parent');
		expect(buildCombined(h, ids.bride!, ids.husband!)?.suggestions ?? []).toEqual([]);
		expect(setMatch(h, ids.bride!, ids.momS!, ids.momT!, true)).toEqual({ ok: true });
		const j = buildCombined(h, ids.bride!, ids.bride!)!;
		expect(j.persons.filter((p) => p.firstName === 'Laxmi')).toHaveLength(1);
		expect(j.treesOf[ids.momS! < ids.momT! ? ids.momS! : ids.momT!]?.sort()).toEqual([ids.shakya, ids.tuladhar].sort());
		expect(j.suggestions).toEqual([]);
		// The joined node keeps both trees' links: Laxmi is now the Father's spouse in the combined view.
		const laxmi = j.persons.find((p) => p.firstName === 'Laxmi')!.id as string;
		expect(relateInView(j, ids.husbandP!, ids.fatherP!)?.label).toMatch(/in-law/);
		expect(relateInView(j, laxmi, ids.fatherP!)?.label).toBe('spouse');
		setMatch(h, ids.bride!, ids.momS!, ids.momT!, false);
		expect(buildCombined(h, ids.bride!, ids.bride!)!.persons.filter((p) => p.firstName === 'Laxmi')).toHaveLength(2);
	});

	test('matches only between two of the owner\'s own trees', () => {
		const other = createTree(h, ids.stranger!, { name: 'Other' }).id;
		const x = createPerson(h, ids.stranger!, other, { firstName: 'X' }).id;
		expect(setMatch(h, ids.bride!, ids.momS!, x, true)).toEqual({ error: 'NOT_FOUND' });
		expect(setMatch(h, ids.bride!, ids.momS!, ids.husbandP!, true)).toEqual({ error: 'NOT_FOUND' });
	});

	test('sharing changes are logged for the owner and chosen people are notified', () => {
		saveSettings(h, ids.bride!, { share: 'chosen', depth: 3, viewers: [ids.child!] });
		expect(settingsLog(h, ids.bride!)[0]!.summary).toContain('Shared with child');
		const n = raw.prepare(`SELECT title, linkUrl FROM notifications WHERE userId = ? AND type = 'share'`).all(ids.child) as { title: string; linkUrl: string }[];
		expect(n.at(-1)?.linkUrl).toBe(`/families/${ids.bride}`);
	});

	test('tree setting changes appear in the tree activity', () => {
		updateTree(h.db, ids.tuladhar!, { allowCrossTree: false }, ids.tuladharOwner);
		const row = raw.prepare(`SELECT field, newValue FROM changeHistory WHERE treeId = ? AND entityType = 'tree' AND action = 'update'`).get(ids.tuladhar) as { field: string; newValue: string };
		expect(row).toEqual({ field: 'allowCrossTree', newValue: 'false' });
		updateTree(h.db, ids.tuladhar!, { allowCrossTree: true }, ids.tuladharOwner);
	});
});
