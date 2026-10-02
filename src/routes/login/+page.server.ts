import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { googleConfigured } from '$lib/server/oauth.js';

export const load: PageServerLoad = () => ({ googleEnabled: googleConfigured(env) });
