import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import tar from 'tar-stream';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { apiError } from '$lib/server/api.js';
import { runWorker } from '$lib/server/run-worker.js';
import { photoRoot } from '$lib/server/storage.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

// Tree backup (owner/editor): the full JSON export plus that tree's photos, streamed as a tar.
// Whole-instance snapshots are an operator job (scripts/backup.ts); a tree owner never receives other trees' data.
export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'fullExport');
		if (g instanceof Response) return g;
		const out = await runWorker<{ body: string } | { error: string }>('export-worker.mjs', {
			dbPath: env.DATABASE_PATH ?? './data/family.db',
			treeId,
			format: 'json',
			filtered: false,
			now: new Date().toISOString(),
			livingYears: 110
		});
		if ('error' in out) return apiError(404, 'NOT_FOUND', 'Not found');
		const pack = tar.pack();
		pack.entry({ name: 'tree.json' }, out.body);
		const root = photoRoot();
		const files: string[] = [];
		const walk = (dir: string) => {
			if (!existsSync(dir)) return;
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, e.name);
				if (e.isDirectory()) walk(p);
				else files.push(p);
			}
		};
		walk(join(root, treeId));
		// Entries are written one at a time so a big photo set never sits in memory.
		void (async () => {
			try {
				for (const f of files) {
					await new Promise<void>((resolve, reject) => {
						const entry = pack.entry({ name: `photos/${f.slice(root.length + 1)}`, size: statSync(f).size }, (err) => (err ? reject(err) : resolve()));
						createReadStream(f).on('error', reject).pipe(entry);
					});
				}
				pack.finalize();
			} catch (e) {
				pack.destroy(e as Error);
			}
		})();
		return new Response(Readable.toWeb(Readable.from(pack)) as ReadableStream, {
			headers: {
				'content-type': 'application/x-tar',
				'content-disposition': 'attachment; filename="family-tree-backup.tar"',
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} finally {
		gate.release();
	}
};
