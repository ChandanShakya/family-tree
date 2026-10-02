import { describe, expect, test, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { changeHistory, treeMembers } from '$lib/db/schema.js';
import { createTree } from '$lib/server/trees.js';
import { getFamilyCode, regenerateFamilyCode } from '$lib/server/join-codes.js';
import { createPerson, deletePerson, updatePerson } from '$lib/server/persons.js';
import { createLink, deleteLink } from '$lib/server/relations.js';
import { ancestors, chainRoots, descendants, generationDepth, relationPath } from '$lib/server/graph.js';
import { createEvent, deleteEvent, updateEvent } from '$lib/server/events.js';
import { requireTreeAccess } from '$lib/server/permissions.js';
import { changeMemberRole, removeMember, transferOwnership } from '$lib/server/members.js';
import { deleteAccount, findUserByEmail, register } from '$lib/server/accounts.js';
import { clearAllRateLimits } from '$lib/server/rate-limit.js';
import { _clearAccountFailures } from '$lib/server/accounts.js';
import { closeAllHandles, freshHandles, makeUser, type TestHandles } from './helpers.js';

let h: TestHandles;

beforeEach(() => {
	h = freshHandles();
	clearAllRateLimits();
	_clearAccountFailures();
});

afterAll(() => {
	closeAllHandles();
});

function makeTree(ownerId: string, name = 'Tree'): string {
	return createTree(h, ownerId, { name }).id;
}

function makePerson(treeId: string, firstName: string, actor: string): string {
	return createPerson(h, actor, treeId, { firstName }).id;
}

function historyCount(entityId: string): number {
	return h.db.select().from(changeHistory).where(eq(changeHistory.entityId, entityId)).all().length;
}

describe('AT-13: parent cycle rejected', () => {
	test('AT-13: parent link that would create a cycle is rejected with no row written', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id);
		const a = makePerson(t, 'A', owner.id);
		const b = makePerson(t, 'B', owner.id);
		expect(createLink(h, owner.id, t, { person1Id: a, person2Id: b, type: 'parent' })).toMatchObject({
			created: true
		});
		const res = createLink(h, owner.id, t, { person1Id: b, person2Id: a, type: 'parent' });
		expect(res).toEqual({ error: 'CYCLE' });
		expect(
			h.raw
				.prepare(`SELECT COUNT(*) AS c FROM relationships WHERE treeId = ?`)
				.get(t) as { c: number }
		).toMatchObject({ c: 1 });
	});
});

describe('AT-14: spouse order normalised', () => {
	test('AT-14: spouse (A,B) then (B,A) is a duplicate; stored order normalised', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id);
		const a = makePerson(t, 'Zed', owner.id);
		const b = makePerson(t, 'Amy', owner.id);
		const first = createLink(h, owner.id, t, { person1Id: a, person2Id: b, type: 'spouse' });
		expect(first).toMatchObject({ created: true });
		const second = createLink(h, owner.id, t, { person1Id: b, person2Id: a, type: 'spouse' });
		expect(second).toEqual({ error: 'DUPLICATE' });
		const row = h.raw.prepare(`SELECT person1Id, person2Id FROM relationships WHERE treeId = ?`).get(t) as {
			person1Id: string;
			person2Id: string;
		};
		expect(row.person1Id < row.person2Id).toBe(true);
	});
});

describe('AT-15: stale version writes nothing', () => {
	test('AT-15: stale version on person update is a conflict with no history rows written', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id);
		const p = makePerson(t, 'Stale', owner.id);
		expect(historyCount(p)).toBe(1);
		const good = updatePerson(h, owner.id, p, 1, { bio: 'first' });
		expect(good).toMatchObject({ updated: true, version: 2 });
		const stale = updatePerson(h, owner.id, p, 1, { bio: 'second' });
		expect(stale).toMatchObject({ error: 'VERSION_CONFLICT' });
		expect((stale as unknown as { current: { version: number } }).current.version).toBe(2);
		expect(historyCount(p)).toBe(2);
	});
});

