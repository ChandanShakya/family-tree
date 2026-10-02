import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '$lib/config.js';

const Email = z.email({ error: 'Valid email is required' }).max(254);
const DisplayName = z.string({ error: 'Display name is required' }).trim().min(1).max(100);
// bcrypt caps at 72 bytes; length floor comes from config.
const Password = z
	.string({ error: 'Password is required' })
	.min(PASSWORD_MIN_LENGTH, { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` })
	.max(256)
	.refine((s) => Buffer.byteLength(s, 'utf8') <= 72, { error: 'Password must be at most 72 bytes' });

const ThemePref = z.enum(['system', 'light', 'dark']);
const DateDisplayPref = z.enum(['AD', 'BS', 'both']);

export const RegisterSchema = z.object({
	email: Email,
	password: Password,
	displayName: DisplayName
});

export const LoginSchema = z.object({
	email: Email,
	password: z.string({ error: 'Password is required' }).max(256)
});

export const ForgotSchema = z.object({
	email: Email
});

export const ResetSchema = z.object({
	token: z.string({ error: 'Token is required' }).min(1).max(256),
	password: Password
});

export const VerifySchema = z.object({
	token: z.string({ error: 'Token is required' }).min(1).max(256)
});

export const PasswordChangeSchema = z.object({
	currentPassword: z.string({ error: 'Current password is required' }).max(256),
	password: Password
});

export const AccountUpdateSchema = z
	.object({
		displayName: DisplayName.optional(),
		themePref: ThemePref.optional(),
		dateDisplayPref: DateDisplayPref.optional(),
		notifyPrefs: z
			.strictObject({
				join: z.boolean().optional(),
				join_approval: z.boolean().optional(),
				claim: z.boolean().optional(),
				claim_review: z.boolean().optional(),
				edit: z.boolean().optional(),
				share: z.boolean().optional()
			})
			.optional()
	})
	.refine((v) => Object.values(v).some((x) => x !== undefined), {
		error: 'At least one field is required'
	});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
