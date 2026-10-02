<script lang="ts">
	// decorative: next to a visible name (e.g. inside a link), so screen readers do not hear the name twice.
	let { src, name, size = 40, decorative = false }: { src?: string | null; name: string; size?: number; decorative?: boolean } = $props();
	const initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => [...w][0])
			.join('')
			.toUpperCase()
	);
</script>

{#if src}
	<img {src} alt={decorative ? '' : name} width={size} height={size} class="shrink-0 rounded-full object-cover" style="width:{size}px;height:{size}px" />
{:else}
	<span
		class="inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground"
		style="width:{size}px;height:{size}px"
		aria-label={decorative ? undefined : name}
		aria-hidden={decorative ? 'true' : undefined}>{initials}</span
	>
{/if}
