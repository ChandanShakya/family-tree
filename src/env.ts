import { defineEnvVars } from '@sveltejs/kit/env';

// Kit 3 only exposes declared variables. All are optional here: each caller applies its own default
// and production checks (SESSION_SECRET, VERIFICATION_PEPPER) at startup.
const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
	ADDRESS_HEADER: { schema: optional },
	DATABASE_PATH: { schema: optional },
	GOOGLE_CLIENT_ID: { schema: optional },
	GOOGLE_CLIENT_SECRET: { schema: optional },
	MIGRATIONS_PATH: { schema: optional },
	NODE_ENV: { schema: optional },
	ORIGIN: { schema: optional },
	PHOTO_PATH: { schema: optional },
	RATE_LIMIT_API_MAX: { schema: optional },
	SESSION_SECRET: { schema: optional },
	SMTP_FROM: { schema: optional },
	SMTP_HOST: { schema: optional },
	SMTP_PASS: { schema: optional },
	SMTP_PORT: { schema: optional },
	SMTP_USER: { schema: optional },
	VERIFICATION_PEPPER: { schema: optional },
	WORKERS_PATH: { schema: optional }
});
