// Tunable defaults per SPECS.md §0.2. One exported constant each.
export const LIVING_ASSUMPTION_YEARS = 110;
export const MIN_VERIFICATION_QUESTIONS = 3;
export const VERIFY_MAX_ATTEMPTS_PER_24H = 5;
export const SOFT_DELETE_PURGE_DAYS = 30;
export const SESSION_DAYS = 30;
export const CONTRIBUTOR_REVERT_OWN_ONLY = true;
// Family codes are unlimited by default (owner request, D-034); NULL in the DB means unlimited.
export const FAMILY_CODE_DEFAULT_MAX_USES: number | null = null;
export const EDIT_NOTIFY_COALESCE_MINUTES = 10;
export const TREE_FOCUS_MODE_THRESHOLD = 500;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_HASH_CONCURRENCY = 2;
export const MAX_TRAVERSAL_DEPTH = 30;
export const MAX_TRAVERSAL_NODES = 5000;
export const DEFAULT_FOCUS_DEPTH = 3;
export const IMPORT_MAX_BYTES = 5242880;
export const IMPORT_MAX_PERSONS = 10000;
export const IMPORT_MAX_RELATIONSHIPS = 20000;
export const MAIN_THREAD_BLOCK_BUDGET_MS = 50;
export const DEFAULT_JOIN_ROLE = 'contributor' as const;
export const MATCH_WEIGHTS = { name: 0.5, birthDate: 0.3, birthPlace: 0.2 } as const;
export const DUPLICATE_MAX_PAIRS = 200;
export const UPLOAD_MAX_BYTES = 10485760;
export const IMAGE_MAX_PIXELS = 25000000;
export const MAINTENANCE_INTERVAL_HOURS = 6;

export const RATE_LIMITS = {
	register: { limit: 3, windowMs: 60_000 },
	login: { limit: 5, windowMs: 60_000 },
	logout: { limit: 10, windowMs: 60_000 },
	forgot: { limit: 3, windowMs: 3_600_000 },
	join: { limit: 10, windowMs: 60_000 },
	verify: { limit: 20, windowMs: 3_600_000 },
	claims: { limit: 10, windowMs: 3_600_000 },
	search: { limit: 60, windowMs: 60_000 },
	api: { limit: 100, windowMs: 60_000 }
} as const;

export const LOCKOUT_TIERS = [
	{ failures: 5, blockMs: 15 * 60_000 },
	{ failures: 10, blockMs: 60 * 60_000 },
	{ failures: 20, blockMs: 24 * 60 * 60_000 }
] as const;
