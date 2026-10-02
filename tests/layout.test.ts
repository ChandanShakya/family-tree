import { describe, expect, test } from 'vitest';
import {
	NODE_W,
	NODE_H,
	assignGenerations,
	buildLayoutTree,
	buildUnits,
	layoutTree,
	placeUnit,
	routeEdges,
	subtreeWidth,
	type LayoutLink,
	type LayoutPerson,
	type LayoutResult
} from '$lib/tree/layout.js';

function p(id: string, birth: string | null = null, name = id): LayoutPerson {
	return { id, birthDateNorm: birth, name };
}

function parent(a: string, b: string): LayoutLink {
	return { person1Id: a, person2Id: b, type: 'parent' };
}

function spouse(a: string, b: string, startDate?: string): LayoutLink {
	return { person1Id: a, person2Id: b, type: 'spouse', startDate };
}

function boxes(r: LayoutResult): Array<{ id: string; x0: number; y0: number; x1: number; y1: number }> {
	return [...r.nodes.entries()].map(([id, n]) => ({ id, x0: n.x, y0: n.y, x1: n.x + NODE_W, y1: n.y + NODE_H }));
}

function expectNoOverlap(r: LayoutResult): void {
	const b = boxes(r);
	for (let i = 0; i < b.length; i++) {
		for (let j = i + 1; j < b.length; j++) {
			const a = b[i] as (typeof b)[number];
			const c = b[j] as (typeof b)[number];
			const overlap = a.x0 < c.x1 && c.x0 < a.x1 && a.y0 < c.y1 && c.y0 < a.y1;
			expect(overlap, `overlap ${a.id} vs ${c.id}`).toBe(false);
		}
	}
}

function expectParentsAbove(r: LayoutResult, links: LayoutLink[]): void {
	for (const l of links) {
		if (l.type !== 'parent') continue;
		const a = r.nodes.get(l.person1Id);
		const b = r.nodes.get(l.person2Id);
		expect(a && b && a.y < b.y, `parent ${l.person1Id} above ${l.person2Id}`).toBe(true);
	}
}

function expectSpousesAdjacent(r: LayoutResult, a: string, b: string): void {
	const na = r.nodes.get(a);
	const nb = r.nodes.get(b);
	expect(na && nb && Math.abs(na.y - nb.y) === 0, `spouses ${a},${b} same row`).toBe(true);
	expect(na && nb && Math.abs(Math.abs(na.x - nb.x) - (NODE_W + 8)) < 1, `spouses ${a},${b} adjacent`).toBe(true);
}

function expectDeterministic(persons: LayoutPerson[], links: LayoutLink[]): void {
	const a = JSON.stringify(layoutTree(persons, links), (_, v) => (v instanceof Map ? [...v] : v));
	const b = JSON.stringify(layoutTree(persons, links), (_, v) => (v instanceof Map ? [...v] : v));
	expect(a).toBe(b);
}

