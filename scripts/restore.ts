import { restoreDatabase, untarPhotos } from './lib/backup.js';

// Usage: tsx scripts/restore.ts <family-….db> [photos-….tar]   (stop the app first)
const [dbBackup, photosTar] = process.argv.slice(2);
if (!dbBackup) {
	console.error('usage: tsx scripts/restore.ts <database backup> [photos tar]');
	process.exit(2);
}
const dbPath = process.env.DATABASE_PATH ?? './data/family.db';
restoreDatabase(dbBackup, dbPath, process.env.MIGRATIONS_PATH ?? './src/lib/db/migrations');
console.log(`database restored to ${dbPath}; full-text index rebuilt`);
if (photosTar) {
	const n = await untarPhotos(photosTar, process.env.PHOTO_PATH ?? './photos');
	console.log(`restored ${n} photo files`);
}
