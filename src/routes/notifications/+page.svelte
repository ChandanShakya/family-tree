<script lang="ts">
	import { CheckCheck } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api.js';

	let { data } = $props();

	async function readAll() {
		await api('PUT', '/api/notifications', { all: true });
		await invalidateAll();
	}
	async function open(id: string) {
		await api('PUT', '/api/notifications', { ids: [id] }, { quiet: true });
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Notifications · Family Tree</title>
</svelte:head>

<div class="page-header">
	<div>
		<h1>Notifications</h1>
		<p>{data.page.unreadCount > 0 ? `${data.page.unreadCount} unread` : 'You are all caught up.'}</p>
	</div>
	{#if data.page.unreadCount > 0}<button type="button" class="secondary" onclick={readAll}><CheckCheck size={16} /> Mark all read</button>{/if}
</div>
{#if data.page.data.length === 0}
	<div class="section py-12 text-center"><p class="muted">Nothing yet.</p></div>
{:else}
	<ul class="section divide-y p-0">
		{#each data.page.data as n (n.id)}
			<li class="flex items-start gap-3 px-5 py-4">
				<span class="mt-2 size-2 shrink-0 rounded-full {n.isRead ? 'bg-transparent' : 'bg-primary'}" aria-hidden="true"></span>
				<div class="min-w-0 flex-1">
					{#if n.linkUrl}
						<a href={resolve(n.linkUrl as '/')} onclick={() => open(n.id)} class="font-medium {n.isRead ? 'text-muted-foreground' : 'text-foreground'}">{n.title}</a>
					{:else}
						<button type="button" class="link px-0 font-medium" onclick={() => open(n.id)}>{n.title}</button>
					{/if}
					<div class="muted text-xs">{new Date(n.createdAt).toLocaleString()}</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}
{#if data.page.nextCursor}
	<div class="mt-4 flex justify-center">
		<a class="inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold text-foreground no-underline hover:bg-muted" href={resolve(`/notifications?cursor=${encodeURIComponent(data.page.nextCursor)}` as '/notifications')}>Older</a>
	</div>
{/if}
