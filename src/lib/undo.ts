import { invalidateAll } from '$app/navigation';
import { api } from './api.js';
import { toast } from './toast.svelte.js';

/** Revert through the same endpoint as the history UI; the undo toast lives 10 s (§6.6). */
export async function undoBatch(batchId: string): Promise<void> {
	const r = await api('POST', '/api/history/revert', { batchId }, { quiet: true });
	// Reload first, so the confirmation appears only once the page shows the undone state.
	await invalidateAll();
	if (r.ok) toast('Change undone');
	else if (r.status === 409) toast('Someone changed it since; use the history to review', 'error');
	else toast(r.message, 'error');
}

export function offerUndo(text: string, batchId: string | null | undefined): void {
	if (!batchId) return toast(text);
	toast(text, 'ok', { action: { label: 'Undo', run: () => undoBatch(batchId) }, ms: 10_000 });
}
