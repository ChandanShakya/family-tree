import type { PageServerLoad } from './$types';
import { listClaims } from '$lib/server/claims.js';
import { withTree } from '$lib/server/page-load.js';

// Owner/editor review queue; the same access rule as GET /api/claims (action `review`).
export const load: PageServerLoad = ({ locals, params }) => ({
	treeId: params.id,
	claims: withTree(locals, params.id, 'review', (c) => listClaims(c.db, params.id)),
	people: withTree(locals, params.id, 'review', (c) =>
		(c.raw.prepare(`SELECT id, firstName, lastName FROM visible_persons WHERE treeId = ? ORDER BY firstName LIMIT 500`).all(params.id) as Array<{ id: string; firstName: string; lastName: string | null }>)
	)
});
