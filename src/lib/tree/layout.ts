// Custom tree layout engine (§7.6). Pure functions, no DOM access, so they
// are unit-testable and can run in a Web Worker. No d3-dag, no d3-hierarchy.

import { MAX_TRAVERSAL_DEPTH } from '$lib/config.js';

export const NODE_W = 160;
export const NODE_H = 72;
export const H_GAP = 24;
export const SPOUSE_GAP = 8;
export const ROW_GAP = 96;

export type Orientation = 'TB' | 'LR';

// Active node box for the layout run. LR lays out a TB tree of swapped-size
// boxes and transposes the result (§7.6: "swap axes for LR"), so every
// distance, bus line and edge stays exact.
let dimW = NODE_W;
let dimH = NODE_H;

export interface LayoutPerson {
	id: string;
	birthDateNorm: string | null;
	name: string;
}

export interface LayoutLink {
	person1Id: string;
	person2Id: string;
	type: string;
	startDate?: string | null;
}

export interface Union {
	id: string;
	/** Couple/single-parent members, deterministically ordered. */
	memberIds: string[];
	childIds: string[];
}

export interface PlacedNode {
	x: number;
	y: number;
	generation: number;
}

export interface PlacedUnion {
	x: number;
	y: number;
}

export interface RoutedEdge {
	points: Array<[number, number]>;
	dashed?: boolean;
	extra?: boolean;
}

export interface LayoutResult {
	nodes: Map<string, PlacedNode>;
	unions: Map<string, PlacedUnion>;
	edges: RoutedEdge[];
	layoutWarning?: 'SPOUSE_ALIGNMENT_UNSTABLE';
}

function birthKey(p: LayoutPerson | undefined): string {
	return p?.birthDateNorm ?? '\uffff';
}

