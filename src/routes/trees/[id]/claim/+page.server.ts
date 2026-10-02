import type { PageServerLoad } from './$types';
import { withTree } from '$lib/server/page-load.js';

export const load: PageServerLoad = ({ locals, params }) => ({
	treeId: params.id,
	hasOwn: withTree(locals, params.id, 'view', (c) =>
		c.raw.prepare(`SELECT 1 FROM visible_persons WHERE treeId = ? AND userId = ?`).get(params.id, c.userId) !== undefined
	)
});
