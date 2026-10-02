<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';
	import ShareButtons from '$lib/components/join/ShareButtons.svelte';
	import UploadButton from '$lib/components/media/UploadButton.svelte';
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';

	let { data } = $props();
	const treeId = $derived(data.treeId);
	// Local edit drafts, resynced from page data after invalidateAll (§2.1).
	let name = $state('');
	let description = $state('');
	let isPublic = $state(false);
	let confirmName = $state('');
	let expires = $state('');
	$effect(() => {
		name = data.tree.name;
		description = data.tree.description ?? '';
		isPublic = data.tree.isPublic;
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if ((await api('PUT', `/api/trees/${treeId}`, { name, description: description || null, isPublic })).ok) {
			toast('Settings saved');
			await invalidateAll();
		}
	}
	async function toggleCross(allowCrossTree: boolean) {
		if ((await api('PUT', `/api/trees/${treeId}`, { allowCrossTree })).ok) {
			toast('Saved');
			await invalidateAll();
		}
	}
	async function uploadCover(file: File) {
		const f = new FormData();
		f.set('file', file);
		if ((await api('POST', `/api/trees/${treeId}/cover`, f)).ok) {
			toast('Cover updated');
			await invalidateAll();
		}
	}
	async function regenerate() {
		if (!(await confirmDialog('Regenerate the family code? The old code stops working.'))) return;
		const body = { treeId, type: 'family', ...(expires ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}) };
		if ((await api('POST', '/api/join-codes', body)).ok) {
			toast('Family code regenerated');
			await invalidateAll();
		}
	}
	async function remove(e: SubmitEvent) {
		e.preventDefault();
		if ((await api('DELETE', `/api/trees/${treeId}`, { confirmName })).ok) {
			toast('Tree deleted');
			await invalidateAll();
			await goto(resolve('/'));
		}
	}
</script>

<svelte:head>
	<title>Settings · Family Tree</title>
</svelte:head>


<TreeNav {treeId} active="settings" />
<div class="page-header">
	<div>
		<h1>Settings</h1>
		<p>Name, visibility, invitations and ownership.</p>
	</div>
</div>

<div class="flex flex-col gap-6">
	{#if !data.canManage}<p class="muted">Only editors and the owner can change tree settings.</p>{:else}
	<section class="section">
		<h2>General</h2>
		<form onsubmit={save} class="grid max-w-2xl gap-4">
			<label>Name <input bind:value={name} required maxlength="200" /></label>
			<label>Description <textarea bind:value={description} maxlength="2000" rows="3"></textarea></label>
			<label class="flex items-start gap-3 rounded-lg border p-3 font-normal"><input type="checkbox" bind:checked={isPublic} class="mt-0.5" /> <span><strong class="font-semibold">Public tree</strong><br /><span class="muted text-sm">Anyone with the link can view it. Living and unknown people show as “Living” with no dates, places, notes or photos. Requires a verified email.</span></span></label>
			<div><button type="submit">Save</button></div>
		</form>
	</section>

	<section class="section">
		<h2>Cover image</h2>
		{#if data.tree.coverImage}<img src={data.tree.coverImage} alt="Tree cover" class="mb-3 h-40 w-full max-w-xl rounded-xl object-cover" />{/if}
		<UploadButton label="Upload cover" onfile={uploadCover} />
	</section>
	{/if}

	{#if data.familyCode}
		<section class="section">
			<h2>Family code</h2>
			<p class="muted text-sm">Anyone with this code can ask to join. You approve each request.</p>
			<div class="mt-3 flex flex-wrap items-center gap-3">
				<code class="rounded-lg border bg-muted px-3 py-2 font-mono text-base">{data.familyCode.code}</code>
				<span class="muted text-sm">{data.familyCode.maxUses ? `${data.familyCode.currentUses}/${data.familyCode.maxUses} uses` : `Used ${data.familyCode.currentUses} ${data.familyCode.currentUses === 1 ? 'time' : 'times'} · unlimited`}</span>
			</div>
			{#if data.familyCode.expiresAt}<p class="muted mt-2 text-sm">Expires {new Date(data.familyCode.expiresAt).toLocaleDateString()}</p>{/if}
			<div class="mt-3"><ShareButtons code={data.familyCode.code} /></div>
			<div class="mt-4 flex flex-wrap items-end gap-3">
				<label>New code expires (optional) <input type="date" bind:value={expires} /></label>
				<button type="button" class="secondary" onclick={regenerate}>Regenerate</button>
			</div>
		</section>
	{/if}

	{#if data.isOwner}
	<section class="section">
		<h2>Combined family views</h2>
		<label class="flex items-start gap-3 rounded-lg border p-3 font-normal"><input type="checkbox" checked={data.tree.allowCrossTree} class="mt-0.5" onchange={(e) => toggleCross(e.currentTarget.checked)} /> <span><strong class="font-semibold">Allow members to join this tree with their other family trees</strong><br /><span class="muted text-sm">A member whose profile is claimed in several trees (for example after a marriage) can see them on one page and share it. Others see this tree there only if they are members of it.</span></span></label>
	</section>
	<section class="section border-destructive/40">
		<h2 class="text-destructive">Delete tree</h2>
		<p class="muted text-sm">Permanently deletes the tree, its people and photos. This cannot be undone.</p>
		<form onsubmit={remove} class="mt-3 flex flex-wrap items-end gap-3">
			<label class="min-w-64 flex-1">Type the tree name to confirm <input bind:value={confirmName} /></label>
			<button type="submit" class="danger" disabled={confirmName !== data.tree.name}>Delete tree</button>
		</form>
	</section>
	{/if}
</div>
