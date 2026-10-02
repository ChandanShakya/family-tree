import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { LIVING_ASSUMPTION_YEARS } from '$lib/config.js';
import { apiError } from '$lib/server/api.js';
import { canDo, type Role } from '$lib/server/permissions.js';
import { runWorker } from '$lib/server/run-worker.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

const FORMATS = ['gedcom', 'json', 'csv'];

// Everyone may export, through the privacy filter. Owner/editor get the full tree unless excludeLiving is set (§4, §6.9).
export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'privacyExport');
		if (g instanceof Response) return g;
		const format = event.url.searchParams.get('format') ?? 'json';
		if (!FORMATS.includes(format)) return apiError(400, 'VALIDATION', 'format must be gedcom, json or csv');
		const exclude = ['1', 'true'].includes(event.url.searchParams.get('excludeLiving') ?? '');
		const filtered = exclude || !canDo(g.role as Role, 'fullExport');
		const out = await runWorker<{ mime: string; ext: string; body: string } | { error: string }>('export-worker.mjs', {
			dbPath: env.DATABASE_PATH ?? './data/family.db',
			treeId,
			format,
			filtered,
			now: new Date().toISOString(),
			livingYears: LIVING_ASSUMPTION_YEARS
		});
		if ('error' in out) return apiError(404, 'NOT_FOUND', 'Not found');
		return new Response(out.body, {
			headers: {
				'content-type': out.mime,
				'content-disposition': `attachment; filename="family-tree${filtered ? '-private' : ''}.${out.ext}"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} finally {
		gate.release();
	}
};
