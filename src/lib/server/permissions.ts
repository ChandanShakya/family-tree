import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '$lib/db/schema.js';
import {
	changeHistory,
	events,
	joinCodes,
	media,
	persons,
	profileClaims,
	relationships,
	treeMembers
} from '$lib/db/schema.js';

type Db = BetterSQLite3Database<typeof schema>;

export type Role = 'owner' | 'editor' | 'contributor' | 'viewer';

export type Action =
	| 'view'
	| 'add'
	| 'delete'
	| 'revert'
	| 'createDirectCode'
	| 'manageFamilyCode'
	| 'review'
	| 'setQuestions'
	| 'manageMembers'
	| 'import'
	| 'fullExport'
	| 'privacyExport'
	| 'transferDelete';

const MATRIX: Record<Action, Record<Role, boolean>> = {
	view: { owner: true, editor: true, contributor: true, viewer: true },
	add: { owner: true, editor: true, contributor: true, viewer: false },
	delete: { owner: true, editor: true, contributor: false, viewer: false },
	revert: { owner: true, editor: true, contributor: true, viewer: false },
	createDirectCode: { owner: true, editor: true, contributor: true, viewer: false },
	manageFamilyCode: { owner: true, editor: true, contributor: false, viewer: false },
	review: { owner: true, editor: true, contributor: false, viewer: false },
	setQuestions: { owner: true, editor: true, contributor: true, viewer: false },
	manageMembers: { owner: true, editor: false, contributor: false, viewer: false },
	import: { owner: true, editor: true, contributor: false, viewer: false },
	fullExport: { owner: true, editor: true, contributor: false, viewer: false },
	privacyExport: { owner: true, editor: true, contributor: true, viewer: true },
	transferDelete: { owner: true, editor: false, contributor: false, viewer: false }
};

export function canDo(role: Role, action: Action, opts?: { isOwnChange?: boolean }): boolean {
	if (action === 'revert' && role === 'contributor') {
		return opts?.isOwnChange === true;
	}
	return MATRIX[action][role];
}

export function getMatrix(): Record<Action, Record<Role, boolean>> {
	return MATRIX;
}

// --- Access enforcement (§4). Every tree route calls requireTreeAccess; no
// inline role checks elsewhere. ---

export type EntityType = 'person' | 'relationship' | 'event' | 'media' | 'history' | 'claim' | 'joinCode';

export type AccessResult = { ok: true; role: Role } | { ok: false; status: 404 | 403 };

/** Resolve the owning tree of an entity row. Unknown ids yield null (→ 404). */
export function resolveTreeId(db: Db, entityType: EntityType, id: string): string | null {
	switch (entityType) {
		case 'person': {
			const r = db.select({ treeId: persons.treeId }).from(persons).where(eq(persons.id, id)).get();
			return r?.treeId ?? null;
		}
		case 'relationship': {
			const r = db
				.select({ treeId: relationships.treeId })
				.from(relationships)
				.where(eq(relationships.id, id))
				.get();
			return r?.treeId ?? null;
		}
		case 'event': {
			const r = db.select({ treeId: events.treeId }).from(events).where(eq(events.id, id)).get();
			return r?.treeId ?? null;
		}
		case 'media': {
			const r = db.select({ treeId: media.treeId }).from(media).where(eq(media.id, id)).get();
			return r?.treeId ?? null;
		}
		case 'history': {
			const r = db
				.select({ treeId: changeHistory.treeId })
				.from(changeHistory)
				.where(eq(changeHistory.id, id))
				.get();
			return r?.treeId ?? null;
		}
		case 'joinCode': {
			const r = db.select({ treeId: joinCodes.treeId }).from(joinCodes).where(eq(joinCodes.id, id)).get();
			return r?.treeId ?? null;
		}
		case 'claim': {
			const r = db
				.select({ treeId: profileClaims.treeId })
				.from(profileClaims)
				.where(eq(profileClaims.id, id))
				.get();
			return r?.treeId ?? null;
		}
	}
}

/**
 * Gate a tree action. No active membership (or pending/rejected status, or an
 * unknown tree) → 404 so existence is not disclosed. Active member without
 * the role → 403.
 */
export function requireTreeAccess(
	db: Db,
	userId: string,
	treeId: string,
	action: Action,
	ctx?: { authorUserId?: string }
): AccessResult {
	const membership = db
		.select()
		.from(treeMembers)
		.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)))
		.get();
	if (!membership || membership.status !== 'active') return { ok: false, status: 404 };
	const role = membership.role as Role;
	const allowed =
		action === 'revert' && role === 'contributor'
			? ctx?.authorUserId === userId
			: canDo(role, action);
	if (!allowed) return { ok: false, status: 403 };
	return { ok: true, role };
}
