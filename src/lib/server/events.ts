import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { events } from '$lib/db/schema.js';
import { writeHistory } from './audit.js';
import { parseDate } from '$lib/utils/dates.js';
import { notifyEdit } from './notifications.js';
import { writeTx, type Handles } from './tx.js';

function newId(): string {
	return randomUUID();
}

export interface EventInput {
	personId: string;
	type: string;
	date?: string;
	dateCal?: 'AD' | 'BS';
	place?: string;
	description?: string;
}

function visiblePerson(h: Handles, treeId: string, id: string): boolean {
	const r = h.raw.prepare(`SELECT id FROM visible_persons WHERE id = ? AND treeId = ?`).get(id, treeId) as
		| { id: string }
		| undefined;
	return Boolean(r);
}

/** Any non-viewer may add or edit (route gates `add`); delete needs `delete`. */
export function createEvent(
	h: Handles,
	actorId: string,
	treeId: string,
	input: EventInput
): { id: string; batchId: string } | { error: 'NOT_FOUND' } {
	if (!visiblePerson(h, treeId, input.personId)) return { error: 'NOT_FOUND' };
	const id = newId();
	const now = new Date().toISOString();
	const dateNorm = input.date
		? (parseDate(input.date, input.dateCal ?? 'AD').norm ?? null)
		: null;
	const batchId = writeTx(h.db, (tx) => {
		tx.insert(events)
			.values({
				id,
				personId: input.personId,
				treeId,
				type: input.type,
				date: input.date ?? null,
				dateCal: input.dateCal ?? 'AD',
				dateNorm,
				place: input.place ?? null,
				description: input.description ?? null,
				createdAt: now
			})
			.run();
		const b = writeHistory(tx, {
			treeId,
			entityType: 'event',
			entityId: id,
			changedBy: actorId,
			action: 'create'
		});
		notifyEdit(tx, { treeId, personId: input.personId, actorId });
		return b;
	});
	return { id, batchId };
}

export function updateEvent(
	h: Handles,
	actorId: string,
	eventId: string,
	patch: { type?: string; date?: string | null; dateCal?: 'AD' | 'BS'; place?: string | null; description?: string | null }
): { updated: true; batchId?: string } | { error: 'NOT_FOUND' } {
	const row = h.db.select().from(events).where(eq(events.id, eventId)).get();
	if (!row) return { error: 'NOT_FOUND' };
	const changed: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
	const next: Record<string, unknown> = {};
	if (patch.type !== undefined && patch.type !== row.type) {
		changed.push({ field: 'type', oldValue: row.type, newValue: patch.type });
		next.type = patch.type;
	}
	if (patch.date !== undefined || patch.dateCal !== undefined) {
		const date = patch.date !== undefined ? patch.date : row.date;
		const cal = patch.dateCal ?? (row.dateCal === 'BS' ? 'BS' : 'AD');
		const norm = date ? (parseDate(date, cal as 'AD' | 'BS').norm ?? null) : null;
		if ((patch.date !== undefined && (patch.date ?? null) !== row.date) || norm !== row.dateNorm) {
			if (patch.date !== undefined) {
				changed.push({ field: 'date', oldValue: row.date, newValue: patch.date });
				next.date = patch.date;
			}
			if (norm !== row.dateNorm) {
				changed.push({ field: 'dateNorm', oldValue: row.dateNorm, newValue: norm });
				next.dateNorm = norm;
			}
		}
		if (patch.dateCal !== undefined && patch.dateCal !== row.dateCal) {
			changed.push({ field: 'dateCal', oldValue: row.dateCal, newValue: patch.dateCal });
			next.dateCal = patch.dateCal;
		}
	}
	if (patch.place !== undefined && (patch.place ?? null) !== row.place) {
		changed.push({ field: 'place', oldValue: row.place, newValue: patch.place });
		next.place = patch.place;
	}
	if (patch.description !== undefined && (patch.description ?? null) !== row.description) {
		changed.push({ field: 'description', oldValue: row.description, newValue: patch.description });
		next.description = patch.description;
	}
	if (changed.length === 0) return { updated: true };
	const batchId = writeTx(h.db, (tx) => {
		tx.update(events).set(next).where(eq(events.id, eventId)).run();
		let batch: string | undefined;
		for (const c of changed) {
			batch = writeHistory(tx, {
				treeId: row.treeId,
				entityType: 'event',
				entityId: eventId,
				changedBy: actorId,
				action: 'update',
				field: c.field,
				oldValue: c.oldValue,
				newValue: c.newValue,
				batchId: batch
			});
		}
		notifyEdit(tx, { treeId: row.treeId, personId: row.personId, actorId });
		return batch;
	});
	return { updated: true, batchId };
}

export function deleteEvent(
	h: Handles,
	actorId: string,
	eventId: string
): { deleted: true; batchId: string } | { error: 'NOT_FOUND' } {
	const row = h.db.select().from(events).where(eq(events.id, eventId)).get();
	if (!row) return { error: 'NOT_FOUND' };
	const batchId = writeTx(h.db, (tx) => {
		tx.delete(events).where(eq(events.id, eventId)).run();
		const b = writeHistory(tx, {
			treeId: row.treeId,
			entityType: 'event',
			entityId: eventId,
			changedBy: actorId,
			action: 'delete',
			snapshot: row
		});
		notifyEdit(tx, { treeId: row.treeId, personId: row.personId, actorId });
		return b;
	});
	return { deleted: true, batchId };
}
