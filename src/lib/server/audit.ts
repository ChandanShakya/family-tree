import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { or } from 'drizzle-orm';
import { events, media, persons, relationships } from '$lib/db/schema.js';
import { changeHistory } from '$lib/db/schema.js';
import { newBatchId, type Db } from './tx.js';

export type EntityType = 'person' | 'relationship' | 'event' | 'media' | 'tree';

interface HistoryInput {
	treeId: string;
	entityType: EntityType;
	entityId: string;
	changedBy: string;
	action: 'create' | 'update' | 'delete' | 'revert' | 'claim';
	field?: string | null;
	oldValue?: unknown;
	newValue?: unknown;
	snapshot?: unknown;
	batchId?: string;
	note?: string | null;
	revertedFrom?: string | null;
}

function now(): string {
	return new Date().toISOString();
}

function json(v: unknown): string | null {
	return v === undefined || v === null ? null : JSON.stringify(v);
}

function newId(): string {
	return randomUUID();
}

export function writeHistory(db: Db, input: HistoryInput): string {
	const batchId = input.batchId ?? newBatchId();
	db.insert(changeHistory)
		.values({
			id: newId(),
			treeId: input.treeId,
			entityType: input.entityType,
			entityId: input.entityId,
			changedBy: input.changedBy,
			changedAt: now(),
			action: input.action,
			field: input.field ?? null,
			oldValue: json(input.oldValue),
			newValue: json(input.newValue),
			snapshot: json(input.snapshot),
			batchId,
			note: input.note ?? null,
			revertedFrom: input.revertedFrom ?? null
		})
		.run();
	return batchId;
}

/** Snapshot for a revertible person delete: full row + dependent rows (§5.1). */
export function personDeleteSnapshot(db: Db, personId: string): Record<string, unknown> {
	const person = db.select().from(persons).where(eq(persons.id, personId)).get();
	const personEvents = db.select().from(events).where(eq(events.personId, personId)).all();
	const personMedia = db.select().from(media).where(eq(media.personId, personId)).all();
	const links = db
		.select()
		.from(relationships)
		.where(or(eq(relationships.person1Id, personId), eq(relationships.person2Id, personId)))
		.all();
	return { person, relationships: links, events: personEvents, media: personMedia };
}
