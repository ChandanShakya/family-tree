import { z } from 'zod';

const DateCal = z.enum(['AD', 'BS']);

export const EventCreateSchema = z.object({
	treeId: z.uuid({ error: 'Valid treeId is required' }),
	personId: z.uuid({ error: 'Valid personId is required' }),
	type: z.string({ error: 'Type is required' }).trim().min(1).max(100),
	date: z.string().trim().max(100).optional(),
	dateCal: DateCal.optional(),
	place: z.string().trim().max(200).optional(),
	description: z.string().trim().max(5000).optional()
});

export const EventUpdateSchema = z
	.object({
		type: z.string().trim().min(1).max(100).optional(),
		date: z.string().trim().max(100).nullable().optional(),
		dateCal: DateCal.optional(),
		place: z.string().trim().max(200).nullable().optional(),
		description: z.string().trim().max(5000).nullable().optional()
	})
	.refine((v) => Object.values(v).some((x) => x !== undefined), {
		error: 'At least one field is required'
	});
