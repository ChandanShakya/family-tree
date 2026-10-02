import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
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
		},
		// NOTE: Kit 2.70.3 deprecates csrf.checkOrigin in favour of
		// csrf.trustedOrigins (see D-007d). Default origin check stays on;
		// ORIGIN allow-listing is enforced explicitly in hooks.server.ts.
	}
};

export default config;
