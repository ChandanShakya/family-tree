import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { FAMILY_CODE_DEFAULT_MAX_USES } from '$lib/config.js';
import { joinCodes, trees } from '$lib/db/schema.js';
import { makeJoinCode, slugify } from './trees.js';
import { writeTx, type Db } from './tx.js';

/** The tree's single active family code (§5.1), or null. */
export function getFamilyCode(db: Db, treeId: string) {
	return (
		db
			.select()
			.from(joinCodes)
			.where(and(eq(joinCodes.treeId, treeId), eq(joinCodes.type, 'family'), eq(joinCodes.isActive, 1)))
			.get() ?? null
	);
}

/**
 * Replace the active family code. The old row is deactivated first so the
 * partial unique index (one active family code per tree) never sees two.
 */
export function regenerateFamilyCode(
	db: Db,
	treeId: string,
	actorId: string,
	expiresAt: string | null = null
): { code: string } | { error: 'NOT_FOUND' } {
	const tree = db.select().from(trees).where(eq(trees.id, treeId)).get();
	if (!tree) return { error: 'NOT_FOUND' };
	return writeTx(db, (tx) => {
		const old = getFamilyCode(tx, treeId);
		if (old) tx.update(joinCodes).set({ isActive: 0 }).where(eq(joinCodes.id, old.id)).run();
		const code = makeJoinCode(slugify(tree.name));
		tx.insert(joinCodes)
			.values({
				id: randomUUID(),
				code,
				type: 'family',
				treeId,
				createdBy: actorId,
				role: old?.role ?? 'contributor',
				maxUses: FAMILY_CODE_DEFAULT_MAX_USES,
				expiresAt,
				currentUses: 0,
				isActive: 1,
				createdAt: new Date().toISOString()
			})
			.run();
		return { code };
	});
}
