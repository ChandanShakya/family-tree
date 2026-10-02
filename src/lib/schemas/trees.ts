import { z } from 'zod';

export const TreeCreateSchema = z.object({
	name: z.string({ error: 'Name is required' }).trim().min(1).max(200),
	description: z.string().trim().max(2000).optional()
});

export const TreeUpdateSchema = z
	.object({
		name: z.string().trim().min(1).max(200).optional(),
		description: z.string().trim().max(2000).nullable().optional(),
		isPublic: z.boolean().optional()
	})
	.refine((v) => Object.values(v).some((x) => x !== undefined), {
		error: 'At least one field is required'
	});

export const TreeDeleteSchema = z.object({
	confirmName: z.string({ error: 'Type the tree name to confirm deletion' }).min(1)
});

export const RoleSchema = z.enum(['owner', 'editor', 'contributor', 'viewer']);

export const MemberRoleSchema = z.object({
	role: z.enum(['editor', 'contributor', 'viewer'])
});
