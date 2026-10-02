import { z } from 'zod';

const Gender = z.enum(['M', 'F', 'X', 'U']);
const DateCal = z.enum(['AD', 'BS']);

const NameField = z.string().trim().max(100);
const DateText = z.string().trim().max(100);
const PlaceField = z.string().trim().max(200);

export const PersonCreateSchema = z.object({
	treeId: z.uuid({ error: 'Valid treeId is required' }),
	firstName: z.string({ error: 'First name is required' }).trim().min(1).max(100),
	middleName: NameField.optional(),
	lastName: NameField.optional(),
	maidenName: NameField.optional(),
	birthDate: DateText.optional(),
	birthDateCal: DateCal.optional(),
	deathDate: DateText.optional(),
	deathDateCal: DateCal.optional(),
	gender: Gender.optional(),
	birthPlace: PlaceField.optional(),
	deathPlace: PlaceField.optional(),
	bio: z.string().trim().max(5000).optional(),
	isLiving: z.boolean().nullable().optional()
});

export const PersonUpdateSchema = PersonCreateSchema.omit({ treeId: true })
	.partial()
	.extend({
		version: z.number({ error: 'Current version is required' }).int().min(1)
	})
	.refine((v) => Object.entries(v).some(([k]) => k !== 'version'), {
		error: 'At least one field is required'
	});
