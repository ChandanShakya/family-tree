import type { PageServerLoad } from './$types';
import { treeActivity } from '$lib/server/trees.js';
import { withTree } from '$lib/server/page-load.js';

// Pagination is by URL cursor so every page is a normal load.
export const load: PageServerLoad = ({ locals, params, url }) => ({
	treeId: params.id,
	page: withTree(locals, params.id, 'view', (c) =>
		treeActivity(c.raw, params.id, url.searchParams.get('cursor') ?? undefined)
	)
});
