// Minimal toast store (§7): one live region, auto-dismiss. An optional action
// (e.g. Undo) keeps the toast for `ms` (10 s for undo, §6.6).
export type Toast = { id: number; kind: 'ok' | 'error'; text: string; action?: { label: string; run: () => void | Promise<void> } };

export const toasts = $state<Toast[]>([]);
let n = 0;

export function dismiss(id: number): void {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}

export function toast(text: string, kind: Toast['kind'] = 'ok', opts?: { action?: Toast['action']; ms?: number }): void {
	const id = ++n;
	toasts.push({ id, kind, text, action: opts?.action });
	setTimeout(() => dismiss(id), opts?.ms ?? 5000);
}
