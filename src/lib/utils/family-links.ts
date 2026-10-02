// Follow-up links implied by a new relationship, so a family is mapped in one step:
// adding a child to a father offers his spouse as the other parent, adding a spouse offers the
// partner's children, and so on. The caller shows each as a pre-checked option.

export type RelKind = 'parent' | 'child' | 'spouse' | 'sibling';
type Rel = { person1Id: string; person2Id: string; type: string };
export type Link = { person1Id: string; person2Id: string; type: 'parent' | 'spouse' };

const parentsOf = (rels: Rel[], id: string) => rels.filter((r) => r.type === 'parent' && r.person2Id === id).map((r) => r.person1Id);
const childrenOf = (rels: Rel[], id: string) => rels.filter((r) => r.type === 'parent' && r.person1Id === id).map((r) => r.person2Id);
const spousesOf = (rels: Rel[], id: string) =>
	rels.filter((r) => r.type === 'spouse' && (r.person1Id === id || r.person2Id === id)).map((r) => (r.person1Id === id ? r.person2Id : r.person1Id));

/** Links implied by "a is <kind> of b" (a may be a person not saved yet, with no relationships). */
export function impliedLinks(rels: Rel[], kind: RelKind, a: string, b: string): Link[] {
	const out: Link[] = [];
	const parent = (p: string, c: string) => {
		if (p !== c && !parentsOf(rels, c).includes(p) && parentsOf(rels, c).length < 2) out.push({ person1Id: p, person2Id: c, type: 'parent' });
	};
	if (kind === 'child') for (const s of spousesOf(rels, b)) parent(s, a);
	if (kind === 'sibling') for (const p of parentsOf(rels, b)) parent(p, a);
	if (kind === 'spouse') {
		for (const c of childrenOf(rels, b)) if (parentsOf(rels, c).length === 1) parent(a, c);
		for (const c of childrenOf(rels, a)) if (parentsOf(rels, c).length === 1) parent(b, c);
	}
	if (kind === 'parent') {
		const ps = parentsOf(rels, b);
		if (ps.length === 1 && ps[0] !== a && !spousesOf(rels, a).includes(ps[0]!)) out.push({ person1Id: a, person2Id: ps[0]!, type: 'spouse' });
	}
	return out;
}

export function linkLabel(l: Link, name: (id: string) => string): string {
	return `${name(l.person1Id)} is also ${l.type === 'spouse' ? 'spouse' : 'parent'} of ${name(l.person2Id)}`;
}
