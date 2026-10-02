import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MediaCreateFieldsSchema } from '$lib/schemas/media.js';
import { addMedia } from '$lib/server/media.js';
import { badInput, gateTree, openGate } from '$lib/server/tree-route.js';
import { mediaErrorJson, readUpload } from '$lib/server/upload.js';

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const up = await readUpload(event.request);
		if (up instanceof Response) {
			// Anonymous/unauthorised callers never reach here; size errors are fine to return.
			return up;
		}
		const f = up.fields;
		const parsed = MediaCreateFieldsSchema.safeParse({
			treeId: f.treeId,
			personId: f.personId || undefined,
			caption: f.caption || undefined,
			makePrimary: f.makePrimary === undefined ? undefined : f.makePrimary === 'true'
		});
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const g = gateTree(gate, parsed.data.treeId, 'add');
		if (g instanceof Response) return g;
		const res = await addMedia(gate, gate.userId, parsed.data.treeId, { ...parsed.data, buf: up.file });
		if ('error' in res) return mediaErrorJson(res.error);
		return json({ data: { ...res.media, batchId: res.batchId } }, { status: 201 });
	} finally {
		gate.release();
	}
};
