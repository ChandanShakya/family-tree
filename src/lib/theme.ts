export type ThemePref = 'system' | 'light' | 'dark';

/** Apply a theme preference to the page and mirror it in localStorage, which the inline script in app.html reads. */
export function applyTheme(pref: ThemePref): void {
	const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.classList.toggle('dark', dark);
	try {
		if (pref === 'system') localStorage.removeItem('theme');
		else localStorage.setItem('theme', pref);
	} catch {
		// storage blocked: the class still applies for this page
	}
}
