import type { PageServerLoad } from './$types';
import { listUserTrees } from '$lib/server/trees.js';
import { withUser } from '$lib/server/page-load.js';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) return { trees: null };
	return { trees: withUser(locals, (c) => listUserTrees(c.db, c.userId)) };
};
