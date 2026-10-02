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
}
