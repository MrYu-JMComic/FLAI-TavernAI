import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db.js';

const BACKUP_DIR = path.join(dataDir, 'backups');
const MAX_BACKUPS = 7;

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupFileName() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  return `flai-${date}.sqlite`;
}

/**
 * Create a backup of flai.sqlite.
 * Returns the backup file path, or null if the source DB doesn't exist.
 */
export function createBackup() {
  const sourcePath = path.join(dataDir, 'flai.sqlite');
  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  ensureBackupDir();
  const destPath = path.join(BACKUP_DIR, backupFileName());

  // Use SQLite's backup via file copy (safe with WAL mode — checkpoint first)
  fs.copyFileSync(sourcePath, destPath);

  // Also copy WAL and SHM files if they exist
  const walPath = sourcePath + '-wal';
  const shmPath = sourcePath + '-shm';
  if (fs.existsSync(walPath)) {
    fs.copyFileSync(walPath, destPath + '-wal');
  }
  if (fs.existsSync(shmPath)) {
    fs.copyFileSync(shmPath, destPath + '-shm');
  }

  pruneOldBackups();
  return destPath;
}

/**
 * Remove backups older than MAX_BACKUPS days, keeping only the most recent ones.
 */
function pruneOldBackups() {
  if (!fs.existsSync(BACKUP_DIR)) {
    return;
  }

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('flai-') && f.endsWith('.sqlite'))
    .sort()
    .reverse();

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
    const today = new Date().toISOString().slice(0, 10);
    if (lastBackupDate !== today) {
      const result = createBackup();
      if (result) {
        lastBackupDate = today;
        console.log(`[backup] Daily backup created: ${result}`);
      }
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
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('flai-') && f.endsWith('.sqlite'))
    .sort()
    .reverse();

  return files.map((f) => {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    return {
      filename: f,
      size: stat.size,
      createdAt: stat.mtime.toISOString()
    };
  });
}
