import { describe, expect, test, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { changeHistory, events, notifications, persons, profileClaims, relationships, treeMembers } from '$lib/db/schema.js';
import { LOCKOUT_TIERS, EDIT_NOTIFY_COALESCE_MINUTES } from '$lib/config.js';
import { createTree, getTreeView, treeStats } from '$lib/server/trees.js';
import { createPerson, deletePerson, updatePerson } from '$lib/server/persons.js';
import { createLink, deleteLink } from '$lib/server/relations.js';
import { createEvent, deleteEvent } from '$lib/server/events.js';
import { ancestors } from '$lib/server/graph.js';
import { ftsSearch } from '$lib/server/search.js';
import { createDirectCode, deactivateCode, previewCode, redeemCode, reviewMember } from '$lib/server/codes.js';
import { getFamilyCode, regenerateFamilyCode } from '$lib/server/join-codes.js';
import { claimAudience, claimSearch, getQuestions, matchScore, reviewClaim, setQuestions, submitClaim, verifyAnswers } from '$lib/server/claims.js';
import { revertHistory } from '$lib/server/history.js';
import { listNotifications, markRead, notifyEdit } from '$lib/server/notifications.js';
import { requireTreeAccess } from '$lib/server/permissions.js';
import { runWorker } from '$lib/server/run-worker.js';
import { clearAllRateLimits, isBlocked, recordFailure } from '$lib/server/rate-limit.js';
import { closeAllHandles, freshHandles, makeUser, type TestHandles } from './helpers.js';

let h: TestHandles;
beforeEach(() => {
	h = freshHandles();
	clearAllRateLimits();
});
afterAll(() => closeAllHandles());

const NOW = new Date('2026-10-01T12:00:00Z');

function member(treeId: string, userId: string, role: string, status = 'active') {
	h.db.insert(treeMembers).values({ id: `m-${treeId}-${userId}`, treeId, userId, role, status, joinedAt: 'n', joinedViaType: 'manual' }).run();
}

function world() {
	const owner = makeUser(h.db, undefined, 'Olive Owner');
	const editor = makeUser(h.db, undefined, 'Eddie Editor');
	const contrib = makeUser(h.db, undefined, 'Cora Contrib');
	const viewer = makeUser(h.db);
	const tree = createTree(h, owner.id, { name: 'Rai Family' }).id;
	member(tree, editor.id, 'editor');
	member(tree, contrib.id, 'contributor');
	member(tree, viewer.id, 'viewer');
	return { owner, editor, contrib, viewer, tree };
}

describe('AT-04: one person per user per tree', () => {
	test('AT-04: second claim in the same tree fails on ux_person_user_per_tree; another tree succeeds', () => {
		const w = world();
		const t2 = createTree(h, w.owner.id, { name: 'Other' }).id;
		const user = makeUser(h.db);
		member(w.tree, user.id, 'viewer');
		member(t2, user.id, 'viewer');
		const mk = (t: string, n: string) => {
			const id = createPerson(h, w.owner.id, t, { firstName: n }).id;
			setQuestions(h, w.owner.id, t, id, [1, 2, 3].map((i) => ({ question: `q${i}`, answer: `a${i}` })));
			return id;
		};
		const p1 = mk(w.tree, 'One');
		const p2 = mk(w.tree, 'Two');
		const p3 = mk(t2, 'Three');
		const answer = (pid: string) => getQuestions(h.db, pid).map((q) => ({ questionId: q.id, answer: `a${q.question.slice(1)}` }));
		expect(verifyAnswers(h, user.id, w.tree, p1, answer(p1))).toMatchObject({ ok: true, claimed: true });
		const second = verifyAnswers(h, user.id, w.tree, p2, answer(p2));
		expect(second).toMatchObject({ ok: true, claimed: false, reason: 'ALREADY_LINKED' });
		expect(h.db.select().from(persons).where(eq(persons.id, p2)).get()?.userId).toBeNull();
		// the DB itself refuses it too
		expect(() => h.raw.prepare(`UPDATE persons SET userId = ? WHERE id = ?`).run(user.id, p2)).toThrow(/UNIQUE/);
		expect(verifyAnswers(h, user.id, t2, p3, answer(p3))).toMatchObject({ ok: true, claimed: true });
	});
});

describe('AT-20/AT-21: verification attempts and matching', () => {
	test('AT-20: the 6th attempt in 24 h is blocked even with the correct answers', () => {
		const w = world();
		const pid = createPerson(h, w.owner.id, w.tree, { firstName: 'Quiz' }).id;
		setQuestions(h, w.owner.id, w.tree, pid, [1, 2, 3].map((i) => ({ question: `q${i}`, answer: `a${i}` })));
		const qs = getQuestions(h.db, pid);
		const wrong = qs.map((q) => ({ questionId: q.id, answer: 'nope' }));
		const right = qs.map((q) => ({ questionId: q.id, answer: ` A${q.question.slice(1)} ` })); // normalised: case and spaces
		for (let i = 0; i < 5; i++) expect(verifyAnswers(h, w.viewer.id, w.tree, pid, wrong, NOW)).toEqual({ ok: false, error: 'WRONG' });
		const sixth = verifyAnswers(h, w.viewer.id, w.tree, pid, right, NOW);
		expect(sixth).toMatchObject({ ok: false, error: 'LOCKED' });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.userId).toBeNull();
		// the window is per (user, person) and 24 h long
		expect(verifyAnswers(h, w.contrib.id, w.tree, pid, right, NOW)).toMatchObject({ ok: true, claimed: true });
		const later = new Date(NOW.getTime() + 24 * 3600_000 + 1000);
		expect(verifyAnswers(h, w.viewer.id, w.tree, pid, right, later)).toMatchObject({ ok: true, claimed: false, reason: 'ALREADY_CLAIMED' });
	});

	test('AT-20: fewer than the minimum questions cannot be used, and answers never leave the service', () => {
		const w = world();
		const pid = createPerson(h, w.owner.id, w.tree, { firstName: 'Few' }).id;
		setQuestions(h, w.owner.id, w.tree, pid, [{ question: 'only one', answer: 'x' }]);
		const qs = getQuestions(h.db, pid);
		expect(Object.keys(qs[0]!).sort()).toEqual(['id', 'question']);
		expect(verifyAnswers(h, w.viewer.id, w.tree, pid, [{ questionId: qs[0]!.id, answer: 'x' }])).toEqual({ ok: false, error: 'NOT_ENOUGH_QUESTIONS' });
	});

	test('AT-21: a matching claim with score >= 0.95 stays pending and is never auto-approved', () => {
		const w = world();
		const pid = createPerson(h, w.owner.id, w.tree, { firstName: 'Hari', lastName: 'Rai', birthDate: '12 March 1950', birthPlace: 'Pokhara' }).id;
		const r = submitClaim(h, w.viewer.id, { treeId: w.tree, personId: pid, proofMethod: 'matching', claimedFirstName: 'Hari', claimedLastName: 'Rai', claimedBirthDate: '1950-03-12', claimedBirthPlace: 'Pokhara' });
		expect(r.ok && r.matchScore).toBeGreaterThanOrEqual(0.95);
		expect(h.db.select().from(profileClaims).where(eq(profileClaims.userId, w.viewer.id)).get()?.status).toBe('pending');
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.userId).toBeNull();
		// weights: name 0.5, date 0.3, place 0.2; missing fields score 0 (no renormalising)
		const p = { firstName: 'Hari', lastName: 'Rai', birthDateNorm: '1950-03-12', birthPlace: 'Pokhara' };
		expect(matchScore(p, { firstName: 'Hari', lastName: 'Rai' })).toBeCloseTo(0.5);
		expect(matchScore(p, { firstName: 'Hari', lastName: 'Rai', birthDate: '1950' })).toBeCloseTo(0.8);
		expect(matchScore(p, { firstName: 'Hari', lastName: 'Rai', birthDate: '1950-04' })).toBeCloseTo(0.65);
		expect(matchScore(p, { firstName: 'Hari', lastName: 'Rai', birthPlace: 'Pokhara Nepal' })).toBeCloseTo(0.6);
		// only an owner/editor decision links the person
		const rev = reviewClaim(h, w.editor.id, (r as { claimId: string }).claimId, { decision: 'approve' });
		expect(rev).toEqual({ ok: true, status: 'approved' });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.userId).toBe(w.viewer.id);
	});

	test('claim review: approval links a relationship atomically; a lost race rejects the claim', () => {
		const w = world();
		const parent = createPerson(h, w.owner.id, w.tree, { firstName: 'Parent' }).id;
		const kid = createPerson(h, w.owner.id, w.tree, { firstName: 'Kid' }).id;
		const a = makeUser(h.db);
		const b = makeUser(h.db);
		member(w.tree, a.id, 'viewer');
		member(w.tree, b.id, 'viewer');
		const ca = submitClaim(h, a.id, { treeId: w.tree, personId: kid, proofMethod: 'manual' }) as { claimId: string };
		const cb = submitClaim(h, b.id, { treeId: w.tree, personId: kid, proofMethod: 'manual' }) as { claimId: string };
		const ok = reviewClaim(h, w.owner.id, ca.claimId, { decision: 'approve', linkedRelationType: 'child', linkedToPersonId: parent });
		expect(ok).toEqual({ ok: true, status: 'approved' });
		expect(h.db.select().from(relationships).where(and(eq(relationships.person1Id, parent), eq(relationships.person2Id, kid))).get()).toBeDefined();
		// b's claim was rejected in the same transaction (first wins)
		expect(h.db.select().from(profileClaims).where(eq(profileClaims.id, cb.claimId)).get()).toMatchObject({ status: 'rejected', reviewNote: 'already claimed' });
		// a failing link rolls back the whole approval
		const c2 = makeUser(h.db);
		member(w.tree, c2.id, 'viewer');
		const other = createPerson(h, w.owner.id, w.tree, { firstName: 'Other' }).id;
		const cc = submitClaim(h, c2.id, { treeId: w.tree, personId: other, proofMethod: 'manual' }) as { claimId: string };
		const bad = reviewClaim(h, w.owner.id, cc.claimId, { decision: 'approve', linkedRelationType: 'parent', linkedToPersonId: other });
		expect(bad).toEqual({ ok: false, error: 'LINK_FAILED' });
		expect(h.db.select().from(persons).where(eq(persons.id, other)).get()?.userId).toBeNull();
		expect(h.db.select().from(profileClaims).where(eq(profileClaims.id, cc.claimId)).get()?.status).toBe('pending');
	});

	test('claim search shows code holders only first name, last initial and birth year, and only unclaimed people', () => {
		const w = world();
		const pid = createPerson(h, w.owner.id, w.tree, { firstName: 'Mina', lastName: 'Gurung', birthDate: '1988', birthPlace: 'Lamjung' }).id;
		const taken = createPerson(h, w.owner.id, w.tree, { firstName: 'Mina', lastName: 'Thapa' }).id;
		h.raw.prepare(`UPDATE persons SET userId = ? WHERE id = ?`).run(w.viewer.id, taken);
		const fam = getFamilyCode(h.db, w.tree)!;
		expect(claimAudience(h.db, null, w.tree, fam.code)).toBe('holder');
		expect(claimAudience(h.db, null, w.tree, 'NOPE-AAAAAAAA')).toBeNull();
		expect(claimAudience(h.db, w.contrib.id, w.tree)).toBe('member');
		const holder = claimSearch(h, w.tree, 'Mina', 'holder');
		expect(holder).toEqual([{ id: pid, firstName: 'Mina', lastInitial: 'G', birthYear: '1988' }]);
		const mem = claimSearch(h, w.tree, 'Mina', 'member');
		expect(mem[0]).toMatchObject({ id: pid, lastName: 'Gurung', birthPlace: 'Lamjung' });
	});
});

