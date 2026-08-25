import fs from 'node:fs';
import path from 'node:path';
import { databasePath, db } from '../db.js';

const { sourcePath: SOURCE_PATH, backupDir: BACKUP_DIR } = resolveBackupStorage(databasePath);
const MAX_BACKUPS = 7;

export function resolveBackupStorage(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === ':memory:') {
    return { sourcePath: '', backupDir: '' };
  }
  const sourcePath = path.resolve(normalized);
  return {
    sourcePath,
    backupDir: path.join(path.dirname(sourcePath), 'backups')
  };
}

function compareBackupFileNameNewestFirst(current, next) {
  if (current < next) return 1;
  if (current > next) return -1;
  return 0;
}

export function getBackupFileNamesNewestFirst(fileNames = []) {
  const backupFileNames = [];
  for (const fileName of fileNames) {
    if (typeof fileName === 'string' && fileName.startsWith('flai-') && fileName.endsWith('.sqlite')) {
      backupFileNames.push(fileName);
    }
  }
  backupFileNames.sort(compareBackupFileNameNewestFirst);
  return backupFileNames;
}

function ensureBackupDir() {
  if (!BACKUP_DIR) {
    return false;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return true;
}

function backupFileName() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  return `flai-${date}.sqlite`;
}

/**
 * Create a backup of flai.sqlite.
 * Returns the backup file path, or null if the source DB doesn't exist.
 *
 * Uses SQLite's `VACUUM INTO`, an online backup that runs through the live
 * database connection. Unlike copying the file on disk, it needs no OS-level
 * file handle on the source, so it never hits Windows EBUSY locks, and it
 * writes a single consolidated file (WAL already folded in) rather than a
 * separate main/-wal/-shm trio.
 */
export function createBackup() {
  if (!SOURCE_PATH || !fs.existsSync(SOURCE_PATH)) {
    return null;
  }

  if (!ensureBackupDir()) {
    return null;
  }
  const destPath = path.join(BACKUP_DIR, backupFileName());

  // VACUUM INTO refuses to overwrite; clear any prior file for the same day.
  removeBackupFileGroup(destPath);

  db.exec(`VACUUM INTO '${escapeSqlStringLiteral(destPath)}'`);

  pruneOldBackups();
  return destPath;
}

function escapeSqlStringLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function removeBackupFileGroup(backupPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(backupPath + suffix, { force: true });
    } catch {
      // Ignore removal errors; VACUUM INTO will surface a real conflict.
    }
  }
}

/**
 * Remove backups older than MAX_BACKUPS days, keeping only the most recent ones.
 */
function pruneOldBackups() {
  const files = readBackupFileNamesNewestFirst();

  // Keep only the most recent MAX_BACKUPS backups
  for (const file of files.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, file));
      // Also remove associated WAL/SHM files
      const walFile = path.join(BACKUP_DIR, file + '-wal');
      const shmFile = path.join(BACKUP_DIR, file + '-shm');
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
      if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
    } catch {
      // Ignore deletion errors
    }
  }
}

/**
 * Schedule a daily backup at the first opportunity after midnight.
 * Uses setInterval to check every hour if a backup hasn't been made today.
 */
let lastBackupDate = '';

export function scheduleDailyBackup() {
  const tryBackup = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (lastBackupDate !== today) {
        const result = createBackup();
        if (result) {
          lastBackupDate = today;
          console.log(`[backup] Daily backup created: ${result}`);
        }
      }
    } catch (error) {
      console.error('[backup] Daily backup failed (non-fatal):', error?.message || error);
    }
  };

  // Run once immediately on startup
  tryBackup();

  // Check every hour
  setInterval(tryBackup, 60 * 60 * 1000);
}

/**
 * List available backups (for admin API).
 */
export function listBackups() {
  if (!ensureBackupDir()) {
    return [];
  }
  const files = readBackupFileNamesNewestFirst();

  return files.map((f) => {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    return {
      filename: f,
      size: stat.size,
      createdAt: stat.mtime.toISOString()
    };
  });
}

function readBackupFileNamesNewestFirst() {
  if (!BACKUP_DIR || !fs.existsSync(BACKUP_DIR)) {
    return [];
  }
  return getBackupFileNamesNewestFirst(fs.readdirSync(BACKUP_DIR));
}
