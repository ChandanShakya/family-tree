import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// better-sqlite3 is a native CJS module: never bundle it into the SSR
	// output (its binding loader uses `require.main`, which crashes under ESM).
	// NOTE: Vite 8 only honours externalization via environments.ssr.resolve;
	// the legacy top-level `ssr.external` is ignored unless environments exist.
	environments: {
		ssr: {
			resolve: {
				external: ['better-sqlite3']
			}
		}
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node'
	}
});
