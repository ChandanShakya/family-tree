import type Database from 'better-sqlite3';
import { MAX_TRAVERSAL_DEPTH, MAX_TRAVERSAL_NODES } from '$lib/config.js';
import { kinshipLabel } from './kinship.js';

export interface BoundedResult {
	truncated: boolean;
}

// One prepared statement per level; id lists pass through json_each (§6.11). INDEXED BY pins the per-person
// index: left to itself the planner scans the whole tree's relationships (50 000 rows) for every level.
// Reads go through the visible_persons view (§5.1).

function parentIdsOf(
	raw: Database.Database,
	treeId: string,
	childIds: string[]
): Array<{ parent: string; child: string }> {
	if (childIds.length === 0) return [];
	return raw
		.prepare(
			`SELECT r.person1Id AS parent, r.person2Id AS child FROM relationships r INDEXED BY ix_rel_p2
			 JOIN visible_persons p ON p.id = r.person1Id
			 WHERE r.treeId = ? AND r.type = 'parent' AND r.person2Id IN (SELECT value FROM json_each(?))`
		)
		.all(treeId, JSON.stringify(childIds)) as Array<{ parent: string; child: string }>;
}

function childIdsOf(
	raw: Database.Database,
	treeId: string,
	parentIds: string[]
): Array<{ parent: string; child: string }> {
	if (parentIds.length === 0) return [];
	return raw
		.prepare(
			`SELECT r.person1Id AS parent, r.person2Id AS child FROM relationships r INDEXED BY ix_rel_p1
			 JOIN visible_persons p ON p.id = r.person2Id
			 WHERE r.treeId = ? AND r.type = 'parent' AND r.person1Id IN (SELECT value FROM json_each(?))`
		)
		.all(treeId, JSON.stringify(parentIds)) as Array<{ parent: string; child: string }>;
}

function personVisible(raw: Database.Database, id: string): boolean {
	const r = raw.prepare(`SELECT id FROM visible_persons WHERE id = ?`).get(id) as
		| { id: string }
		| undefined;
	return Boolean(r);
}

export function ancestors(
	raw: Database.Database,
	treeId: string,
	personId: string,
	maxDepth = MAX_TRAVERSAL_DEPTH,
	cap = MAX_TRAVERSAL_NODES
): { ids: string[]; truncated: boolean } {
	const seen = new Set<string>();
	let frontier = [personId];
	let truncated = false;
	for (let depth = 0; depth < maxDepth; depth++) {
		const links = parentIdsOf(raw, treeId, frontier);
		const next: string[] = [];
		for (const l of links) {
			if (seen.size >= cap) {
				truncated = true;
				return { ids: [...seen], truncated };
			}
			if (!seen.has(l.parent)) {
				seen.add(l.parent);
				next.push(l.parent);
			}
		}
		if (next.length === 0) return { ids: [...seen], truncated };
		frontier = next;
	}
	if (frontier.length > 0 && parentIdsOf(raw, treeId, frontier).length > 0) truncated = true;
	return { ids: [...seen], truncated };
}

export function descendants(
	raw: Database.Database,
	treeId: string,
	personId: string,
	maxDepth = MAX_TRAVERSAL_DEPTH,
	cap = MAX_TRAVERSAL_NODES
): { ids: string[]; truncated: boolean } {
	const seen = new Set<string>();
	let frontier = [personId];
	let truncated = false;
	for (let depth = 0; depth < maxDepth; depth++) {
		const links = childIdsOf(raw, treeId, frontier);
		const next: string[] = [];
		for (const l of links) {
			if (seen.size >= cap) {
				truncated = true;
				return { ids: [...seen], truncated };
			}
			if (!seen.has(l.child)) {
				seen.add(l.child);
				next.push(l.child);
			}
		}
		if (next.length === 0) return { ids: [...seen], truncated };
		frontier = next;
	}
	if (frontier.length > 0 && childIdsOf(raw, treeId, frontier).length > 0) truncated = true;
	return { ids: [...seen], truncated };
}

