import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NotificationsUpdateSchema } from '$lib/schemas/collab.js';
import { apiError } from '$lib/server/api.js';
import { listNotifications, markRead } from '$lib/server/notifications.js';
import { openGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const r = listNotifications(gate.db, gate.userId, event.url.searchParams.get('cursor') ?? undefined);
		return json({ data: r.data, nextCursor: r.nextCursor, unreadCount: r.unreadCount });
	} finally {
		gate.release();
	}
};

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const parsed = NotificationsUpdateSchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
		return json({ data: { updated: markRead(gate.db, gate.userId, parsed.data) } });
	} finally {
		gate.release();
	}
};
