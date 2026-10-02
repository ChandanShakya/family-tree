import { json } from '@sveltejs/kit';
import { UPLOAD_MAX_BYTES } from '$lib/config.js';
import type { MediaError } from './media.js';

// multipart envelope overhead allowance on top of the file cap
const OVERHEAD = 64 * 1024;

const STATUS: Record<MediaError, [number, string, string]> = {
	UNSUPPORTED_MEDIA: [415, 'UNSUPPORTED_MEDIA', 'Only JPEG, PNG, GIF and WebP images are accepted'],
	TOO_LARGE: [413, 'TOO_LARGE', 'File is too large'],
	IMAGE_TOO_LARGE: [413, 'IMAGE_TOO_LARGE', 'Image dimensions are too large'],
	NOT_FOUND: [404, 'NOT_FOUND', 'Not found']
};

export function mediaErrorJson(e: MediaError): Response {
	const [status, code, message] = STATUS[e];
	return json({ error: { code, message } }, { status });
}

/** Parse a multipart body, enforcing the byte cap before the file is buffered. */
export async function readUpload(
	request: Request
): Promise<{ file: Buffer; fields: Record<string, string> } | Response> {
	const len = Number(request.headers.get('content-length'));
	if (Number.isFinite(len) && len > UPLOAD_MAX_BYTES + OVERHEAD) return mediaErrorJson('TOO_LARGE');
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!form || !(file instanceof File)) {
		return json({ error: { code: 'VALIDATION', message: 'A "file" field is required' } }, { status: 400 });
	}
	if (file.size > UPLOAD_MAX_BYTES) return mediaErrorJson('TOO_LARGE');
	const fields: Record<string, string> = {};
	for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
	return { file: Buffer.from(await file.arrayBuffer()), fields };
}
