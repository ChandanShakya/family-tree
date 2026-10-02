declare global {
	namespace App {
		interface Error {
			message: string;
			requestId?: string;
		}
		interface Locals {
			user?: { id: string; sessionId: string };
			requestId: string;
			/** Set by handleError when the failure was SQLITE_BUSY (mapped to 503). */
			busy?: boolean;
		}
	}
}

export {};
