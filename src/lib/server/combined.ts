import { randomUUID } from 'node:crypto';
import { MAX_TRAVERSAL_DEPTH } from '$lib/config.js';
import { notify } from './notifications.js';
import { normalizeText } from '$lib/utils/fuzzy.js';
import { requireTreeAccess } from './permissions.js';
import { getTreeView, type TreeView } from './trees.js';
import { describePath, type RelationStep } from './graph.js';
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

const SHARE_LABEL: Record<Share, string> = { me: 'only me', members: 'members of two or more of my trees', chosen: 'people I choose' };

export function saveSettings(h: Handles, userId: string, s: CombinedSettings): { ok: true } | { error: 'BAD_VIEWER' } {
	const candidates = shareCandidates(h, userId);
	const nameOf = new Map(candidates.map((c) => [c.id, c.displayName]));
	if (s.viewers.some((v) => !nameOf.has(v))) return { error: 'BAD_VIEWER' };
	const before = getSettings(h, userId);
	const viewers = s.share === 'chosen' ? [...new Set(s.viewers)] : [];
	const added = viewers.filter((v) => !(before.share === 'chosen' && before.viewers.includes(v)));
	const removed = before.share === 'chosen' ? before.viewers.filter((v) => !viewers.includes(v)) : [];
	const changes = [
		before.share !== s.share && `Visible to: ${SHARE_LABEL[s.share]}`,
		added.length > 0 && `Shared with ${added.map((v) => nameOf.get(v)).join(', ')}`,
		removed.length > 0 && `Stopped sharing with ${removed.map((v) => nameOf.get(v) ?? 'a former member').join(', ')}`,
		before.depth !== s.depth && `Generations: ${s.depth ?? 'all recorded'}`
	].filter((x): x is string => !!x);
	const now = new Date();
	h.raw.transaction(() => {
		h.raw
			.prepare(
				`INSERT INTO combinedViews (userId, share, depth, updatedAt) VALUES (?, ?, ?, ?)
				 ON CONFLICT(userId) DO UPDATE SET share = excluded.share, depth = excluded.depth, updatedAt = excluded.updatedAt`
			)
			.run(userId, s.share, s.depth, now.toISOString());
		h.raw.prepare(`DELETE FROM combinedViewViewers WHERE ownerId = ?`).run(userId);
		const ins = h.raw.prepare(`INSERT INTO combinedViewViewers (ownerId, viewerId) VALUES (?, ?)`);
		for (const v of viewers) ins.run(userId, v);
		if (changes.length) {
			h.raw.prepare(`INSERT INTO combinedViewLog (id, userId, summary, createdAt) VALUES (?, ?, ?, ?)`).run(randomUUID(), userId, changes.join('; '), now.toISOString());
		}
		const owner = (h.raw.prepare(`SELECT displayName FROM users WHERE id = ?`).get(userId) as { displayName: string } | undefined)?.displayName ?? 'Someone';
		for (const v of added) {
			notify(h.db, { userId: v, actorId: userId, type: 'share', title: `${owner} shared their combined family view with you`, linkUrl: `/families/${userId}` }, now);
		}
	})();
	return { ok: true };
}

