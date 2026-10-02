import { z } from 'zod';
import { PersonCreateSchema } from './persons.js';

const Role = z.enum(['viewer', 'contributor', 'editor']);
const Relation = z.enum(['parent', 'child', 'spouse', 'sibling', 'self']);

/** Redeeming a code: the visitor's own details (ignored for a `self` code). */
export const JoinRedeemSchema = PersonCreateSchema.omit({ treeId: true, isLiving: true }).partial();

export const JoinCodeCreateSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('family'),
		treeId: z.uuid({ error: 'Valid treeId is required' }),
		expiresAt: z.iso.datetime({ error: 'expiresAt must be an ISO timestamp' }).nullable().optional()
	}),
	z.object({
		type: z.literal('direct'),
		treeId: z.uuid({ error: 'Valid treeId is required' }),
		linkedPersonId: z.uuid({ error: 'Valid linkedPersonId is required' }),
		linkedRelationType: Relation,
		role: Role.optional(),
		expiresAt: z.iso.datetime({ error: 'expiresAt must be an ISO timestamp' }).nullable().optional()
	})
]);

export const MemberReviewSchema = z.object({ decision: z.enum(['approve', 'reject']) });

export const ClaimCreateSchema = z.object({
	treeId: z.uuid(),
	personId: z.uuid(),
	proofMethod: z.enum(['matching', 'manual']),
	claimedFirstName: z.string().trim().max(100).optional(),
	claimedLastName: z.string().trim().max(100).optional(),
	claimedBirthDate: z.string().trim().max(100).optional(),
	claimedBirthPlace: z.string().trim().max(200).optional(),
	claimedRelation: z.string().trim().max(200).optional(),
	code: z.string().trim().max(100).optional()
});

export const ClaimReviewSchema = z
	.object({
		decision: z.enum(['approve', 'reject']),
		note: z.string().trim().max(1000).optional(),
		linkedRelationType: z.enum(['parent', 'child', 'spouse', 'sibling']).optional(),
		linkedToPersonId: z.uuid().optional()
	})
	.refine((v) => !v.linkedRelationType === !v.linkedToPersonId, {
		error: 'linkedRelationType and linkedToPersonId go together'
	});

export const QuestionsSetSchema = z.object({
	questions: z
		.array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(300) }))
		.min(1)
		.max(10)
});

export const VerifySchema = z.object({
	answers: z.array(z.object({ questionId: z.uuid(), answer: z.string().max(300) })).min(1).max(10),
	code: z.string().trim().max(100).optional()
});

export const RevertSchema = z
	.object({
		historyId: z.string().trim().min(1).max(64).optional(),
		batchId: z.string().trim().min(1).max(64).optional(),
		force: z.boolean().optional()
	})
	.refine((v) => !!v.historyId !== !!v.batchId, { error: 'Provide exactly one of historyId or batchId' });

export const NotificationsUpdateSchema = z
	.object({ ids: z.array(z.uuid()).max(100).optional(), all: z.boolean().optional() })
	.refine((v) => v.all || (v.ids && v.ids.length > 0), { error: 'Provide ids or all' });
