import { z } from 'zod';

const Opt = z.string().trim().max(200).optional();

// q may be empty when at least one filter is given.
export const SearchQuerySchema = z
	.object({
		q: z.string().trim().max(200).default(''),
		treeId: z.uuid({ error: 'Valid treeId is required' }),
		name: Opt,
		birthYear: z.string().trim().regex(/^\d{1,4}$/, { error: 'birthYear must be a year' }).optional(),
		place: Opt
	})
	.refine((v) => v.q || v.name || v.birthYear || v.place, {
		error: 'Query parameter "q" or a filter is required'
	});
