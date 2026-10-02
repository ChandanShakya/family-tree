<script lang="ts">
	import { Archive, Download } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';
	import { api } from '$lib/api.js';
	import { IMPORT_MAX_BYTES } from '$lib/config.js';
	import { toast } from '$lib/toast.svelte.js';

	let { data } = $props();
	const treeId = $derived(data.treeId);
	let excludeLiving = $state(false);
	let file = $state<File | null>(null);
	let preview = $state<{ persons: number; relationships: number; warnings: string[]; unknownTags: number } | null>(null);
	let busy = $state(false);

	const q = $derived(excludeLiving ? '&excludeLiving=1' : '');

	async function send(previewOnly: boolean) {
		if (!file) return;
		if (file.size > IMPORT_MAX_BYTES) {
			toast('The file is larger than 5 MB', 'error');
			return;
		}
		busy = true;
		const f = new FormData();
		f.set('treeId', treeId);
		f.set('file', file);
		const r = await api<{ persons: number; relationships: number; warnings: string[]; unknownTags: number }>('POST', `/api/gedcom/import${previewOnly ? '?preview=1' : ''}`, f);
		busy = false;
		if (!r.ok) return;
		if (previewOnly) preview = r.data;
		else {
			toast(`Imported ${r.data.persons} people and ${r.data.relationships} relationships`);
			preview = null;
			file = null;
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>Import and export · Family Tree</title>
</svelte:head>


<TreeNav {treeId} active="data" />
<div class="page-header">
	<div>
		<h1>Import and export</h1>
		<p>Import a GEDCOM file or download this tree.</p>
	</div>
</div>

<div class="grid gap-6 lg:grid-cols-2">
	<section class="section">
		<h2>Export</h2>
		<p class="muted text-sm">
			{#if data.fullExport}Owners and editors export everything unless “exclude living people” is ticked.{:else}Your export hides living and unknown people: they appear as “Living” with no dates, places, notes or photos.{/if}
		</p>
		{#if data.fullExport}<label class="mt-3 flex items-center gap-2"><input type="checkbox" bind:checked={excludeLiving} /> Exclude living people</label>{/if}
		<div class="mt-4 flex flex-wrap gap-2">
			<a class="dl" href={resolve(`/api/trees/${treeId}/export?format=gedcom${q}` as '/')} download><Download size={16} /> GEDCOM</a>
			<a class="dl" href={resolve(`/api/trees/${treeId}/export?format=json${q}` as '/')} download><Download size={16} /> JSON</a>
			<a class="dl" href={resolve(`/api/trees/${treeId}/export?format=csv${q}` as '/')} download><Download size={16} /> CSV</a>
			{#if data.fullExport}<a class="dl" href={resolve(`/api/trees/${treeId}/backup` as '/')} download><Archive size={16} /> Backup (tree + photos)</a>{/if}
		</div>
	</section>

	{#if data.canImport}
		<section class="section">
			<h2>Import GEDCOM</h2>
			<p class="muted text-sm">Adds the people in the file to this tree. Nothing is merged or overwritten. Maximum 5 MB.</p>
			<label class="mt-3">GEDCOM file <input type="file" accept=".ged,.gedcom,text/plain" class="file text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:font-semibold file:text-foreground" onchange={(e) => { file = e.currentTarget.files?.[0] ?? null; preview = null; }} /></label>
			<div class="mt-3 flex gap-2">
				<button type="button" class="secondary" disabled={!file || busy} onclick={() => send(true)}>Preview</button>
				{#if preview}<button type="button" disabled={busy} onclick={() => send(false)}>Import {preview.persons} people</button>{/if}
			</div>
			{#if preview}
				<div class="mt-4 rounded-lg border bg-muted/50 p-4 text-sm" role="status">
					<p>{preview.persons} people and {preview.relationships} relationships will be added.</p>
					{#if preview.unknownTags}<p class="muted">{preview.unknownTags} unsupported tags are ignored.</p>{/if}
					{#if preview.warnings.length}
						<details class="mt-2"><summary class="cursor-pointer">{preview.warnings.length} warnings</summary>
							<ul class="mt-2 list-disc pl-5">{#each preview.warnings.slice(0, 50) as w (w)}<li>{w}</li>{/each}</ul>
						</details>
					{/if}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.dl {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid var(--input);
		border-radius: 12px;
		color: var(--foreground);
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
	}
	.dl:hover {
		background: var(--muted);
	}
	.file {
		padding: 8px;
	}
</style>
