import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('AT-47: CSP nonce, no unsafe-inline in script-src', () => {
	test('AT-47: kit csp uses nonce mode and script-src has no unsafe-inline', () => {
		const config = readFileSync('./svelte.config.js', 'utf8');
		expect(config).toContain("mode: 'nonce'");
		const scriptSrc = /'script-src':\s*\[(.*?)\]/s.exec(config)?.[1] ?? '';
		expect(scriptSrc).not.toContain('unsafe-inline');
		expect(scriptSrc).toContain("'self'");
	});

	test('AT-47: every inline script in app.html carries the nonce placeholder', () => {
		const html = readFileSync('./src/app.html', 'utf8');
		const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>/g)].map((m) => m[0]);
		expect(scripts.length).toBeGreaterThan(0);
		for (const tag of scripts) {
			expect(tag, `inline script missing nonce: ${tag}`).toContain('nonce="%sveltekit.nonce%"');
		}
	});

	test('AT-47: live built server sends CSP with nonce and no unsafe-inline', async () => {
		if (!existsSync('./build')) return;
		const { spawn } = await import('node:child_process');
		const server = spawn('node', ['build'], { env: { ...process.env, PORT: '4188' } });
		try {
			let html = '';
			for (let i = 0; i < 50; i++) {
				try {
					const res = await fetch('http://localhost:4188/');
					html = await res.text();
					const csp = res.headers.get('content-security-policy') ?? '';
					expect(csp).toContain('script-src');
					expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
					const nonces = [...html.matchAll(/nonce="([^"]+)"/g)].map((m) => m[1]);
					const inlineScripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>/g)].map((m) => m[0]);
					for (const tag of inlineScripts) {
						expect(tag).toContain('nonce=');
					}
					for (const n of nonces) {
						expect(csp).toContain(`'nonce-${n}'`);
					}
					return;
				} catch {
					await new Promise((r) => setTimeout(r, 200));
				}
			}
			throw new Error('built server did not respond on :4188');
		} finally {
			server.kill();
		}
	});
});