describe('AT-37: layout fixtures', () => {
	test('AT-37: single parent with children', () => {
		const persons = [p('pa', '1970-01-01'), p('c1', '2000-01-01'), p('c2', '2002-01-01')];
		const links = [parent('pa', 'c1'), parent('pa', 'c2')];
		const r = layoutTree(persons, links);
		expectNoOverlap(r);
		expectParentsAbove(r, links);
		expectDeterministic(persons, links);
	});

	test('AT-37: two parents with children', () => {
		const persons = [p('mo', '1970-01-01'), p('fa', '1969-01-01'), p('c1', '2000-01-01'), p('c2', '2003-01-01')];
		const links = [spouse('mo', 'fa'), parent('mo', 'c1'), parent('fa', 'c1'), parent('mo', 'c2'), parent('fa', 'c2')];
		const r = layoutTree(persons, links);
		expectNoOverlap(r);
		expectParentsAbove(r, links);
		expectSpousesAdjacent(r, 'mo', 'fa');
		expectDeterministic(persons, links);
	});

	test('AT-37: divorced and remarried with half-siblings', () => {
		const persons = [
			p('dad', '1970-01-01'),
			p('mom1', '1971-01-01'),
			p('mom2', '1975-01-01'),
			p('half1', '2000-01-01'),
			p('half2', '2005-01-01')
		];
		const links = [
			spouse('dad', 'mom1', '1995-01-01'),
			spouse('dad', 'mom2', '2003-01-01'),
			parent('dad', 'half1'),
			parent('mom1', 'half1'),
			parent('dad', 'half2'),
			parent('mom2', 'half2')
		];
		const r = layoutTree(persons, links);
		expectNoOverlap(r);
		expectParentsAbove(r, links);
		expectDeterministic(persons, links);
	});

	test('AT-37: two disjoint trees', () => {
		const persons = [p('a1', '1970-01-01'), p('a2', '2000-01-01'), p('b1', '1980-01-01'), p('b2', '2010-01-01')];
		const links = [parent('a1', 'a2'), parent('b1', 'b2')];
		const r = layoutTree(persons, links);
		expectNoOverlap(r);
		expectParentsAbove(r, links);
		expectDeterministic(persons, links);
	});

	test('AT-37: five-generation straight line', () => {
		const persons = [0, 1, 2, 3, 4].map((i) => p(`g${i}`, `19${70 + i * 10}-01-01`));
		const links = [0, 1, 2, 3].map((i) => parent(`g${i}`, `g${i + 1}`));
		const r = layoutTree(persons, links);
		expectNoOverlap(r);
		expectParentsAbove(r, links);
		const gens = [...r.nodes.values()].map((n) => n.generation);
		expect(Math.max(...gens)).toBe(4);
		expectDeterministic(persons, links);
	});

	test('AT-37: marriage to own grandchild terminates with SPOUSE_ALIGNMENT_UNSTABLE', () => {
		const persons = [p('gp', '1950-01-01'), p('mid', '1975-01-01'), p('gc', '2000-01-01')];
		const links = [parent('gp', 'mid'), parent('mid', 'gc'), spouse('gp', 'gc')];
		const r = layoutTree(persons, links);
		expect(r.layoutWarning).toBe('SPOUSE_ALIGNMENT_UNSTABLE');
		expect(r.nodes.size).toBe(3);
		expectDeterministic(persons, links);
	});

	test('AT-37: 500-node generated tree lays out in budget (R-PERF-4)', () => {
		const persons: LayoutPerson[] = [];
		const links: LayoutLink[] = [];
		let n = 0;
		const next = () => `n${n++}`;
		const roots: string[] = [];
		for (let i = 0; i < 10; i++) {
			const r = next();
			persons.push(p(r, `19${50 + i}-01-01`, `Root${i}`));
			roots.push(r);
		}
		const queue = [...roots];
		while (persons.length < 500 && queue.length > 0) {
			const par = queue.shift() as string;
			for (let k = 0; k < 2 && persons.length < 500; k++) {
				const c = next();
				persons.push(p(c, '2000-01-01', `Kid${c}`));
				links.push(parent(par, c));
				if (persons.length % 3 === 0) queue.push(c);
			}
		}
		const t0 = performance.now();
		const r = layoutTree(persons, links);
		const ms = performance.now() - t0;
		expect(r.nodes.size).toBe(persons.length);
		expectNoOverlap(r);
		expectParentsAbove(r, links);
		expect(ms).toBeLessThan(500);
		 
		console.log(`layout 500 nodes: ${ms.toFixed(1)} ms (R-PERF-4)`);
	});

	test('AT-37: engine units are individually addressable', () => {
		const persons = [p('mo', '1970-01-01'), p('fa', '1969-01-01'), p('c1', '2000-01-01')];
		const links = [spouse('mo', 'fa'), parent('mo', 'c1'), parent('fa', 'c1')];
		const unions = buildUnits(persons, links);
		expect(unions).toHaveLength(1);
		const { generations } = assignGenerations(persons, unions, links);
		expect(generations.get('c1')).toBe(1);
		const { units, roots } = buildLayoutTree(persons, unions);
		expect(roots).toHaveLength(1);
		const root = units.get(roots[0] as string);
		expect(root?.memberIds).toHaveLength(2);
		expect(subtreeWidth(root as NonNullable<typeof root>, units)).toBeGreaterThan(0);
		const positions = new Map<string, number>();
		const placed = placeUnit(root as NonNullable<typeof root>, units, positions, 0, 0);
		expect(placed.right).toBeGreaterThan(0);
		const routed = routeEdges(persons, unions, units, positions, generations, links);
		expect(routed.edges.length).toBeGreaterThan(0);
	});

	test('AT-37: LR orientation swaps axes: no overlap, parents left of children, spouses adjacent', () => {
		const persons = [p('a', '1950'), p('b', '1951'), p('c', '1975'), p('d', '1977'), p('e', '1980')];
		const links = [spouse('a', 'b'), parent('a', 'c'), parent('b', 'c'), parent('a', 'd'), parent('b', 'd'), parent('c', 'e')];
		const r = layoutTree(persons, links, 'LR');
		expectNoOverlap(r);
		for (const l of links.filter((x) => x.type === 'parent')) {
			expect((r.nodes.get(l.person1Id)?.x ?? 0) < (r.nodes.get(l.person2Id)?.x ?? 0)).toBe(true);
		}
		const a = r.nodes.get('a')!;
		const b = r.nodes.get('b')!;
		expect(a.x).toBe(b.x);
		expect(Math.abs(a.y - b.y)).toBe(NODE_H + 8);
		const tb = layoutTree(persons, links, 'TB');
		expect(layoutTree(persons, links, 'TB').nodes.get('c')).toEqual(tb.nodes.get('c'));
	});
});
