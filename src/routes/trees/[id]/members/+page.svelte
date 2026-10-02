<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';

	let { data } = $props();
	const treeId = $derived(data.treeId);
	const myRole = $derived(data.members.find((m) => m.userId === data.me?.id)?.role);

	async function setRole(userId: string, role: string) {
		if ((await api('PUT', `/api/trees/${treeId}/members/${userId}`, { role })).ok) toast('Role updated');
		await invalidateAll();
	}
	async function remove(userId: string) {
		if (!(await confirmDialog('Remove this member?'))) return;
		if ((await api('DELETE', `/api/trees/${treeId}/members/${userId}`)).ok) toast('Member removed');
		await invalidateAll();
	}
	async function review(userId: string, decision: 'approve' | 'reject') {
		if ((await api('POST', `/api/trees/${treeId}/members/${userId}/review`, { decision })).ok) {
			toast(decision === 'approve' ? 'Member approved' : 'Request rejected');
		}
		await invalidateAll();
	}
	async function leave() {
		if (!(await confirmDialog('Leave this tree?'))) return;
		if ((await api('DELETE', `/api/trees/${treeId}/members/${data.me!.id}`)).ok) await goto(resolve('/'));
	}
	async function transfer(userId: string) {
		if (!(await confirmDialog('Transfer ownership? You will become an editor.'))) return;
		if ((await api('POST', `/api/trees/${treeId}/transfer`, { userId })).ok) toast('Ownership transferred');
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Members · Family Tree</title>
</svelte:head>


<TreeNav {treeId} active="members" />
<div class="page-header">
	<div>
		<h1>Members</h1>
		<p>People with access to this tree and their roles.</p>
	</div>
</div>

<section class="section overflow-x-auto p-0">
	<table>
		<thead><tr><th class="pl-5">Name</th><th>Role</th><th>Status</th><th class="pr-5 text-right">Actions</th></tr></thead>
		<tbody>
			{#each data.members as m (m.userId)}
				<tr>
					<td class="pl-5 font-medium">{m.displayName ?? 'Unknown'}</td>
					<td>
						{#if myRole === 'owner' && m.role !== 'owner'}
							<select value={m.role} onchange={(e) => setRole(m.userId, e.currentTarget.value)} aria-label="Role of {m.displayName}" class="max-w-40">
								<option>editor</option><option>contributor</option><option>viewer</option>
							</select>
						{:else}<span class="capitalize">{m.role}</span>{/if}
					</td>
					<td>
						<span class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold {m.status === 'active' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}">{m.status}</span>
					</td>
					<td class="pr-5">
						<div class="flex flex-wrap justify-end gap-2">
							{#if (myRole === 'owner' || myRole === 'editor') && m.status === 'pending'}
								<button type="button" onclick={() => review(m.userId, 'approve')}>Approve</button>
								<button type="button" class="secondary" onclick={() => review(m.userId, 'reject')}>Reject</button>
							{/if}
							{#if myRole === 'owner' && m.role !== 'owner' && m.status === 'active'}
								<button type="button" class="secondary" onclick={() => transfer(m.userId)}>Make owner</button>
								<button type="button" class="danger" onclick={() => remove(m.userId)}>Remove</button>
							{/if}
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
{#if myRole && myRole !== 'owner'}
	<p class="mt-6"><button type="button" class="danger" onclick={leave}>Leave tree</button></p>
{/if}
