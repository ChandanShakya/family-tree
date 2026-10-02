import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

// The runtime image installs `dependencies` only (npm ci --omit=dev). A package the server bundle imports
// but that is listed only under devDependencies builds fine and then 500s in production.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
	});
}

describe('production dependencies', () => {
	test('no package is listed in both dependencies and devDependencies; every version is pinned', () => {
		expect(Object.keys(pkg.dependencies).filter((k) => k in pkg.devDependencies)).toEqual([]);
		const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v));
		expect(loose).toEqual([]);
	});

	test.skipIf(!existsSync('build/server'))('every bare import in the server build is a production dependency', () => {
		const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
		const missing = new Set<string>();
		for (const f of files('build/server')) {
			// Block comments (JSDoc `@import … from 'types'`) are not imports.
			const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
			for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"'./#][^"']*)["']/g)) {
				const spec = m[1]!;
				if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w./-]*)?$/.test(spec)) continue; // template strings etc.
				if (builtins.has(spec) || builtins.has(spec.split('/')[0]!)) continue;
				const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
				if (!(name in pkg.dependencies)) missing.add(`${name} (${f})`);
			}
		}
		expect([...missing]).toEqual([]);
	});
});
