<script lang="ts" module>
	export interface MediaItem {
		id: string;
		storagePath: string;
		thumbPath: string | null;
		caption: string | null;
		personId: string | null;
	}
</script>

<script lang="ts">
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';
	import { offerUndo } from '$lib/undo.js';

	let {
		items,
		canPrimary = false,
		readonly = false,
		onchange
	}: { items: MediaItem[]; canPrimary?: boolean; readonly?: boolean; onchange: () => void } = $props();
	let current = $state<MediaItem | null>(null);
	let caption = $state('');
	let dialog: HTMLDialogElement;

	function open(m: MediaItem) {
		current = m;
		caption = m.caption ?? '';
		dialog.showModal();
	}
	async function saveCaption() {
		const r = current ? await api<{ batchId: string | null }>('PUT', `/api/media/${current.id}`, { caption }) : null;
		if (r?.ok) {
			// A modal <dialog> makes the page (and its toast) inert, so close it to leave the Undo reachable.
			dialog.close();
			await onchange();
			offerUndo('Caption saved', r.data.batchId);
		}
	}
	async function primary() {
		if (current && (await api('PUT', `/api/media/${current.id}`, { makePrimary: true })).ok) {
			toast('Profile photo set');
			dialog.close();
			onchange();
		}
	}
	async function remove() {
		if (!current || !(await confirmDialog('Delete this photo?'))) return;
		if ((await api('DELETE', `/api/media/${current.id}`)).ok) {
			toast('Photo deleted');
			dialog.close();
			onchange();
		}
	}
</script>

<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
	{#each items as m (m.id)}
		<li>
			<button type="button" onclick={() => open(m)} class="thumb">
				<img src={`/photos/${m.thumbPath ?? m.storagePath}`} alt={m.caption ?? 'Photo'} loading="lazy" class="aspect-square w-full rounded-lg object-cover transition-transform hover:scale-[1.02]" />
			</button>
		</li>
	{/each}
</ul>

<dialog bind:this={dialog} class="max-w-3xl!" aria-label="Photo">
	{#if current}
		<img src={`/photos/${current.storagePath}`} alt={current.caption ?? 'Photo'} class="max-h-[70vh] w-full rounded-lg bg-muted object-contain" />
		{#if readonly}
			<div class="mt-4 flex items-center gap-3">
				{#if current.caption}<p class="flex-1">{current.caption}</p>{:else}<span class="flex-1"></span>{/if}
				<button type="button" class="secondary" onclick={() => dialog.close()}>Close</button>
			</div>
		{:else}
		<label class="mt-4">Caption <input bind:value={caption} maxlength="500" /></label>
		<div class="mt-4 flex flex-wrap gap-2">
			<button type="button" onclick={saveCaption}>Save caption</button>
			{#if canPrimary && current.personId}<button type="button" class="secondary" onclick={primary}>Use as profile photo</button>{/if}
			<span class="flex-1"></span>
			<button type="button" class="danger" onclick={remove}>Delete</button>
			<button type="button" class="secondary" onclick={() => dialog.close()}>Close</button>
		</div>
		{/if}
	{/if}
</dialog>

<style>
	.thumb {
		display: block;
		width: 100%;
		padding: 0;
		background: transparent;
		box-shadow: none;
		overflow: hidden;
		border-radius: 10px;
	}
	.thumb:hover {
		background: transparent;
	}
</style>
