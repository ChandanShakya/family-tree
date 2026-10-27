import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit({
			adapter: adapter(),
			csp: {
				mode: 'nonce',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'frame-ancestors': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			}
			// Default CSRF origin check stays on; ORIGIN allow-listing is enforced explicitly in hooks.server.ts (D-007d).
		})],
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
		environment: 'node',
		setupFiles: ['tests/setup-fetch.ts']
	}
});
