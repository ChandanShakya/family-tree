import { existsSync } from 'node:fs';
import { and, asc, eq, or } from 'drizzle-orm';
import { CONTRIBUTOR_REVERT_OWN_ONLY } from '$lib/config.js';
import { changeHistory, events, media, persons, relationships } from '$lib/db/schema.js';
import { parseDate } from '$lib/utils/dates.js';
import { newBatchId, writeTx, type Db, type Handles } from './tx.js';
import { writeHistory } from './audit.js';
import { wouldCreateCycle, wouldExceedDepth } from './graph.js';
import { notifyEdit } from './notifications.js';
import { requireTreeAccess } from './permissions.js';
import { absPath, deleteFiles, photoUrl } from './storage.js';

// §5.1 revert. One request is one immediate transaction: every row is checked
// first (stale rule, integrity, permission); nothing is written unless all pass.

export type RevertErrorCode =
	| 'NOT_FOUND'
	| 'FORBIDDEN'
	| 'STALE_REVERT'
	| 'REVERT_CONFLICT'
	| 'NOT_REVERTIBLE'
	| 'PURGED';

export interface StaleConflict {
	historyId: string;
	field: string;
	current: unknown;
}

export type RevertResult =
	| { ok: true; batchId: string; reverted: number }
	| { ok: false; code: RevertErrorCode; message: string; conflicts?: StaleConflict[]; current?: unknown };

type Row = typeof changeHistory.$inferSelect;

class Fail extends Error {
	constructor(readonly result: Extract<RevertResult, { ok: false }>) {
		super(result.code);
	}
}
const fail = (code: RevertErrorCode, message: string): never => {
	throw new Fail({ ok: false, code, message });
};

// Whitelisted columns per entity. `derived` ones are recomputed, never reverted by themselves.
const FIELDS: Record<string, { table: string; editable: string[]; derived: string[] }> = {
	person: {
		table: 'persons',
		editable: ['firstName', 'middleName', 'lastName', 'maidenName', 'birthDate', 'birthDateCal', 'deathDate', 'deathDateCal', 'gender', 'birthPlace', 'deathPlace', 'bio', 'isLiving', 'photoUrl'],
		derived: ['birthDateNorm', 'deathDateNorm']
	},
	relationship: { table: 'relationships', editable: ['startDate', 'endDate', 'notes'], derived: [] },
	event: { table: 'events', editable: ['type', 'date', 'dateCal', 'place', 'description'], derived: ['dateNorm'] }
};

// text/cal columns whose Norm is recomputed after a revert
const NORMS: Record<string, Array<{ text: string; cal: string; norm: string }>> = {
	person: [
		{ text: 'birthDate', cal: 'birthDateCal', norm: 'birthDateNorm' },
		{ text: 'deathDate', cal: 'deathDateCal', norm: 'deathDateNorm' }
	],
	event: [{ text: 'date', cal: 'dateCal', norm: 'dateNorm' }]
};

const parse = (v: string | null): unknown => (v === null ? null : JSON.parse(v));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Check permission per row: contributors may revert only their own changes (§4). */
function allowed(db: Db, userId: string, treeId: string, r: Row): 'ok' | 'forbidden' | 'hidden' {
	const a = requireTreeAccess(db, userId, treeId, 'revert', {
		authorUserId: CONTRIBUTOR_REVERT_OWN_ONLY ? (r.changedBy ?? undefined) : userId
	});
	return a.ok ? 'ok' : a.status === 404 ? 'hidden' : 'forbidden';
}

function rowsFor(db: Db, target: { historyId?: string; batchId?: string }): Row[] {
	if (target.historyId) {
		return db.select().from(changeHistory).where(eq(changeHistory.id, target.historyId)).all();
	}
	return db.select().from(changeHistory).where(eq(changeHistory.batchId, target.batchId ?? '')).orderBy(asc(changeHistory.changedAt), asc(changeHistory.id)).all();
}

