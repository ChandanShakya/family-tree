<script lang="ts">
	import type { Snippet } from 'svelte';
	import { TreePine } from '@lucide/svelte';

	// Centred card for sign-in, sign-up and password pages.
	let { title, subtitle = '', children, footer }: { title: string; subtitle?: string; children: Snippet; footer?: Snippet } = $props();
</script>

<div class="flex min-h-[calc(100vh-10rem)] items-center justify-center py-6">
	<div class="w-full max-w-md">
		<div class="mb-6 flex flex-col items-center text-center">
			<span class="mb-4 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><TreePine size={26} /></span>
			<h1>{title}</h1>
			{#if subtitle}<p class="mt-1 text-sm text-muted-foreground">{subtitle}</p>{/if}
		</div>
		<div class="section p-6 sm:p-8">
			{@render children()}
		</div>
		{#if footer}<div class="mt-6 text-center text-sm text-muted-foreground [&_a]:font-medium [&_a]:underline">{@render footer()}</div>{/if}
	</div>
</div>