/** Longest ancestor chain length (edges) above a person, bounded. */
export function ancestorDepth(raw: Database.Database, treeId: string, personId: string): number {
	const dist = new Map<string, number>([[personId, 0]]);
	let frontier = [personId];
	let max = 0;
	for (let depth = 0; depth < maxDepthGuard(); depth++) {
		const links = parentIdsOf(raw, treeId, frontier);
		if (links.length === 0) return max;
		const next: string[] = [];
		for (const l of links) {
			const d = (dist.get(l.child) ?? 0) + 1;
			if (d > (dist.get(l.parent) ?? -1)) {
				dist.set(l.parent, d);
				max = Math.max(max, d);
				next.push(l.parent);
			}
		}
		frontier = [...new Set(next)];
	}
	return max;
}

function maxDepthGuard(): number {
	return MAX_TRAVERSAL_DEPTH;
}

/** Longest descendant chain length (edges) below a person, bounded. */
export function descendantDepth(raw: Database.Database, treeId: string, personId: string): number {
	const dist = new Map<string, number>([[personId, 0]]);
	let frontier = [personId];
	let max = 0;
	for (let depth = 0; depth < MAX_TRAVERSAL_DEPTH; depth++) {
		const links = childIdsOf(raw, treeId, frontier);
		if (links.length === 0) return max;
		const next: string[] = [];
		for (const l of links) {
			const d = (dist.get(l.parent) ?? 0) + 1;
			if (d > (dist.get(l.child) ?? -1)) {
				dist.set(l.child, d);
				max = Math.max(max, d);
				next.push(l.child);
			}
		}
		frontier = [...new Set(next)];
	}
	return max;
}

/** True when linking parent → child would create a cycle (child reachable above parent). */
export function wouldCreateCycle(
	raw: Database.Database,
	treeId: string,
	parentId: string,
	childId: string
): boolean {
	if (parentId === childId) return true;
	const above = ancestors(raw, treeId, parentId);
	if (above.ids.includes(childId)) return true;
	// If the walk itself was truncated by the depth cap, refuse: unverifiable.
	if (above.truncated) return true;
	return false;
}

/**
 * True when a parent link would push an ancestor chain past
 * MAX_TRAVERSAL_DEPTH (§6.11 → GRAPH_TOO_DEEP).
 */
export function wouldExceedDepth(
	raw: Database.Database,
	treeId: string,
	parentId: string,
	childId: string
): boolean {
	return ancestorDepth(raw, treeId, parentId) + 1 + descendantDepth(raw, treeId, childId) > MAX_TRAVERSAL_DEPTH;
}

export interface Relatives {
	parents: string[];
	children: string[];
	spouses: string[];
	siblings: string[];
}

