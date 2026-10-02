import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { SESSION_DAYS } from '$lib/config.js';
import { getClientIp } from './rate-limit.js';
import type { ServiceError } from './accounts.js';

export function clientIp(event: RequestEvent): string {
	return getClientIp(event.request, env.ADDRESS_HEADER);
}

export function baseUrl(event: RequestEvent): string {
	const origin = env.ORIGIN ?? event.url.origin;
	return origin.replace(/\/$/, '');
}

export function isSecure(event: RequestEvent, nodeEnv: string | undefined = env.NODE_ENV): boolean {
	if (nodeEnv === 'production') return true;
	return event.url.protocol === 'https:';
}

export function setSessionCookie(event: RequestEvent, token: string): void {
	event.cookies.set('session', token, {
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure(event),
		path: '/',
		maxAge: SESSION_DAYS * 24 * 60 * 60
	});
}

export function clearSessionCookie(event: RequestEvent): void {
	event.cookies.delete('session', { path: '/' });
}

export function errorJson(e: ServiceError): Response {
	const headers: Record<string, string> = {};
	if (e.retryAfter !== undefined) headers['retry-after'] = String(e.retryAfter);
	return json({ error: { code: e.code, message: e.message } }, { status: e.status, headers });
}

/** `{ error: { code, message, ...extra } }` with an optional Retry-After (§8 error shape). */
export function apiError(
	status: number,
	code: string,
	message: string,
	opts?: { retryAfter?: number; extra?: Record<string, unknown> }
): Response {
	return json(
		{ error: { code, message, ...opts?.extra } },
		{ status, headers: opts?.retryAfter !== undefined ? { 'retry-after': String(opts.retryAfter) } : {} }
	);
}
