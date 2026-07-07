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
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('PRAGMA foreign_keys = ON');
    execWithDatabaseLockRetry(database, 'PRAGMA journal_mode = WAL');
    initializeDatabase(database);
    return database;
  } catch (error) {
    closeDatabaseQuietly(database);
    throw error;
  }
}

function execWithDatabaseLockRetry(database, statement, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 6));
  const delayMs = Math.max(25, Number(options.delayMs || 150));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      database.exec(statement);
      return;
    } catch (error) {
      if (!isDatabaseLockedError(error) || attempt === maxAttempts) {
        throw error;
      }
      waitForDatabaseRetry(delayMs * attempt);
    }
  }
}

export function isDatabaseLockedError(error) {
  const message = `${error?.message || ''} ${error?.errstr || ''}`.toLowerCase();
  return error?.code === 'ERR_SQLITE_ERROR'
    && (
      error?.errcode === 5 ||
      error?.errcode === 6 ||
      error?.errcode === 261 ||
      message.includes('database is locked') ||
      message.includes('database table is locked')
    );
}

function waitForDatabaseRetry(delayMs) {
  const waitBuffer = new SharedArrayBuffer(4);
  const waitArray = new Int32Array(waitBuffer);
  Atomics.wait(waitArray, 0, 0, Math.floor(delayMs));
}

function closeDatabaseQuietly(database) {
  try {
    database.close();
  } catch (error) {
    console.warn('[db] Failed to close database after startup error:', error?.message || error);
  }
}
