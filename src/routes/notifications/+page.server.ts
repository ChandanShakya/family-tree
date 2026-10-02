import type { PageServerLoad } from './$types';
import { listNotifications } from '$lib/server/notifications.js';
import { withUser } from '$lib/server/page-load.js';

export const load: PageServerLoad = ({ locals, url }) => ({
	page: withUser(locals, (c) => listNotifications(c.db, c.userId, url.searchParams.get('cursor') ?? undefined))
});