describe('whole-tree scan cache (§3 main-thread budget)', () => {
	test('generation depth and chain roots follow link inserts, deletes, soft deletes and restores', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id);
		const [a, b, c] = ['A', 'B', 'C'].map((n) => makePerson(t, n, owner.id)) as [string, string, string];
		expect(generationDepth(h.raw, t).depth).toBe(0);
		const ab = createLink(h, owner.id, t, { person1Id: a, person2Id: b, type: 'parent' }) as { id: string };
		expect(generationDepth(h.raw, t).depth).toBe(1);
		expect(chainRoots(h.raw, t)).toEqual([a]);
		const bc = createLink(h, owner.id, t, { person1Id: b, person2Id: c, type: 'parent' }) as { id: string };
		expect(generationDepth(h.raw, t).depth).toBe(2);
		// Soft delete hides C from the depth; restoring brings it back.
		deletePerson(h, owner.id, c);
		expect(generationDepth(h.raw, t).depth).toBe(1);
		h.raw.prepare(`UPDATE persons SET deletedAt = NULL WHERE id = ?`).run(c);
		expect(generationDepth(h.raw, t).depth).toBe(2);
		// Deleting a link and adding a different one with the same count still invalidates.
		deleteLink(h, owner.id, bc.id);
		const d = makePerson(t, 'D', owner.id);
		createLink(h, owner.id, t, { person1Id: d, person2Id: a, type: 'parent' });
		expect(chainRoots(h.raw, t)).toEqual([d]);
		expect(generationDepth(h.raw, t).depth).toBe(2);
		deleteLink(h, owner.id, ab.id);
		expect(generationDepth(h.raw, t).depth).toBe(1);
	});
});

describe('AT-38: traversal caps on a 40-generation chain', () => {
	test(
		'AT-38: ancestors, descendants, relation path and stats stay bounded; over-depth and cycle links rejected',
		async () => {
			const owner = makeUser(h.db);
			const t = makeTree(owner.id);
			const ids: string[] = [];
			for (let i = 0; i < 41; i++) ids.push(makePerson(t, `G${i}`, owner.id));
			// A 41-long chain cannot be built through the API: the
			// GRAPH_TOO_DEEP guard rejects link 31+. The fixture therefore
			// inserts links directly (as a hostile GEDCOM import could not —
			// imports are capped — but raw DB state or legacy data might), so
			// traversals must still terminate bounded (AT-38).
			const now = new Date().toISOString();
			const ins = h.raw.prepare(
				`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdBy, createdAt) VALUES (?, ?, ?, ?, 'parent', ?, ?)`
			);
			for (let i = 0; i < 40; i++) {
				ins.run(`rel-${i}`, t, ids[i], ids[i + 1], owner.id, now);
			}
			const top = ids[0] as string;
			const bottom = ids[40] as string;
			const anc = ancestors(h.raw, t, bottom);
			expect(anc.ids.length).toBeLessThanOrEqual(30);
			expect(anc.truncated).toBe(true);
			const desc = descendants(h.raw, t, top);
			expect(desc.ids.length).toBeLessThanOrEqual(30);
			expect(desc.truncated).toBe(true);
			const rel = relationPath(h.raw, t, top, bottom);
			expect(rel?.truncated).toBe(true);
			const gen = generationDepth(h.raw, t);
			expect(gen.depth).toBeLessThanOrEqual(30);
			expect(gen.truncated).toBe(true);
			// New parent above the top would push the chain to 41.
			const outsider = makePerson(t, 'Out', owner.id);
			expect(
				createLink(h, owner.id, t, { person1Id: outsider, person2Id: top, type: 'parent' })
			).toEqual({ error: 'GRAPH_TOO_DEEP' });
			// Closing the loop is a cycle.
			expect(createLink(h, owner.id, t, { person1Id: bottom, person2Id: top, type: 'parent' })).toEqual({
				error: 'CYCLE'
			});
		},
		60_000
	);
});

