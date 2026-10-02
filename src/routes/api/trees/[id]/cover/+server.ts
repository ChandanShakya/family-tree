import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setCover } from '$lib/server/media.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';
import { mediaErrorJson, readUpload } from '$lib/server/upload.js';

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'delete');
		if (g instanceof Response) return g;
		const up = await readUpload(event.request);
		if (up instanceof Response) return up;
		const res = await setCover(gate, gate.userId, treeId, up.file);
		if ('error' in res) return mediaErrorJson(res.error);
		return json({ data: res }, { status: 201 });
	} finally {
		gate.release();
	}
};
