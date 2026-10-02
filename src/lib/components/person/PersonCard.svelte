<script lang="ts">
	import { resolve } from '$app/paths';
	import Avatar from '$lib/components/media/Avatar.svelte';

	// Compact person link: avatar, name and an optional line (relation or life span).
	let { id, name, photoUrl = null, sub = '' }: { id: string; name: string; photoUrl?: string | null; sub?: string } = $props();
</script>

<a href={resolve(`/persons/${id}` as '/')} class="card flex items-center gap-2 p-2 no-underline">
	<Avatar src={photoUrl} {name} size={36} decorative />
	<span class="flex flex-col">
		<span>{name}</span>
		{#if sub}<span class="muted text-sm">{sub}</span>{/if}
	</span>
</a>