describe('AT-41: events audited, viewer gated', () => {
	test('AT-41: add, edit and delete an event write history and show in the timeline', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id);
		const p = makePerson(t, 'Ev', owner.id);
		const created = createEvent(h, owner.id, t, {
			personId: p,
			type: 'residence',
			place: 'Kathmandu'
		});
		if (!('id' in created)) throw new Error('event not created');
		expect(historyCount(created.id)).toBe(1);
		expect(updateEvent(h, owner.id, created.id, { place: 'Pokhara', description: 'moved' })).toMatchObject({
			updated: true
		});
		const rows = h.db.select().from(changeHistory).where(eq(changeHistory.entityId, created.id)).all();
		expect(rows.filter((r) => r.action === 'update')).toHaveLength(2);
		expect(new Set(rows.map((r) => r.batchId)).size).toBeLessThanOrEqual(2);
		expect(deleteEvent(h, owner.id, created.id)).toMatchObject({ deleted: true });
		const del = h.db.select().from(changeHistory).where(eq(changeHistory.entityId, created.id)).all();
		expect(del.filter((r) => r.action === 'delete')).toHaveLength(1);
		expect(del.find((r) => r.action === 'delete')?.snapshot).toBeTruthy();
	});

	test('AT-41: viewer cannot add events; contributor can', () => {
		const owner = makeUser(h.db);
		const viewer = makeUser(h.db);
		const contributor = makeUser(h.db);
		const t = makeTree(owner.id);
		h.db.insert(treeMembers).values({
			id: 'm-viewer',
			treeId: t,
			userId: viewer.id,
			role: 'viewer',
			status: 'active',
			joinedAt: new Date().toISOString(),
			joinedViaType: 'manual'
		}).run();
		h.db.insert(treeMembers).values({
			id: 'm-contrib',
			treeId: t,
			userId: contributor.id,
			role: 'contributor',
			status: 'active',
			joinedAt: new Date().toISOString(),
			joinedViaType: 'manual'
		}).run();
		expect(requireTreeAccess(h.db, viewer.id, t, 'add')).toEqual({ ok: false, status: 403 });
		expect(requireTreeAccess(h.db, contributor.id, t, 'add')).toMatchObject({ ok: true });
	});
});

describe('AT-42: member removal and account deletion', () => {
	test('AT-42: remove a member keeps the person row with userId NULL and drops the membership', () => {
		const owner = makeUser(h.db);
		const member = makeUser(h.db);
		const t = makeTree(owner.id);
		h.db.insert(treeMembers).values({
			id: 'm-ed',
			treeId: t,
			userId: member.id,
			role: 'editor',
			status: 'active',
			joinedAt: new Date().toISOString(),
			joinedViaType: 'manual'
		}).run();
		const p = makePerson(t, 'Linked', owner.id);
		h.raw.prepare(`UPDATE persons SET userId = ?, claimedAt = ? WHERE id = ?`).run(member.id, new Date().toISOString(), p);
		expect(removeMember(h.db, t, member.id)).toEqual({ removed: true });
		const person = h.raw.prepare(`SELECT userId FROM persons WHERE id = ?`).get(p) as {
			userId: string | null;
		};
		expect(person.userId).toBeNull();
		expect(
			h.db.select().from(treeMembers).where(eq(treeMembers.userId, member.id)).all()
		).toHaveLength(0);
	});

	test('AT-42: owner cannot be removed; transfer then remove works', () => {
		const owner = makeUser(h.db);
		const other = makeUser(h.db);
		const t = makeTree(owner.id);
		h.db.insert(treeMembers).values({
			id: 'm-other',
			treeId: t,
			userId: other.id,
			role: 'editor',
			status: 'active',
			joinedAt: new Date().toISOString(),
			joinedViaType: 'manual'
		}).run();
		expect(removeMember(h.db, t, owner.id)).toEqual({ error: 'OWNER_IMMUTABLE' });
		expect(changeMemberRole(h.db, t, owner.id, 'editor')).toEqual({ error: 'OWNER_IMMUTABLE' });
		expect(transferOwnership(h.db, t, other.id)).toEqual({ transferred: true });
		expect(removeMember(h.db, t, owner.id)).toEqual({ removed: true });
	});

	test('AT-42: deleted account frees the email for re-registration', async () => {
		const database = h.db;
		const email = 'cycle42@example.com';
		const first = await register(
			database,
			{ email, password: 'correct-horse-42', displayName: 'Cycle' },
			{ ip: '42.0.0.1', baseUrl: 'http://localhost' }
		);
		expect(first.ok).toBe(true);
		const row = findUserByEmail(database, email);
		if (!row) throw new Error('no user');
		expect(deleteAccount(database, row.id).ok).toBe(true);
		const second = await register(
			database,
			{ email, password: 'correct-horse-42', displayName: 'Cycle 2' },
			{ ip: '42.0.0.2', baseUrl: 'http://localhost' }
		);
		expect(second.ok).toBe(true);
	}, 30_000);
});

