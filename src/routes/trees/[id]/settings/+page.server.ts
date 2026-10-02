import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getFamilyCode } from '$lib/server/join-codes.js';
import { canDo, type Role } from '$lib/server/permissions.js';
import { getTreeRow } from '$lib/server/trees.js';
import { withTree } from '$lib/server/page-load.js';

export const load: PageServerLoad = ({ locals, params }) => {
	const { tree, code, canManage, isOwner } = withTree(locals, params.id, 'view', (c, role) => ({
		tree: getTreeRow(c.db, params.id),
		code: canDo(role as Role, 'manageFamilyCode') ? getFamilyCode(c.db, params.id) : null,
		canManage: canDo(role as Role, 'delete'),
		isOwner: canDo(role as Role, 'transferDelete')
	}));
	if (!tree) error(404, 'Not found');
	return {
		treeId: params.id,
		canManage,
		isOwner,
		tree: { name: tree.name, description: tree.description, isPublic: !!tree.isPublic, coverImage: tree.coverImage },
		familyCode: code ? { code: code.code, maxUses: code.maxUses, currentUses: code.currentUses, expiresAt: code.expiresAt } : null
	};
};
