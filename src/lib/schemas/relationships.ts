import { z } from 'zod';

const RelationType = z.enum(['parent', 'spouse', 'sibling', 'guardian']);

export const RelationshipCreateSchema = z.object({
	treeId: z.uuid({ error: 'Valid treeId is required' }),
	person1Id: z.uuid({ error: 'Valid person1Id is required' }),
	person2Id: z.uuid({ error: 'Valid person2Id is required' }),
	type: RelationType,
	startDate: z.string().trim().max(100).optional(),
	endDate: z.string().trim().max(100).optional(),
	notes: z.string().trim().max(2000).optional()
});

export const RelationshipUpdateSchema = z
	.object({
		startDate: z.string().trim().max(100).nullable().optional(),
		endDate: z.string().trim().max(100).nullable().optional(),
		notes: z.string().trim().max(2000).nullable().optional()
	})
	.refine((v) => Object.values(v).some((x) => x !== undefined), {
		error: 'At least one field is required'
	});
