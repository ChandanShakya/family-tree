<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';
	import Gallery from '$lib/components/media/Gallery.svelte';
	import UploadButton from '$lib/components/media/UploadButton.svelte';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';

	let { data } = $props();

	async function upload(file: File) {
		const f = new FormData();
		f.set('treeId', data.treeId);
		f.set('file', file);
		if ((await api('POST', '/api/media', f)).ok) {
			toast('Photo added');
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>Photos · Family Tree</title>
</svelte:head>


<TreeNav treeId={data.treeId} active="media" />
<div class="page-header">
	<div>
		<h1>Photos</h1>
		<p>All photos uploaded to this tree.</p>
	</div>
</div>

<section class="section">
	<div class="mb-4"><UploadButton label="Upload photo" onfile={upload} /></div>
	<Gallery items={data.page.data} onchange={invalidateAll} />
	{#if data.page.data.length === 0}<p class="muted">No photos yet.</p>{/if}
	{#if data.page.nextCursor}
		<div class="mt-4 flex justify-center">
			<a class="inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold text-foreground no-underline hover:bg-muted" href={resolve(`/trees/${data.treeId}/media?cursor=${encodeURIComponent(data.page.nextCursor)}` as '/')}>Older</a>
		</div>
	{/if}
</section>
