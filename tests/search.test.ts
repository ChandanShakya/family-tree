import { describe, expect, test, beforeEach, afterAll } from 'vitest';
import { createTree, getTreeView } from '$lib/server/trees.js';
import { createPerson } from '$lib/server/persons.js';
import { createLink } from '$lib/server/relations.js';
import { duplicateFinder, filterHits, ftsSearch, fuzzySearchInline, surnameExplorer } from '$lib/server/search.js';
import { TREE_FOCUS_MODE_THRESHOLD, MAX_TRAVERSAL_NODES } from '$lib/config.js';
import { closeAllHandles, freshHandles, makeUser, type TestHandles } from './helpers.js';

let h: TestHandles;
beforeEach(() => {
	h = freshHandles();
});
afterAll(() => closeAllHandles());

describe('AT-26: search prefix + fuzzy', () => {
	test('AT-26: Devanagari typo found by fuzzy; vowel-sign pair never cross in FTS', () => {
		const o = makeUser(h.db);
		const t = createTree(h, o.id, { name: 'T' }).id;
		const a = createPerson(h, o.id, t, { firstName: 'किशोर' }).id;
		const b = createPerson(h, o.id, t, { firstName: 'किशोरी' }).id;
		createPerson(h, o.id, t, { firstName: 'Ramesh', lastName: 'Sharma' });
		// FTS stage: exact and prefix only, no vowel-sign crossing.
		expect(ftsSearch(h, t, 'किशोर').map((x) => x.id).sort()).toEqual([a, b].sort());
		expect(ftsSearch(h, t, 'किशोरी').map((x) => x.id)).toEqual([b]);
		expect(ftsSearch(h, t, 'Rames').length).toBe(1);
		// Typo: FTS finds nothing, fuzzy does.
		expect(ftsSearch(h, t, 'Rammesh')).toEqual([]);
		expect(fuzzySearchInline(h, t, 'Rammesh').map((x) => x.firstName)).toContain('Ramesh');
	});

	test('surnames group and duplicates stay advisory', () => {
		const o = makeUser(h.db);
		const t = createTree(h, o.id, { name: 'T' }).id;
		for (const y of ['1900', '1901']) createPerson(h, o.id, t, { firstName: 'Sita', lastName: 'Rai', birthDate: y });
		expect(surnameExplorer(h, t)).toEqual([{ lastName: 'Rai', count: 2 }]);
		const d = duplicateFinder(h, t);
		expect(d.pairs.length).toBe(1);
		expect(d.truncated).toBe(false);
	});
});

describe('AT-26: search filters', () => {
	test('AT-26: birth year and place filters narrow FTS and fuzzy hits', () => {
		const o = makeUser(h.db);
		const t = createTree(h, o.id, { name: 'T' }).id;
		const a = createPerson(h, o.id, t, { firstName: 'Hari', lastName: 'Rai', birthDate: '1950', birthPlace: 'Pokhara' }).id;
		createPerson(h, o.id, t, { firstName: 'Hari', lastName: 'Rai', birthDate: '1980', birthPlace: 'Kathmandu' });
		expect(ftsSearch(h, t, 'Hari').length).toBe(2);
		expect(ftsSearch(h, t, 'Hari', 20, { birthYear: '1950' }).map((x) => x.id)).toEqual([a]);
		expect(ftsSearch(h, t, '', 20, { place: 'Pokh' }).map((x) => x.id)).toEqual([a]);
		expect(ftsSearch(h, t, '', 20, { name: 'Har', birthYear: '1980' }).length).toBe(1);
		// Fuzzy stage: filters are applied to the id list.
		const ids = fuzzySearchInline(h, t, 'Harri').map((x) => x.id);
		expect(filterHits(h, ids, { place: 'kathmandu' }).length).toBe(1);
		// Quotes and operators in input stay inert.
		expect(() => ftsSearch(h, t, 'Hari" OR *', 20, { name: 'a" NOT' })).not.toThrow();
	});
});

describe('AT-40: focus mode above threshold', () => {
	test('AT-40: bounded payload, totalPersons + truncated, focus on deep descendant yields ancestors', () => {
		const o = makeUser(h.db);
		const t = createTree(h, o.id, { name: 'Big' }).id;
		const ids: string[] = [];
		const ins = h.raw.prepare(
			`INSERT INTO persons (id, treeId, firstName, version, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?, ?)`
		);
		const now = new Date().toISOString();
		const n = TREE_FOCUS_MODE_THRESHOLD + 20;
		h.raw.transaction(() => {
			for (let i = 0; i < n; i++) {
				const id = crypto.randomUUID();
				ids.push(id);
				ins.run(id, t, `P${i}`, o.id, now, now);
			}
		})();
		// Chain of 8 generations at the head, rest are loose.
		for (let i = 0; i < 7; i++) {
			const r = createLink(h, o.id, t, { person1Id: ids[i]!, person2Id: ids[i + 1]!, type: 'parent' });
			expect('error' in r).toBe(false);
		}
		const view = getTreeView(h, t, {})!;
		expect(view.totalPersons).toBe(n);
		expect(view.truncated).toBe(true);
		expect(view.persons.length).toBeLessThanOrEqual(MAX_TRAVERSAL_NODES);
		expect(view.persons.length).toBeLessThan(n);
		const deep = getTreeView(h, t, { focus: ids[7], depth: 3 })!;
		const got = new Set(deep.persons.map((p) => p.id));
		for (const i of [7, 6, 5, 4]) expect(got.has(ids[i]!)).toBe(true);
		expect(got.has(ids[0]!)).toBe(false);
	});

	test('AT-40: focus view adds spouses and siblings and defaults to the caller\'s own person', () => {
		const o = makeUser(h.db);
		const t = createTree(h, o.id, { name: 'Big2' }).id;
		const now = new Date().toISOString();
		const ins = h.raw.prepare(
			`INSERT INTO persons (id, treeId, firstName, userId, version, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
		);
		const ids: string[] = [];
		h.raw.transaction(() => {
			for (let i = 0; i < TREE_FOCUS_MODE_THRESHOLD + 5; i++) {
				const id = crypto.randomUUID();
				ids.push(id);
				ins.run(id, t, `Q${i}`, i === 300 ? o.id : null, o.id, now, now);
			}
		})();
		const [par, me, sib, spouse] = [ids[0]!, ids[300]!, ids[301]!, ids[302]!];
		expect('error' in createLink(h, o.id, t, { person1Id: par, person2Id: me, type: 'parent' })).toBe(false);
		expect('error' in createLink(h, o.id, t, { person1Id: par, person2Id: sib, type: 'parent' })).toBe(false);
		expect('error' in createLink(h, o.id, t, { person1Id: me, person2Id: spouse, type: 'spouse' })).toBe(false);
		const v = getTreeView(h, t, { userId: o.id })!;
		const got = new Set(v.persons.map((p) => p.id));
		expect([par, me, sib, spouse].every((x) => got.has(x))).toBe(true);
		expect(v.truncated).toBe(true);
	});
});