function currentRow(raw: Handles['raw'], entity: string, id: string): Record<string, unknown> | undefined {
	const f = FIELDS[entity];
	if (!f) return undefined;
	return raw.prepare(`SELECT * FROM ${f.table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

export function revertHistory(
	h: Handles,
	userId: string,
	target: { historyId?: string; batchId?: string },
	force = false,
	now = new Date()
): RevertResult {
	// Files are named inside the transaction and removed only after it commits (§6.7).
	const filesToDelete: string[] = [];
	try {
		const result = writeTx(h.db, (tx): RevertResult => {
			const rows = rowsFor(tx, target);
			if (rows.length === 0) return { ok: false, code: 'NOT_FOUND', message: 'Not found' };
			const treeId = rows[0]!.treeId;
			if (rows.some((r) => r.treeId !== treeId)) return fail('NOT_FOUND', 'Not found');
			for (const r of rows) {
				const a = allowed(tx, userId, treeId, r);
				if (a === 'hidden') return { ok: false, code: 'NOT_FOUND', message: 'Not found' };
				if (a === 'forbidden') return { ok: false, code: 'FORBIDDEN', message: 'You can only revert your own changes' };
			}
			const stamp = now.toISOString();
			const batchId = newBatchId();
			const stale: StaleConflict[] = [];
			const touchedPersons = new Set<string>();
			const plans: Array<() => void> = [];
			const single = rows.length === 1;

			for (const r of rows) {
				if (r.action === 'claim' || r.entityType === 'tree') return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
				if (r.entityType === 'media' && (r.action === 'update' || r.action === 'revert') && r.field !== 'caption' && r.field !== 'primary') {
					return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
				}
				if (r.action === 'update' || (r.action === 'revert' && r.field)) {
					planUpdate(h, tx, r, { single, force, stale, plans, batchId, userId, stamp, touchedPersons });
				} else if (r.action === 'create') {
					planUndoCreate(h, tx, r, { plans, batchId, userId, stamp, filesToDelete, touchedPersons });
				} else if (r.action === 'delete') {
					planRestore(h, tx, r, { plans, batchId, userId, stamp, touchedPersons });
				} else {
					return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
				}
			}

			if (stale.length > 0 && !force) {
				return {
					ok: false,
					code: 'STALE_REVERT',
					message: 'The value changed since this edit',
					conflicts: stale,
					current: stale.length === 1 ? stale[0]!.current : undefined
				};
			}
			for (const p of plans) p();
			for (const r of rows) {
				tx.update(changeHistory).set({ isReverted: 1, revertedBy: userId, revertedAt: stamp }).where(eq(changeHistory.id, r.id)).run();
			}
			for (const pid of touchedPersons) notifyEdit(tx, { treeId, personId: pid, actorId: userId }, now);
			return { ok: true, batchId, reverted: rows.length };
		});
		if (result.ok) deleteFiles(filesToDelete);
		return result;
	} catch (e) {
		if (e instanceof Fail) return e.result;
		throw e;
	}
}

interface Ctx {
	plans: Array<() => void>;
	batchId: string;
	userId: string;
	stamp: string;
	touchedPersons: Set<string>;
}

function planUpdate(
	h: Handles,
	tx: Db,
	r: Row,
	c: Ctx & { single: boolean; force: boolean; stale: StaleConflict[] }
): void {
	const f = FIELDS[r.entityType];
	const field = r.field ?? '';
	if (r.entityType === 'media') return planMedia(h, tx, r, c);
	if (!f) return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
	if (f.derived.includes(field)) {
		// A Norm follows its date text; alone it is not meaningful to revert.
		if (c.single) fail('NOT_REVERTIBLE', 'This value is derived; revert the date instead');
		return;
	}
	if (!f.editable.includes(field)) return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
	const cur = currentRow(h.raw, r.entityType, r.entityId);
	if (!cur || (r.entityType === 'person' && cur.deletedAt)) return fail('REVERT_CONFLICT', 'The item no longer exists');
	const current = cur[field] ?? null;
	if (!same(current, parse(r.newValue))) c.stale.push({ historyId: r.id, field, current });
	c.plans.push(() => {
		const oldValue = parse(r.oldValue);
		h.raw.prepare(`UPDATE ${f.table} SET ${field} = ? WHERE id = ?`).run(oldValue, r.entityId);
		writeHistory(tx, {
			treeId: r.treeId,
			entityType: r.entityType as 'person',
			entityId: r.entityId,
			changedBy: c.userId,
			action: 'revert',
			field,
			oldValue: current,
			newValue: oldValue,
			batchId: c.batchId,
			revertedFrom: r.id
		});
		// Keep Norm columns consistent with the text/calendar just restored.
		for (const n of NORMS[r.entityType] ?? []) {
			if (field !== n.text && field !== n.cal) continue;
			const row = currentRow(h.raw, r.entityType, r.entityId)!;
			const text = row[n.text] as string | null;
			const norm = text ? (parseDate(text, row[n.cal] === 'BS' ? 'BS' : 'AD').norm ?? null) : null;
			if (norm !== (row[n.norm] ?? null)) {
				h.raw.prepare(`UPDATE ${f.table} SET ${n.norm} = ? WHERE id = ?`).run(norm, r.entityId);
				writeHistory(tx, { treeId: r.treeId, entityType: r.entityType as 'person', entityId: r.entityId, changedBy: c.userId, action: 'revert', field: n.norm, oldValue: row[n.norm] ?? null, newValue: norm, batchId: c.batchId, revertedFrom: r.id });
			}
		}
		if (r.entityType === 'person') {
			h.raw.prepare(`UPDATE persons SET version = version + 1, updatedAt = ?, lastEditedBy = ? WHERE id = ?`).run(c.stamp, c.userId, r.entityId);
			c.touchedPersons.add(r.entityId);
		}
	});
}

function planMedia(h: Handles, tx: Db, r: Row, c: Ctx & { stale: StaleConflict[] }): void {
	const m = tx.select().from(media).where(eq(media.id, r.entityId)).get();
	if (!m) return fail('REVERT_CONFLICT', 'The photo no longer exists');
	if (r.field === 'caption') {
		if (!same(m.caption ?? null, parse(r.newValue))) c.stale.push({ historyId: r.id, field: 'caption', current: m.caption });
		c.plans.push(() => {
			const old = parse(r.oldValue);
			tx.update(media).set({ caption: old as string | null }).where(eq(media.id, r.entityId)).run();
			writeHistory(tx, { treeId: r.treeId, entityType: 'media', entityId: r.entityId, changedBy: c.userId, action: 'revert', field: 'caption', oldValue: m.caption, newValue: old, batchId: c.batchId, revertedFrom: r.id });
		});
		return;
	}
	// "primary": the person's profile photo points at this file; revert clears it.
	const p = m.personId ? tx.select().from(persons).where(eq(persons.id, m.personId)).get() : undefined;
	const isPrimary = p?.photoUrl === photoUrl(m.storagePath);
	if (!isPrimary) c.stale.push({ historyId: r.id, field: 'primary', current: false });
	c.plans.push(() => {
		if (!p) return;
		tx.update(persons).set({ photoUrl: null }).where(eq(persons.id, p.id)).run();
		writeHistory(tx, { treeId: r.treeId, entityType: 'media', entityId: r.entityId, changedBy: c.userId, action: 'revert', field: 'primary', oldValue: true, newValue: false, batchId: c.batchId, revertedFrom: r.id });
	});
}

/** Undo a create: persons are soft-deleted, other rows deleted (files after commit). */
function planUndoCreate(h: Handles, tx: Db, r: Row, c: Ctx & { filesToDelete: string[] }): void {
	if (r.entityType === 'person') {
		const p = tx.select().from(persons).where(eq(persons.id, r.entityId)).get();
		if (!p || p.deletedAt) return fail('REVERT_CONFLICT', 'The person is already deleted');
		c.plans.push(() => {
			const snapshot = personSnapshot(tx, r.entityId);
			tx.update(persons).set({ deletedAt: c.stamp }).where(eq(persons.id, r.entityId)).run();
			writeHistory(tx, { treeId: r.treeId, entityType: 'person', entityId: r.entityId, changedBy: c.userId, action: 'delete', snapshot, batchId: c.batchId, revertedFrom: r.id });
		});
		return;
	}
	const table = r.entityType === 'relationship' ? relationships : r.entityType === 'event' ? events : r.entityType === 'media' ? media : null;
	if (!table) return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
	const row = tx.select().from(table).where(eq(table.id, r.entityId)).get() as Record<string, unknown> | undefined;
	if (!row) return fail('REVERT_CONFLICT', 'The item is already deleted');
	c.plans.push(() => {
		tx.delete(table).where(eq(table.id, r.entityId)).run();
		if (r.entityType === 'media') {
			c.filesToDelete.push(row.storagePath as string);
			if (row.thumbPath) c.filesToDelete.push(row.thumbPath as string);
			if (row.personId) tx.update(persons).set({ photoUrl: null }).where(and(eq(persons.id, row.personId as string), eq(persons.photoUrl, photoUrl(row.storagePath as string)))).run();
		}
		writeHistory(tx, { treeId: r.treeId, entityType: r.entityType as 'event', entityId: r.entityId, changedBy: c.userId, action: 'delete', snapshot: row, batchId: c.batchId, revertedFrom: r.id });
	});
}

function personSnapshot(db: Db, id: string) {
	return {
		person: db.select().from(persons).where(eq(persons.id, id)).get(),
		relationships: db.select().from(relationships).where(or(eq(relationships.person1Id, id), eq(relationships.person2Id, id))).all(),
		events: db.select().from(events).where(eq(events.personId, id)).all(),
		media: db.select().from(media).where(eq(media.personId, id)).all()
	};
}

/** Link integrity before re-inserting a relationship (§5.1): endpoints visible, no duplicate, no cycle, depth. */
function checkLink(h: Handles, tx: Db, l: typeof relationships.$inferSelect, treeId: string): string | null {
	const visible = (id: string) => h.raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ? AND treeId = ?`).get(id, treeId) !== undefined;
	if (!visible(l.person1Id) || !visible(l.person2Id)) return 'one of the people was deleted';
	const dup = tx
		.select({ id: relationships.id })
		.from(relationships)
		.where(and(eq(relationships.person1Id, l.person1Id), eq(relationships.person2Id, l.person2Id), eq(relationships.type, l.type)))
		.get();
	if (dup) return 'the link already exists';
	if (l.type === 'parent') {
		if (wouldCreateCycle(h.raw, treeId, l.person1Id, l.person2Id)) return 'the link would create a cycle';
		if (wouldExceedDepth(h.raw, treeId, l.person1Id, l.person2Id)) return 'the link would make the tree too deep';
	}
	return null;
}