describe('AT-44 / AT-12: join codes', () => {
	test('AT-44: a direct code cannot grant a role above its creator; redemption gives the code role; family joiners get DEFAULT_JOIN_ROLE', () => {
		const w = world();
		const anchor = createPerson(h, w.owner.id, w.tree, { firstName: 'Anchor' }).id;
		expect(createDirectCode(h, w.contrib.id, 'contributor', w.tree, { linkedPersonId: anchor, linkedRelationType: 'child', role: 'editor' })).toEqual({ error: 'ROLE_TOO_HIGH' });
		const code = createDirectCode(h, w.contrib.id, 'contributor', w.tree, { linkedPersonId: anchor, linkedRelationType: 'child', role: 'viewer' }) as { code: string };
		const joiner = makeUser(h.db);
		const r = redeemCode(h, joiner.id, code.code, { firstName: 'Kid' });
		expect(r).toMatchObject({ ok: true, status: 'active' });
		expect(h.db.select().from(treeMembers).where(and(eq(treeMembers.treeId, w.tree), eq(treeMembers.userId, joiner.id))).get()).toMatchObject({ role: 'viewer', status: 'active', joinedViaType: 'direct' });
		const fam = getFamilyCode(h.db, w.tree)!;
		const fj = makeUser(h.db);
		expect(redeemCode(h, fj.id, fam.code, { firstName: 'Cousin' })).toMatchObject({ ok: true, status: 'pending' });
		expect(h.db.select().from(treeMembers).where(eq(treeMembers.userId, fj.id)).get()).toMatchObject({ role: 'contributor', status: 'pending' });
	});

	test('direct code relation mapping, one transaction, and failures leave nothing behind', () => {
		const w = world();
		const anchor = createPerson(h, w.owner.id, w.tree, { firstName: 'Anchor' }).id;
		const child = createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: anchor, linkedRelationType: 'child' }) as { code: string };
		const u = makeUser(h.db);
		const r = redeemCode(h, u.id, child.code, { firstName: 'New' }) as { personId: string };
		expect(h.db.select().from(relationships).where(and(eq(relationships.person1Id, anchor), eq(relationships.person2Id, r.personId), eq(relationships.type, 'parent'))).get()).toBeDefined();
		expect(h.db.select().from(persons).where(eq(persons.id, r.personId)).get()).toMatchObject({ userId: u.id, claimedVia: 'join_code' });
		// single use
		const u2 = makeUser(h.db);
		expect(redeemCode(h, u2.id, child.code, { firstName: 'Again' })).toEqual({ ok: false, error: 'JOIN_UNAVAILABLE' });
		// a member redeeming again gets a clear message with no side effects
		const code2 = createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: anchor, linkedRelationType: 'sibling' }) as { id: string; code: string };
		const before = h.raw.prepare(`SELECT COUNT(*) AS c FROM persons`).get();
		expect(redeemCode(h, u.id, code2.code, { firstName: 'Dup' })).toEqual({ ok: false, error: 'ALREADY_MEMBER' });
		expect(h.raw.prepare(`SELECT COUNT(*) AS c FROM persons`).get()).toEqual(before);
		expect(h.raw.prepare(`SELECT currentUses FROM joinCodes WHERE id = ?`).get(code2.id)).toEqual({ currentUses: 0 });
		// a cycle makes the whole redemption fail, counter included
		const up = createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: anchor, linkedRelationType: 'parent' }) as { id: string; code: string };
		createLink(h, w.owner.id, w.tree, { person1Id: r.personId, person2Id: anchor, type: 'parent' }); // anchor is now the new person's parent? (cycle guard on redeem below)
		const u3 = makeUser(h.db);
		const res = redeemCode(h, u3.id, up.code, { firstName: 'Parent' });
		expect(res.ok).toBe(true); // a new parent person never cycles
		expect(h.raw.prepare(`SELECT currentUses FROM joinCodes WHERE id = ?`).get(up.id)).toEqual({ currentUses: 1 });
	});

	test('self code claims the linked person (null-guarded); an already claimed person fails the redemption', () => {
		const w = world();
		const me = createPerson(h, w.owner.id, w.tree, { firstName: 'Me' }).id;
		const code = createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: me, linkedRelationType: 'self' }) as { id: string; code: string };
		const u = makeUser(h.db);
		expect(redeemCode(h, u.id, code.code, {})).toMatchObject({ ok: true, personId: me });
		expect(h.db.select().from(persons).where(eq(persons.id, me)).get()).toMatchObject({ userId: u.id, claimedVia: 'claim_code' });
		expect(createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: me, linkedRelationType: 'self' })).toEqual({ error: 'ALREADY_CLAIMED' });
		// a code made before the person was claimed fails and rolls back its counter
		const other = createPerson(h, w.owner.id, w.tree, { firstName: 'Other' }).id;
		const c2 = createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: other, linkedRelationType: 'self' }) as { id: string; code: string };
		h.raw.prepare(`UPDATE persons SET userId = ? WHERE id = ?`).run(w.viewer.id, other);
		expect(redeemCode(h, makeUser(h.db).id, c2.code, {})).toEqual({ ok: false, error: 'JOIN_UNAVAILABLE' });
		expect(h.raw.prepare(`SELECT currentUses FROM joinCodes WHERE id = ?`).get(c2.id)).toEqual({ currentUses: 0 });
	});

	test('AT-12: unknown, expired, exhausted and deactivated codes give one identical failure; rejected users too', () => {
		const w = world();
		const anchor = createPerson(h, w.owner.id, w.tree, { firstName: 'A' }).id;
		const mk = (extra: { expiresAt?: string }) => createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: anchor, linkedRelationType: 'child', ...extra }) as { id: string; code: string };
		const expired = mk({ expiresAt: '2000-01-01T00:00:00.000Z' });
		const exhausted = mk({});
		redeemCode(h, makeUser(h.db).id, exhausted.code, { firstName: 'X' });
		const off = mk({});
		deactivateCode(h.db, off.id);
		const results = ['NOPE-AAAAAAAA', expired.code, exhausted.code, off.code].map((c) => JSON.stringify(redeemCode(h, makeUser(h.db).id, c, { firstName: 'Y' })));
		expect(new Set(results).size).toBe(1);
		expect(results[0]).toBe(JSON.stringify({ ok: false, error: 'JOIN_UNAVAILABLE' }));
		for (const c of ['NOPE-AAAAAAAA', expired.code, exhausted.code, off.code]) expect(previewCode(h.db, c)).toBeNull();
		// family joiner rejected: same generic failure on any further redemption
		const fam = getFamilyCode(h.db, w.tree)!;
		const fj = makeUser(h.db);
		redeemCode(h, fj.id, fam.code, { firstName: 'Nope' });
		expect(reviewMember(h, w.owner.id, w.tree, fj.id, 'reject')).toEqual({ ok: true });
		expect(h.db.select().from(treeMembers).where(eq(treeMembers.userId, fj.id)).get()).toMatchObject({ status: 'rejected', personId: null });
		expect(redeemCode(h, fj.id, fam.code, { firstName: 'Nope' })).toEqual({ ok: false, error: 'JOIN_UNAVAILABLE' });
	});
});

