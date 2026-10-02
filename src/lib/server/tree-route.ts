import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import {
	requireTreeAccess,
	resolveTreeId,
	type Action,
	type EntityType
} from './permissions.js';
import { errorJson } from './api.js';
import { readAccess } from './public-access.js';
import type { Db } from './tx.js';
import type Database from 'better-sqlite3';

export interface Gate {
	userId: string;
	sessionId: string;
	db: Db;
	raw: Database.Database;
	release: () => void;
}

/** 401 when anonymous; caller must release(). */
export function openGate(event: RequestEvent): Gate | Response {
	const user = event.locals.user;
	if (!user) {
		return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	return { userId: user.id, sessionId: user.sessionId, db, raw, release: () => raw.close() };
}

export interface OptionalGate {
	userId: string | null;
	db: Db;
	raw: Database.Database;
	release: () => void;
}

/** Like openGate, but anonymous callers pass (for `allowPublic` routes; the caller decides what they may see). */
export function openOptionalGate(event: RequestEvent): OptionalGate {
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	return { userId: event.locals.user?.id ?? null, db, raw, release: () => raw.close() };
}

/** The one 401 for anonymous callers: same body for private and nonexistent trees (§4). */
export function anonymousDenied(): Response {
	return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
}

/** Entity-keyed read for `allowPublic` routes: member, public or the same 401/404 as an unknown id. */
export function readEntity(
	gate: OptionalGate,
	entityType: EntityType,
	id: string
): { treeId: string; mode: 'member' | 'public' } | Response {
	const treeId = resolveTreeId(gate.db, entityType, id);
	const denied = (status: 401 | 404) =>
		status === 401 ? anonymousDenied() : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
	if (!treeId) return denied(gate.userId ? 404 : 401);
	const a = readAccess(gate.db, gate.userId, treeId);
	if (a.mode === 'denied') return denied(a.status);
	return { treeId, mode: a.mode };
}

/** Gate a tree by id: unknown/inaccessible → 404, wrong role → 403. */
export function gateTree(
	gate: Gate,
	treeId: string,
	action: Action,
	ctx?: { authorUserId?: string }
): { role: string } | Response {
	const res = requireTreeAccess(gate.db, gate.userId, treeId, action, ctx);
	if (!res.ok && res.status === 404) {
		return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
	}
	if (!res.ok) {
		return errorJson({ ok: false, code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
	}
	return { role: res.role };
}

/** Entity-keyed gate: resolve tree inside the service layer, 404 on unknown. */
export function gateEntity(
	gate: Gate,
	entityType: EntityType,
	id: string,
	action: Action,
	ctx?: { authorUserId?: string }
): { treeId: string; role: string } | Response {
	const treeId = resolveTreeId(gate.db, entityType, id);
	if (!treeId) {
		return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
	}
	const g = gateTree(gate, treeId, action, ctx);
	if (g instanceof Response) return g;
	return { treeId, ...g };
}

export function badInput(message: string): Response {
	return json({ error: { code: 'VALIDATION', message } }, { status: 400 });
}
