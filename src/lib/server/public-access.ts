import { eq } from 'drizzle-orm';
import { LIVING_ASSUMPTION_YEARS } from '$lib/config.js';
import { trees } from '$lib/db/schema.js';
import { anonymisePerson, filterPeople, isLiving } from '$lib/shared/privacy.mjs';
import { requireTreeAccess, type Role } from './permissions.js';
import { getPerson, type PersonRow } from './persons.js';
import type { TreeView } from './trees.js';
import type { Db, Handles } from './tx.js';

// Public trees (§4, §6.9). `allowPublic` routes accept anonymous callers; every
// response they give passes through the privacy filter, and member views stay unfiltered.

export type ReadAccess =
	| { mode: 'member'; role: Role }
	| { mode: 'public' }
	| { mode: 'denied'; status: 401 | 404 };

/**
 * Anonymous: a public tree is readable (filtered); a private or nonexistent tree is the same 401.
 * Signed in: members get the full view; others see a public tree filtered, or 404 (§4).
 */
export function readAccess(db: Db, userId: string | null, treeId: string): ReadAccess {
	const tree = db.select({ p: trees.isPublic }).from(trees).where(eq(trees.id, treeId)).get();
	if (userId) {
		const a = requireTreeAccess(db, userId, treeId, 'view');
		if (a.ok) return { mode: 'member', role: a.role };
	}
	if (tree?.p === 1) return { mode: 'public' };
	return { mode: 'denied', status: userId ? 404 : 401 };
}

/** Strip account ids that must never reach an anonymous or exported view. */
function strip<T extends Record<string, unknown>>(p: T): T {
	const c: Record<string, unknown> = { ...p };
	for (const k of ['userId', 'createdBy', 'lastEditedBy', 'claimedAt', 'claimedVia']) delete c[k];
	return c as T;
}

export function publicTreeView(view: TreeView, now = new Date()): TreeView {
	const { people } = filterPeople(view.persons, now, LIVING_ASSUMPTION_YEARS);
	const t = view.tree as Record<string, unknown>;
	return {
		...view,
		// members, owner and cover are not part of the public view
		tree: { id: t.id, name: t.name, description: t.description, isPublic: 1 },
		members: [],
		persons: people.map((p) => strip(p)),
		relationships: view.relationships.map((r) => {
			const { createdBy, notes, ...rest } = r;
			void createdBy;
			void notes;
			return rest as typeof r;
		})
	};
}

/** One person for a public viewer: living/unknown people are "Living" with no events or photos. */
export function publicPerson(h: Handles, personId: string, now = new Date()) {
	const p = getPerson(h, personId);
	if (!p) return null;
	const { events, media, ...row } = p;
	if (isLiving(row as PersonRow, now, LIVING_ASSUMPTION_YEARS)) {
		return { ...strip(anonymisePerson(row as PersonRow)), events: [], media: [] };
	}
	return { ...strip(row as PersonRow), events, media: media.map(({ uploadedBy, ...m }) => (void uploadedBy, m)) };
}

/** Whether an anonymous caller may fetch a file of this person (non-living only). */
export function personVisibleToPublic(raw: Handles['raw'], personId: string, now = new Date()): boolean {
	const r = raw.prepare(`SELECT isLiving, deathDate, deathDateNorm, birthDateNorm FROM visible_persons WHERE id = ?`).get(personId) as
		| { isLiving: number | null; deathDate: string | null; deathDateNorm: string | null; birthDateNorm: string | null }
		| undefined;
	return !!r && !isLiving(r, now, LIVING_ASSUMPTION_YEARS);
}
