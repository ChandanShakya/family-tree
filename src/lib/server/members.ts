import { and, eq } from 'drizzle-orm';
import { persons, treeMembers, trees, users } from '$lib/db/schema.js';
import { writeTx, type Db } from './tx.js';
import type { Role } from './permissions.js';

export interface MemberRow {
	id: string;
	userId: string;
	role: string;
	status: string;
	personId: string | null;
	displayName: string | null;
}

export function listMembers(db: Db, treeId: string): MemberRow[] {
	return db
		.select({
			id: treeMembers.id,
			userId: treeMembers.userId,
			role: treeMembers.role,
			status: treeMembers.status,
			personId: treeMembers.personId,
			displayName: users.displayName
		})
		.from(treeMembers)
		.leftJoin(users, eq(users.id, treeMembers.userId))
		.where(eq(treeMembers.treeId, treeId))
		.all();
}

function unlinkPerson(db: Db, treeId: string, userId: string): void {
	db.update(persons)
		.set({ userId: null, claimedAt: null })
		.where(and(eq(persons.treeId, treeId), eq(persons.userId, userId)))
		.run();
}

/**
 * Remove a member (owner action) or leave (self). Unlinks their person row
 * in the same transaction; the person row stays (§4). Owners cannot be
 * removed — transfer first.
 */
export function removeMember(
	db: Db,
	treeId: string,
	targetUserId: string
): { removed: true } | { error: string } {
	return writeTx(db, (tx) => {
		const row = tx
			.select()
			.from(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, targetUserId)))
			.get();
		if (!row) return { error: 'NOT_FOUND' };
		if (row.role === 'owner') return { error: 'OWNER_IMMUTABLE' };
		unlinkPerson(tx, treeId, targetUserId);
		tx.delete(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, targetUserId)))
			.run();
		return { removed: true as const };
	});
}

/** Owner-only role change. The owner row itself is immutable here. */
export function changeMemberRole(
	db: Db,
	treeId: string,
	targetUserId: string,
	role: 'editor' | 'contributor' | 'viewer'
): { updated: true } | { error: string } {
	return writeTx(db, (tx) => {
		const row = tx
			.select()
			.from(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, targetUserId)))
			.get();
		if (!row || row.status !== 'active') return { error: 'NOT_FOUND' };
		if (row.role === 'owner') return { error: 'OWNER_IMMUTABLE' };
		tx.update(treeMembers)
			.set({ role })
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, targetUserId)))
			.run();
		return { updated: true as const };
	});
}

/**
 * Transfer ownership to an active member. trees.ownerId and the owner
 * membership row change together; the previous owner becomes editor.
 */
export function transferOwnership(
	db: Db,
	treeId: string,
	newOwnerUserId: string
): { transferred: true } | { error: string } {
	return writeTx(db, (tx) => {
		const tree = tx.select().from(trees).where(eq(trees.id, treeId)).get();
		if (!tree) return { error: 'NOT_FOUND' };
		const target = tx
			.select()
			.from(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, newOwnerUserId)))
			.get();
		if (!target || target.status !== 'active') return { error: 'NOT_MEMBER' };
		if (target.role === 'owner') return { error: 'ALREADY_OWNER' };
		const current = tx
			.select()
			.from(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.role, 'owner')))
			.get();
		tx.update(trees).set({ ownerId: newOwnerUserId }).where(eq(trees.id, treeId)).run();
		// ux_one_owner_per_tree: demote the old owner before promoting the new one.
		if (current) {
			tx.update(treeMembers)
				.set({ role: 'editor' })
				.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, current.userId)))
				.run();
		}
		tx.update(treeMembers)
			.set({ role: 'owner' })
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, newOwnerUserId)))
			.run();
		return { transferred: true as const };
	});
}

export type { Role };
