<script lang="ts">
	// First-run tour (§7.3): four steps, shown once per browser; dismissal is remembered in localStorage.
	const KEY = 'onboarded';
	const STEPS = [
		{ title: 'Start a tree', text: 'Create a tree for your family, or open a join link someone sent you to join theirs.' },
		{ title: 'Add people', text: 'Add yourself first, then parents, spouses and children. Dates can be AD or BS (Bikram Sambat).' },
		{ title: 'Invite family', text: 'Share a family code, or a direct code for a specific person, so relatives can join and fill in details.' },
		{ title: 'Claim and review', text: 'Claim the profile that is you. Every change is kept in history and can be undone or reverted.' }
	];
	let dialog: HTMLDialogElement;
	let step = $state(0);
	const current = $derived(STEPS[step] ?? STEPS[0]!);

	$effect(() => {
		let seen = true;
		try {
			seen = localStorage.getItem(KEY) === '1';
		} catch {
			// storage blocked: do not nag on every page load
		}
		if (!seen && !dialog.open) dialog.showModal();
	});

	function finish() {
		try {
			localStorage.setItem(KEY, '1');
		} catch {
			// ignore
		}
		dialog.close();
	}
</script>

<dialog bind:this={dialog} aria-labelledby="tour-title" oncancel={finish} class="max-w-md!">
	<div class="mb-4 flex items-center justify-between">
		<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Step {step + 1} of {STEPS.length}</p>
		<div class="flex gap-1.5" aria-hidden="true">
			{#each STEPS as s, i (s.title)}<span class="h-1.5 rounded-full transition-all {i === step ? 'w-6 bg-primary' : 'w-1.5 bg-border'}"></span>{/each}
		</div>
	</div>
	<h2 id="tour-title" class="mt-0">{current.title}</h2>
	<p class="text-muted-foreground">{current.text}</p>
	<div class="mt-6 flex items-center gap-2">
		{#if step < STEPS.length - 1}<button type="button" class="link px-0" onclick={finish}>Skip tour</button>{/if}
		<span class="flex-1"></span>
		{#if step > 0}<button type="button" class="secondary" onclick={() => step--}>Back</button>{/if}
		{#if step < STEPS.length - 1}
			<button type="button" onclick={() => step++}>Next</button>
		{:else}
			<button type="button" onclick={finish}>Get started</button>
		{/if}
	</div>
</dialog>
