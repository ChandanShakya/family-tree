import { toast } from './toast.svelte.js';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; body: unknown };

/** JSON/multipart fetch wrapper. Failures toast unless `quiet`. */
export async function api<T = unknown>(
	method: string,
	url: string,
	body?: unknown,
	opts?: { quiet?: boolean }
): Promise<ApiResult<T>> {
	const isForm = body instanceof FormData;
	const res = await fetch(url, {
		method,
		headers: body === undefined || isForm ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
	}).catch(() => null);
	if (!res) {
		const message = navigator.onLine ? 'Network error' : "You're offline";
		if (!opts?.quiet) toast(message, 'error');
		return { ok: false, status: 0, message, body: null };
	}
	const json = await res.json().catch(() => null);
	if (!res.ok) {
		const message = json?.error?.message ?? `Request failed (${res.status})`;
		if (!opts?.quiet) toast(message, 'error');
		return { ok: false, status: res.status, message, body: json };
	}
	return { ok: true, data: json?.data as T };
}

export { fullName as personName } from './utils/format.js';
