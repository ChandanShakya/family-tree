import type Database from 'better-sqlite3';
import type { HistoryEntry } from '$lib/types.js';

// Names for history rows, so the activity reads "Maya added Hari Shakya" instead of raw ids.
// Deleted people keep their name (the row stays until the purge, and snapshots carry it after).

type Row = HistoryEntry & { snapshot?: string | null };
type Named = { firstName?: string; middleName?: string | null; lastName?: string | null };
const nameOf = (p: Named | undefined) => (p ? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : null);
const parse = (s: string | null | undefined): Record<string, unknown> | null => {
	try {
		return s ? (JSON.parse(s) as Record<string, unknown>) : null;
	} catch {
		return null;
	}
};

export function describeRows<T extends Row>(raw: Database.Database, rows: T[]): (T & Pick<HistoryEntry, 'subject' | 'subjectId' | 'detail'>)[] {
	const person = raw.prepare(`SELECT firstName, middleName, lastName FROM persons WHERE id = ?`);
	const rel = raw.prepare(`SELECT person1Id, person2Id, type FROM relationships WHERE id = ?`);
	const event = raw.prepare(`SELECT personId, type FROM events WHERE id = ?`);
	const media = raw.prepare(`SELECT personId FROM media WHERE id = ?`);
	const tree = raw.prepare(`SELECT name FROM trees WHERE id = ?`);
	const cache = new Map<string, string | null>();
	const pname = (id: unknown) => {
		if (typeof id !== 'string') return null;
		if (!cache.has(id)) cache.set(id, nameOf(person.get(id) as Named | undefined));
		return cache.get(id) ?? null;
	};
	return rows.map((r) => {
		const snap = parse(r.snapshot);
		const snapPerson = (snap?.person as Named | undefined) ?? (snap as Named | null) ?? undefined;
		let subject: string | null = null;
		let subjectId: string | null = null;
		let detail: string | null = null;
		if (r.entityType === 'person') {
			subject = pname(r.entityId) ?? nameOf(snapPerson?.firstName ? snapPerson : undefined);
			subjectId = r.entityId;
		} else if (r.entityType === 'relationship') {
			const l = (rel.get(r.entityId) as { person1Id: string; person2Id: string; type: string } | undefined) ?? (snap as { person1Id?: string; person2Id?: string; type?: string } | null);
			if (l?.person1Id && l.person2Id) {
				const a = pname(l.person1Id) ?? 'someone';
				const b = pname(l.person2Id) ?? 'someone';
				subject = l.type === 'parent' ? `${a} as parent of ${b}` : l.type === 'guardian' ? `${a} as guardian of ${b}` : `${a} and ${b} as ${l.type === 'spouse' ? 'spouses' : 'siblings'}`;
				subjectId = l.person2Id;
			}
		} else if (r.entityType === 'event') {
			const e = (event.get(r.entityId) as { personId: string; type: string } | undefined) ?? (snap as { personId?: string; type?: string } | null);
			subject = pname(e?.personId);
			subjectId = (e?.personId as string | undefined) ?? null;
			detail = (e?.type as string | undefined) ?? null;
		} else if (r.entityType === 'media') {
			const m = (media.get(r.entityId) as { personId: string | null } | undefined) ?? (snap as { personId?: string } | null);
			subject = pname(m?.personId);
			subjectId = (m?.personId as string | undefined) ?? null;
		} else if (r.entityType === 'tree') {
			subject = (tree.get(r.entityId) as { name: string } | undefined)?.name ?? null;
		}
		const { snapshot: _snapshot, ...rest } = r;
		void _snapshot;
		return { ...(rest as T), subject, subjectId, detail };
	});
}
