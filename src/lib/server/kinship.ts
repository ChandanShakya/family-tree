// Derived relations (§6.3): labels computed from a relationship path, never
// stored. `links[i]` says what step i's target is to its source.

export type Link = 'parent' | 'child' | 'spouse' | 'sibling';

const ORD = ['th', 'st', 'nd', 'rd'];
function ordinal(n: number): string {
	const v = n % 100;
	return `${n}${ORD[(v - 20) % 10] ?? ORD[v] ?? ORD[0]}`;
}

function greats(n: number): string {
	return n <= 0 ? '' : n === 1 ? 'great-' : `${ordinal(n)}-great-`;
}

/** Label for a purely blood path expressed as `up` steps then `down` steps via a common ancestor. */
function bloodLabel(up: number, down: number): string {
	if (up === 0 && down === 0) return 'self';
	if (down === 0) return up === 1 ? 'parent' : `${greats(up - 2)}grandparent`;
	if (up === 0) return down === 1 ? 'child' : `${greats(down - 2)}grandchild`;
	if (up === 1 && down === 1) return 'sibling';
	if (up === 1) return down === 2 ? 'niece/nephew' : `${greats(down - 3)}grandniece/nephew`;
	if (down === 1) return up === 2 ? 'aunt/uncle' : `${greats(up - 3)}grandaunt/uncle`;
	const degree = Math.min(up, down) - 1;
	const removed = Math.abs(up - down);
	const base = `${ordinal(degree)} cousin`;
	return removed === 0 ? base : `${base} ${removed === 1 ? 'once' : removed === 2 ? 'twice' : `${removed} times`} removed`;
}

/** Collapse a blood path (no spouse steps) to up/down counts, or null if it zig-zags. */
function toUpDown(links: Link[]): { up: number; down: number } | null {
	let up = 0;
	let down = 0;
	for (const l of links) {
		if (l === 'sibling') {
			// A stored sibling link means "same unknown parents": up one, down one.
			if (down > 0) return null;
			up += 1;
			down += 1;
		} else if (l === 'parent') {
			if (down > 0) return null;
			up += 1;
		} else if (l === 'child') {
			down += 1;
		} else return null;
	}
	return { up, down };
}

const IN_LAW: Record<string, string> = {
	parent: 'parent-in-law',
	sibling: 'sibling-in-law',
	child: 'child-in-law'
};

export function kinshipLabel(links: Link[]): string {
	if (links.length === 0) return 'self';
	const spouseSteps = links.filter((l) => l === 'spouse').length;
	if (spouseSteps === 0) {
		const ud = toUpDown(links);
		return ud ? bloodLabel(ud.up, ud.down) : 'relative';
	}
	if (links.length === 1) return 'spouse';
	// In-law: one spouse step at either end of an otherwise blood path.
	const first = links[0] === 'spouse';
	const last = links[links.length - 1] === 'spouse';
	if (spouseSteps === 1 && (first || last)) {
		const rest = links.filter((l) => l !== 'spouse');
		const ud = toUpDown(rest);
		if (ud) {
			const blood = bloodLabel(ud.up, ud.down);
			return IN_LAW[blood] ?? `${blood} by marriage`;
		}
	}
	return 'relative by marriage';
}