function comparePersons(a: LayoutPerson, b: LayoutPerson): number {
	const ba = birthKey(a);
	const bb = birthKey(b);
	if (ba !== bb) return ba < bb ? -1 : 1;
	if (a.name !== b.name) return a.name < b.name ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * One union per distinct set of parents sharing ≥1 child, plus one per
 * childless spouse pair. A person with several partners joins several unions.
 */
export function buildUnits(persons: LayoutPerson[], links: LayoutLink[]): Union[] {
	const byId = new Map(persons.map((p) => [p.id, p]));
	const parentGroups = new Map<string, { parentIds: string[]; childIds: Set<string> }>();
	for (const l of links) {
		if (l.type !== 'parent') continue;
		if (!byId.has(l.person1Id) || !byId.has(l.person2Id)) continue;
		const groupKey = parentSetKey(links, l.person2Id);
		let g = parentGroups.get(groupKey);
		if (!g) {
			g = { parentIds: groupKey.split('|').filter(Boolean), childIds: new Set() };
			parentGroups.set(groupKey, g);
		}
		g.childIds.add(l.person2Id);
	}
	const unions: Union[] = [];
	let n = 0;
	const childlessPairs = new Set<string>();
	for (const l of links) {
		if (l.type !== 'spouse') continue;
		if (!byId.has(l.person1Id) || !byId.has(l.person2Id)) continue;
		childlessPairs.add([l.person1Id, l.person2Id].sort().join('|'));
	}
	// Remove pairs that share a child (they already form a parent union).
	for (const g of parentGroups.values()) {
		if (g.parentIds.length === 2) {
			childlessPairs.delete([...g.parentIds].sort().join('|'));
		}
	}
	for (const g of [...parentGroups.values()].sort((a, b) =>
		a.parentIds.join('|') < b.parentIds.join('|') ? -1 : 1
	)) {
		unions.push({
			id: `u${n++}`,
			memberIds: orderMembers(g.parentIds, byId, links),
			childIds: [...g.childIds].sort()
		});
	}
	for (const key of [...childlessPairs].sort()) {
		unions.push({ id: `u${n++}`, memberIds: orderMembers(key.split('|'), byId, links), childIds: [] });
	}
	return unions;
}

/** All parents of a child, sorted — the union key for that child. */
function parentSetKey(links: LayoutLink[], childId: string): string {
	const parents = links
		.filter((l) => l.type === 'parent' && l.person2Id === childId)
		.map((l) => l.person1Id)
		.sort();
	return parents.join('|');
}

/** Member order: by marriage startDate around multi-partner persons, else by birth/name/id. */
function orderMembers(
	memberIds: string[],
	byId: Map<string, LayoutPerson>,
	links: LayoutLink[]
): string[] {
	if (memberIds.length <= 2) {
		return [...memberIds].sort((a, b) => {
			const pa = byId.get(a);
			const pb = byId.get(b);
			if (!pa || !pb) return a < b ? -1 : 1;
			return comparePersons(pa, pb);
		});
	}
	const startOf = new Map<string, string>();
	for (const id of memberIds) {
		const starts = links
			.filter(
				(l) =>
					l.type === 'spouse' &&
					(l.person1Id === id || l.person2Id === id) &&
					memberIds.includes(l.person1Id) &&
					memberIds.includes(l.person2Id)
			)
			.map((l) => l.startDate ?? '\uffff')
			.sort();
		startOf.set(id, starts[0] ?? '\uffff');
	}
	return [...memberIds].sort((a, b) => {
		const sa = startOf.get(a) as string;
		const sb = startOf.get(b) as string;
		if (sa !== sb) return sa < sb ? -1 : 1;
		const pa = byId.get(a);
		const pb = byId.get(b);
		if (!pa || !pb) return a < b ? -1 : 1;
		return comparePersons(pa, pb);
	});
}

/**
 * Generations by longest parent path from roots, then spouse alignment to the
 * pair maximum (re-propagated ≤ MAX_TRAVERSAL_DEPTH + 1 rounds). Spouse links
 * are not cycle-checked, so a marriage that can never stabilise keeps the
 * last assignment with SPOUSE_ALIGNMENT_UNSTABLE.
 */
export function assignGenerations(
	persons: LayoutPerson[],
	unions: Union[],
	links: LayoutLink[]
): { generations: Map<string, number>; layoutWarning?: 'SPOUSE_ALIGNMENT_UNSTABLE' } {
	const ids = new Set(persons.map((p) => p.id));
	const childToUnions = new Map<string, Union[]>();
	for (const u of unions) {
		for (const c of u.childIds) {
			if (!ids.has(c)) continue;
			const list = childToUnions.get(c) ?? [];
			list.push(u);
			childToUnions.set(c, list);
		}
	}
	const gen = new Map<string, number>();
	for (const p of persons) {
		if (!childToUnions.has(p.id)) gen.set(p.id, 0);
	}
	const propagate = (): boolean => {
		let changed = false;
		for (const u of unions) {
			const parentGens = u.memberIds.map((m) => gen.get(m)).filter((g) => g !== undefined) as number[];
			if (parentGens.length === 0) continue;
			const g = Math.max(...parentGens) + 1;
			for (const c of u.childIds) {
				if (!ids.has(c)) continue;
				if ((gen.get(c) ?? -1) < g) {
					gen.set(c, g);
					changed = true;
				}
			}
		}
		return changed;
	};
	for (let i = 0; i < persons.length + 1 && propagate(); i++) {
		// longest-path relaxation; parent DAGs always converge here.
	}
	const spousePairs = new Set<string>();
	for (const l of links) {
		if (l.type !== 'spouse' || !ids.has(l.person1Id) || !ids.has(l.person2Id)) continue;
		spousePairs.add([l.person1Id, l.person2Id].sort().join('|'));
	}
	for (let round = 0; round < MAX_TRAVERSAL_DEPTH + 1; round++) {
		let changed = false;
		for (const key of spousePairs) {
			const [a, b] = key.split('|') as [string, string];
			const m = Math.max(gen.get(a) ?? 0, gen.get(b) ?? 0);
			if (gen.get(a) !== m) {
				gen.set(a, m);
				changed = true;
			}
			if (gen.get(b) !== m) {
				gen.set(b, m);
				changed = true;
			}
		}
		if (propagate()) changed = true;
		if (!changed) {
			for (const p of persons) if (!gen.has(p.id)) gen.set(p.id, 0);
			return { generations: gen };
		}
	}
	for (const p of persons) if (!gen.has(p.id)) gen.set(p.id, 0);
	return { generations: gen, layoutWarning: 'SPOUSE_ALIGNMENT_UNSTABLE' };
}

export interface LayoutUnit {
	id: string;
	unionId: string;
	memberIds: string[];
	childUnitIds: string[];
	parentUnitId: string | null;
}

/**
 * Layout tree: at most one primary parent union per person (earliest-birth
 * parents, ties by union id); couple units anchor to the member holding a
 * primary parent union (earlier birth wins when both do); childless-parent
 * couples without parents are roots.
 */
export function buildLayoutTree(
	persons: LayoutPerson[],
	unions: Union[]
): { units: Map<string, LayoutUnit>; roots: string[] } {
	const byId = new Map(persons.map((p) => [p.id, p]));
	const childToUnions = new Map<string, Union[]>();
	for (const u of unions) {
		for (const c of u.childIds) {
			const list = childToUnions.get(c) ?? [];
			list.push(u);
			childToUnions.set(c, list);
		}
	}
	const primaryOf = new Map<string, string>();
	const earliestBirth = (u: Union): string =>
		u.memberIds.map((m) => birthKey(byId.get(m))).sort()[0] ?? '\uffff';
	for (const [child, list] of childToUnions) {
		const ordered = [...list].sort((a, b) => {
			const ea = earliestBirth(a);
			const eb = earliestBirth(b);
			if (ea !== eb) return ea < eb ? -1 : 1;
			return a.id < b.id ? -1 : 1;
		});
		primaryOf.set(child, (ordered[0] as Union).id);
	}
	const unitOfUnion = new Map(unions.map((u) => [u.id, `unit-${u.id}`]));
	const units = new Map<string, LayoutUnit>();
	for (const u of unions) {
		units.set(`unit-${u.id}`, {
			id: `unit-${u.id}`,
			unionId: u.id,
			memberIds: u.memberIds,
			childUnitIds: [],
			parentUnitId: null
		});
	}
	// People who belong to no union (no partner) still need placement: one
	// single-member unit each, anchored to their primary parent union if any.
	const membered = new Set(unions.flatMap((u) => u.memberIds));
	for (const person of persons) {
		if (membered.has(person.id)) continue;
		units.set(`unit-p-${person.id}`, {
			id: `unit-p-${person.id}`,
			unionId: '',
			memberIds: [person.id],
			childUnitIds: [],
			parentUnitId: null
		});
	}
	const anchorOf = (unit: LayoutUnit): string | null => {
		const withParents = unit.memberIds.filter((m) => primaryOf.has(m));
		if (withParents.length === 0) return null;
		return [...withParents].sort((a, b) => {
			const pa = byId.get(a);
			const pb = byId.get(b);
			const ba = birthKey(pa);
			const bb = birthKey(pb);
			if (ba !== bb) return ba < bb ? -1 : 1;
			if ((pa?.name ?? '') !== (pb?.name ?? '')) return (pa?.name ?? '') < (pb?.name ?? '') ? -1 : 1;
			return a < b ? -1 : 1;
		})[0] as string;
	};
	for (const unit of units.values()) {
		const anchor = anchorOf(unit);
		if (!anchor) continue;
		const parentUnion = primaryOf.get(anchor) as string;
		const parentUnit = unitOfUnion.get(parentUnion) as string;
		if (parentUnit === unit.id) continue;
		unit.parentUnitId = parentUnit;
		units.get(parentUnit)?.childUnitIds.push(unit.id);
	}
	const unitBirth = (u: LayoutUnit): string => {
		const b = u.memberIds.map((m) => birthKey(byId.get(m))).sort()[0];
		return b ?? '\uffff';
	};
	const unitName = (u: LayoutUnit): string => {
		const n = u.memberIds.map((m) => byId.get(m)?.name ?? '').sort()[0];
		return n ?? '';
	};
	for (const unit of units.values()) {
		unit.childUnitIds.sort((a, b) => {
			const ua = units.get(a) as LayoutUnit;
			const ub = units.get(b) as LayoutUnit;
			const ba = unitBirth(ua);
			const bb = unitBirth(ub);
			if (ba !== bb) return ba < bb ? -1 : 1;
			const na = unitName(ua);
			const nb = unitName(ub);
			if (na !== nb) return na < nb ? -1 : 1;
			return a < b ? -1 : 1;
		});
	}
	const roots = [...units.values()]
		.filter((u) => !u.parentUnitId)
		.sort((a, b) => {
			const ba = unitBirth(a);
			const bb = unitBirth(b);
			if (ba !== bb) return ba < bb ? -1 : 1;
			return a.id < b.id ? -1 : 1;
		})
		.map((u) => u.id);
	return { units, roots };
}

/** Width of one unit: member nodes plus spouse gaps. */
export function unitWidth(unit: LayoutUnit): number {
	if (unit.memberIds.length === 0) return 0;
	return unit.memberIds.length * dimW + (unit.memberIds.length - 1) * SPOUSE_GAP;
}

/** Subtree width: unit width vs children spans plus gaps. */
export function subtreeWidth(unit: LayoutUnit, units: Map<string, LayoutUnit>): number {
	if (unit.childUnitIds.length === 0) return unitWidth(unit);
	let sum = 0;
	for (const c of unit.childUnitIds) sum += subtreeWidth(units.get(c) as LayoutUnit, units);
	return Math.max(unitWidth(unit), sum + H_GAP * (unit.childUnitIds.length - 1));
}

export interface PlacedUnit {
	x: number;
	right: number;
}

/**
 * Top-down deterministic placement. Children fill the allotted span left to
 * right; the parent centres over its children midpoint without overlapping
 * its left neighbour (shifting the subtree right when the centre rule would
 * violate the gap). Returns member x positions and the subtree right edge.
 */
export function placeUnit(
	unit: LayoutUnit,
	units: Map<string, LayoutUnit>,
	positions: Map<string, number>,
	x: number,
	minX: number
): PlacedUnit {
	const w = unitWidth(unit);
	let childX = x;
	let childRights: number[] = [];
	const childCenters: number[] = [];
	for (const c of unit.childUnitIds) {
		const child = units.get(c) as LayoutUnit;
		const cw = subtreeWidth(child, units);
		const placed = placeUnit(child, units, positions, childX, childX);
		childCenters.push(childX + cw / 2);
		childRights.push(placed.right);
		childX = placed.right + H_GAP;
	}
	let ux = x;
	if (childCenters.length > 0) {
		const mid = (childCenters[0] as number) + ((childCenters[childCenters.length - 1] as number) - (childCenters[0] as number)) / 2;
		ux = Math.max(minX, mid - w / 2);
		const shift = ux - x;
		if (shift !== 0) {
			// Shift the whole subtree right so the centred parent clears the neighbour.
			shiftSubtree(unit, units, positions, shift);
			childRights = childRights.map((r) => r + shift);
		}
	} else {
		ux = Math.max(minX, x);
	}
	unit.memberIds.forEach((m, i) => positions.set(m, ux + i * (dimW + SPOUSE_GAP)));
	const ownRight = ux + w;
	const right = Math.max(ownRight, ...childRights, ux);
	return { x: ux, right };
}

function shiftSubtree(
	unit: LayoutUnit,
	units: Map<string, LayoutUnit>,
	positions: Map<string, number>,
	dx: number
): void {
	for (const c of unit.childUnitIds) {
		const child = units.get(c) as LayoutUnit;
		child.memberIds.forEach((m) => positions.set(m, (positions.get(m) as number) + dx));
		shiftSubtree(child, units, positions, dx);
	}
}

/**
 * Orthogonal edges: spouse–union horizontal at couple mid-height, union–child
 * verticals through a shared bus line. Non-primary parent links are extra
 * curved paths; guardians are dashed extras; sibling links are not drawn.
 */
export function routeEdges(
	persons: LayoutPerson[],
	unions: Union[],
	units: Map<string, LayoutUnit>,
	positions: Map<string, number>,
	generations: Map<string, number>,
	links: LayoutLink[]
): { unionPos: Map<string, PlacedUnion>; edges: RoutedEdge[] } {
	const yOf = (id: string): number => (generations.get(id) ?? 0) * (dimH + ROW_GAP);
	const unionPos = new Map<string, PlacedUnion>();
	const edges: RoutedEdge[] = [];
	for (const u of unions) {
		const xs = u.memberIds.map((m) => (positions.get(m) ?? 0) + dimW / 2);
		const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
		const topY = Math.min(...u.memberIds.map((m) => yOf(m)));
		const midY = topY + dimH / 2;
		const busY = topY + dimH + ROW_GAP / 2;
		unionPos.set(u.id, { x: cx, y: busY });
		if (u.memberIds.length > 1) {
			edges.push({ points: [[Math.min(...xs), midY], [Math.max(...xs), midY]] });
		}
		if (u.childIds.length > 0) {
			const childXs = u.childIds.map((c) => (positions.get(c) ?? 0) + dimW / 2);
			const busL = Math.min(cx, ...childXs);
			const busR = Math.max(cx, ...childXs);
			edges.push({ points: [[cx, midY], [cx, busY], [busL, busY], [busR, busY]] });
			for (const c of u.childIds) {
				const ccx = (positions.get(c) ?? 0) + dimW / 2;
				edges.push({ points: [[ccx, busY], [ccx, yOf(c)]] });
			}
		}
	}
	const primaryOf = new Map<string, string>();
	{
		const childToUnions = new Map<string, Union[]>();
		for (const u of unions) {
			for (const c of u.childIds) {
				const list = childToUnions.get(c) ?? [];
				list.push(u);
				childToUnions.set(c, list);
			}
		}
		const earliestBirth = (u: Union): string => {
			const b = u.memberIds
				.map((m) => persons.find((p) => p.id === m))
				.map((p) => (p?.birthDateNorm ?? '\uffff') as string)
				.sort()[0];
			return b ?? '\uffff';
		};
		for (const [child, list] of childToUnions) {
			const ordered = [...list].sort((a, b) => {
				const ea = earliestBirth(a);
				const eb = earliestBirth(b);
				if (ea !== eb) return ea < eb ? -1 : 1;
				return a.id < b.id ? -1 : 1;
			});
			primaryOf.set(child, (ordered[0] as Union).id);
		}
	}
	for (const l of links) {
		if (l.type === 'sibling') continue;
		if (l.type === 'guardian') {
			const ax = (positions.get(l.person1Id) ?? 0) + dimW / 2;
			const bx = (positions.get(l.person2Id) ?? 0) + dimW / 2;
			const ay = yOf(l.person1Id) + dimH / 2;
			const by = yOf(l.person2Id) + dimH / 2;
			edges.push({ points: [[ax, ay], [(ax + bx) / 2, Math.min(ay, by) - ROW_GAP / 2], [bx, by]], dashed: true, extra: true });
			continue;
		}
		if (l.type !== 'parent') continue;
		const primary = primaryOf.get(l.person2Id);
		const union = unions.find((u) => u.id === primary);
		if (union && union.memberIds.includes(l.person1Id) && union.childIds.includes(l.person2Id)) continue;
		const ax = (positions.get(l.person1Id) ?? 0) + dimW / 2;
		const bx = (positions.get(l.person2Id) ?? 0) + dimW / 2;
		const ay = yOf(l.person1Id) + dimH;
		const by = yOf(l.person2Id);
		edges.push({ points: [[ax, ay], [(ax + bx) / 2, (ay + by) / 2 - 20], [bx, by]], extra: true });
	}
	return { unionPos, edges };
}

/** Full pipeline: units → generations → layout tree → placement → edges. */
export function layoutTree(
	persons: LayoutPerson[],
	links: LayoutLink[],
	orientation: Orientation = 'TB'
): LayoutResult {
	const lr = orientation === 'LR';
	dimW = lr ? NODE_H : NODE_W;
	dimH = lr ? NODE_W : NODE_H;
	try {
		const r = layoutTB(persons, links);
		return lr ? transpose(r) : r;
	} finally {
		dimW = NODE_W;
		dimH = NODE_H;
	}
}

function transpose(r: LayoutResult): LayoutResult {
	const nodes = new Map<string, PlacedNode>();
	for (const [id, n] of r.nodes) nodes.set(id, { x: n.y, y: n.x, generation: n.generation });
	const unions = new Map<string, PlacedUnion>();
	for (const [id, u] of r.unions) unions.set(id, { x: u.y, y: u.x });
	const edges = r.edges.map((e) => ({ ...e, points: e.points.map(([x, y]) => [y, x] as [number, number]) }));
	return { ...r, nodes, unions, edges };
}

function layoutTB(persons: LayoutPerson[], links: LayoutLink[]): LayoutResult {
	const unions = buildUnits(persons, links);
	const { generations, layoutWarning } = assignGenerations(persons, unions, links);
	const { units, roots } = buildLayoutTree(persons, unions);
	const positions = new Map<string, number>();
	let cursor = 0;
	for (const r of roots) {
		const unit = units.get(r) as LayoutUnit;
		const placed = placeUnit(unit, units, positions, cursor, cursor);
		cursor = placed.right + 3 * H_GAP;
	}
	const nodes = new Map<string, PlacedNode>();
	for (const p of persons) {
		const x = positions.get(p.id) ?? 0;
		const g = generations.get(p.id) ?? 0;
		nodes.set(p.id, { x, y: g * (dimH + ROW_GAP), generation: g });
	}
	const { unionPos, edges } = routeEdges(persons, unions, units, positions, generations, links);
	const result: LayoutResult = { nodes, unions: unionPos, edges };
	if (layoutWarning) result.layoutWarning = layoutWarning;
	return result;
}
