import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MediaUpdateSchema } from '$lib/schemas/media.js';
import { deleteMedia, updateMedia } from '$lib/server/media.js';
import { badInput, gateEntity, openGate } from '$lib/server/tree-route.js';
import { mediaErrorJson } from '$lib/server/upload.js';

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'media', id, 'add');
		if (g instanceof Response) return g;
		const parsed = MediaUpdateSchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const res = updateMedia(gate, gate.userId, id, parsed.data);
		if ('error' in res) return mediaErrorJson(res.error);
		return json({ data: { ...res.media, batchId: res.batchId ?? null } });
	} finally {
		gate.release();
	}
};

export const DELETE: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'media', id, 'delete');
		if (g instanceof Response) return g;
		const res = deleteMedia(gate, gate.userId, id);
		if ('error' in res) return mediaErrorJson(res.error);
		return json({ data: { message: 'Photo deleted' } });
	} finally {
		gate.release();
	}
};
