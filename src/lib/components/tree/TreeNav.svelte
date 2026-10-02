<script lang="ts">
	import { resolve } from '$app/paths';
	let { treeId, active }: { treeId: string; active: 'tree' | 'members' | 'claims' | 'activity' | 'media' | 'data' | 'settings' } = $props();
	const tabs = [
		['tree', '', 'Tree'],
		['members', '/members', 'Members'],
		['claims', '/claims', 'Claims'],
		['activity', '/activity', 'Activity'],
		['media', '/media', 'Photos'],
		['data', '/data', 'Import & export'],
		['settings', '/settings', 'Settings']
	] as const;
</script>

<!-- Section tabs; on desktop the sidebar carries the same links. -->
<nav aria-label="Tree sections" class="tabs -mx-4 mb-6 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0 lg:hidden">
	<div class="flex min-w-max gap-1">
		{#each tabs as [key, suffix, label] (key)}
			<a
				href={resolve(`/trees/${treeId}${suffix}` as '/')}
				aria-current={active === key ? 'page' : undefined}
				class="-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium no-underline hover:no-underline {active === key
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}">{label}</a
			>
		{/each}
	</div>
</nav>

<style>
	.tabs {
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
</style>
