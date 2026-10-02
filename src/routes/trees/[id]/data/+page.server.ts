import type { PageServerLoad } from "./$types";
import { canDo, type Role } from "$lib/server/permissions.js";
import { withTree } from "$lib/server/page-load.js";

export const load: PageServerLoad = ({ locals, params }) =>
	withTree(locals, params.id, "privacyExport", (_c, role) => ({
		treeId: params.id,
		fullExport: canDo(role as Role, "fullExport"),
		canImport: canDo(role as Role, "import"),
	}));
