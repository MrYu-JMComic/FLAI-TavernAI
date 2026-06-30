import path from 'node:path';
import { createAppDatabase, dataDir } from './db/runtime.js';

export {
  avatarUploadDir,
  backendRoot,
  createAppDatabase,
  dataDir,
  ensureStorageDirs
} from './db/runtime.js';
export { initializeDatabase } from './db/schema.js';

export const db = createAppDatabase(process.env.FLAI_DB_PATH || path.join(dataDir, 'flai.sqlite'));
