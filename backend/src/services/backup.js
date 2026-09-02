import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { appConfig } from '../config.js';
import { dataDir } from '../db/runtime.js';
import { latestSchemaVersion, listAppliedMigrations } from '../db/migrations.js';
import { logger } from './logger.js';

const defaultDatabasePath = appConfig.databasePath || path.join(dataDir, 'flai.sqlite');
const MAX_BACKUPS = 7;
let backupInProgress = false;

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

function ensureBackupDir(backupDir) {
  if (!backupDir) {
    return false;
  }
  fs.mkdirSync(backupDir, { recursive: true });
  return true;
}

function backupFileName(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const date = now.toISOString().slice(0, 10);
  if (options.label) {
    const time = now.toISOString().slice(11, 19).replace(/:/g, '-');
    const label = String(options.label).replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
    return `flai-${date}T${time}-${label || 'manual'}.sqlite`;
  }
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
export function createBackup(options = {}) {
  if (backupInProgress) {
    throw backupError('A database backup is already in progress.', 'BACKUP_IN_PROGRESS', 409);
  }
  backupInProgress = true;
  try {
    return createBackupInternal(options);
  } finally {
    backupInProgress = false;
  }
}

function createBackupInternal(options = {}) {
  const database = options.database;
  if (!database && options.databasePath === undefined) {
    // A direct helper call without an active database represents the
    // in-memory/no-backup case; do not accidentally inspect the process's
    // default on-disk database.
    return null;
  }
  const storage = resolveBackupStorage(options.databasePath ?? defaultDatabasePath);
  if (!storage.sourcePath || !fs.existsSync(storage.sourcePath)) {
    return null;
  }

  if (!database) {
    throw new Error('An active database connection is required to create a backup');
  }
  if (!ensureBackupDir(storage.backupDir)) {
    return null;
  }
  const destPath = path.join(storage.backupDir, backupFileName(options));
  const temporaryPath = path.join(
    storage.backupDir,
    `.${path.basename(destPath)}.${crypto.randomUUID()}.tmp.sqlite`
  );
  assertPathInside(temporaryPath, storage.backupDir);
  try {
    // VACUUM INTO writes to a new path.  The existing same-day backup is left
    // untouched until the new file has passed integrity verification.
    database.exec(`VACUUM INTO '${escapeSqlStringLiteral(temporaryPath)}'`);
    const integrity = verifyBackupFile(temporaryPath);
    if (integrity !== 'ok') {
      throw backupError('新备份完整性校验失败，已保留旧备份。', 'BACKUP_INTEGRITY_FAILED');
    }
    syncFile(temporaryPath);
    atomicReplaceBackupFile(temporaryPath, destPath);
    const metadata = backupMetadata(database, destPath, integrity);
    writeBackupMetadataAtomically(destPath, metadata);
    // Sidecar files from a previous backup are safe to remove only after the
    // new database file is in place.
    removeBackupSidecars(destPath);
    pruneOldBackups(storage.backupDir);
    return options.withMetadata ? metadata : destPath;
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    } catch (cleanupError) {
      // Best-effort cleanup; the temporary path is unique and harmless.
      void cleanupError;
    }
    throw error;
  }
}

function escapeSqlStringLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function removeBackupSidecars(backupPath) {
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.rmSync(backupPath + suffix, { force: true });
    } catch (error) {
      // Sidecars are optional and can be cleaned on the next run.
      void error;
    }
  }
}

function atomicReplaceBackupFile(temporaryPath, destinationPath) {
  const previousPath = `${destinationPath}.${crypto.randomUUID()}.previous`;
  let movedPrevious = false;
  try {
    if (fs.existsSync(destinationPath)) {
      fs.renameSync(destinationPath, previousPath);
      movedPrevious = true;
    }
    try {
      fs.renameSync(temporaryPath, destinationPath);
    } catch (error) {
      if (movedPrevious && fs.existsSync(previousPath) && !fs.existsSync(destinationPath)) {
        fs.renameSync(previousPath, destinationPath);
      }
      throw error;
    }
  } finally {
    if (movedPrevious) {
      try {
        fs.rmSync(previousPath, { force: true });
      } catch (error) {
        // A stale previous file is recoverable and does not invalidate the
        // newly installed backup.
        void error;
      }
    }
  }
  syncDirectory(path.dirname(destinationPath));
}

