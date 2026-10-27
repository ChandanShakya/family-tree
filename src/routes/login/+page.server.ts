import type { PageServerLoad } from './$types';
import * as env from '$app/env/private';
import { googleConfigured } from '#lib/server/oauth.js';

export const load: PageServerLoad = () => ({ googleEnabled: googleConfigured(env) });
