import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonCreateSchema } from '$lib/schemas/persons.js';
import { createPerson } from '$lib/server/persons.js';
import { badInput, gateTree, openGate } from '$lib/server/tree-route.js';

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const body = await event.request.json().catch(() => null);
		const parsed = PersonCreateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const g = gateTree(gate, parsed.data.treeId, 'add');
		if (g instanceof Response) return g;
		const { id, batchId } = createPerson(gate, gate.userId, parsed.data.treeId, {
			firstName: parsed.data.firstName,
			middleName: parsed.data.middleName,
			lastName: parsed.data.lastName,
			maidenName: parsed.data.maidenName,
			birthDate: parsed.data.birthDate,
			birthDateCal: parsed.data.birthDateCal,
			deathDate: parsed.data.deathDate,
			deathDateCal: parsed.data.deathDateCal,
			gender: parsed.data.gender,
			birthPlace: parsed.data.birthPlace,
			deathPlace: parsed.data.deathPlace,
			bio: parsed.data.bio,
			isLiving: parsed.data.isLiving
		});
		return json({ data: { id, batchId } }, { status: 201 });
	} finally {
		gate.release();
	}
};
