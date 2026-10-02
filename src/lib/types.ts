// Shapes shared by server services and client components (no server imports here).
export interface HistoryEntry {
	id: string;
	changedAt: string;
	action: string;
	entityType: string;
	entityId: string;
	field: string | null;
	oldValue: string | null;
	newValue: string | null;
	batchId: string | null;
	changedBy: string | null;
	changedByName: string | null;
	isReverted: number;
	/** Who or what the change was about, in words (server-filled). */
	subject?: string | null;
	/** Person to link to, when there is one. */
	subjectId?: string | null;
	/** Extra noun, e.g. the event type. */
	detail?: string | null;
}
