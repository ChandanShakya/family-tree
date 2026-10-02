import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { setAvatar } from '$lib/server/media.js';
import { mediaErrorJson, readUpload } from '$lib/server/upload.js';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
	}
	const up = await readUpload(event.request);
	if (up instanceof Response) return up;
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const res = await setAvatar({ raw, db }, user.id, up.file);
		if ('error' in res) return mediaErrorJson(res.error);
		return json({ data: res }, { status: 201 });
	} finally {
		raw.close();
	}
};
