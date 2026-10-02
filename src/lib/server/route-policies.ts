import type { Action } from './permissions.js';

export type Access = 'public' | 'session' | 'tree' | 'code';

export interface ProbeContext {
	treeId: string;
	personId: string;
	otherPersonId: string;
	linkId: string;
	eventId: string;
	memberUserId: string;
	mediaId: string;
	directCodeId: string;
	pendingUserId: string;
	claimId: string;
	historyId: string;
}

export interface RoutePolicy {
	route: string;
	method: string;
	access: Access;
	action?: Action;
	allowPublic?: boolean;
	probe?: (ctx: ProbeContext) => {
		params?: Record<string, string>;
		body?: unknown;
		query?: Record<string, string>;
		/** multipart fields; the harness adds a valid tiny PNG as `file`. */
		form?: Record<string, string>;
	};
}

export const ROUTE_POLICIES: RoutePolicy[] = [
	{ route: '/api/health', method: 'GET', access: 'public' },
	{ route: '/api/auth/register', method: 'POST', access: 'public' },
	{ route: '/api/auth/login', method: 'POST', access: 'public' },
	{ route: '/api/auth/logout', method: 'POST', access: 'public' },
	{ route: '/api/auth/forgot', method: 'POST', access: 'public' },
	{ route: '/api/auth/reset', method: 'POST', access: 'public' },
	{ route: '/api/auth/verify', method: 'POST', access: 'public' },
	{ route: '/api/auth/verify/resend', method: 'POST', access: 'session' },
	{ route: '/api/auth/password', method: 'POST', access: 'session' },
	{ route: '/api/auth/google', method: 'GET', access: 'public' },
	{ route: '/api/auth/google/callback', method: 'GET', access: 'public' },
	{ route: '/api/account', method: 'PUT', access: 'session' },
	{ route: '/api/account', method: 'DELETE', access: 'session' },
	{ route: '/api/account/avatar', method: 'POST', access: 'session' },
	// Authorised per row inside the handler (media/cover/avatar ownership), probed by AT-17.
	{ route: '/photos/:path', method: 'GET', access: 'session', allowPublic: true },
	{ route: '/api/trees', method: 'GET', access: 'session' },
	{ route: '/api/trees', method: 'POST', access: 'session' },
	{
		route: '/api/trees/:id',
		method: 'GET',
		access: 'tree',
		allowPublic: true,
		action: 'view',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/trees/:id',
		method: 'PUT',
		access: 'tree',
		action: 'delete',
		probe: (c) => ({ params: { id: c.treeId }, body: { description: 'probe' } })
	},
	{
		route: '/api/trees/:id',
		method: 'DELETE',
		access: 'tree',
		action: 'transferDelete',
		probe: (c) => ({ params: { id: c.treeId }, body: { confirmName: '__probe__' } })
	},
	{
		route: '/api/trees/:id/activity',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/trees/:id/stats',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/trees/:id/members',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/trees/:id/members/:userId',
		method: 'PUT',
		access: 'tree',
		action: 'manageMembers',
		probe: (c) => ({ params: { id: c.treeId, userId: c.memberUserId }, body: { role: 'viewer' } })
	},
	{
		route: '/api/trees/:id/members/:userId',
		method: 'DELETE',
		access: 'tree',
		action: 'manageMembers',
		probe: (c) => ({ params: { id: c.treeId, userId: c.memberUserId } })
	},
	{
		route: '/api/trees/:id/transfer',
		method: 'POST',
		access: 'tree',
		action: 'transferDelete',
		probe: (c) => ({ params: { id: c.treeId }, body: { userId: c.memberUserId } })
	},
	{
		route: '/api/persons',
		method: 'POST',
		access: 'tree',
		action: 'add',
		probe: (c) => ({ body: { treeId: c.treeId, firstName: 'Probe' } })
	},
	{
		route: '/api/persons/:id',
		method: 'GET',
		access: 'tree',
		allowPublic: true,
		action: 'view',
		probe: (c) => ({ params: { id: c.personId } })
	},
	{
		route: '/api/persons/:id',
		method: 'PUT',
		access: 'tree',
		action: 'add',
		probe: (c) => ({ params: { id: c.personId }, body: { version: 1, bio: 'probe' } })
	},
	{
		route: '/api/persons/:id',
		method: 'DELETE',
		access: 'tree',
		action: 'delete',
		probe: (c) => ({ params: { id: c.personId } })
	},
	{
		route: '/api/persons/:id/history',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ params: { id: c.personId } })
	},
	{
		route: '/api/persons/:id/relatives',
		method: 'GET',
		access: 'tree',
		allowPublic: true,
		action: 'view',
		probe: (c) => ({ params: { id: c.personId } })
	},
	{
		route: '/api/persons/:id/relation',
		method: 'GET',
		access: 'tree',
		allowPublic: true,
		action: 'view',
		probe: (c) => ({ params: { id: c.personId }, body: { to: c.otherPersonId } })
	},
	{
		route: '/api/relationships',
		method: 'POST',
		access: 'tree',
		action: 'add',
		probe: (c) => ({
			body: { treeId: c.treeId, person1Id: c.personId, person2Id: c.otherPersonId, type: 'spouse' }
		})
	},
	{
		route: '/api/relationships/:id',
		method: 'PUT',
		access: 'tree',
		action: 'add',
		probe: (c) => ({ params: { id: c.linkId }, body: { notes: 'probe' } })
	},
	{
		route: '/api/relationships/:id',
		method: 'DELETE',
		access: 'tree',
		action: 'delete',
		probe: (c) => ({ params: { id: c.linkId } })
	},
	{
		route: '/api/events',
		method: 'POST',
		access: 'tree',
		action: 'add',
		probe: (c) => ({ body: { treeId: c.treeId, personId: c.personId, type: 'residence' } })
	},
	{
		route: '/api/events/:id',
		method: 'PUT',
		access: 'tree',
		action: 'add',
		probe: (c) => ({ params: { id: c.eventId }, body: { place: 'probe' } })
	},
	{
		route: '/api/events/:id',
		method: 'DELETE',
		access: 'tree',
		action: 'delete',
		probe: (c) => ({ params: { id: c.eventId } })
	},
	{
		route: '/api/search',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ query: { q: 'Probe', treeId: c.treeId } })
	},
	{
		route: '/api/trees/:id/surnames',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/trees/:id/duplicates',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/media',
		method: 'POST',
		access: 'tree',
		action: 'add',
		probe: (c) => ({ form: { treeId: c.treeId, personId: c.personId } })
	},
	{
		route: '/api/media/:id',
		method: 'PUT',
		access: 'tree',
		action: 'add',
		probe: (c) => ({ params: { id: c.mediaId }, body: { caption: 'probe' } })
	},
	{
		route: '/api/media/:id',
		method: 'DELETE',
		access: 'tree',
		action: 'delete',
		probe: (c) => ({ params: { id: c.mediaId } })
	},
	{
		route: '/api/trees/:id/media',
		method: 'GET',
		access: 'tree',
		action: 'view',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/trees/:id/join-codes',
		method: 'GET',
		access: 'tree',
		action: 'createDirectCode',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/join-codes',
		method: 'POST',
		access: 'tree',
		action: 'createDirectCode',
		probe: (c) => ({
			body: { treeId: c.treeId, type: 'direct', linkedPersonId: c.personId, linkedRelationType: 'child', role: 'viewer' }
		})
	},
	{
		route: '/api/join-codes/:id',
		method: 'DELETE',
		access: 'tree',
		action: 'createDirectCode',
		probe: (c) => ({ params: { id: c.directCodeId } })
	},
	{
		route: '/api/trees/:id/members/:userId/review',
		method: 'POST',
		access: 'tree',
		action: 'review',
		probe: (c) => ({ params: { id: c.treeId, userId: c.pendingUserId }, body: { decision: 'approve' } })
	},
	{
		route: '/api/claims',
		method: 'GET',
		access: 'tree',
		action: 'review',
		probe: (c) => ({ query: { treeId: c.treeId } })
	},
	{
		route: '/api/claims/:id',
		method: 'PUT',
		access: 'tree',
		action: 'review',
		probe: (c) => ({ params: { id: c.claimId }, body: { decision: 'reject' } })
	},
	{
		route: '/api/claims/questions/:personId',
		method: 'POST',
		access: 'tree',
		action: 'setQuestions',
		probe: (c) => ({ params: { personId: c.personId }, body: { questions: [{ question: 'First pet?', answer: 'Rex' }] } })
	},
	{
		route: '/api/history/revert',
		method: 'POST',
		access: 'tree',
		action: 'revert',
		probe: (c) => ({ body: { historyId: c.historyId } })
	},
	{
		route: '/api/trees/:id/export',
		method: 'GET',
		access: 'tree',
		action: 'privacyExport',
		probe: (c) => ({ params: { id: c.treeId }, query: { format: 'json' } })
	},
	{
		route: '/api/trees/:id/backup',
		method: 'GET',
		access: 'tree',
		action: 'fullExport',
		probe: (c) => ({ params: { id: c.treeId } })
	},
	{
		route: '/api/gedcom/import',
		method: 'POST',
		access: 'tree',
		action: 'import',
		// preview only: the harness posts a PNG as the file, which parses to zero people
		probe: (c) => ({ query: { preview: '1' }, form: { treeId: c.treeId } })
	},
	// Authorised inside the handler: members or holders of a valid code, or the caller's own data.
	{ route: '/api/join/:code', method: 'GET', access: 'code' },
	{ route: '/api/join/:code', method: 'POST', access: 'code' },
	{ route: '/api/claims', method: 'POST', access: 'code' },
	{ route: '/api/claims/search', method: 'GET', access: 'code' },
	{ route: '/api/claims/questions/:personId', method: 'GET', access: 'code' },
	{ route: '/api/claims/questions/verify/:personId', method: 'PUT', access: 'code' },
	{ route: '/api/notifications', method: 'GET', access: 'session' },
	{ route: '/api/notifications', method: 'PUT', access: 'session' },
	{
		route: '/api/trees/:id/cover',
		method: 'POST',
		access: 'tree',
		action: 'delete',
		probe: (c) => ({ params: { id: c.treeId }, form: {} })
	}
];

export function findPolicy(route: string, method: string): RoutePolicy | undefined {
	return ROUTE_POLICIES.find((p) => p.route === route && p.method === method);
}
