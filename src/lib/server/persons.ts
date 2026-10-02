import { randomUUID } from 'node:crypto';
import { describeRows } from './activity.js';
import { and, eq } from 'drizzle-orm';
import { events, media, persons } from '$lib/db/schema.js';
import type { HistoryEntry } from '$lib/types.js';
import { personDeleteSnapshot, writeHistory } from './audit.js';
import { parseDate } from '$lib/utils/dates.js';
import { notifyEdit } from './notifications.js';
import { writeTx, type Handles } from './tx.js';

function newId(): string {
	return randomUUID();
}

export interface PersonInput {
	firstName: string;
	middleName?: string;
	lastName?: string;
	maidenName?: string;
	birthDate?: string;
	birthDateCal?: 'AD' | 'BS';
	deathDate?: string;
	deathDateCal?: 'AD' | 'BS';
	gender?: string;
	birthPlace?: string;
	deathPlace?: string;
	bio?: string;
	isLiving?: boolean | null;
}

function norms(input: PersonInput): { birthDateNorm: string | null; deathDateNorm: string | null } {
	const birthDateNorm = input.birthDate
		? (parseDate(input.birthDate, input.birthDateCal ?? 'AD').norm ?? null)
		: null;
	const deathDateNorm = input.deathDate
		? (parseDate(input.deathDate, input.deathDateCal ?? 'AD').norm ?? null)
		: null;
	return { birthDateNorm, deathDateNorm };
}

const AUDIT_FIELDS = [
	'firstName',
	'middleName',
	'lastName',
	'maidenName',
	'birthDate',
	'birthDateCal',
	'birthDateNorm',
	'deathDate',
	'deathDateCal',
	'deathDateNorm',
	'gender',
	'birthPlace',
	'deathPlace',
	'bio',
	'isLiving',
	'photoUrl'
] as const;

function toStoredIsLiving(v: boolean | null | undefined): number | null {
	if (v === undefined) return null;
	if (v === null) return null;
	return v ? 1 : 0;
}

function storedCal(v: unknown): 'AD' | 'BS' {
	return v === 'BS' ? 'BS' : 'AD';
}

export function createPerson(
	h: Handles,
	actorId: string,
	treeId: string,
	input: PersonInput
): { id: string; batchId: string } {
	const now = new Date().toISOString();
	const id = newId();
	const { birthDateNorm, deathDateNorm } = norms(input);
	const batchId = writeTx(h.db, (tx) => {
		tx.insert(persons)
			.values({
				id,
				treeId,
				firstName: input.firstName,
				lastName: input.lastName ?? null,
				middleName: input.middleName ?? null,
				maidenName: input.maidenName ?? null,
				birthDate: input.birthDate ?? null,
				birthDateCal: input.birthDateCal ?? 'AD',
				birthDateNorm,
				deathDate: input.deathDate ?? null,
				deathDateCal: input.deathDateCal ?? 'AD',
				deathDateNorm,
				gender: input.gender ?? 'U',
				birthPlace: input.birthPlace ?? null,
				deathPlace: input.deathPlace ?? null,
				bio: input.bio ?? null,
				isLiving: toStoredIsLiving(input.isLiving),
				createdBy: actorId,
				lastEditedBy: actorId,
				version: 1,
				createdAt: now,
				updatedAt: now
			})
			.run();
		return writeHistory(tx, {
			treeId,
			entityType: 'person',
			entityId: id,
			changedBy: actorId,
			action: 'create'
		});
	});
	return { id, batchId };
}

export interface PersonRow {
	id: string;
	treeId: string;
	version: number;
	firstName: string;
	lastName: string | null;
	photoUrl: string | null;
	userId: string | null;
	birthDate: string | null;
	birthDateCal: string;
	deathDate: string | null;
	deathDateCal: string;
	[k: string]: unknown;
}

export function getPerson(h: Handles, personId: string) {
	const row = h.raw.prepare(`SELECT * FROM visible_persons WHERE id = ?`).get(personId) as PersonRow | null;
	if (!row) return null;
	const personEvents = h.db.select().from(events).where(eq(events.personId, personId)).all();
	const personMedia = h.db.select().from(media).where(eq(media.personId, personId)).all();
	return { ...row, events: personEvents, media: personMedia };
}

export type UpdateResult =
	| { updated: true; version: number; batchId?: string }
	| { error: 'NOT_FOUND' }
	| { error: 'VERSION_CONFLICT'; current: Record<string, unknown> };

