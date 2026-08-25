import path from 'node:path';
import { appConfig } from './config.js';
import { createAppDatabase, dataDir } from './db/runtime.js';

export {
  avatarUploadDir,
  backendRoot,
  createAppDatabase,
  dataDir,
  ensureStorageDirs
} from './db/runtime.js';
export { initializeDatabase } from './db/schema.js';

export const databasePath = appConfig.databasePath || path.join(dataDir, 'flai.sqlite');
export const db = createAppDatabase(databasePath);
