import { MAX_TRAVERSAL_DEPTH } from '$lib/config.js';
import { requireTreeAccess } from './permissions.js';
import { getTreeView, type TreeView } from './trees.js';
import type { Handles } from './tx.js';

// Combined family view (D-035): a user who has claimed a profile in several trees sees those
// trees joined at their own person. The user decides who may open the view; each tree is still
// drawn only for viewers who are members of it.

export const COMBINED_MAX_TREES = 3;
export type Share = 'me' | 'chosen' | 'members';

export interface Profile {
	personId: string;
	treeId: string;
	treeName: string;
}

export interface CombinedSettings {
	share: Share;
	/** Generations around the user; null = everything recorded. */
	depth: number | null;
	viewers: string[];
}

/** The user's claimed profiles in trees that allow cross-tree views, oldest claim first. */
export function profilesOf(h: Handles, userId: string): Profile[] {
	return h.raw
		.prepare(
			`SELECT p.id AS personId, p.treeId, t.name AS treeName FROM visible_persons p JOIN trees t ON t.id = p.treeId
			 WHERE p.userId = ? AND t.allowCrossTree = 1 ORDER BY p.claimedAt, p.createdAt LIMIT ?`
		)
		.all(userId, COMBINED_MAX_TREES) as Profile[];
}

export function getSettings(h: Handles, userId: string): CombinedSettings {
	const row = h.raw.prepare(`SELECT share, depth FROM combinedViews WHERE userId = ?`).get(userId) as
		| { share: Share; depth: number | null }
		| undefined;
	const viewers = (h.raw.prepare(`SELECT viewerId FROM combinedViewViewers WHERE ownerId = ?`).all(userId) as { viewerId: string }[]).map(
		(r) => r.viewerId
	);
	return { share: row?.share ?? 'me', depth: row?.depth ?? null, viewers };
}

/** People the user may share with: active members of any tree they have a profile in. */
export function shareCandidates(h: Handles, userId: string): { id: string; displayName: string }[] {
	const trees = JSON.stringify(profilesOf(h, userId).map((p) => p.treeId));
	return h.raw
		.prepare(
			`SELECT DISTINCT u.id, u.displayName FROM treeMembers m JOIN users u ON u.id = m.userId
			 WHERE m.treeId IN (SELECT value FROM json_each(?)) AND m.status = 'active' AND u.id <> ? ORDER BY u.displayName`
		)
		.all(trees, userId) as { id: string; displayName: string }[];
}

export function saveSettings(h: Handles, userId: string, s: CombinedSettings): { ok: true } | { error: 'BAD_VIEWER' } {
	const allowed = new Set(shareCandidates(h, userId).map((c) => c.id));
	if (s.viewers.some((v) => !allowed.has(v))) return { error: 'BAD_VIEWER' };
	h.raw.transaction(() => {
		h.raw
			.prepare(
				`INSERT INTO combinedViews (userId, share, depth, updatedAt) VALUES (?, ?, ?, ?)
				 ON CONFLICT(userId) DO UPDATE SET share = excluded.share, depth = excluded.depth, updatedAt = excluded.updatedAt`
			)
			.run(userId, s.share, s.depth, new Date().toISOString());
		h.raw.prepare(`DELETE FROM combinedViewViewers WHERE ownerId = ?`).run(userId);
		const ins = h.raw.prepare(`INSERT INTO combinedViewViewers (ownerId, viewerId) VALUES (?, ?)`);
		for (const v of new Set(s.viewers)) ins.run(userId, v);
	})();
	return { ok: true };
}

const isMember = (h: Handles, userId: string, treeId: string) => requireTreeAccess(h.db, userId, treeId, 'view').ok;

/** May `viewerId` open `ownerId`'s combined view? Needs two or more profiles either way. */
export function canOpen(h: Handles, ownerId: string, viewerId: string, profiles = profilesOf(h, ownerId)): boolean {
	if (profiles.length < 2) return false;
	if (ownerId === viewerId) return true;
	const s = getSettings(h, ownerId);
	const memberOf = profiles.filter((p) => isMember(h, viewerId, p.treeId)).length;
	if (memberOf === 0) return false;
	if (s.share === 'chosen') return s.viewers.includes(viewerId);
	return s.share === 'members' && memberOf >= 2;
}

export interface CombinedView {
	centerId: string;
	persons: TreeView['persons'];
	relationships: TreeView['relationships'];
	/** Tree of each shown person, for the colour tag. */
	treeOf: Record<string, string>;
	sides: { treeId: string; treeName: string; personId: string; visible: boolean; count: number }[];
	depth: number | null;
}

/**
 * The trees joined at the owner: every visible side's copy of the owner becomes one node (the
 * first visible profile). `depth` is capped by the owner's own setting.
 */
export function buildCombined(h: Handles, ownerId: string, viewerId: string, depth?: number | null): CombinedView | null {
	const profiles = profilesOf(h, ownerId);
	if (!canOpen(h, ownerId, viewerId, profiles)) return null;
	const max = getSettings(h, ownerId).depth;
	const d = depth == null ? max : max == null ? depth : Math.min(depth, max);
	const sides: CombinedView['sides'] = [];
	const persons: CombinedView['persons'] = [];
	const relationships: CombinedView['relationships'] = [];
	const treeOf: Record<string, string> = {};
	let centerId = '';
	for (const p of profiles) {
		if (!isMember(h, viewerId, p.treeId)) {
			sides.push({ ...p, visible: false, count: 0 });
			continue;
		}
		const view = getTreeView(h, p.treeId, { focus: p.personId, depth: d ?? MAX_TRAVERSAL_DEPTH, forceFocus: d != null });
		if (!view) continue;
		centerId ||= p.personId;
		const map = (id: string) => (id === p.personId ? centerId : id);
		for (const person of view.persons) {
			if (person.id === p.personId && centerId !== p.personId) continue;
			persons.push(person);
			treeOf[person.id as string] = p.treeId;
		}
		for (const r of view.relationships) relationships.push({ ...r, person1Id: map(r.person1Id), person2Id: map(r.person2Id) });
		sides.push({ ...p, visible: true, count: view.persons.length });
	}
	if (!centerId) return null;
	return { centerId, persons, relationships, treeOf, sides, depth: d };
}
