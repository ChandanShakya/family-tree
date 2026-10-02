// Promise-based confirm dialog state; rendered by ConfirmDialog.svelte.
export const confirmState = $state<{ message: string; resolve: ((ok: boolean) => void) | null }>({
	message: '',
	resolve: null
});

export function confirmDialog(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		confirmState.message = message;
		confirmState.resolve = resolve;
	});
}
