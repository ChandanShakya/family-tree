import { join } from 'node:path';
import { backupDatabase, tarPhotos } from './lib/backup.js';

// Usage (inside the container): tsx scripts/backup.ts [outDir]
const dbPath = process.env.DATABASE_PATH ?? './data/family.db';
const photos = process.env.PHOTO_PATH ?? './photos';
const out = process.argv[2] ?? process.env.BACKUP_DIR ?? './backups';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

await backupDatabase(dbPath, join(out, `family-${stamp}.db`));
const files = await tarPhotos(photos, join(out, `photos-${stamp}.tar`));
console.log(`backup written to ${out}: family-${stamp}.db, photos-${stamp}.tar (${files} files)`);
