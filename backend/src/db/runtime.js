import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { resetMessageCounter } from '../modules/worldBooks.js';
import { initializeDatabase, resetColumnCache } from './schema.js';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(sourceDir, '..', '..');
export const dataDir = path.join(backendRoot, 'data');
const uploadsDir = path.join(backendRoot, 'uploads');
export const avatarUploadDir = path.join(uploadsDir, 'avatars');

export function ensureStorageDirs() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    console.error(`[db] Failed to create data directory: ${dataDir}`, error.message);
    throw new Error(`Failed to create data directory ${dataDir}: ${error.message}`);
  }
  try {
    fs.mkdirSync(avatarUploadDir, { recursive: true });
  } catch (error) {
    console.error(`[db] Failed to create avatar directory: ${avatarUploadDir}`, error.message);
    throw new Error(`Failed to create avatar directory ${avatarUploadDir}: ${error.message}`);
  }
}

export function createAppDatabase(filename = path.join(dataDir, 'flai.sqlite')) {
  ensureStorageDirs();
  resetColumnCache();
  resetMessageCounter();
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA busy_timeout = 5000');
  initializeDatabase(database);
  return database;
}