describe('AT-07/AT-09: matrix and membership gating', () => {
	test('AT-07: viewer is denied every above-viewer action; AT-09: outsiders get 404', () => {
		const owner = makeUser(h.db);
		const viewer = makeUser(h.db);
		const stranger = makeUser(h.db);
		const t = makeTree(owner.id);
		h.db.insert(treeMembers).values({
			id: 'm-v7',
			treeId: t,
			userId: viewer.id,
			role: 'viewer',
			status: 'active',
			joinedAt: new Date().toISOString(),
			joinedViaType: 'manual'
		}).run();
		for (const action of ['add', 'delete', 'createDirectCode', 'manageFamilyCode', 'review', 'manageMembers', 'import', 'transferDelete'] as const) {
			expect(requireTreeAccess(h.db, viewer.id, t, action)).toEqual({ ok: false, status: 403 });
		}
		expect(requireTreeAccess(h.db, viewer.id, t, 'view')).toMatchObject({ ok: true, role: 'viewer' });
		expect(requireTreeAccess(h.db, stranger.id, t, 'view')).toEqual({ ok: false, status: 404 });
		expect(requireTreeAccess(h.db, stranger.id, 'no-such-tree', 'view')).toEqual({
			ok: false,
			status: 404
		});
	});

	test('AT-09: pending members have no read access; contributor revert is own-only', () => {
		const owner = makeUser(h.db);
		const pending = makeUser(h.db);
		const contrib = makeUser(h.db);
		const other = makeUser(h.db);
		const t = makeTree(owner.id);
		h.db.insert(treeMembers).values({
			id: 'm-pend',
			treeId: t,
			userId: pending.id,
			role: 'contributor',
			status: 'pending',
			joinedAt: new Date().toISOString(),
			joinedViaType: 'manual'
		}).run();
		h.db.insert(treeMembers).values({
			id: 'm-contrib9',
			treeId: t,
			userId: contrib.id,
			role: 'contributor',
			status: 'active',
			joinedAt: new Date().toISOString(),
			joinedViaType: 'manual'
		}).run();
		expect(requireTreeAccess(h.db, pending.id, t, 'view')).toEqual({ ok: false, status: 404 });
		expect(requireTreeAccess(h.db, contrib.id, t, 'revert', { authorUserId: contrib.id })).toMatchObject({
			ok: true
		});
		expect(requireTreeAccess(h.db, contrib.id, t, 'revert', { authorUserId: other.id })).toEqual({
			ok: false,
			status: 403
		});
	});
});

