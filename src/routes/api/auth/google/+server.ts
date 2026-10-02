import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import { googleAuthUrl, googleConfigured, issueOAuthState } from '$lib/server/oauth.js';
import { isSecure } from '$lib/server/api.js';

export const GET: RequestHandler = async (event) => {
	if (!googleConfigured(env)) {
		return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}
	const secret = env.SESSION_SECRET ?? '';
	const verifier = randomBytes(32).toString('base64url');
	const { state, cookie } = issueOAuthState(secret, verifier);
	event.cookies.set('oauth_state', cookie, {
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure(event),
		path: '/',
		maxAge: 10 * 60
	});
	const redirectUri = `${event.url.origin}/api/auth/google/callback`;
	throw redirect(
		302,
		googleAuthUrl(env.GOOGLE_CLIENT_ID as string, redirectUri, state, verifier)
	);
};