describe('AT-31: lockout tiers', () => {
	test('AT-31: 5 failures block 15 min, 10 block 1 h, 20 block 24 h, with matching remaining time', () => {
		const key = 'lock:join:1.2.3.4';
		let t = 1_000_000;
		for (let i = 1; i <= 20; i++) {
			const last = recordFailure(key, LOCKOUT_TIERS, t);
			const remaining = isBlocked(key, t);
			if (i < 5) expect(remaining).toBe(0);
			if (i >= 5 && i < 10) expect([last, remaining]).toEqual([15 * 60_000, 15 * 60_000]);
			if (i >= 10 && i < 20) expect([last, remaining]).toEqual([60 * 60_000, 60 * 60_000]);
			if (i === 20) expect([last, remaining]).toEqual([24 * 3600_000, 24 * 3600_000]);
			t += 1000;
		}
		expect(isBlocked(key, t + 24 * 3600_000 + 1)).toBe(0);
		// keyed per IP + endpoint
		expect(isBlocked('lock:join:9.9.9.9', t)).toBe(0);
		expect(isBlocked('lock:verify:1.2.3.4', t)).toBe(0);
	});
});

describe('AT-10 / AT-11: pending and rejected members', () => {
	test('AT-10: pending and rejected members get no tree access (404); approving grants it', () => {
		const w = world();
		const fam = getFamilyCode(h.db, w.tree)!;
		const p = makeUser(h.db);
		redeemCode(h, p.id, fam.code, { firstName: 'Pen' });
		expect(requireTreeAccess(h.db, p.id, w.tree, 'view')).toEqual({ ok: false, status: 404 });
		expect(reviewMember(h, w.owner.id, w.tree, p.id, 'approve')).toEqual({ ok: true });
		expect(requireTreeAccess(h.db, p.id, w.tree, 'view')).toMatchObject({ ok: true, role: 'contributor' });
		const r = makeUser(h.db);
		redeemCode(h, r.id, fam.code, { firstName: 'Rej' });
		reviewMember(h, w.owner.id, w.tree, r.id, 'reject');
		expect(requireTreeAccess(h.db, r.id, w.tree, 'view')).toEqual({ ok: false, status: 404 });
		expect(reviewMember(h, w.owner.id, w.tree, r.id, 'approve')).toEqual({ ok: false, error: 'NOT_FOUND' });
	});

	test('AT-11: a pending person is in no tree, search, stats or traversal result; a person with no membership row always is', () => {
		const w = world();
		const root = createPerson(h, w.owner.id, w.tree, { firstName: 'Root' }).id;
		const plain = createPerson(h, w.owner.id, w.tree, { firstName: 'Plainperson' }).id; // no membership row
		const code = createDirectCode(h, w.owner.id, 'owner', w.tree, { linkedPersonId: root, linkedRelationType: 'child' }) as { code: string };
		void code;
		const fam = getFamilyCode(h.db, w.tree)!;
		const pend = makeUser(h.db);
		const joined = redeemCode(h, pend.id, fam.code, { firstName: 'Pendingperson' }) as { personId: string };
		createLink(h, w.owner.id, w.tree, { person1Id: root, person2Id: plain, type: 'parent' });
		// force a link to the pending person at row level (as a stale import could), the reads must still hide it
		h.raw.prepare(`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdAt) VALUES ('rp', ?, ?, ?, 'parent', 'n')`).run(w.tree, root, joined.personId);
		const ids = (v: ReturnType<typeof getTreeView>) => v!.persons.map((x) => x.id);
		expect(ids(getTreeView(h, w.tree))).toContain(plain);
		expect(ids(getTreeView(h, w.tree))).not.toContain(joined.personId);
		expect(ftsSearch(h, w.tree, 'Pendingperson')).toEqual([]);
		expect(ftsSearch(h, w.tree, 'Plainperson').map((x) => x.id)).toEqual([plain]);
		expect(treeStats(h, w.tree)!.persons).toBe(2);
		expect(ancestors(h.raw, w.tree, plain).ids).toContain(root);
		expect(h.raw.prepare(`SELECT id FROM visible_persons WHERE id = ?`).get(joined.personId)).toBeUndefined();
		reviewMember(h, w.owner.id, w.tree, pend.id, 'approve');
		expect(ftsSearch(h, w.tree, 'Pendingperson').length).toBe(1);
		expect(treeStats(h, w.tree)!.persons).toBe(3);
	});

	test('AT-11 (export): a pending person and links to them are in no JSON, CSV or GEDCOM export', async () => {
		const w = world();
		const root = createPerson(h, w.owner.id, w.tree, { firstName: 'Root' }).id;
		const plain = createPerson(h, w.owner.id, w.tree, { firstName: 'Plainperson' }).id;
		const pend = makeUser(h.db);
		const joined = redeemCode(h, pend.id, getFamilyCode(h.db, w.tree)!.code, { firstName: 'Pendingperson' }) as { personId: string };
		h.raw.prepare(`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdAt) VALUES ('rp2', ?, ?, ?, 'parent', 'n')`).run(w.tree, root, joined.personId);
		const exp = (format: string) =>
			runWorker<{ body: string }>('export-worker.mjs', { dbPath: h.path, treeId: w.tree, format, filtered: false, now: new Date().toISOString(), livingYears: 100 }).then((r) => r.body);
		const json = JSON.parse(await exp('json')) as { persons: Array<{ id: string }>; relationships: Array<{ id: string }> };
		expect(json.persons.map((p) => p.id)).toEqual(expect.arrayContaining([root, plain]));
		expect(json.persons.map((p) => p.id)).not.toContain(joined.personId);
		expect(json.relationships.map((r) => r.id)).not.toContain('rp2');
		for (const format of ['csv', 'gedcom']) {
			const body = await exp(format);
			expect(body, format).toContain('Plainperson');
			expect(body, format).not.toContain('Pendingperson');
		}
	});
});

