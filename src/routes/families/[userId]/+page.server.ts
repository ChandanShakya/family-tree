import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { buildCombined, getSettings, profilesOf, shareCandidates } from '$lib/server/combined.js';
import { withUser } from '$lib/server/page-load.js';

export const load: PageServerLoad = ({ locals, params, url }) =>
	withUser(locals, (c) => {
		const raw = url.searchParams.get('depth');
		const depth = raw && Number.isInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
		const own = c.userId === params.userId;
		const view = buildCombined(c, params.userId, c.userId, depth);
		if (!view) {
			// Your own page explains how it fills in; anyone else's is indistinguishable from missing.
			if (own) return { own, view: null, profiles: profilesOf(c, c.userId), settings: null, candidates: [] };
			error(404, 'Not found');
		}
		const owner = c.raw.prepare(`SELECT displayName FROM users WHERE id = ?`).get(params.userId) as { displayName: string } | undefined;
		return {
			own,
			ownerName: owner?.displayName ?? '',
			view,
			profiles: [],
			settings: own ? getSettings(c, c.userId) : null,
			candidates: own ? shareCandidates(c, c.userId) : []
		};
	});
