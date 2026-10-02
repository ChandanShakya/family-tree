import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TreeDeleteSchema, TreeUpdateSchema } from '$lib/schemas/trees.js';
import { deleteTree, getTreeRow, getTreeView, updateTree } from '$lib/server/trees.js';
import { isEmailVerified } from '$lib/server/accounts.js';
import { publicTreeView, readAccess } from '$lib/server/public-access.js';
import { anonymousDenied, badInput, gateTree, openGate, openOptionalGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openOptionalGate(event);
	try {
		const treeId = event.params.id as string;
		const access = readAccess(gate.db, gate.userId, treeId);
		if (access.mode === 'denied') {
			return access.status === 401 ? anonymousDenied() : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		const focus = event.url.searchParams.get('focus') ?? undefined;
		const depthRaw = event.url.searchParams.get('depth');
		const depth = depthRaw ? Number(depthRaw) : undefined;
		const view = getTreeView(gate, treeId, {
			focus,
			userId: gate.userId ?? undefined,
			depth: depth !== undefined && Number.isFinite(depth) ? depth : undefined
		});
		if (!view) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: access.mode === 'public' ? publicTreeView(view) : view });
	} finally {
		gate.release();
	}
};

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'delete');
		if (g instanceof Response) return g;
		const body = await event.request.json().catch(() => null);
		const parsed = TreeUpdateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		if (parsed.data.allowCrossTree !== undefined && g.role !== 'owner') {
			return json({ error: { code: 'FORBIDDEN', message: 'Only the owner can change cross-tree views' } }, { status: 403 });
		}
		if (parsed.data.isPublic && !isEmailVerified(gate.db, gate.userId)) {
			return json({ error: { code: 'FORBIDDEN', message: 'Verify your email before making a tree public' } }, { status: 403 });
		}
		const res = updateTree(gate.db, treeId, {
			name: parsed.data.name,
			description: parsed.data.description,
			isPublic: parsed.data.isPublic,
			allowCrossTree: parsed.data.allowCrossTree
		});
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { message: 'Tree updated' } });
	} finally {
		gate.release();
	}
};

export const DELETE: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'transferDelete');
		if (g instanceof Response) return g;
		const body = await event.request.json().catch(() => null);
		const parsed = TreeDeleteSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const row = getTreeRow(gate.db, treeId);
		if (!row) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		if (row.name !== parsed.data.confirmName) {
			return json(
				{ error: { code: 'VALIDATION', message: 'Confirmation name does not match' } },
				{ status: 400 }
			);
		}
		const res = deleteTree(gate.db, treeId);
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { message: 'Tree deleted' } });
	} finally {
		gate.release();
	}
};
