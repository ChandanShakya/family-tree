import type { PageServerLoad } from './$types';
import { listMembers } from '$lib/server/members.js';
import { withTree } from '$lib/server/page-load.js';

export const load: PageServerLoad = ({ locals, params }) => ({
	treeId: params.id,
	members: withTree(locals, params.id, 'view', (c) => listMembers(c.db, params.id))
});
