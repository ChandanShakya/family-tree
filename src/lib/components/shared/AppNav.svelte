<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Activity, Database, House, Image, Network, Plus, Search, Settings, ShieldCheck, User, Users } from '@lucide/svelte';

	let { signedIn }: { signedIn: boolean } = $props();

	const here = $derived(page.url.pathname);
	// On a person page the tree comes from the loaded person.
	const treeId = $derived(
		/^\/trees\/([0-9a-f-]+)/.exec(here)?.[1] ?? (page.data as { person?: { treeId?: string } }).person?.treeId ?? null
	);
	const treeLinks = $derived(
		treeId
			? ([
					['Tree', '', Network],
					['Members', '/members', Users],
					['Claims', '/claims', ShieldCheck],
					['Activity', '/activity', Activity],
					['Photos', '/media', Image],
					['Import & export', '/data', Database],
					['Settings', '/settings', Settings]
				] as const)
			: []
	);

	// Search: focus the tree search box when on a tree page, else go home.
	function search() {
		const box = document.querySelector<HTMLInputElement>('input[type=search]');
		if (box) box.focus();
		else void goto(resolve(treeId ? (`/trees/${treeId}` as '/') : '/'));
	}
</script>

{#if signedIn}
	<!-- Mobile (<640): bottom nav. -->
	<nav class="bottom" aria-label="Primary">
		<a href={resolve('/')} aria-label="Home" aria-current={here === '/' ? 'page' : undefined}><House size={22} /></a>
		<a href={resolve('/families')} aria-label="My families" aria-current={here.startsWith('/families') ? 'page' : undefined}><Network size={22} /></a>
		<a href={resolve('/?create=1')} aria-label="Add tree" class="fab"><Plus size={26} /></a>
		<button type="button" class="link" onclick={search} aria-label="Search"><Search size={22} /></button>
		<a href={resolve('/profile')} aria-label="Me" aria-current={here === '/profile' ? 'page' : undefined}><User size={22} /></a>
	</nav>
	<!-- Desktop (>=1024): sidebar. -->
	<aside class="side" aria-label="Sidebar">
		<p class="side-heading">Menu</p>
		<a href={resolve('/')} aria-current={here === '/' ? 'page' : undefined}><House size={18} /> Your trees</a>
		<a href={resolve('/families')} aria-current={here.startsWith('/families') ? 'page' : undefined}><Network size={18} /> My families</a>
		<a href={resolve('/profile')} aria-current={here === '/profile' ? 'page' : undefined}><User size={18} /> Profile</a>
		{#if treeLinks.length}
			<p class="side-heading">This tree</p>
			{#each treeLinks as [label, suffix, Icon] (label)}
				{@const href = `/trees/${treeId}${suffix}`}
				<a href={resolve(href as '/')} aria-current={here === href ? 'page' : undefined}><Icon size={18} /> {label}</a>
			{/each}
		{/if}
	</aside>
{/if}

<style>
	.bottom {
		position: fixed;
		inset: auto 0 0 0;
		display: flex;
		justify-content: space-around;
		align-items: center;
		height: 64px;
		padding-bottom: env(safe-area-inset-bottom);
		background: var(--card);
		border-top: 1px solid var(--border);
		z-index: 40;
	}
	.bottom a,
	.bottom button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		color: var(--muted-foreground);
	}
	.bottom a[aria-current='page'] {
		color: var(--primary);
	}
	.fab {
		background: var(--primary);
		color: var(--primary-foreground) !important;
		border-radius: 50%;
		width: 52px;
		height: 52px;
		margin-top: -24px;
		box-shadow: 0 6px 16px rgb(4 120 87 / 0.35);
	}
	.side {
		display: none;
	}
	@media (min-width: 640px) {
		.bottom {
			display: none;
		}
	}
	@media (min-width: 1024px) {
		.side {
			display: flex;
			flex-direction: column;
			gap: 2px;
			position: fixed;
			top: 64px;
			bottom: 0;
			left: 0;
			width: 240px;
			padding: 16px 12px;
			overflow-y: auto;
			background: var(--card);
			border-right: 1px solid var(--border);
		}
		.side a {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 40px;
			padding: 0 12px;
			border-radius: 10px;
			color: var(--muted-foreground);
			font-weight: 500;
			text-decoration: none;
		}
		.side a:hover {
			background: var(--muted);
			color: var(--foreground);
		}
		.side a[aria-current='page'] {
			background: var(--accent);
			color: var(--accent-foreground);
		}
		.side-heading {
			margin: 16px 12px 6px;
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--muted-foreground);
		}
		.side-heading:first-child {
			margin-top: 0;
		}
	}
</style>
