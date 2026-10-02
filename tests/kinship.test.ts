import { describe, expect, test } from 'vitest';
import { kinshipLabel, type Link } from '$lib/server/kinship.js';

const L = (s: string): Link[] =>
	s.split('').map((c) => ({ u: 'parent', d: 'child', s: 'spouse', b: 'sibling' })[c] as Link);

describe('derived relations (§6.3)', () => {
	test.each([
		['', 'self'],
		['u', 'parent'],
		['uu', 'grandparent'],
		['uuu', 'great-grandparent'],
		['uuuu', '2nd-great-grandparent'],
		['d', 'child'],
		['dd', 'grandchild'],
		['ddd', 'great-grandchild'],
		['ud', 'sibling'],
		['b', 'sibling'],
		['udd', 'niece/nephew'],
		['uddd', 'grandniece/nephew'],
		['uud', 'aunt/uncle'],
		['uuud', 'grandaunt/uncle'],
		['uudd', '1st cousin'],
		['uuudd', '1st cousin once removed'],
		['uuuddd', '2nd cousin'],
		['uuuddddd', '2nd cousin twice removed'],
		['s', 'spouse'],
		['su', 'parent-in-law'],
		['sud', 'sibling-in-law'],
		['uds', 'sibling-in-law'],
		['ds', 'child-in-law'],
		['suu', 'grandparent by marriage'],
		['sus', 'relative by marriage'],
		['duu', 'relative']
	])('kinship %s → %s', (path, label) => {
		expect(kinshipLabel(L(path))).toBe(label);
	});
});
