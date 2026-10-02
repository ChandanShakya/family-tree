import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { IMPORT_MAX_BYTES, IMPORT_MAX_PERSONS, IMPORT_MAX_RELATIONSHIPS, MAX_TRAVERSAL_DEPTH } from '$lib/config.js';
import { apiError } from '$lib/server/api.js';
import { runWorker } from '$lib/server/run-worker.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

interface ImportResult {
	counts?: { persons: number; relationships: number; warnings: string[]; unknownTags: number };
	imported?: boolean;
	batchId?: string;
	error?: { code: 'IMPORT_LIMIT' | 'IMPORT_INVALID'; message: string };
}

// Owner/editor. `?preview=1` parses only. Over-cap files are refused before anything is written (§6.9).
export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const len = Number(event.request.headers.get('content-length'));
		if (Number.isFinite(len) && len > IMPORT_MAX_BYTES + 64 * 1024) return apiError(413, 'IMPORT_LIMIT', 'The file is too large');
		const form = await event.request.formData().catch(() => null);
		const treeId = String(form?.get('treeId') ?? '');
		const file = form?.get('file');
		if (!form || !(file instanceof File) || !treeId) return apiError(400, 'VALIDATION', 'treeId and a file are required');
		const g = gateTree(gate, treeId, 'import');
		if (g instanceof Response) return g;
		if (file.size > IMPORT_MAX_BYTES) return apiError(413, 'IMPORT_LIMIT', 'The file is larger than 5 MB');
		const preview = event.url.searchParams.get('preview') === '1';
		const r = await runWorker<ImportResult>(
			'import-worker.mjs',
			{
				dbPath: env.DATABASE_PATH ?? './data/family.db',
				treeId,
				userId: gate.userId,
				text: await file.text(),
				preview,
				limits: { maxPersons: IMPORT_MAX_PERSONS, maxRelationships: IMPORT_MAX_RELATIONSHIPS, maxDepth: MAX_TRAVERSAL_DEPTH }
			},
			60_000
		);
		if (r.error) return apiError(r.error.code === 'IMPORT_LIMIT' ? 413 : 400, r.error.code === 'IMPORT_LIMIT' ? 'IMPORT_LIMIT' : 'VALIDATION', r.error.message);
		if (!preview && !r.imported) return apiError(400, 'VALIDATION', 'The file contains no people');
		return json({ data: { ...r.counts, imported: r.imported === true, batchId: r.batchId ?? null } }, { status: preview ? 200 : 201 });
	} finally {
		gate.release();
	}
};