export function relatives(raw: Database.Database, treeId: string, personId: string): Relatives {
	if (!personVisible(raw, personId)) return { parents: [], children: [], spouses: [], siblings: [] };
	const parentRows = raw
		.prepare(
			`SELECT r.person1Id AS id FROM relationships r JOIN visible_persons p ON p.id = r.person1Id
			 WHERE r.treeId = ? AND r.type = 'parent' AND r.person2Id = ?`
		)
		.all(treeId, personId) as Array<{ id: string }>;
	const childRows = raw
		.prepare(
			`SELECT r.person2Id AS id FROM relationships r JOIN visible_persons p ON p.id = r.person2Id
			 WHERE r.treeId = ? AND r.type = 'parent' AND r.person1Id = ?`
		)
		.all(treeId, personId) as Array<{ id: string }>;
	// "either end" lookups are two index probes, not an OR over the tree's whole relationship list
	const either = (type: string): Array<{ id: string }> =>
		raw
			.prepare(
				`SELECT r.person2Id AS id FROM relationships r INDEXED BY ix_rel_p1 JOIN visible_persons p ON p.id = r.person2Id
				 WHERE r.person1Id = ? AND r.treeId = ? AND r.type = ?
				 UNION ALL
				 SELECT r.person1Id FROM relationships r INDEXED BY ix_rel_p2 JOIN visible_persons p ON p.id = r.person1Id
				 WHERE r.person2Id = ? AND r.treeId = ? AND r.type = ?`
			)
			.all(personId, treeId, type, personId, treeId, type) as Array<{ id: string }>;
	const spouseRows = either('spouse');
	const parents = parentRows.map((r) => r.id);
	const children = childRows.map((r) => r.id);
	const spouses = spouseRows.map((r) => r.id);
	// Siblings: shared parents (derived) plus stored sibling links for
	// parent-unknown cases; never duplicated.
	const siblingSet = new Set<string>();
	if (parents.length > 0) {
		const sibs = raw
			.prepare(
				`SELECT DISTINCT r.person2Id AS id FROM relationships r INDEXED BY ix_rel_p1
				 JOIN visible_persons p ON p.id = r.person2Id
				 WHERE r.treeId = ? AND r.type = 'parent' AND r.person1Id IN (SELECT value FROM json_each(?))
				 AND r.person2Id != ?`
			)
			.all(treeId, JSON.stringify(parents), personId) as Array<{ id: string }>;
		for (const s of sibs) siblingSet.add(s.id);
	}
	const storedSibs = either('sibling');
	for (const s of storedSibs) siblingSet.add(s.id);
	return { parents, children, spouses, siblings: [...siblingSet] };
}

export interface RelationStep {
	from: string;
	to: string;
	link: 'parent' | 'child' | 'spouse' | 'sibling';
}

/** Breadth-first "how are we related" over parent/spouse/sibling links (§6.3). */
export function relationPath(
	raw: Database.Database,
	treeId: string,
	fromId: string,
	toId: string,
	maxDepth = MAX_TRAVERSAL_DEPTH,
	cap = MAX_TRAVERSAL_NODES
): { path: RelationStep[]; label: string; truncated: boolean } | null {
	if (fromId === toId) return { path: [], label: 'self', truncated: false };
	if (!personVisible(raw, fromId) || !personVisible(raw, toId)) return null;
	const prev = new Map<string, RelationStep>();
	const visited = new Set([fromId]);
	let frontier = [fromId];
	let count = 1;
	const neighbors = (id: string): RelationStep[] => {
		const out: RelationStep[] = [];
		const rows = raw
			.prepare(
				`SELECT person1Id, person2Id, type FROM relationships WHERE treeId = ?
				 AND type IN ('parent','spouse','sibling') AND (person1Id = ? OR person2Id = ?)`
			)
			.all(treeId, id, id) as Array<{ person1Id: string; person2Id: string; type: string }>;
		for (const r of rows) {
			const other = r.person1Id === id ? r.person2Id : r.person1Id;
			if (!personVisible(raw, other)) continue;
			let link: RelationStep['link'];
			if (r.type === 'spouse' || r.type === 'sibling') link = r.type;
			else link = r.person1Id === id ? 'child' : 'parent';
			out.push({ from: id, to: other, link });
		}
		return out;
	};
	for (let depth = 0; depth < maxDepth; depth++) {
		const next: string[] = [];
		for (const id of frontier) {
			for (const step of neighbors(id)) {
				if (visited.has(step.to)) continue;
				if (count >= cap) {
					return { path: [], label: 'not connected within the search limit', truncated: true };
				}
				visited.add(step.to);
				count++;
				prev.set(step.to, step);
				if (step.to === toId) {
					const path: RelationStep[] = [];
					let cur: string | undefined = toId;
					while (cur && cur !== fromId) {
						const s = prev.get(cur);
						if (!s) break;
						path.unshift(s);
						cur = s.from;
					}
					return { path, label: describePath(path), truncated: false };
				}
				next.push(step.to);
			}
		}
		if (next.length === 0) return null;
		frontier = next;
	}
	return { path: [], label: 'not connected within the search limit', truncated: true };
}

