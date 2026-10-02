/** Same-site path from a `?next=` value; anything else (other origins, `//host`, `\\`) becomes `/`. */
export function safeNext(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
	return value;
}
