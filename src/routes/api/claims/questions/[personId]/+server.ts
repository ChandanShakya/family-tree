import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { openDb } from '$lib/db/index.js';
import { QuestionsSetSchema } from '$lib/schemas/collab.js';
import { apiError } from '$lib/server/api.js';
import { claimAudience, getQuestions, setQuestions } from '$lib/server/claims.js';
import { gateEntity, openGate } from '$lib/server/tree-route.js';

// Question texts only; same audience as claim search. Claimed people have no claim path left.
export const GET: RequestHandler = async (event) => {
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const personId = event.params.personId as string;
		const p = raw.prepare(`SELECT treeId, userId FROM visible_persons WHERE id = ?`).get(personId) as { treeId: string; userId: string | null } | undefined;
		if (!p || p.userId || !claimAudience(db, event.locals.user?.id ?? null, p.treeId, event.url.searchParams.get('code'))) {
			return apiError(404, 'NOT_FOUND', 'Not found');
		}
		return json({ data: getQuestions(db, personId) });
	} finally {
		raw.close();
	}
};

// Owner, editor or contributor set the questions and answers (§4).
export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const personId = event.params.personId as string;
		const g = gateEntity(gate, 'person', personId, 'setQuestions');
		if (g instanceof Response) return g;
		const parsed = QuestionsSetSchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
		const r = setQuestions(gate, gate.userId, g.treeId, personId, parsed.data.questions);
		return 'error' in r ? apiError(404, 'NOT_FOUND', 'Not found') : json({ data: r }, { status: 201 });
	} finally {
		gate.release();
	}
};
