import { z } from 'zod';

export const MediaUpdateSchema = z
	.object({
		caption: z.string().trim().max(500).nullable().optional(),
		makePrimary: z.boolean().optional()
	})
	.refine((v) => v.caption !== undefined || v.makePrimary !== undefined, {
		error: 'At least one field is required'
	});

export const MediaCreateFieldsSchema = z.object({
	treeId: z.uuid({ error: 'Valid treeId is required' }),
	personId: z.uuid().optional(),
	caption: z.string().trim().max(500).optional(),
	makePrimary: z.boolean().optional()
});
