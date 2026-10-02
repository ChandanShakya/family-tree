import { error, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { openDb } from '$lib/db/index.js';
import { requireTreeAccess, resolveTreeId, type Action, type EntityType, type Role } from './permissions.js';
import { readAccess } from './public-access.js';
import type { Handles } from './tx.js';

// Page `load` helpers (§7.0): reads call the same services as the API routes,
// with the same access rules; they never fetch the app's own /api.

export interface LoadCtx extends Handles {
	userId: string;
}

function open(locals: App.Locals): { h: Handles; userId: string; close: () => void } {
	if (!locals.user) redirect(303, '/login');
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	return { h: { raw, db }, userId: locals.user.id, close: () => raw.close() };
}

/** Signed-in read. Anonymous callers go to /login. */
export function withUser<T>(locals: App.Locals, fn: (c: LoadCtx) => T): T {
	const o = open(locals);
	try {
		return fn({ ...o.h, userId: o.userId });
	} finally {
		o.close();
	}
}

/** Tree-scoped read: unknown or inaccessible tree → 404, wrong role → 403. */
export function withTree<T>(
	locals: App.Locals,
	treeId: string,
	action: Action,
	fn: (c: LoadCtx, role: string) => T
): T {
	return withUser(locals, (c) => {
		const a = requireTreeAccess(c.db, c.userId, treeId, action);
		if (!a.ok) error(a.status, a.status === 404 ? 'Not found' : 'Forbidden');
		return fn(c, a.role);
	});
}

/** Entity-keyed read: the tree is resolved from the entity, same 404 for unknown and foreign. */
export function withEntity<T>(
	locals: App.Locals,
	type: EntityType,
	id: string,
	action: Action,
	fn: (c: LoadCtx, treeId: string, role: string) => T
): T {
	return withUser(locals, (c) => {
		const treeId = resolveTreeId(c.db, type, id);
		if (!treeId) error(404, 'Not found');
		const a = requireTreeAccess(c.db, c.userId, treeId, action);
		if (!a.ok) error(a.status, a.status === 404 ? 'Not found' : 'Forbidden');
		return fn(c, treeId, a.role);
	});
}

export interface ReadCtx extends Handles {
	userId: string | null;
}

function readOpen(locals: App.Locals): { c: ReadCtx; close: () => void } {
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	return { c: { raw, db, userId: locals.user?.id ?? null }, close: () => raw.close() };
}

/** Public-tree read (§4): members see everything, anyone else a filtered view; private trees send anonymous callers to login. */
export function withPublicRead<T>(
	locals: App.Locals,
	treeId: string,
	loginNext: string,
	fn: (c: ReadCtx, mode: 'member' | 'public', role: Role | null) => T
): T {
	const o = readOpen(locals);
	try {
		const a = readAccess(o.c.db, o.c.userId, treeId);
		if (a.mode === 'denied') {
			if (a.status === 401) redirect(303, `/login?next=${encodeURIComponent(loginNext)}`);
			error(404, 'Not found');
		}
		return fn(o.c, a.mode, a.mode === 'member' ? a.role : null);
	} finally {
		o.close();
	}
}

/** Entity-keyed variant: the tree comes from the entity; unknown ids look like private ones. */
export function withPublicEntity<T>(
	locals: App.Locals,
	type: EntityType,
	id: string,
	loginNext: string,
	fn: (c: ReadCtx, treeId: string, mode: 'member' | 'public', role: Role | null) => T
): T {
	const o = readOpen(locals);
	try {
		const treeId = resolveTreeId(o.c.db, type, id);
		if (!treeId) {
			if (!o.c.userId) redirect(303, `/login?next=${encodeURIComponent(loginNext)}`);
			error(404, 'Not found');
		}
		const a = readAccess(o.c.db, o.c.userId, treeId);
		if (a.mode === 'denied') {
			if (a.status === 401) redirect(303, `/login?next=${encodeURIComponent(loginNext)}`);
			error(404, 'Not found');
		}
		return fn(o.c, treeId, a.mode, a.mode === 'member' ? a.role : null);
	} finally {
		o.close();
	}
}
