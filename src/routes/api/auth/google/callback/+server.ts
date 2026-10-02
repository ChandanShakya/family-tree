import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { googleCallback, googleConfigured } from '$lib/server/oauth.js';
import { setSessionCookie } from '$lib/server/api.js';

export const GET: RequestHandler = async (event) => {
	if (!googleConfigured(env)) {
		return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');
	if (!code || !state) throw redirect(302, '/login?error=oauth');
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const res = await googleCallback(
			db,
			{
				code,
				state,
				stateCookie: event.cookies.get('oauth_state'),
				redirectUri: `${event.url.origin}/api/auth/google/callback`
			},
			{
				GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID as string,
				GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET as string,
				SESSION_SECRET: env.SESSION_SECRET ?? ''
			}
		);
		event.cookies.delete('oauth_state', { path: '/' });
		if (!res.ok) throw redirect(302, '/login?error=oauth');
		setSessionCookie(event, res.token);
		throw redirect(302, '/');
	} finally {
		raw.close();
	}
};