function planRestore(h: Handles, tx: Db, r: Row, c: Ctx): void {
	// A purged person's history has no snapshot left: say "purged", not "not revertible".
	const p = r.entityType === 'person' ? tx.select().from(persons).where(eq(persons.id, r.entityId)).get() : undefined;
	if (r.entityType === 'person' && !p) return fail('PURGED', 'This person was permanently removed');
	const snap = r.snapshot ? (JSON.parse(r.snapshot) as Record<string, unknown>) : null;
	if (!snap) return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
	if (r.entityType === 'person' && p) {
		if (!p.deletedAt) return fail('REVERT_CONFLICT', 'The person is not deleted');
		const links = (snap.relationships as Array<typeof relationships.$inferSelect> | undefined) ?? [];
		const evs = (snap.events as Array<typeof events.$inferSelect> | undefined) ?? [];
		const photos = (snap.media as Array<typeof media.$inferSelect> | undefined) ?? [];
		// Everything is checked before anything is written; restored rows must pass the same integrity rules.
		const toLink: typeof links = [];
		for (const l of links) {
			if (tx.select({ id: relationships.id }).from(relationships).where(eq(relationships.id, l.id)).get()) continue;
			const other = l.person1Id === r.entityId ? l.person2Id : l.person1Id;
			const o = tx.select({ d: persons.deletedAt }).from(persons).where(eq(persons.id, other)).get();
			if (!o || o.d) continue; // the other end is gone: that link cannot come back, the rest still can
			toLink.push(l);
		}
		c.plans.push(() => {
			tx.update(persons).set({ deletedAt: null, version: p.version + 1, updatedAt: c.stamp, lastEditedBy: c.userId }).where(eq(persons.id, r.entityId)).run();
			for (const l of toLink) {
				const why = checkLink(h, tx, l, r.treeId);
				if (why) fail('REVERT_CONFLICT', `Cannot restore a relationship: ${why}`);
				tx.insert(relationships).values(l).run();
			}
			for (const e of evs) {
				if (!tx.select({ id: events.id }).from(events).where(eq(events.id, e.id)).get()) tx.insert(events).values(e).run();
			}
			for (const m of photos) {
				if (!tx.select({ id: media.id }).from(media).where(eq(media.id, m.id)).get() && existsSync(absPath(m.storagePath))) tx.insert(media).values(m).run();
			}
			writeHistory(tx, { treeId: r.treeId, entityType: 'person', entityId: r.entityId, changedBy: c.userId, action: 'revert', newValue: { restored: true }, batchId: c.batchId, revertedFrom: r.id });
			c.touchedPersons.add(r.entityId);
		});
		return;
	}
	if (r.entityType === 'relationship') {
		const l = snap as unknown as typeof relationships.$inferSelect;
		const why = checkLink(h, tx, l, r.treeId);
		if (why) return fail('REVERT_CONFLICT', `Cannot restore the relationship: ${why}`);
		c.plans.push(() => {
			tx.insert(relationships).values(l).run();
			writeHistory(tx, { treeId: r.treeId, entityType: 'relationship', entityId: r.entityId, changedBy: c.userId, action: 'revert', newValue: { restored: true }, batchId: c.batchId, revertedFrom: r.id });
		});
		return;
	}
	if (r.entityType === 'event') {
		const e = snap as unknown as typeof events.$inferSelect;
		if (!h.raw.prepare(`SELECT 1 FROM visible_persons WHERE id = ? AND treeId = ?`).get(e.personId, r.treeId)) return fail('REVERT_CONFLICT', 'The person was deleted');
		if (tx.select({ id: events.id }).from(events).where(eq(events.id, e.id)).get()) return fail('REVERT_CONFLICT', 'The event already exists');
		c.plans.push(() => {
			tx.insert(events).values(e).run();
			writeHistory(tx, { treeId: r.treeId, entityType: 'event', entityId: r.entityId, changedBy: c.userId, action: 'revert', newValue: { restored: true }, batchId: c.batchId, revertedFrom: r.id });
		});
		return;
	}
	if (r.entityType === 'media') return fail('REVERT_CONFLICT', 'The photo file was removed and cannot be restored');
	return fail('NOT_REVERTIBLE', 'This change cannot be reverted');
}

