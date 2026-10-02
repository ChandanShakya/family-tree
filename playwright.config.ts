import { defineConfig } from '@playwright/test';

const DIR = './.test-tmp-e2e';

export default defineConfig({
	testDir: './tests/e2e',
	globalTimeout: 480_000,
	workers: 1,
	use: { baseURL: 'http://localhost:4173' },
	webServer: {
		command: `rm -rf ${DIR} && mkdir -p ${DIR} && npm run build && npm run db:migrate && node build`,
		reuseExistingServer: false,
		timeout: 180_000,
		port: 4173,
		env: {
			PORT: '4173',
			RATE_LIMIT_API_MAX: '100000',
			ORIGIN: 'http://localhost:4173',
			DATABASE_PATH: `${DIR}/e2e.db`,
			PHOTO_PATH: `${DIR}/photos`,
			BODY_SIZE_LIMIT: '12M'
		}
	}
});
