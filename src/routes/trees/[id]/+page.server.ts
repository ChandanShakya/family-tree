import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { publicTreeView } from '$lib/server/public-access.js';
import { getTreeView } from '$lib/server/trees.js';
import { withPublicRead } from '$lib/server/page-load.js';

// Members get the full (bounded) view; anyone else gets a public tree through the privacy filter.
export const load: PageServerLoad = ({ locals, params, url }) => {
	const depthRaw = Number(url.searchParams.get('depth'));
	return withPublicRead(locals, params.id, url.pathname, (c, mode) => {
		const view = getTreeView(c, params.id, {
			focus: url.searchParams.get('focus') ?? undefined,
			depth: Number.isFinite(depthRaw) && depthRaw > 0 ? depthRaw : undefined,
			userId: c.userId ?? undefined
		});
		if (!view) error(404, 'Not found');
		return { treeId: params.id, view: mode === 'public' ? publicTreeView(view) : view, publicView: mode === 'public' };
	});
};
