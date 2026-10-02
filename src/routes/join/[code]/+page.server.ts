import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { openDb } from '$lib/db/index.js';
import { clientIp } from '$lib/server/api.js';
import { codeFailed, guardCode } from '$lib/server/code-guard.js';
import { previewCode } from '$lib/server/codes.js';

// A valid code with no session sends the visitor through login and back (§6.4). An unavailable code
// shows the same message to everyone, signed in or not (same limiter and lockout as the API).
export const load: PageServerLoad = (event) => {
	const g = guardCode(clientIp(event));
	if (!g.ok) return { code: event.params.code, status: g.code, preview: null, signedIn: !!event.locals.user };
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const preview = previewCode(db, event.params.code);
		if (!preview) codeFailed(clientIp(event));
		else if (!event.locals.user) redirect(303, `/login?next=${encodeURIComponent(`/join/${event.params.code}`)}`);
		return { code: event.params.code, status: preview ? ('ok' as const) : ('unavailable' as const), preview, signedIn: !!event.locals.user };
	} finally {
		raw.close();
	}
};