describe('family code', () => {
	test('regenerating keeps exactly one active family code and the DB enforces it', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id, 'Code Tree');
		const first = getFamilyCode(h.db, t)!;
		expect(first.maxUses).toBeNull();
		const res = regenerateFamilyCode(h.db, t, owner.id);
		expect('code' in res && res.code).toMatch(/^CODETREE-[A-Z2-9]{8}$/);
		const active = h.raw.prepare(`SELECT COUNT(*) AS c FROM joinCodes WHERE treeId = ? AND type = 'family' AND isActive = 1`).get(t) as { c: number };
		expect(active.c).toBe(1);
		expect(getFamilyCode(h.db, t)!.id).not.toBe(first.id);
		expect(() =>
			h.raw.prepare(`INSERT INTO joinCodes (id, code, type, treeId, role, currentUses, isActive, createdAt) VALUES ('x', 'DUP-AAAAAAAA', 'family', ?, 'viewer', 0, 1, 'now')`).run(t)
		).toThrow(/UNIQUE/);
	});

	test('DB invariants: one owner per tree, one person per user per tree, no self relationship', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id);
		const a = createPerson(h, owner.id, t, { firstName: 'A' }).id;
		expect(() =>
			h.raw.prepare(`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdAt) VALUES ('r', ?, ?, ?, 'spouse', 'n')`).run(t, a, a)
		).toThrow(/CHECK/);
		const other = makeUser(h.db);
		expect(() =>
			h.db.insert(treeMembers).values({ id: 'm2', treeId: t, userId: other.id, role: 'owner', status: 'active', joinedAt: 'n', joinedViaType: 'manual' }).run()
		).toThrow(/UNIQUE/);
		const b = createPerson(h, owner.id, t, { firstName: 'B' }).id;
		h.raw.prepare(`UPDATE persons SET userId = ? WHERE id = ?`).run(other.id, a);
		expect(() => h.raw.prepare(`UPDATE persons SET userId = ? WHERE id = ?`).run(other.id, b)).toThrow(/UNIQUE/);
	});
});

describe('generation depth', () => {
	test('a person reachable by two chains counts the longer one; roots with no links add nothing; the cap truncates', () => {
		const owner = makeUser(h.db);
		const t = makeTree(owner.id, 'Depth');
		const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n) => makePerson(t, n, owner.id)) as [string, string, string, string];
		makePerson(t, 'Loner', owner.id);
		createLink(h, owner.id, t, { person1Id: a, person2Id: b, type: 'parent' });
		createLink(h, owner.id, t, { person1Id: b, person2Id: c, type: 'parent' });
		createLink(h, owner.id, t, { person1Id: a, person2Id: c, type: 'parent' }); // shortcut A→C
		expect(generationDepth(h.raw, t)).toEqual({ depth: 2, truncated: false });
		createLink(h, owner.id, t, { person1Id: c, person2Id: d, type: 'parent' });
		expect(generationDepth(h.raw, t)).toEqual({ depth: 3, truncated: false });
	});
});

describe('middle name', () => {
	test('is stored, edited, searchable, part of the display name and exports, and hidden for living people', async () => {
		const { ftsSearch } = await import('$lib/server/search.js');
		const { anonymisePerson } = await import('../src/lib/shared/privacy.mjs');
		const { buildGedcom } = await import('../src/lib/shared/gedcom.mjs');
		const { fullName } = await import('$lib/utils/format.js');
		const owner = makeUser(h.db);
		const t = makeTree(owner.id);
		const id = createPerson(h, owner.id, t, { firstName: 'Ram', middleName: 'Bahadur', lastName: 'Thapa' }).id;
		const row = h.raw.prepare(`SELECT * FROM persons WHERE id = ?`).get(id) as { firstName: string; middleName: string | null; lastName: string | null };
		expect(row.middleName).toBe('Bahadur');
		expect(fullName(row)).toBe('Ram Bahadur Thapa');
		expect(fullName({ firstName: 'Sita', middleName: '', lastName: null })).toBe('Sita');
		expect(ftsSearch(h, t, 'Bahadur').map((x) => x.id)).toEqual([id]);
		expect(ftsSearch(h, t, 'Bahadur')[0]?.middleName).toBe('Bahadur');
		updatePerson(h, owner.id, id, 1, { middleName: 'Kumar' });
		expect(ftsSearch(h, t, 'Bahadur')).toEqual([]);
		expect(ftsSearch(h, t, 'Kumar').map((x) => x.id)).toEqual([id]);
		expect(historyCount(id)).toBeGreaterThanOrEqual(2);
		expect(anonymisePerson({ ...row, middleName: 'Kumar' }).middleName).toBeNull();
		const ged = buildGedcom({ people: [{ id, firstName: 'Ram', middleName: 'Kumar', lastName: 'Thapa' }], links: [], treeName: 'T' });
		expect(ged).toContain('1 NAME Ram Kumar /Thapa/');
		expect(ged).toContain('2 GIVN Ram Kumar');
	});
});
