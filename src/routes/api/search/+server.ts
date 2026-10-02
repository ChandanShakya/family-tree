import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { SearchQuerySchema } from '$lib/schemas/search.js';
import { RATE_LIMITS } from '$lib/config.js';
import { checkRateLimit } from '$lib/server/rate-limit.js';
import { filterHits, ftsSearch } from '$lib/server/search.js';
import { fuzzySearchWorker } from '$lib/server/fuzzy-host.js';
import { badInput, gateTree, openGate } from '$lib/server/tree-route.js';
import { clientIp } from '$lib/server/api.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const ip = clientIp(event);
		if (!checkRateLimit(`search:${ip}`, RATE_LIMITS.search.limit, RATE_LIMITS.search.windowMs)) {
			return json(
				{ error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
				{ status: 429, headers: { 'retry-after': '60' } }
			);
		}
		const sp = event.url.searchParams;
		const parsedQ = SearchQuerySchema.safeParse({
			q: sp.get('q') ?? '',
			treeId: sp.get('treeId') ?? '',
			name: sp.get('name') || undefined,
			birthYear: sp.get('birthYear') || undefined,
			place: sp.get('place') || undefined
		});
		if (!parsedQ.success) return badInput(parsedQ.error.issues[0]?.message ?? 'Invalid input');
		const { q, treeId, ...filters } = parsedQ.data;
		const g = gateTree(gate, treeId, 'view');
		if (g instanceof Response) return g;
		const t0 = Date.now();
		const fts = ftsSearch(gate, treeId, q, 20, filters);
		if (fts.length > 0) {
			return json({ data: { hits: fts, via: 'fts', ms: Date.now() - t0 } });
		}
		// Server-side fuzzy fallback in the persistent worker thread (§6.8).
		const dbPath = env.DATABASE_PATH ?? './data/family.db';
		// Fuzzy only makes sense for a name; pure year/place filters that found nothing stay empty.
		const nameText = [q, filters.name].filter(Boolean).join(' ');
		if (!nameText) return json({ data: { hits: [], via: 'fts', ms: Date.now() - t0 } });
		try {
			const fuzzy = await fuzzySearchWorker(dbPath, treeId, nameText);
			const hits = filterHits(gate, fuzzy.map((f) => f.id), filters);
			return json({ data: { hits, via: 'fuzzy', ms: Date.now() - t0 } });
		} catch {
			return json(
				{ error: { code: 'BUSY', message: 'Search temporarily unavailable' } },
				{ status: 503, headers: { 'retry-after': '2' } }
			);
		}
	} finally {
		gate.release();
	}
};
