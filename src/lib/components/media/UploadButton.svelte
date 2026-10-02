<script lang="ts">
	import { Upload } from '@lucide/svelte';
	let {
		label,
		accept = 'image/jpeg,image/png,image/gif,image/webp',
		onfile
	}: { label: string; accept?: string; onfile: (f: File) => void | Promise<void> } = $props();
	let input: HTMLInputElement;
</script>

<button type="button" class="secondary" onclick={() => input.click()}><Upload size={16} /> {label}</button>
<input
	bind:this={input}
	type="file"
	{accept}
	hidden
	onchange={() => {
		const f = input.files?.[0];
		if (f) void onfile(f);
		input.value = '';
	}}
/>
