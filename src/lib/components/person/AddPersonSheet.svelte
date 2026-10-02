<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';
	import { offerUndo } from '$lib/undo.js';
	import PersonForm from './PersonForm.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { X } from '@lucide/svelte';
	import { draftToBody, emptyDraft, type PersonDraft } from './draft.js';
	import { impliedLinks, linkLabel, type Link } from '$lib/utils/family-links.js';

	type Rel = 'parent' | 'child' | 'spouse' | 'sibling' | 'none';
	let {
		treeId,
		anchor = null,
		open = $bindable(false),
		oncreated,
		relationships = [],
		nameOf = () => '…'
	}: {
		treeId: string;
		anchor?: { id: string; name: string } | null;
		/** Existing links in the tree, used to offer the implied ones (e.g. the spouse as other parent). */
		relationships?: { person1Id: string; person2Id: string; type: string }[];
		nameOf?: (id: string) => string;
		open: boolean;
		oncreated: (id: string) => void;
	} = $props();

	let draft = $state<PersonDraft>(emptyDraft());
	let rel = $state<Rel>('none');
	let photo = $state<File | null>(null);
	let photoInput = $state<HTMLInputElement>();
	let dialog: HTMLDialogElement;
	const NEW = '__new__';
	const implied = $derived(anchor && rel !== 'none' ? impliedLinks(relationships, rel, NEW, anchor.id) : []);
	let skipped = $state<string[]>([]);
	const key = (l: Link) => `${l.type}:${l.person1Id}:${l.person2Id}`;
	const label = (id: string) => (id === NEW ? draft.firstName.trim() || 'New person' : nameOf(id));

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	async function save() {
		const r = await api<{ id: string; batchId: string }>('POST', '/api/persons', { treeId, ...draftToBody(draft, false) });
		if (!r.ok) return;
		if (anchor && rel !== 'none') {
			const [p1, p2] =
				rel === 'parent' ? [r.data.id, anchor.id] : rel === 'child' ? [anchor.id, r.data.id] : [anchor.id, r.data.id];
			const type = rel === 'child' ? 'parent' : rel;
			const l = await api('POST', '/api/relationships', { treeId, person1Id: p1, person2Id: p2, type });
			let ok = l.ok;
			for (const x of implied.filter((x) => !skipped.includes(key(x)))) {
				const swap = (id: string) => (id === NEW ? r.data.id : id);
				const e = await api('POST', '/api/relationships', { treeId, person1Id: swap(x.person1Id), person2Id: swap(x.person2Id), type: x.type }, { quiet: true });
				ok &&= e.ok;
			}
			if (!ok) toast('Person added, but not every relationship was', 'error');
		}
		if (photo) {
			const f = new FormData();
			f.set('treeId', treeId);
			f.set('personId', r.data.id);
			f.set('file', photo);
			f.set('makePrimary', 'true');
			const m = await api('POST', '/api/media', f, { quiet: true });
			if (!m.ok) toast(`Person added, but the photo was not: ${m.message}`, 'error');
		}
		offerUndo('Person added', r.data.batchId);
		draft = emptyDraft();
		photo = null;
		if (photoInput) photoInput.value = '';
		rel = 'none';
		skipped = [];
		open = false;
		await invalidateAll();
		oncreated(r.data.id);
	}
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-label="Add person">
	<div class="mb-4 flex items-start justify-between gap-3">
		<div>
			<h2 class="mt-0 mb-1">Add person</h2>
			<p class="muted text-sm">Only a first name is required; add more details any time.</p>
		</div>
		<Button variant="ghost" size="icon" onclick={() => (open = false)} aria-label="Close"><X /></Button>
	</div>
	{#if anchor}
		<label class="mb-4">
			Relationship to {anchor.name}
			<select bind:value={rel}>
				<option value="none">None</option>
				<option value="parent">Parent of</option>
				<option value="child">Child of</option>
				<option value="spouse">Spouse of</option>
				<option value="sibling">Sibling of</option>
			</select>
		</label>
		{#if implied.length}
			<fieldset class="mb-4 flex flex-col gap-2">
				<legend>Also link</legend>
				{#each implied as l (key(l))}
					<label class="flex items-center gap-2 font-normal">
						<input
							type="checkbox"
							checked={!skipped.includes(key(l))}
							onchange={(e) => (skipped = e.currentTarget.checked ? skipped.filter((k) => k !== key(l)) : [...skipped, key(l)])}
						/>
						{linkLabel(l, label)}
					</label>
				{/each}
			</fieldset>
		{/if}
	{/if}
	<PersonForm bind:draft submitLabel="Add" onsubmit={save} oncancel={() => (open = false)}>
		{#snippet extra()}
			<label>
				Photo (optional)
				<input
					bind:this={photoInput}
					type="file"
					accept="image/jpeg,image/png,image/gif,image/webp"
					class="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:font-semibold file:text-foreground"
					onchange={(e) => (photo = e.currentTarget.files?.[0] ?? null)}
				/>
			</label>
		{/snippet}
	</PersonForm>
</dialog>
