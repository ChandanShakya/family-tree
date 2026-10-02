import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { changeHistory } from '$lib/db/schema.js';
import { RevertSchema } from '$lib/schemas/collab.js';
import { apiError } from '$lib/server/api.js';
import { revertHistory } from '$lib/server/history.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

const STATUS = { NOT_FOUND: 404, FORBIDDEN: 403, STALE_REVERT: 409, REVERT_CONFLICT: 409, NOT_REVERTIBLE: 409, PURGED: 410 } as const;

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const parsed = RevertSchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
		const { historyId, batchId, force } = parsed.data;
		// The tree comes from the row itself; unknown and foreign rows are both 404.
		const row = historyId
			? gate.db.select({ treeId: changeHistory.treeId }).from(changeHistory).where(eq(changeHistory.id, historyId)).get()
			: gate.db.select({ treeId: changeHistory.treeId }).from(changeHistory).where(eq(changeHistory.batchId, batchId ?? '')).get();
		if (!row) return apiError(404, 'NOT_FOUND', 'Not found');
		const g = gateTree(gate, row.treeId, 'view');
		if (g instanceof Response) return g;
		const r = revertHistory(gate, gate.userId, { historyId, batchId }, force === true);
		if (r.ok) return json({ data: { batchId: r.batchId, reverted: r.reverted } });
		return apiError(STATUS[r.code], r.code, r.message, { extra: { conflicts: r.conflicts, current: r.current } });
	} finally {
		gate.release();
	}
};
