import { describe, expect, test } from 'vitest';
import { parseAts, collectTestTitles } from '../scripts/check-traceability.mjs';
import { readFileSync } from 'node:fs';

describe('check-traceability self test', () => {
	test('parses the §12 table and finds 1a titles', () => {
		const specs = readFileSync('./docs/project/SPECS.md', 'utf8');
		const ats = parseAts(specs);
		const ids = ats.map((a) => a.id);
		for (const id of ['AT-19', 'AT-25', 'AT-28', 'AT-29', 'AT-35', 'AT-47']) {
			expect(ids).toContain(id);
		}
		const titles = collectTestTitles('./tests');
		const have = new Set(titles.map((t) => t.id));
		for (const id of ['AT-19', 'AT-25', 'AT-28', 'AT-29', 'AT-35', 'AT-47']) {
			expect(have.has(id), `no test titled ${id}`).toBe(true);
		}
		expect(titles.some((t) => t.id === '__BANNED__')).toBe(false);
	});
});