function writeBackupMetadataAtomically(destinationPath, metadata) {
  const metadataPath = `${destinationPath}.json`;
  const temporaryPath = `${metadataPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  syncFile(temporaryPath);
  try {
    fs.renameSync(temporaryPath, metadataPath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch (cleanupError) { void cleanupError; }
    throw error;
  }
  syncDirectory(path.dirname(metadataPath));
}

function syncFile(filePath) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // fsync is not available on every filesystem (notably some Windows
    // network shares); integrity verification still protects the data.
    void error;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (error) { void error; }
    }
  }
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Directory fsync is unsupported on Windows; the rename remains atomic.
    void error;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (error) { void error; }
    }
  }
}

/**
 * Remove backups older than MAX_BACKUPS days, keeping only the most recent ones.
 */
function pruneOldBackups(backupDir) {
  const files = readBackupFileNamesNewestFirst(backupDir);

  // Keep only the most recent MAX_BACKUPS backups
  for (const file of files.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(backupDir, file));
      // Also remove associated WAL/SHM files
      const walFile = path.join(backupDir, file + '-wal');
      const shmFile = path.join(backupDir, file + '-shm');
      const metadataFile = path.join(backupDir, file + '.json');
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
      if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
      if (fs.existsSync(metadataFile)) fs.unlinkSync(metadataFile);
    } catch (cleanupError) {
      // Ignore deletion errors
      void cleanupError;
    }
  }
}

/**
 * Schedule a daily backup at the first opportunity after midnight.
 * Uses setInterval to check every hour if a backup hasn't been made today.
 */
let lastBackupDate = '';

export function scheduleDailyBackup(options = {}) {
  const tryBackup = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (lastBackupDate !== today) {
        const result = createBackup(options);
        if (result) {
          lastBackupDate = today;
          logger.info('backup_created', { path: result });
        }
      }
    } catch (error) {
      logger.error('backup_failed', { message: String(error?.message || error) });
    }
  };

  // Run once immediately on startup
  tryBackup();

  // Check every hour
  const timer = setInterval(tryBackup, 60 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * List available backups (for admin API).
 */
export function listBackups(options = {}) {
  if (options.databasePath === undefined) {
    return [];
  }
  const storage = resolveBackupStorage(options.databasePath ?? defaultDatabasePath);
  if (!ensureBackupDir(storage.backupDir)) {
    return [];
  }
  const files = readBackupFileNamesNewestFirst(storage.backupDir);

  return files.map((f) => {
    const filePath = path.join(storage.backupDir, f);
    const stat = fs.statSync(filePath);
    const metadata = readBackupMetadata(`${filePath}.json`);
    return {
      filename: f,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
      sha256: metadata?.sha256 || '',
      schemaVersion: metadata?.schemaVersion || '',
      integrity: metadata?.integrity || 'unknown'
    };
  });
}

export function preflightBackupRestore(options = {}) {
  const storage = resolveBackupStorage(options.databasePath ?? defaultDatabasePath);
  if (!storage.sourcePath || !storage.backupDir) {
    throw backupError('Backup restore is unavailable for an in-memory database.', 'BACKUP_RESTORE_UNAVAILABLE');
  }
  const filename = normalizeBackupFilename(options.filename);
  const backupPath = path.resolve(storage.backupDir, filename);
  assertPathInside(backupPath, storage.backupDir);
  if (!fs.existsSync(backupPath)) {
    throw backupError('Backup file was not found.', 'BACKUP_NOT_FOUND', 404);
  }
  const metadata = readBackupMetadata(`${backupPath}.json`);
  const actualSha256 = sha256File(backupPath);
  const actualIntegrity = verifyBackupFile(backupPath);
  const actualSchemaVersion = readBackupSchemaVersion(backupPath);
  const supportedSchemaVersion = String(options.supportedSchemaVersion || latestSchemaVersion);
  const warnings = [];
  if (!metadata) warnings.push('metadata-missing');
  if (!actualSchemaVersion) warnings.push('schema-version-missing');
  const hashMatches = metadata?.sha256 ? timingSafeTextEqual(metadata.sha256, actualSha256) : null;
  if (hashMatches === false) warnings.push('sha256-mismatch');
  const schemaCompatible = !actualSchemaVersion || actualSchemaVersion <= supportedSchemaVersion;
  if (!schemaCompatible) warnings.push('schema-newer-than-runtime');
  if (actualIntegrity !== 'ok') warnings.push('integrity-check-failed');
  return {
    filename,
    size: fs.statSync(backupPath).size,
    sha256: actualSha256,
    expectedSha256: metadata?.sha256 || '',
    hashMatches,
    integrity: actualIntegrity,
    schemaVersion: actualSchemaVersion,
    supportedSchemaVersion,
    schemaCompatible,
    metadataCreatedAt: metadata?.createdAt || '',
    warnings,
    canRestore: actualIntegrity === 'ok' && hashMatches !== false && schemaCompatible
  };
}

export function restoreBackupOffline(options = {}) {
  if (options.confirmOffline !== true) {
    throw backupError(
      'Offline restore requires explicit confirmation that the server is stopped.',
      'BACKUP_OFFLINE_CONFIRMATION_REQUIRED'
    );
  }
  const storage = resolveBackupStorage(options.databasePath ?? defaultDatabasePath);
  if (!storage.sourcePath || !fs.existsSync(storage.sourcePath)) {
    throw backupError('Target database was not found.', 'BACKUP_TARGET_NOT_FOUND', 404);
  }
  const preflight = preflightBackupRestore(options);
  if (!preflight.canRestore) {
    throw backupError('Backup did not pass restore preflight.', 'BACKUP_PREFLIGHT_FAILED');
  }
  assertDatabaseCanBeLocked(storage.sourcePath);
  ensureBackupDir(storage.backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preRestorePath = path.join(storage.backupDir, `flai-${stamp}-pre-restore.sqlite`);
  const temporaryPath = path.join(path.dirname(storage.sourcePath), `.flai-restore-${crypto.randomUUID()}.sqlite`);
  assertPathInside(preRestorePath, storage.backupDir);
  assertPathInside(temporaryPath, path.dirname(storage.sourcePath));
  const sourceBackupPath = path.join(storage.backupDir, preflight.filename);

  fs.copyFileSync(sourceBackupPath, temporaryPath, fs.constants.COPYFILE_EXCL);
  try {
    if (verifyBackupFile(temporaryPath) !== 'ok') {
      throw backupError('Temporary restore copy failed integrity check.', 'BACKUP_RESTORE_COPY_INVALID');
    }
    fs.renameSync(storage.sourcePath, preRestorePath);
    try {
      fs.renameSync(temporaryPath, storage.sourcePath);
    } catch (error) {
      fs.renameSync(preRestorePath, storage.sourcePath);
      throw error;
    }
    const preRestoreMetadata = standaloneBackupMetadata(preRestorePath);
    fs.writeFileSync(`${preRestorePath}.json`, `${JSON.stringify(preRestoreMetadata, null, 2)}\n`, 'utf8');
    return {
      ok: true,
      restoredFrom: preflight.filename,
      preRestoreBackup: path.basename(preRestorePath),
      integrity: verifyBackupFile(storage.sourcePath),
      schemaVersion: readBackupSchemaVersion(storage.sourcePath)
    };
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    } catch (cleanupError) {
      // The temporary file can be removed manually if the OS still holds it.
      void cleanupError;
    }
    throw error;
  }
}

function readBackupFileNamesNewestFirst(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) {
    return [];
  }
  return getBackupFileNamesNewestFirst(fs.readdirSync(backupDir));
}

export function verifyBackupFile(filePath) {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return String(Object.values(database.prepare('PRAGMA integrity_check(1)').get() || {})[0] || 'error');
  } finally {
    database.close();
  }
}

function backupMetadata(database, filePath, integrity) {
  const migrations = listAppliedMigrations(database);
  return {
    filename: path.basename(filePath),
    path: filePath,
    size: fs.statSync(filePath).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
    schemaVersion: migrations.at(-1)?.version || '',
    integrity,
    createdAt: new Date().toISOString()
  };
}

function readBackupMetadata(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readBackupSchemaVersion(filePath) {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const table = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).get();
    if (!table) return '';
    return String(database.prepare(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    ).get()?.version || '');
  } finally {
    database.close();
  }
}

function standaloneBackupMetadata(filePath) {
  return {
    filename: path.basename(filePath),
    path: filePath,
    size: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
    schemaVersion: readBackupSchemaVersion(filePath),
    integrity: verifyBackupFile(filePath),
    createdAt: new Date().toISOString()
  };
}

function assertDatabaseCanBeLocked(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA busy_timeout = 1000; PRAGMA wal_checkpoint(TRUNCATE); BEGIN EXCLUSIVE; ROLLBACK;');
  } catch (error) {
    throw backupError(
      'Target database is busy. Stop the server before restoring.',
      'BACKUP_TARGET_BUSY',
      409,
      error
    );
  } finally {
    database.close();
  }
}

function normalizeBackupFilename(value) {
  const filename = String(value || '').trim();
  if (
    filename !== path.basename(filename)
    || !filename.startsWith('flai-')
    || !filename.endsWith('.sqlite')
    || filename.includes('\0')
  ) {
    throw backupError('Invalid backup filename.', 'BACKUP_FILENAME_INVALID');
  }
  return filename;
}

function assertPathInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw backupError('Backup path is outside the allowed directory.', 'BACKUP_PATH_INVALID');
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function backupError(message, code, status = 400, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  error.publicMessage = message;
  return error;
}
