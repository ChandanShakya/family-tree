import { sweepOrphans } from './lib/sweep.js';

const removed = sweepOrphans(process.env.DATABASE_PATH ?? './data/family.db', process.env.PHOTO_PATH ?? './photos');
console.log(`sweep-orphans removed ${removed.length} files`);
