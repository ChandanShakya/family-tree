import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { profileClaims } from '$lib/db/schema.js';
import { getQuestions } from '$lib/server/claims.js';
import { listDirectCodes } from '$lib/server/codes.js';
import { relatives } from '$lib/server/graph.js';
import { canDo } from '$lib/server/permissions.js';
import { getPerson, personHistory } from '$lib/server/persons.js';
import { publicPerson } from '$lib/server/public-access.js';
import { withPublicEntity } from '$lib/server/page-load.js';
import { fullName } from '$lib/utils/format.js';

export const load: PageServerLoad = ({ locals, params, url }) =>
	withPublicEntity(locals, 'person', params.id, url.pathname, (c, treeId, mode, role) => {
		const person = mode === 'public' ? publicPerson(c, params.id) : getPerson(c, params.id);
		if (!person) error(404, 'Not found');
		const rels = relatives(c.raw, treeId, params.id);
		const ids = [...new Set([...rels.parents, ...rels.children, ...rels.spouses, ...rels.siblings])];
		const names: Record<string, string> = {};
		const photos: Record<string, string | null> = {};
		for (const rid of ids) {
			const p = mode === 'public' ? publicPerson(c, rid) : getPerson(c, rid);
			if (p) {
				names[rid] = fullName(p as Parameters<typeof fullName>[0]);
				photos[rid] = (p as { photoUrl?: string | null }).photoUrl ?? null;
			}
		}
		if (mode === 'public' || !role || !c.userId) {
			// Read-only view: no history, claims, invites or forms.
			return { person, relatives: rels, names, photos, publicView: true as const };
		}
		// Claiming: only an unclaimed person, and only for a member who has no person in this tree yet.
		const hasOwn = c.raw.prepare(`SELECT 1 FROM visible_persons WHERE treeId = ? AND userId = ?`).get(treeId, c.userId) !== undefined;
		const claimable = !(person as { userId: string | null }).userId && !hasOwn;
		const pendingClaim =
			claimable &&
			c.db
				.select({ id: profileClaims.id })
				.from(profileClaims)
				.where(and(eq(profileClaims.userId, c.userId), eq(profileClaims.personId, params.id), eq(profileClaims.status, 'pending')))
				.get() !== undefined;
		// Stored links of this person (for edit/delete); derived relations are not listed here.
		const links = c.raw
			.prepare(
				`SELECT id, person1Id, person2Id, type, startDate, endDate, notes FROM relationships
				 WHERE treeId = ? AND (person1Id = ? OR person2Id = ?) ORDER BY type`
			)
			.all(treeId, params.id, params.id) as Array<{
			id: string;
			person1Id: string;
			person2Id: string;
			type: 'parent' | 'spouse' | 'sibling' | 'guardian';
			startDate: string | null;
			endDate: string | null;
			notes: string | null;
		}>;
		for (const l of links) {
			const other = l.person1Id === params.id ? l.person2Id : l.person1Id;
			if (!names[other]) {
				const p = getPerson(c, other);
				if (p) names[other] = fullName(p as Parameters<typeof fullName>[0]);
			}
		}
		return {
			person,
			relatives: rels,
			names,
			photos,
			links: links.filter((l) => names[l.person1Id === params.id ? l.person2Id : l.person1Id]),
			canEdit: canDo(role, 'add'),
			canDelete: canDo(role, 'delete'),
			publicView: false as const,
			history: personHistory(c, params.id).data,
			role,
			claimable,
			pendingClaim,
			questions: claimable ? getQuestions(c.db, params.id) : [],
			directCodes: canDo(role, 'createDirectCode') ? listDirectCodes(c.db, treeId, c.userId).filter((d) => d.linkedPersonId === params.id) : [],
			canInvite: canDo(role, 'createDirectCode'),
			canSetQuestions: canDo(role, 'setQuestions')
		};
	});
