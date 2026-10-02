import { openDb, rebuildFts } from '../src/lib/db/index.js';

const dbPath = process.env.DATABASE_PATH ?? './data/family.db';
const { raw } = openDb(dbPath);
try {
	rebuildFts(raw);
	console.log(`rebuilt fts in ${dbPath}`);
} finally {
	raw.close();
}
