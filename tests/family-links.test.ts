import { expect, test } from 'vitest';
import { impliedLinks } from '$lib/utils/family-links.js';

const rels = [
	{ person1Id: 'dad', person2Id: 'kid', type: 'parent' },
	{ person1Id: 'dad', person2Id: 'mom', type: 'spouse' }
];

test('a child of one spouse is offered as the child of the other', () => {
	expect(impliedLinks(rels, 'child', 'new', 'dad')).toEqual([{ person1Id: 'mom', person2Id: 'new', type: 'parent' }]);
});
test("a spouse is offered as the parent of the partner's single-parent children", () => {
	expect(impliedLinks([rels[0]!], 'spouse', 'mom', 'dad')).toEqual([{ person1Id: 'mom', person2Id: 'kid', type: 'parent' }]);
	expect(impliedLinks([rels[0]!], 'spouse', 'dad', 'mom')).toEqual([{ person1Id: 'mom', person2Id: 'kid', type: 'parent' }]);
});
test('a sibling shares parents; a second parent is offered as spouse of the first', () => {
	expect(impliedLinks(rels, 'sibling', 'new', 'kid')).toEqual([{ person1Id: 'dad', person2Id: 'new', type: 'parent' }]);
	expect(impliedLinks([rels[0]!], 'parent', 'mom', 'kid')).toEqual([{ person1Id: 'mom', person2Id: 'dad', type: 'spouse' }]);
});
test('nothing is offered twice or beyond two parents', () => {
	const full = [...rels, { person1Id: 'mom', person2Id: 'kid', type: 'parent' }];
	expect(impliedLinks(full, 'spouse', 'mom', 'dad')).toEqual([]);
	expect(impliedLinks(full, 'parent', 'x', 'kid')).toEqual([]);
});
