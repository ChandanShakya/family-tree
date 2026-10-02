<script lang="ts">
	import { confirmState } from '$lib/confirm.svelte.js';
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (confirmState.resolve && !dialog.open) dialog.showModal();
	});

	function answer(ok: boolean) {
		confirmState.resolve?.(ok);
		confirmState.resolve = null;
		dialog.close();
	}
</script>

<dialog bind:this={dialog} aria-label="Confirm" oncancel={() => answer(false)} class="max-w-md!">
	<h2 class="mt-0 mb-2 text-lg!">Are you sure?</h2>
	<p class="text-muted-foreground">{confirmState.message}</p>
	<div class="mt-6 flex justify-end gap-2">
		<button type="button" class="secondary" onclick={() => answer(false)}>Cancel</button>
		<button type="button" onclick={() => answer(true)}>Confirm</button>
	</div>
</dialog>
