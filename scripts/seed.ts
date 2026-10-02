import { openDb } from '../src/lib/db/index.js';

// Phase 1a minimal fixture seed: one user, one tree, two persons.
// Expanded per phase as new tables gain writers.
const dbPath = process.env.DATABASE_PATH ?? './data/family.db';
const { raw } = openDb(dbPath);
try {
	const now = new Date().toISOString();
	raw.prepare(
		"INSERT OR IGNORE INTO users (id, email, displayName, createdAt) VALUES ('u-seed-1', 'seed@example.com', 'Seed User', ?)"
	).run(now);
	raw.prepare(
		"INSERT OR IGNORE INTO trees (id, name, ownerId, createdAt, updatedAt) VALUES ('t-seed-1', 'Seed Tree', 'u-seed-1', ?, ?)"
	).run(now, now);
	raw.prepare(
		"INSERT OR IGNORE INTO persons (id, treeId, firstName, lastName, createdAt, updatedAt) VALUES ('p-seed-1', 't-seed-1', 'Seed', 'Person', ?, ?)"
	).run(now, now);
	console.log(`seeded ${dbPath}`);
} finally {
	raw.close();
}
