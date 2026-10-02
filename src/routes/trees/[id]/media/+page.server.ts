import type { PageServerLoad } from './$types';
import { listTreeMedia } from '$lib/server/media.js';
import { withTree } from '$lib/server/page-load.js';

export const load: PageServerLoad = ({ locals, params, url }) => ({
	treeId: params.id,
	page: withTree(locals, params.id, 'view', (c) =>
		listTreeMedia(c, params.id, url.searchParams.get('cursor') ?? undefined)
	)
});