export function describePath(path: RelationStep[]): string {
	return kinshipLabel(path.map((s) => s.link));
}

/**
 * Whole-tree scans (chain roots, generation depth) cost 50–100 ms on a 50 000-person tree, over the
 * §3 main-thread budget, so their results are kept per tree until its links or visible people change.
 * The fingerprint is index-only: link count and newest link rowid (any insert or delete moves one of
 * them; links never change their ends), live person count, newest soft-delete time, non-active members.
 * Computed from the database on every call, so it is right across processes sharing the file.
 */
const scanCache = new Map<string, { key: string; roots?: string[]; depth?: { depth: number; truncated: boolean }; count?: number }>();

function treeFingerprint(raw: Database.Database, treeId: string): string {
	return (
		raw
			.prepare(
				`SELECT (SELECT COUNT(*) FROM relationships WHERE treeId = @t) || ':' ||
				        (SELECT IFNULL(MAX(rowid), 0) FROM relationships WHERE treeId = @t) || ':' ||
				        (SELECT COUNT(*) FROM persons WHERE treeId = @t AND deletedAt IS NULL) || ':' ||
				        (SELECT IFNULL(MAX(deletedAt), '') FROM persons WHERE treeId = @t) || ':' ||
				        (SELECT COUNT(*) FROM treeMembers WHERE treeId = @t AND status <> 'active') AS k`
			)
			.get({ t: treeId }) as { k: string }
	).k;
}

export function cached<K extends 'roots' | 'depth' | 'count'>(
	raw: Database.Database,
	treeId: string,
	field: K,
	compute: () => NonNullable<(typeof scanCache extends Map<string, infer V> ? V : never)[K]>
) {
	const key = treeFingerprint(raw, treeId);
	let entry = scanCache.get(treeId);
	if (!entry || entry.key !== key) {
		entry = { key };
		scanCache.set(treeId, entry);
	}
	return (entry[field] ??= compute());
}

/** Persons that have children but no parents: where every parent chain starts (one anti-join over the tree's links). */
export function chainRoots(raw: Database.Database, treeId: string): string[] {
	return cached(raw, treeId, 'roots', () => scanChainRoots(raw, treeId));
}

function scanChainRoots(raw: Database.Database, treeId: string): string[] {
	return (
		raw
			.prepare(
				`SELECT DISTINCT r.person1Id AS id FROM relationships r
				 LEFT JOIN relationships c ON c.person2Id = r.person1Id AND c.type = 'parent' AND c.treeId = r.treeId
				 WHERE r.treeId = ? AND r.type = 'parent' AND c.id IS NULL`
			)
			.all(treeId) as Array<{ id: string }>
	).map((r) => r.id);
}

/**
 * Generation depth = longest visible parent chain in the tree, bounded (§6.11). Level by level, one
 * query per level: a node reached again by a longer chain is simply visited again one level down.
 */
export function generationDepth(raw: Database.Database, treeId: string): { depth: number; truncated: boolean } {
	return cached(raw, treeId, 'depth', () => scanGenerationDepth(raw, treeId));
}

function scanGenerationDepth(raw: Database.Database, treeId: string): { depth: number; truncated: boolean } {
	const best = new Map<string, number>();
	let frontier = chainRoots(raw, treeId);
	for (const id of frontier) best.set(id, 0);
	let depth = 0;
	let visited = 0;
	let truncated = false;
	let level = 0;
	while (frontier.length > 0) {
		visited += frontier.length;
		if (visited > MAX_TRAVERSAL_NODES) {
			truncated = true;
			break;
		}
		depth = Math.max(depth, level);
		if (level >= MAX_TRAVERSAL_DEPTH) {
			truncated = true;
			break;
		}
		const next = new Set<string>();
		for (const l of childIdsOf(raw, treeId, frontier)) {
			if ((best.get(l.child) ?? -1) < level + 1) {
				best.set(l.child, level + 1);
				next.add(l.child);
			}
		}
		frontier = [...next];
		level++;
	}
	return { depth, truncated };
}
