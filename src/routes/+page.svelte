<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';
	import OnboardingTour from '$lib/components/shared/OnboardingTour.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Check, Plus, Server, ShieldCheck, TreePine, Users } from '@lucide/svelte';
	import { onMount } from 'svelte';

	const FEATURES = [
		{ icon: Users, title: 'Built together', text: 'Relatives join with a code, add their own branch and claim their profile. Owners approve, and every edit can be undone.' },
		{ icon: ShieldCheck, title: 'Private by default', text: 'Public trees and exports show living people only as “Living”. Photos are never cached by shared caches.' },
		{ icon: Server, title: 'Yours to host', text: 'One Docker command, SQLite, and a Cloudflare Tunnel. Runs happily on a Raspberry Pi 4.' }
	];

	let demo = $state<HTMLVideoElement>();
	onMount(() => {
		if (demo && !matchMedia('(prefers-reduced-motion: reduce)').matches) void demo.play().catch(() => {});
	});

	let { data } = $props();
	let name = $state('');
	let nameInput: HTMLInputElement | undefined = $state();
	let dialog: HTMLDialogElement | undefined = $state();

	function openCreate() {
		dialog?.showModal();
		nameInput?.focus();
	}

	// Bottom-nav "Add" lands here with ?create=1.
	$effect(() => {
		if (page.url.searchParams.get('create') === '1' && dialog && !dialog.open) openCreate();
	});

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const r = await api<{ tree: { id: string } }>('POST', '/api/trees', { name });
		if (!r.ok) return;
		toast('Tree created');
		dialog?.close();
		name = '';
		await invalidateAll();
		// Prompt to add your own person next.
		await goto(resolve(`/trees/${r.data.tree.id}?new=1` as '/'));
	}
</script>

<svelte:head>
	<title>Your trees · Family Tree</title>
</svelte:head>

{#if !data.me}
	<section class="grid items-center gap-10 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-12">
		<div>
			<p class="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm font-medium text-muted-foreground">
				<span class="size-2 rounded-full bg-primary"></span> Open source · self-hosted
			</p>
			<h1 class="text-4xl! leading-tight! sm:text-5xl!">Your family’s story, <span class="text-primary">built together.</span></h1>
			<p class="mt-4 text-lg text-muted-foreground">
				A collaborative family tree your relatives fill in with you. Every change is kept in history, living people stay private, and the data lives on your own server, even a Raspberry Pi.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button size="lg" href={resolve('/register')}>Create an account</Button>
				<Button size="lg" variant="outline" href={resolve('/login')}>Log in</Button>
			</div>
			<ul class="mt-8 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
				<li class="flex items-center gap-2"><Check size={16} class="text-primary" /> AD and Bikram Sambat dates</li>
				<li class="flex items-center gap-2"><Check size={16} class="text-primary" /> “How are we related?”</li>
				<li class="flex items-center gap-2"><Check size={16} class="text-primary" /> Invite family with a code</li>
				<li class="flex items-center gap-2"><Check size={16} class="text-primary" /> GEDCOM import and export</li>
			</ul>
		</div>
		<figure class="overflow-hidden rounded-2xl border bg-card shadow-xl">
			<!-- Music only, no speech: the figcaption describes the content. Muted autoplay unless reduced motion is preferred. -->
			<video
				bind:this={demo}
				src="/media/demo.mp4"
				poster="/media/demo.jpg"
				muted
				loop
				playsinline
				controls
				preload="metadata"
				class="block aspect-video w-full bg-[#0f172a]"
				aria-describedby="demo-caption"
			></video>
			<figcaption id="demo-caption" class="px-4 py-3 text-sm text-muted-foreground">A 20-second tour: the tree, adding a person, “How are we related?” and privacy.</figcaption>
		</figure>
	</section>

	<section class="mt-10 grid gap-4 md:grid-cols-3">
		{#each FEATURES as f (f.title)}
			<div class="section">
				<span class="mb-3 grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground"><f.icon size={20} /></span>
				<h3 class="mt-0">{f.title}</h3>
				<p class="muted text-sm">{f.text}</p>
			</div>
		{/each}
	</section>
{:else}
	{#if data.trees?.length === 0}<OnboardingTour />{/if}
	<div class="page-header">
		<div>
			<h1>Your trees</h1>
			<p>Welcome back, {data.me.displayName}.</p>
		</div>
		<button type="button" onclick={openCreate}><Plus size={18} /> New tree</button>
	</div>
	{#if data.trees?.length === 0}
		<div class="section mb-6 flex flex-col items-center gap-2 py-12 text-center">
			<span class="mb-2 grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground"><TreePine size={24} /></span>
			<p class="text-base font-semibold">No trees yet</p>
			<p class="muted text-sm">Create your first tree, or open a join link a relative sent you.</p>
			<button type="button" class="mt-3" onclick={openCreate}><Plus size={18} /> New tree</button>
		</div>
	{/if}
	<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.trees ?? [] as t (t.id)}
			<li class="card group overflow-hidden transition-shadow hover:shadow-md">
				{#if t.coverImage}
					<img src={t.coverImage} alt="" class="h-32 w-full object-cover" />
				{:else}
					<div class="h-20 bg-gradient-to-br from-primary/25 via-accent to-card"></div>
				{/if}
				<div class="p-5">
					<h3 class="mt-0"><a href={resolve(`/trees/${t.id}` as '/')} class="text-foreground">{t.name}</a></h3>
					{#if t.description}<p class="muted line-clamp-2 text-sm">{t.description}</p>{/if}
					<p class="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Users size={15} /> {t.memberCount} member{t.memberCount === 1 ? '' : 's'}</p>
				</div>
			</li>
		{/each}
	</ul>
	<dialog bind:this={dialog} aria-labelledby="new-tree-title">
		<h2 id="new-tree-title" class="mt-0">Create a new tree</h2>
		<p class="muted mb-4 text-sm">You become its owner and can invite relatives afterwards.</p>
		<form onsubmit={create} class="grid gap-4">
			<label>New tree name <input bind:this={nameInput} bind:value={name} required maxlength="200" placeholder="e.g. The Shakya family" /></label>
			<div class="flex justify-end gap-2">
				<button type="button" class="secondary" onclick={() => dialog?.close()}>Cancel</button>
				<button type="submit">Create tree</button>
			</div>
		</form>
	</dialog>
{/if}
