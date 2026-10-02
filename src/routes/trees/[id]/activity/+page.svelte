<script lang="ts">
	import { resolve } from '$app/paths';
	import ChangeHistory from '$lib/components/history/ChangeHistory.svelte';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Activity · Family Tree</title>
</svelte:head>


<TreeNav treeId={data.treeId} active="activity" />
<div class="page-header">
	<div>
		<h1>Activity</h1>
		<p>Every change in this tree, newest first.</p>
	</div>
</div>

<section class="section">
	{#if data.page.data.length === 0}<p class="muted">No activity yet.</p>{/if}
	<ChangeHistory rows={data.page.data} />
	{#if data.page.nextCursor}
		<div class="mt-4 flex justify-center">
			<a class="inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold text-foreground no-underline hover:bg-muted" href={resolve(`/trees/${data.treeId}/activity?cursor=${data.page.nextCursor}` as '/')}>Older</a>
		</div>
	{/if}
</section>