/** The owner's own sharing history, newest first. */
export function settingsLog(h: Handles, userId: string): { summary: string; createdAt: string }[] {
	return h.raw.prepare(`SELECT summary, createdAt FROM combinedViewLog WHERE userId = ? ORDER BY createdAt DESC LIMIT 50`).all(userId) as {
		summary: string;
		createdAt: string;
	}[];
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

export interface Suggestion {
	a: { id: string; name: string; treeName: string };
	b: { id: string; name: string; treeName: string };
	kind: Kind;
}
type Kind = 'parent' | 'child' | 'spouse' | 'sibling';

export interface CombinedView {
	centerId: string;
	persons: TreeView['persons'];
	relationships: TreeView['relationships'];
	/** Trees each shown person comes from (two or more when matched), for the colour tag. */
	treesOf: Record<string, string[]>;
	sides: { treeId: string; treeName: string; personId: string; visible: boolean; count: number }[];
	depth: number | null;
	/** Owner only: likely same people across trees, waiting for a verdict. */
	suggestions: Suggestion[];
	/** Owner only: confirmed matches, so they can be undone. */
	matches: Suggestion[];
}

type Person = TreeView['persons'][number];
const fullName = (p: Person) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
const nameKey = (p: Person) => normalizeText([p.firstName, p.lastName].filter(Boolean).join(' '));
const year = (p: Person) => (p.birthDateNorm ? Number(String(p.birthDateNorm).slice(0, 4)) : null);
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** How each person is directly related to `self` in one tree's links. */
function kindsAround(rels: TreeView['relationships'], self: string): Map<string, Kind> {
	const out = new Map<string, Kind>();
	for (const r of rels) {
		if (r.type === 'parent' && r.person2Id === self) out.set(r.person1Id, 'parent');
		else if (r.type === 'parent' && r.person1Id === self) out.set(r.person2Id, 'child');
		else if ((r.type === 'spouse' || r.type === 'sibling') && (r.person1Id === self || r.person2Id === self)) {
			out.set(r.person1Id === self ? r.person2Id : r.person1Id, r.type);
		}
	}
	return out;
}

/** Owner's verdicts: same=1 joins two people in the view, same=0 stops suggesting them. */
function verdicts(h: Handles, ownerId: string): Map<string, boolean> {
	const rows = h.raw.prepare(`SELECT personAId, personBId, same FROM personMatches WHERE ownerId = ?`).all(ownerId) as {
		personAId: string;
		personBId: string;
		same: number;
	}[];
	return new Map(rows.map((r) => [pairKey(r.personAId, r.personBId), r.same === 1]));
}

/** Record the owner's verdict on two people from two of their trees. */
export function setMatch(h: Handles, ownerId: string, x: string, y: string, same: boolean): { ok: true } | { error: 'NOT_FOUND' } {
	const trees = profilesOf(h, ownerId).map((p) => p.treeId);
	const rows = h.raw
		.prepare(`SELECT id, treeId FROM visible_persons WHERE id IN (?, ?)`)
		.all(x, y) as { id: string; treeId: string }[];
	if (x === y || rows.length !== 2 || rows[0]!.treeId === rows[1]!.treeId || !rows.every((r) => trees.includes(r.treeId))) {
		return { error: 'NOT_FOUND' };
	}
	const [a, b] = x < y ? [x, y] : [y, x];
	h.raw
		.prepare(
			`INSERT INTO personMatches (ownerId, personAId, personBId, same, createdAt) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(ownerId, personAId, personBId) DO UPDATE SET same = excluded.same, createdAt = excluded.createdAt`
		)
		.run(ownerId, a, b, same ? 1 : 0, new Date().toISOString());
	return { ok: true };
}

/**
 * The trees joined at the owner: every visible side's copy of the owner becomes one node (the
 * first visible profile), and so does each pair the owner confirmed as the same person.
 * `depth` is capped by the owner's own setting.
 */
export function buildCombined(h: Handles, ownerId: string, viewerId: string, depth?: number | null): CombinedView | null {
	const profiles = profilesOf(h, ownerId);
	if (!canOpen(h, ownerId, viewerId, profiles)) return null;
	const max = getSettings(h, ownerId).depth;
	const d = depth == null ? max : max == null ? depth : Math.min(depth, max);
	const sides: CombinedView['sides'] = [];
	const views: { p: Profile; view: TreeView }[] = [];
	for (const p of profiles) {
		const view = isMember(h, viewerId, p.treeId)
			? getTreeView(h, p.treeId, { focus: p.personId, depth: d ?? MAX_TRAVERSAL_DEPTH, forceFocus: d != null })
			: null;
		sides.push({ ...p, visible: !!view, count: view?.persons.length ?? 0 });
		if (view) views.push({ p, view });
	}
	if (!views.length) return null;
	const centerId = views[0]!.p.personId;
	const byId = new Map<string, { person: Person; treeId: string; treeName: string }>();
	for (const { p, view } of views) for (const person of view.persons) byId.set(person.id as string, { person, treeId: p.treeId, treeName: p.treeName });

	// alias: person id -> the id drawn for them.
	const alias = new Map<string, string>(views.map(({ p }) => [p.personId, centerId]));
	const root = (id: string) => alias.get(id) ?? id;
	const known = verdicts(h, ownerId);
	const matches: Suggestion[] = [];
	const label = (id: string) => ({ id, name: fullName(byId.get(id)!.person), treeName: byId.get(id)!.treeName });
	for (const [key, same] of known) {
		const [x, y] = key.split('|') as [string, string];
		if (!same || !byId.has(x) || !byId.has(y) || root(x) === root(y)) continue;
		alias.set(y, root(x));
		matches.push({ a: label(x), b: label(y), kind: 'sibling' });
	}

	// Suggestions: same kind of link to the owner, same name, birth years within 2 when both known.
	const suggestions: Suggestion[] = [];
	if (viewerId === ownerId) {
		const around = views.map(({ p, view }) => kindsAround(view.relationships, p.personId));
		for (let i = 0; i < views.length; i++)
			for (let j = i + 1; j < views.length; j++)
				for (const [x, kx] of around[i]!)
					for (const [y, ky] of around[j]!) {
						const px = byId.get(x)?.person;
						const py = byId.get(y)?.person;
						if (!px || !py || kx !== ky || known.has(pairKey(x, y)) || root(x) === root(y) || nameKey(px) !== nameKey(py)) continue;
						const yx = year(px);
						const yy = year(py);
						if (yx != null && yy != null && Math.abs(yx - yy) > 2) continue;
						suggestions.push({ a: label(x), b: label(y), kind: kx });
					}
	}

	const persons: Person[] = [];
	const treesOf: Record<string, string[]> = {};
	for (const [id, { person, treeId }] of byId) {
		const r = root(id);
		const list = (treesOf[r] ??= []);
		if (!list.includes(treeId)) list.push(treeId);
		if (r === id) persons.push(person);
	}
	const seen = new Set<string>();
	const relationships: CombinedView['relationships'] = [];
	for (const { view } of views)
		for (const rel of view.relationships) {
			const a = root(rel.person1Id);
			const b = root(rel.person2Id);
			const k = rel.type === 'parent' ? `p|${a}|${b}` : `${rel.type}|${pairKey(a, b)}`;
			if (a === b || seen.has(k)) continue;
			seen.add(k);
			relationships.push({ ...rel, person1Id: a, person2Id: b });
		}
	return { centerId, persons, relationships, treesOf, sides, depth: d, suggestions, matches: viewerId === ownerId ? matches : [] };
}

/** "How are we related?" across the joined trees, over what this viewer's combined view shows. */
export function relateInView(view: CombinedView, fromId: string, toId: string): { label: string; path: RelationStep[] } | null {
	const shown = new Set(view.persons.map((p) => p.id as string));
	if (!shown.has(fromId) || !shown.has(toId)) return null;
	if (fromId === toId) return { label: 'self', path: [] };
	const next = new Map<string, RelationStep[]>();
	const add = (s: RelationStep) => (next.get(s.from) ?? next.set(s.from, []).get(s.from)!).push(s);
	for (const r of view.relationships) {
		if (r.type === 'parent') {
			add({ from: r.person2Id, to: r.person1Id, link: 'parent' });
			add({ from: r.person1Id, to: r.person2Id, link: 'child' });
		} else if (r.type === 'spouse' || r.type === 'sibling') {
			add({ from: r.person1Id, to: r.person2Id, link: r.type });
			add({ from: r.person2Id, to: r.person1Id, link: r.type });
		}
	}
	// Breadth-first over an already bounded set (the view), so no extra cap is needed.
	const prev = new Map<string, RelationStep>();
	let frontier = [fromId];
	const seen = new Set(frontier);
	while (frontier.length) {
		const out: string[] = [];
		for (const id of frontier)
			for (const s of next.get(id) ?? []) {
				if (seen.has(s.to)) continue;
				seen.add(s.to);
				prev.set(s.to, s);
				if (s.to === toId) {
					const path: RelationStep[] = [];
					for (let cur = toId; cur !== fromId; cur = prev.get(cur)!.from) path.unshift(prev.get(cur)!);
					return { label: describePath(path), path };
				}
				out.push(s.to);
			}
		frontier = out;
	}
	return null;
}
