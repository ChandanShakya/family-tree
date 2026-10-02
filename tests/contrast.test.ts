import { describe, expect, test } from 'vitest';
import { execSync } from 'node:child_process';
import { TOKEN_PAIRS, TEXT_MIN, UI_MIN, contrastRatio } from '$lib/utils/contrast.js';

describe('AT-28: contrast', () => {
	test('AT-28: every text pair is >= 4.5:1', () => {
		for (const pair of TOKEN_PAIRS) {
			const ratio = contrastRatio(pair.fg, pair.bg);
			const min = pair.large ? UI_MIN : TEXT_MIN;
			expect(ratio, `${pair.name}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(min);
		}
	});

	test('AT-28: contrast script exits zero', () => {
		const out = execSync('npm run contrast --silent', { encoding: 'utf8' });
		expect(out).toContain('all contrast pairs pass');
	});
});
