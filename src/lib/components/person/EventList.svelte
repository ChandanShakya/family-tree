<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api.js';
	import { offerUndo } from '$lib/undo.js';
	import { fmtDate } from '$lib/utils/format.js';
	import type { DateDisplayPref } from '$lib/utils/dates.js';

	interface Ev {
		id: string;
		type: string;
		date: string | null;
		dateCal: string | null;
		place: string | null;
		description: string | null;
	}
	let { personId, treeId, events, pref }: { personId: string; treeId: string; events: Ev[]; pref: DateDisplayPref } = $props();

	const blank = { type: '', date: '', place: '', description: '' };
	let draft = $state({ ...blank });
	let editing = $state<string | null>(null);
	let edit = $state({ ...blank });

	async function add(e: SubmitEvent) {
		e.preventDefault();
		const body = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== ''));
		const r = await api<{ batchId: string }>('POST', '/api/events', { treeId, personId, ...body });
		if (r.ok) {
			draft = { ...blank };
			await invalidateAll();
			offerUndo('Event added', r.data.batchId);
		}
	}

	function startEdit(ev: Ev) {
		editing = ev.id;
		edit = { type: ev.type, date: ev.date ?? '', place: ev.place ?? '', description: ev.description ?? '' };
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const body = { type: edit.type, date: edit.date || null, place: edit.place || null, description: edit.description || null };
		const r = await api<{ batchId: string | null }>('PUT', `/api/events/${editing}`, body);
		if (r.ok) {
			editing = null;
			await invalidateAll();
			offerUndo('Event updated', r.data.batchId);
		}
	}

	async function del(ev: Ev) {
		const r = await api<{ batchId: string }>('DELETE', `/api/events/${ev.id}`);
		if (r.ok) {
			await invalidateAll();
			offerUndo('Event deleted', r.data.batchId);
		}
	}
</script>

<ul class="mb-4 flex flex-col gap-2">
	{#each events as ev (ev.id)}
		<li class="rounded-lg border px-3 py-2 text-sm">
			{ev.type}{ev.date ? ` · ${fmtDate(ev.date, ev.dateCal, pref)}` : ''}{ev.place ? ` · ${ev.place}` : ''}{ev.description ? ` — ${ev.description}` : ''}
			<button type="button" class="link" onclick={() => startEdit(ev)} aria-label="Edit event {ev.type}">Edit</button>
			<button type="button" class="link" onclick={() => del(ev)} aria-label="Delete event {ev.type}">×</button>
			{#if editing === ev.id}
				<form onsubmit={save} class="mt-3 grid gap-2 sm:grid-cols-2">
					<input bind:value={edit.type} required aria-label="Edited event type" />
					<input bind:value={edit.date} placeholder="Date" aria-label="Edited event date" />
					<input bind:value={edit.place} placeholder="Place" aria-label="Edited event place" />
					<input bind:value={edit.description} placeholder="Notes" aria-label="Edited event notes" />
					<button type="submit">Save event</button>
					<button type="button" onclick={() => (editing = null)}>Cancel</button>
				</form>
			{/if}
		</li>
	{/each}
</ul>
<form onsubmit={add} class="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-2" aria-label="Add an event">
	<input bind:value={draft.type} placeholder="Type (e.g. residence)" required aria-label="Event type" />
	<input bind:value={draft.date} placeholder="Date" aria-label="Event date" />
	<input bind:value={draft.place} placeholder="Place" aria-label="Event place" />
	<input bind:value={draft.description} placeholder="Notes" aria-label="Event notes" />
	<button type="submit">Add event</button>
</form>
