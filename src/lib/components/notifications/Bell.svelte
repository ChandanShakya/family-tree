<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Bell } from '@lucide/svelte';

	let { initial = 0 }: { initial?: number } = $props();
	// Starts from the server count, then a poll result takes over until the next navigation.
	let unread = $derived(initial);

	// Poll every 60 s while the tab is visible (§6.10); no sockets in v1.
	async function poll() {
		if (document.visibilityState !== 'visible') return;
		const r = await fetch('/api/notifications?limit=1').catch(() => null);
		if (r?.ok) unread = (await r.json()).unreadCount ?? 0;
	}
	onMount(() => {
		const t = setInterval(poll, 60_000);
		const vis = () => void poll();
		document.addEventListener('visibilitychange', vis);
		return () => {
			clearInterval(t);
			document.removeEventListener('visibilitychange', vis);
		};
	});
</script>

<a
	href={resolve('/notifications')}
	aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
	class="relative inline-flex size-11 items-center justify-center rounded-lg text-foreground no-underline hover:bg-muted hover:no-underline"
>
	<Bell size={20} />
	{#if unread > 0}
		<span class="absolute top-1.5 right-1.5 min-w-[18px] rounded-full bg-destructive px-1 text-center text-[11px] leading-[18px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>
	{/if}
</a>
