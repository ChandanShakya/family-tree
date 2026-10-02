import { migrateAndCheck } from '../src/lib/db/index.js';

const dbPath = process.env.DATABASE_PATH ?? './data/family.db';
const migrationsPath = process.env.MIGRATIONS_PATH ?? './src/lib/db/migrations';

const { rebuilt } = migrateAndCheck(dbPath, migrationsPath);
console.log(`migrated ${dbPath}${rebuilt ? ' (fts rebuilt)' : ''}`);
