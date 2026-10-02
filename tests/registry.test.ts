import { describe, expect, test } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_POLICIES } from '$lib/server/route-policies.js';

function collectServers(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, e.name);
		if (e.isDirectory()) collectServers(full, out);
		else if (e.name === '+server.ts') out.push(full);
	}
	return out;
}

function routeOf(file: string): string {
	const m = /src\/routes(\/.*)\/\+server\.ts$/.exec(file.replace(/\\/g, '/'));
	if (!m) return file;
	return (m[1] ?? file)
		.replace(/\[\.\.\.([^\]]+)\]/g, ':$1')
		.replace(/\[([^\]]+)\]/g, ':$1');
}

describe('AT-29: registry coverage', () => {
	test('AT-29: every +server under api/photos has a registry entry', () => {
		const files = [
			...collectServers('src/routes/api'),
			...collectServers('src/routes/photos')
		];
		expect(files.length).toBeGreaterThan(0);
		const routes = files.map(routeOf);
		for (const r of routes) {
			expect(
				ROUTE_POLICIES.some((p) => p.route === r),
				`missing registry entry for ${r}`
			).toBe(true);
		}
	});

	test('AT-29: probe public health route success', async () => {
		const policy = ROUTE_POLICIES.find((p) => p.route === '/api/health' && p.method === 'GET');
		expect(policy).toBeDefined();
		expect(policy?.access).toBe('public');
		const { GET } = await import('../src/routes/api/health/+server.js');
		const res = await GET({} as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.status).toBe('ok');
	});
});