/** Optimistic-lock update: one history row per changed field, shared batchId. */
export function updatePerson(
	h: Handles,
	actorId: string,
	personId: string,
	version: number,
	input: Partial<PersonInput>
): UpdateResult {
	const current = h.raw.prepare(`SELECT * FROM visible_persons WHERE id = ?`).get(personId) as Record<
		string,
		unknown
	> | null;
	if (!current) return { error: 'NOT_FOUND' };
	if (current.version !== version) return { error: 'VERSION_CONFLICT', current };
	const patch: Record<string, unknown> = {};
	if (input.firstName !== undefined) patch.firstName = input.firstName;
	if (input.middleName !== undefined) patch.middleName = input.middleName;
	if (input.lastName !== undefined) patch.lastName = input.lastName;
	if (input.maidenName !== undefined) patch.maidenName = input.maidenName;
	if (input.birthDate !== undefined) {
		patch.birthDate = input.birthDate;
		const cal = input.birthDateCal ?? storedCal(current.birthDateCal);
		patch.birthDateNorm = input.birthDate ? (parseDate(input.birthDate, cal).norm ?? null) : null;
	}
	if (input.birthDateCal !== undefined) {
		patch.birthDateCal = input.birthDateCal;
		if (input.birthDate === undefined && current.birthDate) {
			patch.birthDateNorm =
				parseDate(current.birthDate as string, input.birthDateCal).norm ?? null;
		}
	}
	if (input.deathDate !== undefined) {
		patch.deathDate = input.deathDate;
		const cal = input.deathDateCal ?? storedCal(current.deathDateCal);
		patch.deathDateNorm = input.deathDate ? (parseDate(input.deathDate, cal).norm ?? null) : null;
	}
	if (input.deathDateCal !== undefined) {
		patch.deathDateCal = input.deathDateCal;
		if (input.deathDate === undefined && current.deathDate) {
			patch.deathDateNorm =
				parseDate(current.deathDate as string, input.deathDateCal).norm ?? null;
		}
	}
	if (input.gender !== undefined) patch.gender = input.gender;
	if (input.birthPlace !== undefined) patch.birthPlace = input.birthPlace;
	if (input.deathPlace !== undefined) patch.deathPlace = input.deathPlace;
	if (input.bio !== undefined) patch.bio = input.bio;
	if (input.isLiving !== undefined) patch.isLiving = toStoredIsLiving(input.isLiving);
	const changed = AUDIT_FIELDS.filter(
		(f) => f in patch && (patch[f] ?? null) !== (current[f] ?? null)
	);
	if (changed.length === 0) return { updated: true, version: version as number };
	const now = new Date().toISOString();
	const nextVersion = (version as number) + 1;
	const res = writeTx(h.db, (tx) => {
		const n = tx
			.update(persons)
			.set({ ...patch, lastEditedBy: actorId, version: nextVersion, updatedAt: now })
			.where(and(eq(persons.id, personId), eq(persons.version, version)))
			.run().changes;
		if (n !== 1) return { conflict: true as const };
		const batchId = (() => {
			let first: string | null = null;
			for (const field of changed) {
				first = writeHistory(tx, {
					treeId: current.treeId as string,
					entityType: 'person',
					entityId: personId,
					changedBy: actorId,
					action: 'update',
					field,
					oldValue: (current[field] ?? null) as unknown,
					newValue: (patch[field] ?? null) as unknown,
					batchId: first ?? undefined
				});
			}
			return first as string;
		})();
		notifyEdit(tx, { treeId: current.treeId as string, personId, actorId });
		return { conflict: false as const, batchId };
	});
	if (res.conflict) {
		const fresh = h.raw.prepare(`SELECT * FROM visible_persons WHERE id = ?`).get(personId) as Record<
			string,
			unknown
		> | null;
		if (!fresh) return { error: 'NOT_FOUND' };
		return { error: 'VERSION_CONFLICT', current: fresh };
	}
	return { updated: true, version: nextVersion, batchId: res.batchId };
}

/** Soft delete with a revertible snapshot. No history rows on version conflict. */
export function deletePerson(
	h: Handles,
	actorId: string,
	personId: string
): { deleted: true; batchId: string } | { error: 'NOT_FOUND' } {
	const current = h.raw.prepare(`SELECT * FROM visible_persons WHERE id = ?`).get(personId) as Record<
		string,
		unknown
	> | null;
	if (!current) return { error: 'NOT_FOUND' };
	const now = new Date().toISOString();
	const batchId = writeTx(h.db, (tx) => {
		const snapshot = personDeleteSnapshot(tx, personId);
		tx.update(persons).set({ deletedAt: now }).where(eq(persons.id, personId)).run();
		const b = writeHistory(tx, {
			treeId: current.treeId as string,
			entityType: 'person',
			entityId: personId,
			changedBy: actorId,
			action: 'delete',
			snapshot
		});
		notifyEdit(tx, { treeId: current.treeId as string, personId, actorId });
		return b;
	});
	return { deleted: true, batchId };
}

export interface HistoryPage {
	data: HistoryEntry[];
	nextCursor: string | null;
}

function encodeCursor(changedAt: string, id: string): string {
	return Buffer.from(JSON.stringify({ changedAt, id }), 'utf8').toString('base64url');
}

export function personHistory(h: Handles, personId: string, cursor?: string, limit = 50): HistoryPage {
	let decoded: { changedAt: string; id: string } | null = null;
	if (cursor) {
		try {
			const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
				changedAt: string;
				id: string;
			};
			if (typeof v.changedAt === 'string' && typeof v.id === 'string') decoded = v;
		} catch {
			decoded = null;
		}
	}
	const rows = (
		decoded
			? h.raw
					.prepare(
						`SELECT h.*, (SELECT displayName FROM users u WHERE u.id = h.changedBy) AS changedByName FROM changeHistory h WHERE entityType = 'person' AND entityId = ? AND (changedAt < ? OR (changedAt = ? AND id < ?)) ORDER BY changedAt DESC, id DESC LIMIT ?`
					)
					.all(personId, decoded.changedAt, decoded.changedAt, decoded.id, limit + 1)
			: h.raw
					.prepare(
						`SELECT h.*, (SELECT displayName FROM users u WHERE u.id = h.changedBy) AS changedByName FROM changeHistory h WHERE entityType = 'person' AND entityId = ? ORDER BY changedAt DESC, id DESC LIMIT ?`
					)
					.all(personId, limit + 1)
	) as HistoryEntry[];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return {
		data: describeRows(h.raw, page),
		nextCursor:
			rows.length > limit && last ? encodeCursor(last.changedAt as string, last.id as string) : null
	};
}
