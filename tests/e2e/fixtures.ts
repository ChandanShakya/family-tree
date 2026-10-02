import { test as base, expect } from '@playwright/test';

// Every browser context starts with the onboarding tour already dismissed, so its modal never blocks a flow
// under test; the tour has its own spec that clears the flag.
export const test = base.extend<object, { browser: import('@playwright/test').Browser }>({
	browser: [
		async ({ browser }, use) => {
			const newContext = browser.newContext.bind(browser);
			browser.newContext = async (options) => {
				const context = await newContext(options);
				await context.addInitScript(() => {
					if (!sessionStorage.getItem('tour-test')) localStorage.setItem('onboarded', '1');
				});
				return context;
			};
			await use(browser);
		},
		{ scope: 'worker' }
	]
});

export { expect };