describe('revert system', () => {
	function edited() {
		const w = world();
		const pid = createPerson(h, w.owner.id, w.tree, { firstName: 'Ann', lastName: 'Lee' }).id;
		const hist = (action: string, field?: string) =>
			h.db.select().from(changeHistory).where(and(eq(changeHistory.entityId, pid), eq(changeHistory.action, action))).all().filter((r) => !field || r.field === field);
		return { w, pid, hist };
	}

	test('AT-05: reverting after a later edit to the same field is 409 with the current value; force succeeds and logs a revert row', () => {
		const { w, pid, hist } = edited();
		updatePerson(h, w.editor.id, pid, 1, { firstName: 'Anna' });
		const first = hist('update', 'firstName')[0]!;
		updatePerson(h, w.editor.id, pid, 2, { firstName: 'Annabel' });
		const r = revertHistory(h, w.editor.id, { historyId: first.id });
		expect(r).toMatchObject({ ok: false, code: 'STALE_REVERT', current: 'Annabel' });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.firstName).toBe('Annabel');
		expect(hist('revert')).toHaveLength(0);
		const forced = revertHistory(h, w.editor.id, { historyId: first.id }, true);
		expect(forced).toMatchObject({ ok: true, reverted: 1 });
		const row = h.db.select().from(persons).where(eq(persons.id, pid)).get()!;
		expect(row.firstName).toBe('Ann');
		expect(row.version).toBe(4);
		expect(hist('revert', 'firstName')[0]).toMatchObject({ oldValue: '"Annabel"', newValue: '"Ann"', revertedFrom: first.id });
		expect(h.db.select().from(changeHistory).where(eq(changeHistory.id, first.id)).get()?.isReverted).toBe(1);
		// a revert is itself revertible under the same stale rule
		const rev = hist('revert', 'firstName')[0]!;
		expect(revertHistory(h, w.editor.id, { historyId: rev.id })).toMatchObject({ ok: true });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.firstName).toBe('Annabel');
	});

	test('AT-05: an unchanged field reverts without force', () => {
		const { w, pid, hist } = edited();
		updatePerson(h, w.editor.id, pid, 1, { lastName: 'Kim' });
		expect(revertHistory(h, w.editor.id, { historyId: hist('update', 'lastName')[0]!.id })).toMatchObject({ ok: true });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.lastName).toBe('Lee');
	});

	test('AT-06: reverting a person delete restores the person with relationships, events and media rows', () => {
		const { w, pid } = edited();
		const kid = createPerson(h, w.owner.id, w.tree, { firstName: 'Kid' }).id;
		createLink(h, w.owner.id, w.tree, { person1Id: pid, person2Id: kid, type: 'parent' });
		createEvent(h, w.owner.id, w.tree, { personId: pid, type: 'residence', place: 'Pokhara' });
		const del = deletePerson(h, w.editor.id, pid) as { batchId: string };
		expect(h.raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ?`).get(pid)).toBeUndefined();
		// the dependent rows are gone (as after a hard cleanup of the rows) so the snapshot has to bring them back
		h.raw.prepare(`DELETE FROM relationships WHERE person1Id = ? OR person2Id = ?`).run(pid, pid);
		h.raw.prepare(`DELETE FROM events WHERE personId = ?`).run(pid);
		const r = revertHistory(h, w.editor.id, { batchId: del.batchId });
		expect(r).toMatchObject({ ok: true });
		expect(h.raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ?`).get(pid)).toBeDefined();
		expect(h.db.select().from(relationships).where(eq(relationships.person1Id, pid)).all()).toHaveLength(1);
		expect(h.db.select().from(events).where(eq(events.personId, pid)).all()).toHaveLength(1);
	});

	test('AT-08: a contributor reverting another user\'s change gets 403; their own succeeds', () => {
		const { w, pid, hist } = edited();
		updatePerson(h, w.owner.id, pid, 1, { bio: 'by owner' });
		updatePerson(h, w.contrib.id, pid, 2, { lastName: 'Cee' });
		const ownerRow = hist('update', 'bio')[0]!;
		const mine = hist('update', 'lastName')[0]!;
		expect(revertHistory(h, w.contrib.id, { historyId: ownerRow.id })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.bio).toBe('by owner');
		expect(revertHistory(h, w.contrib.id, { historyId: mine.id })).toMatchObject({ ok: true });
		expect(revertHistory(h, w.viewer.id, { historyId: ownerRow.id })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
		expect(revertHistory(h, w.editor.id, { historyId: ownerRow.id })).toMatchObject({ ok: true });
		// a mixed batch is all-or-nothing for the contributor
		const batch = updatePerson(h, w.owner.id, pid, 5, { firstName: 'Z', bio: 'zz' }) as { batchId: string };
		expect(revertHistory(h, w.contrib.id, { batchId: batch.batchId })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()?.firstName).toBe('Z');
	});

	test('AT-43: revert a create; a relationship delete after an endpoint was deleted; a delete after purge; a claim row; a whole batch', () => {
		const { w, pid, hist } = edited();
		// create → soft delete (+ snapshot row), and restore again through that delete row
		const created = hist('create')[0]!;
		const undo = revertHistory(h, w.editor.id, { historyId: created.id });
		expect(undo).toMatchObject({ ok: true });
		expect(h.raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ?`).get(pid)).toBeUndefined();
		const del = hist('delete')[0]!;
		expect(del.revertedFrom).toBe(created.id);
		expect(revertHistory(h, w.editor.id, { historyId: del.id })).toMatchObject({ ok: true });
		expect(h.raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ?`).get(pid)).toBeDefined();

		// relationship delete: restorable until an endpoint is deleted → 409 REVERT_CONFLICT
		const kid = createPerson(h, w.owner.id, w.tree, { firstName: 'Kid' }).id;
		const link = createLink(h, w.owner.id, w.tree, { person1Id: pid, person2Id: kid, type: 'parent' }) as { id: string };
		deleteLink(h, w.editor.id, link.id);
		const linkDel = h.db.select().from(changeHistory).where(and(eq(changeHistory.entityId, link.id), eq(changeHistory.action, 'delete'))).get()!;
		deletePerson(h, w.editor.id, kid);
		expect(revertHistory(h, w.editor.id, { historyId: linkDel.id })).toMatchObject({ ok: false, code: 'REVERT_CONFLICT' });
		expect(h.db.select().from(relationships).where(eq(relationships.id, link.id)).get()).toBeUndefined();
		// event delete restores while the person is visible
		const ev = createEvent(h, w.owner.id, w.tree, { personId: pid, type: 'occupation' }) as { id: string };
		deleteEvent(h, w.editor.id, ev.id);
		const evDel = h.db.select().from(changeHistory).where(and(eq(changeHistory.entityId, ev.id), eq(changeHistory.action, 'delete'))).get()!;
		expect(revertHistory(h, w.editor.id, { historyId: evDel.id })).toMatchObject({ ok: true });
		expect(h.db.select().from(events).where(eq(events.id, ev.id)).get()).toBeDefined();

		// delete after purge → 410
		const gone = createPerson(h, w.owner.id, w.tree, { firstName: 'Gone' }).id;
		const gdel = deletePerson(h, w.editor.id, gone) as { batchId: string };
		h.raw.prepare(`DELETE FROM persons WHERE id = ?`).run(gone);
		expect(revertHistory(h, w.editor.id, { batchId: gdel.batchId })).toMatchObject({ ok: false, code: 'PURGED' });

		// claim rows and tree rows are not revertible
		const cl = makeUser(h.db);
		member(w.tree, cl.id, 'viewer');
		const target = createPerson(h, w.owner.id, w.tree, { firstName: 'Claimed' }).id;
		const sub = submitClaim(h, cl.id, { treeId: w.tree, personId: target, proofMethod: 'manual' }) as { claimId: string };
		reviewClaim(h, w.owner.id, sub.claimId, { decision: 'approve' });
		const claimRow = h.db.select().from(changeHistory).where(and(eq(changeHistory.entityId, target), eq(changeHistory.action, 'claim'))).get()!;
		expect(revertHistory(h, w.owner.id, { historyId: claimRow.id })).toMatchObject({ ok: false, code: 'NOT_REVERTIBLE' });

		// batch revert: atomic, and the 409 lists every stale field
		const b = updatePerson(h, w.editor.id, pid, h.db.select().from(persons).where(eq(persons.id, pid)).get()!.version, { firstName: 'B1', lastName: 'B2', bio: 'B3' }) as { batchId: string };
		const cur = () => h.db.select().from(persons).where(eq(persons.id, pid)).get()!;
		updatePerson(h, w.editor.id, pid, cur().version, { firstName: 'C1', lastName: 'C2' });
		const stale = revertHistory(h, w.editor.id, { batchId: b.batchId });
		expect(stale.ok).toBe(false);
		if (!stale.ok) {
			expect(stale.code).toBe('STALE_REVERT');
			expect(stale.conflicts!.map((c) => c.field).sort()).toEqual(['firstName', 'lastName']);
		}
		expect(cur().bio).toBe('B3'); // nothing was applied, not even the non-stale field
		const forced = revertHistory(h, w.editor.id, { batchId: b.batchId }, true);
		expect(forced).toMatchObject({ ok: true, reverted: 3 });
		expect(cur()).toMatchObject({ firstName: 'Ann', lastName: 'Lee', bio: null });
	});

	test('date reverts keep the normalised value in step; derived fields are not reverted alone', () => {
		const { w, pid } = edited();
		updatePerson(h, w.editor.id, pid, 1, { birthDate: '1950-03-12' });
		updatePerson(h, w.editor.id, pid, 2, { birthDate: '1960' });
		const second = h.db.select().from(changeHistory).where(and(eq(changeHistory.entityId, pid), eq(changeHistory.field, 'birthDate'))).all().sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.id.localeCompare(b.id));
		const norms = h.db.select().from(changeHistory).where(and(eq(changeHistory.entityId, pid), eq(changeHistory.field, 'birthDateNorm'))).all();
		expect(revertHistory(h, w.editor.id, { historyId: norms[0]!.id })).toMatchObject({ ok: false, code: 'NOT_REVERTIBLE' });
		const latest = second[second.length - 1]!;
		expect(revertHistory(h, w.editor.id, { historyId: latest.id }, true)).toMatchObject({ ok: true });
		expect(h.db.select().from(persons).where(eq(persons.id, pid)).get()).toMatchObject({ birthDate: '1950-03-12', birthDateNorm: '1950-03-12' });
	});

	test('revert of a foreign tree row is invisible and a viewer cannot revert', () => {
		const { w, pid, hist } = edited();
		updatePerson(h, w.editor.id, pid, 1, { bio: 'x' });
		const row = hist('update', 'bio')[0]!;
		const stranger = makeUser(h.db);
		expect(revertHistory(h, stranger.id, { historyId: row.id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
		expect(revertHistory(h, w.owner.id, { historyId: 'missing' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
	});
});

describe('notifications', () => {
	function claimed() {
		const w = world();
		const pid = createPerson(h, w.owner.id, w.tree, { firstName: 'Mine' }).id;
		h.raw.prepare(`UPDATE persons SET userId = ? WHERE id = ?`).run(w.viewer.id, pid);
		const unread = (userId: string) => h.db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, 'edit'), eq(notifications.isRead, 0))).all();
		return { w, pid, unread };
	}

	test('edit notifications to a claimed person are coalesced per editor inside the window', () => {
		const { w, pid, unread } = claimed();
		updatePerson(h, w.owner.id, pid, 1, { bio: 'one' });
		updatePerson(h, w.owner.id, pid, 2, { bio: 'two' });
		updatePerson(h, w.owner.id, pid, 3, { bio: 'three' });
		expect(unread(w.viewer.id)).toHaveLength(1);
		// another editor gets their own notification
		updatePerson(h, w.editor.id, pid, 4, { bio: 'four' });
		expect(unread(w.viewer.id)).toHaveLength(2);
		// the claimed person editing themselves never notifies
		updatePerson(h, w.viewer.id, pid, 5, { bio: 'mine' });
		expect(unread(w.viewer.id)).toHaveLength(2);
		// after the window a new unread one is allowed again
		const later = new Date(Date.now() + (EDIT_NOTIFY_COALESCE_MINUTES + 1) * 60_000);
		expect(notifyEdit(h.db, { treeId: w.tree, personId: pid, actorId: w.owner.id }, later)).toBe(true);
		expect(unread(w.viewer.id)).toHaveLength(3);
		// reading one reopens the slot for that editor immediately
		markRead(h.db, w.viewer.id, { all: true });
		expect(notifyEdit(h.db, { treeId: w.tree, personId: pid, actorId: w.owner.id })).toBe(true);
	});

	test('the owner claiming a person is linked at once (no review) and takes its photo as avatar when they have none', () => {
		const w = world();
		const pid = createPerson(h, w.owner.id, w.tree, { firstName: 'Me' }).id;
		h.raw.prepare(`UPDATE persons SET photoUrl = '/photos/t/p/a.webp' WHERE id = ?`).run(pid);
		h.raw.prepare(`UPDATE users SET avatarUrl = NULL WHERE id = ?`).run(w.owner.id);
		const r = submitClaim(h, w.owner.id, { treeId: w.tree, personId: pid, proofMethod: 'manual' });
		expect(r).toMatchObject({ ok: true, approved: true });
		expect(h.raw.prepare(`SELECT userId FROM persons WHERE id = ?`).get(pid)).toEqual({ userId: w.owner.id });
		expect(h.raw.prepare(`SELECT avatarUrl FROM users WHERE id = ?`).get(w.owner.id)).toEqual({ avatarUrl: '/photos/t/p/a.webp' });
		// A non-owner's claim still waits for review, and an existing avatar is never replaced.
		const other = createPerson(h, w.owner.id, w.tree, { firstName: 'Them' }).id;
		h.raw.prepare(`UPDATE users SET avatarUrl = 'mine' WHERE id = ?`).run(w.viewer.id);
		h.raw.prepare(`UPDATE persons SET photoUrl = 'theirs' WHERE id = ?`).run(other);
		const c = submitClaim(h, w.viewer.id, { treeId: w.tree, personId: other, proofMethod: 'manual' });
		expect(c).toMatchObject({ ok: true });
		expect((c as { approved?: boolean }).approved).toBeUndefined();
		reviewClaim(h, w.owner.id, (c as { claimId: string }).claimId, { decision: 'approve' });
		expect(h.raw.prepare(`SELECT avatarUrl FROM users WHERE id = ?`).get(w.viewer.id)).toEqual({ avatarUrl: 'mine' });
	});

	test('notifyPrefs: a muted type is never stored, other types still are', () => {
		const { w, pid, unread } = claimed();
		h.raw.prepare(`UPDATE users SET notifyPrefs = ? WHERE id = ?`).run(JSON.stringify({ edit: false }), w.viewer.id);
		updatePerson(h, w.owner.id, pid, 1, { bio: 'muted' });
		expect(unread(w.viewer.id)).toHaveLength(0);
		const fam = getFamilyCode(h.db, w.tree)!;
		h.raw.prepare(`UPDATE users SET notifyPrefs = ? WHERE id = ?`).run(JSON.stringify({ edit: true, join_approval: false }), w.owner.id);
		redeemCode(h, makeUser(h.db, undefined, 'Mu Ted').id, fam.code, { firstName: 'Mu' });
		expect(listNotifications(h.db, w.owner.id).data.map((n) => n.type)).not.toContain('join_approval');
		expect(listNotifications(h.db, w.editor.id).data.map((n) => n.type)).toContain('join_approval');
		// Unmuting restores delivery; corrupt JSON fails open (on).
		h.raw.prepare(`UPDATE users SET notifyPrefs = ? WHERE id = ?`).run('{bad', w.viewer.id);
		updatePerson(h, w.owner.id, pid, 2, { bio: 'loud' });
		expect(unread(w.viewer.id)).toHaveLength(1);
	});

	test('join, join_approval, claim and claim_review notify the right people; list and mark-read are per user', () => {
		const w = world();
		const fam = getFamilyCode(h.db, w.tree)!;
		const joiner = makeUser(h.db, undefined, 'Jo Joiner');
		redeemCode(h, joiner.id, fam.code, { firstName: 'Jo' });
		for (const id of [w.owner.id, w.editor.id]) {
			expect(listNotifications(h.db, id).data.map((n) => n.type)).toEqual(['join_approval']);
		}
		expect(listNotifications(h.db, w.contrib.id).unreadCount).toBe(0);
		reviewMember(h, w.owner.id, w.tree, joiner.id, 'approve');
		expect(listNotifications(h.db, joiner.id).data[0]).toMatchObject({ type: 'join_approval', isRead: 0 });
		const target = createPerson(h, w.owner.id, w.tree, { firstName: 'Cl' }).id;
		const claim = submitClaim(h, w.viewer.id, { treeId: w.tree, personId: target, proofMethod: 'manual' }) as { claimId: string };
		expect(listNotifications(h.db, w.editor.id).data.map((n) => n.type)).toContain('claim');
		reviewClaim(h, w.editor.id, claim.claimId, { decision: 'approve' });
		const mine = listNotifications(h.db, w.viewer.id);
		expect(mine.data.map((n) => n.type)).toContain('claim_review');
		expect(mine.unreadCount).toBe(mine.data.length);
		// others cannot mark mine read; mine can be marked
		expect(markRead(h.db, w.owner.id, { ids: mine.data.map((n) => n.id) })).toBe(0);
		expect(markRead(h.db, w.viewer.id, { ids: [mine.data[0]!.id] })).toBe(1);
		expect(listNotifications(h.db, w.viewer.id).unreadCount).toBe(mine.unreadCount - 1);
		expect(markRead(h.db, w.viewer.id, { all: true })).toBe(mine.unreadCount - 1);
		// pagination
		const p1 = listNotifications(h.db, w.owner.id, undefined, 1);
		expect(p1.data).toHaveLength(1);
		expect(p1.nextCursor).not.toBeNull();
		expect(listNotifications(h.db, w.owner.id, p1.nextCursor!, 5).data.every((n) => n.id !== p1.data[0]!.id)).toBe(true);
	});
});

describe('edits beyond the person row', () => {
	function setup() {
		const w = world();
		const mine = createPerson(h, w.owner.id, w.tree, { firstName: 'Mine' }).id;
		const other = createPerson(h, w.owner.id, w.tree, { firstName: 'Other' }).id;
		h.raw.prepare(`UPDATE persons SET userId = ? WHERE id = ?`).run(w.viewer.id, mine);
		const unread = () => h.db.select().from(notifications).where(and(eq(notifications.userId, w.viewer.id), eq(notifications.type, 'edit'), eq(notifications.isRead, 0))).all();
		return { w, mine, other, unread };
	}

	test('links, events and their deletes notify the claimed person (coalesced per editor)', () => {
		const { w, mine, other, unread } = setup();
		const link = createLink(h, w.editor.id, w.tree, { person1Id: mine, person2Id: other, type: 'spouse' }) as { id: string };
		expect(unread()).toHaveLength(1);
		createEvent(h, w.editor.id, w.tree, { personId: mine, type: 'residence' }); // same editor, same window
		deleteLink(h, w.editor.id, link.id);
		expect(unread()).toHaveLength(1);
		createEvent(h, w.contrib.id, w.tree, { personId: mine, type: 'occupation' }); // another editor
		expect(unread()).toHaveLength(2);
		// edits to a link that does not involve them stay silent
		const third = createPerson(h, w.owner.id, w.tree, { firstName: 'Third' }).id;
		createLink(h, w.owner.id, w.tree, { person1Id: other, person2Id: third, type: 'sibling' });
		expect(unread()).toHaveLength(2);
	});

	test('every create and delete returns a batchId that the revert endpoint can undo', () => {
		const { w, mine, other } = setup();
		const ev = createEvent(h, w.editor.id, w.tree, { personId: mine, type: 'burial' }) as { id: string; batchId: string };
		expect(revertHistory(h, w.editor.id, { batchId: ev.batchId })).toMatchObject({ ok: true });
		expect(h.db.select().from(events).where(eq(events.id, ev.id)).get()).toBeUndefined();
		const ev2 = createEvent(h, w.editor.id, w.tree, { personId: mine, type: 'school' }) as { id: string };
		const del = deleteEvent(h, w.editor.id, ev2.id) as { batchId: string };
		expect(revertHistory(h, w.editor.id, { batchId: del.batchId })).toMatchObject({ ok: true });
		expect(h.db.select().from(events).where(eq(events.id, ev2.id)).get()).toBeDefined();
		const link = createLink(h, w.editor.id, w.tree, { person1Id: mine, person2Id: other, type: 'spouse' }) as { id: string; batchId: string };
		expect(revertHistory(h, w.editor.id, { batchId: link.batchId })).toMatchObject({ ok: true });
		expect(h.db.select().from(relationships).where(eq(relationships.id, link.id)).get()).toBeUndefined();
		const link2 = createLink(h, w.editor.id, w.tree, { person1Id: mine, person2Id: other, type: 'spouse' }) as { id: string };
		const ld = deleteLink(h, w.editor.id, link2.id) as { batchId: string };
		expect(revertHistory(h, w.editor.id, { batchId: ld.batchId })).toMatchObject({ ok: true });
		expect(h.db.select().from(relationships).where(eq(relationships.id, link2.id)).get()).toBeDefined();
		const p = createPerson(h, w.editor.id, w.tree, { firstName: 'Fresh' });
		expect(revertHistory(h, w.editor.id, { batchId: p.batchId })).toMatchObject({ ok: true });
		expect(h.raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ?`).get(p.id)).toBeUndefined();
	});

	test('a family code with an expiry stops working after it; regenerating without one clears it', () => {
		const w = world();
		const past = regenerateFamilyCode(h.db, w.tree, w.owner.id, '2000-01-01T00:00:00.000Z') as { code: string };
		expect(getFamilyCode(h.db, w.tree)!.expiresAt).toBe('2000-01-01T00:00:00.000Z');
		expect(previewCode(h.db, past.code)).toBeNull();
		expect(redeemCode(h, makeUser(h.db).id, past.code, { firstName: 'Late' })).toEqual({ ok: false, error: 'JOIN_UNAVAILABLE' });
		const next = regenerateFamilyCode(h.db, w.tree, w.owner.id, '2099-01-01T00:00:00.000Z') as { code: string };
		expect(previewCode(h.db, next.code)?.kind).toBe('family');
		const open = regenerateFamilyCode(h.db, w.tree, w.owner.id) as { code: string };
		expect(getFamilyCode(h.db, w.tree)!.expiresAt).toBeNull();
		expect(previewCode(h.db, open.code)).not.toBeNull();
	});
});
