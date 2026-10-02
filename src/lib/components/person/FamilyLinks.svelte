<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SearchBar from '$lib/components/tree/SearchBar.svelte';
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';
	import { offerUndo } from '$lib/undo.js';

	interface Link {
		id: string;
		person1Id: string;
		person2Id: string;
		type: 'parent' | 'spouse' | 'sibling' | 'guardian';
		startDate: string | null;
		endDate: string | null;
		notes: string | null;
	}
	let {
		personId,
		treeId,
		links,
		names,
		canEdit
	}: { personId: string; treeId: string; links: Link[]; names: Record<string, string>; canEdit: boolean } = $props();

	// The other person and how they relate to this one (person1 of a parent/guardian link is the parent/guardian).
	function describe(l: Link): { other: string; label: string } {
		const mine = l.person1Id === personId;
		const other = mine ? l.person2Id : l.person1Id;
		const label =
			l.type === 'parent' ? (mine ? 'Child' : 'Parent') : l.type === 'guardian' ? (mine ? 'Ward' : 'Guardian') : l.type === 'spouse' ? 'Spouse' : 'Sibling';
		return { other, label };
	}

	let editing = $state<string | null>(null);
	let form = $state({ startDate: '', endDate: '', notes: '' });

	function startEdit(l: Link) {
		editing = l.id;
		form = { startDate: l.startDate ?? '', endDate: l.endDate ?? '', notes: l.notes ?? '' };
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		const body = { startDate: form.startDate || null, endDate: form.endDate || null, notes: form.notes || null };
		const r = await api<{ batchId: string | null }>('PUT', `/api/relationships/${editing}`, body);
		if (r.ok) {
			editing = null;
			await invalidateAll();
			offerUndo('Relationship updated', r.data.batchId);
		}
	}

	async function remove(l: Link) {
		const { other, label } = describe(l);
		if (!(await confirmDialog(`Remove ${label.toLowerCase()} link to ${names[other] ?? 'this person'}?`))) return;
		const r = await api<{ batchId: string }>('DELETE', `/api/relationships/${l.id}`);
		if (r.ok) {
			await invalidateAll();
			offerUndo('Relationship removed', r.data.batchId);
		}
	}

	// Link an existing person: `as` is what the picked person is to this one.
	let pick = $state<{ id: string; name: string } | null>(null);
	let as = $state<'parent' | 'child' | 'spouse' | 'sibling' | 'guardian'>('parent');

	async function link(e: SubmitEvent) {
		e.preventDefault();
		if (!pick) return;
		const other = pick.id;
		const [person1Id, person2Id, type] =
			as === 'parent' ? [other, personId, 'parent'] : as === 'child' ? [personId, other, 'parent'] : as === 'guardian' ? [other, personId, 'guardian'] : [personId, other, as];
		const r = await api<{ batchId: string; parentWarning?: boolean }>('POST', '/api/relationships', { treeId, person1Id, person2Id, type });
		if (r.ok) {
			if (r.data.parentWarning) toast('This person now has more than two parents. Check the links.');
			pick = null;
			await invalidateAll();
			offerUndo('Linked', r.data.batchId);
		}
	}
</script>

{#if links.length}
	<ul class="mb-4 flex flex-col gap-2">
		{#each links as l (l.id)}
			{@const d = describe(l)}
			<li class="rounded-lg border px-3 py-2 text-sm">
				{d.label}: <a href={resolve(`/persons/${d.other}` as '/')}>{names[d.other]}</a>
				{#if l.startDate || l.endDate}<span class="muted">({l.startDate ?? '?'}{l.endDate ? ` – ${l.endDate}` : ''})</span>{/if}
				{#if l.notes}<span class="muted">— {l.notes}</span>{/if}
				{#if canEdit}
					<button type="button" class="link" onclick={() => startEdit(l)} aria-label="Edit {d.label.toLowerCase()} link to {names[d.other]}">Edit</button>
					<button type="button" class="link" onclick={() => remove(l)} aria-label="Remove {d.label.toLowerCase()} link to {names[d.other]}">Remove</button>
				{/if}
				{#if editing === l.id}
					<form onsubmit={saveEdit} class="mt-3 grid gap-2 sm:grid-cols-3">
						<input bind:value={form.startDate} placeholder={l.type === 'spouse' ? 'Marriage date' : 'Start date'} aria-label="Link start date" />
						<input bind:value={form.endDate} placeholder="End date" aria-label="Link end date" />
						<input bind:value={form.notes} placeholder="Notes" aria-label="Link notes" />
						<button type="submit">Save link</button>
						<button type="button" onclick={() => (editing = null)}>Cancel</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if canEdit}
	<form onsubmit={link} class="mt-3 grid gap-3 rounded-lg border border-dashed p-3" aria-label="Link an existing person">
		<p class="text-sm font-medium">Link an existing person</p>
		{#if pick}
			<div class="flex min-h-11 items-center justify-between rounded-lg border bg-muted px-3 text-sm">
				<span class="font-medium">{pick.name}</span>
				<button type="button" class="link" onclick={() => (pick = null)} aria-label="Clear picked person">×</button>
			</div>
		{:else}
			<SearchBar {treeId} label="Find a person to link" hotkey={false} filters={false} onpick={(id, name) => (pick = id === personId ? null : { id, name })} />
		{/if}
		<div class="grid grid-cols-[1fr_auto] items-end gap-2">
			<label>
				They are this person's
				<select bind:value={as} aria-label="Relationship">
					<option value="parent">parent</option>
					<option value="child">child</option>
					<option value="spouse">spouse</option>
					<option value="sibling">sibling</option>
					<option value="guardian">guardian</option>
				</select>
			</label>
			<button type="submit" disabled={!pick}>Link</button>
		</div>
	</form>
{/if}
