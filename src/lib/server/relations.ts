import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { relationships } from '$lib/db/schema.js';
import { writeHistory } from './audit.js';
import { wouldCreateCycle, wouldExceedDepth } from './graph.js';
import { notifyEdit } from './notifications.js';
import { writeTx, type Handles } from './tx.js';

function newId(): string {
	return randomUUID();
}

export type LinkType = 'parent' | 'spouse' | 'sibling' | 'guardian';

export interface LinkInput {
	person1Id: string;
	person2Id: string;
	type: LinkType;
	startDate?: string;
	endDate?: string;
	notes?: string;
}

export type LinkResult =
	| { created: true; id: string; batchId: string; parentWarning?: boolean }
	| { error: 'NOT_FOUND' | 'SELF_LINK' | 'DUPLICATE' | 'CYCLE' | 'GRAPH_TOO_DEEP' | 'SHARED_PARENTS' };

function normalizeOrder(a: string, b: string, type: LinkType): [string, string] {
	if ((type === 'spouse' || type === 'sibling') && a > b) return [b, a];
	return [a, b];
}

function visiblePerson(h: Handles, id: string): Record<string, unknown> | null {
	return h.raw.prepare(`SELECT * FROM visible_persons WHERE id = ?`).get(id) as Record<
		string,
		unknown
	> | null;
}

/** Shared-parent check for the sibling-link rule (§6.3). */
function sharedParent(h: Handles, treeId: string, a: string, b: string): boolean {
	const rows = h.raw
		.prepare(
			`SELECT r.person1Id AS p FROM relationships r WHERE r.treeId = ? AND r.type = 'parent' AND r.person2Id = ?
			 INTERSECT
			 SELECT r.person1Id AS p FROM relationships r WHERE r.treeId = ? AND r.type = 'parent' AND r.person2Id = ?`
		)
		.all(treeId, a, treeId, b) as Array<{ p: string }>;
	return rows.length > 0;
}

export function createLink(h: Handles, actorId: string, treeId: string, input: LinkInput): LinkResult {
	if (input.person1Id === input.person2Id) return { error: 'SELF_LINK' };
	const [p1, p2] = normalizeOrder(input.person1Id, input.person2Id, input.type);
	const pa = visiblePerson(h, p1);
	const pb = visiblePerson(h, p2);
	if (!pa || !pb || pa.treeId !== treeId || pb.treeId !== treeId) return { error: 'NOT_FOUND' };
	if (input.type === 'parent') {
		if (wouldCreateCycle(h.raw, treeId, p1, p2)) return { error: 'CYCLE' };
		if (wouldExceedDepth(h.raw, treeId, p1, p2)) return { error: 'GRAPH_TOO_DEEP' };
	}
	if (input.type === 'sibling' && sharedParent(h, treeId, p1, p2)) {
		// Siblings through shared parents are derived; never duplicate with a stored link.
		return { error: 'SHARED_PARENTS' };
	}
	const existing = h.db
		.select()
		.from(relationships)
		.where(
			and(
				eq(relationships.person1Id, p1),
				eq(relationships.person2Id, p2),
				eq(relationships.type, input.type)
			)
		)
		.get();
	if (existing) return { error: 'DUPLICATE' };
	const id = newId();
	const now = new Date().toISOString();
	let parentWarning = false;
	if (input.type === 'parent') {
		const count = (
			h.raw
				.prepare(
					`SELECT COUNT(*) AS c FROM relationships WHERE treeId = ? AND type = 'parent' AND person2Id = ?`
				)
				.get(treeId, p2) as { c: number }
		).c;
		parentWarning = count >= 2;
	}
	const batchId = writeTx(h.db, (tx) => {
		tx.insert(relationships)
			.values({
				id,
				treeId,
				person1Id: p1,
				person2Id: p2,
				type: input.type,
				startDate: input.startDate ?? null,
				endDate: input.endDate ?? null,
				notes: input.notes ?? null,
				createdBy: actorId,
				createdAt: now
			})
			.run();
		const b = writeHistory(tx, {
			treeId,
			entityType: 'relationship',
			entityId: id,
			changedBy: actorId,
			action: 'create'
		});
		// A claimed person hears about edits to their family links (§5.1, coalesced).
		for (const pid of [p1, p2]) notifyEdit(tx, { treeId, personId: pid, actorId });
		return b;
	});
	return parentWarning ? { created: true, id, batchId, parentWarning: true } : { created: true, id, batchId };
}

export type UpdateLinkResult =
	| { updated: true; batchId?: string }
	| { error: 'NOT_FOUND' };

export function updateLink(
	h: Handles,
	actorId: string,
	linkId: string,
	patch: { startDate?: string | null; endDate?: string | null; notes?: string | null }
): UpdateLinkResult {
	const row = h.db.select().from(relationships).where(eq(relationships.id, linkId)).get();
	if (!row) return { error: 'NOT_FOUND' };
	const changed: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
	if (patch.startDate !== undefined && (patch.startDate ?? null) !== row.startDate) {
		changed.push({ field: 'startDate', oldValue: row.startDate, newValue: patch.startDate });
	}
	if (patch.endDate !== undefined && (patch.endDate ?? null) !== row.endDate) {
		changed.push({ field: 'endDate', oldValue: row.endDate, newValue: patch.endDate });
	}
	if (patch.notes !== undefined && (patch.notes ?? null) !== row.notes) {
		changed.push({ field: 'notes', oldValue: row.notes, newValue: patch.notes });
	}
	if (changed.length === 0) return { updated: true };
	const batchId = writeTx(h.db, (tx) => {
		tx.update(relationships)
			.set({
				...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
				...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
				...(patch.notes !== undefined ? { notes: patch.notes } : {})
			})
			.where(eq(relationships.id, linkId))
			.run();
		let batch: string | undefined;
		for (const c of changed) {
			batch = writeHistory(tx, {
				treeId: row.treeId,
				entityType: 'relationship',
				entityId: linkId,
				changedBy: actorId,
				action: 'update',
				field: c.field,
				oldValue: c.oldValue,
				newValue: c.newValue,
				batchId: batch
			});
		}
		for (const pid of [row.person1Id, row.person2Id]) notifyEdit(tx, { treeId: row.treeId, personId: pid, actorId });
		return batch;
	});
	return { updated: true, batchId };
}

export function deleteLink(h: Handles, actorId: string, linkId: string): { deleted: true; batchId: string } | { error: 'NOT_FOUND' } {
	const row = h.db.select().from(relationships).where(eq(relationships.id, linkId)).get();
	if (!row) return { error: 'NOT_FOUND' };
	const batchId = writeTx(h.db, (tx) => {
		tx.delete(relationships).where(eq(relationships.id, linkId)).run();
		const b = writeHistory(tx, {
			treeId: row.treeId,
			entityType: 'relationship',
			entityId: linkId,
			changedBy: actorId,
			action: 'delete',
			snapshot: row
		});
		for (const pid of [row.person1Id, row.person2Id]) notifyEdit(tx, { treeId: row.treeId, personId: pid, actorId });
		return b;
	});
	return { deleted: true, batchId };
}
