import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyStartupMigrations, latestSchemaVersion, listAppliedMigrations } from '../db/migrations.js';
import { listBackups, preflightBackupRestore, resolveBackupStorage, verifyBackupFile } from './backup.js';

/**
 * Prove a backup is restorable without touching the live database: copy it to
 * a scratch directory, boot it through the normal startup migrations and
 * check integrity, foreign keys and the migration ledger on the result.
 */
export function runBackupRestoreDrill(options = {}) {
  const databasePath = String(options.databasePath || '').trim();
  if (!databasePath || databasePath === ':memory:') {
    throw drillError('A file-backed database path is required.', 'DRILL_DATABASE_REQUIRED');
  }
  const storage = resolveBackupStorage(databasePath);
  const backups = listBackups({ databasePath });
  if (!backups.length) {
    throw drillError('No backups are available to drill.', 'DRILL_NO_BACKUPS');
  }
  const filename = options.filename || backups[0].filename;
  // A truncated or non-SQLite file makes preflight throw rather than return a
  // verdict, so surface that as a drill failure instead of a raw driver error.
  let preflight;
  try {
    preflight = preflightBackupRestore({ databasePath, filename });
  } catch (error) {
    if (error?.code === 'BACKUP_FILENAME_INVALID') throw error;
    throw drillError(`Backup could not be read: ${String(error?.message || error)}`, 'DRILL_PREFLIGHT_FAILED', { cause: error });
  }
  if (!preflight.canRestore) {
    throw drillError(`Backup failed preflight: ${preflight.warnings.join(', ')}`, 'DRILL_PREFLIGHT_FAILED', { preflight });
  }

  const scratchDir = fs.mkdtempSync(path.join(options.scratchRoot || os.tmpdir(), 'flai-restore-drill-'));
  const restoredPath = path.join(scratchDir, 'restored.sqlite');
  try {
    fs.copyFileSync(path.join(storage.backupDir, filename), restoredPath);
    const integrityBeforeMigration = verifyBackupFile(restoredPath);
    if (integrityBeforeMigration !== 'ok') {
      throw drillError(`Restored copy failed integrity check: ${integrityBeforeMigration}`, 'DRILL_INTEGRITY_FAILED');
    }

    // Deliberately not createAppDatabase: that resets the process-wide table
    // column cache and world book counter, which would corrupt the live
    // server's state when the drill runs in-process. A scratch copy only needs
    // the migrations plus its own column lookups.
    const database = new DatabaseSync(restoredPath);
    try {
      applyStartupMigrations(database, { getCachedTableColumns: readTableColumns });
      const ledger = listAppliedMigrations(database);
      const migratedTo = ledger.at(-1)?.version || '';
      const foreignKeyProblems = database.prepare('PRAGMA foreign_key_check').all();
      const integrityAfterMigration = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
      const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get()?.count ?? 0;
      if (migratedTo !== latestSchemaVersion) {
        throw drillError(`Restored copy migrated to ${migratedTo || 'nothing'}, expected ${latestSchemaVersion}.`, 'DRILL_MIGRATION_INCOMPLETE');
      }
      if (foreignKeyProblems.length) {
        throw drillError(`Restored copy has ${foreignKeyProblems.length} foreign key problems.`, 'DRILL_FOREIGN_KEYS_FAILED');
      }
      if (integrityAfterMigration !== 'ok') {
        throw drillError(`Restored copy failed integrity check after migration: ${integrityAfterMigration}`, 'DRILL_INTEGRITY_FAILED');
      }
      return {
        ok: true,
        backup: filename,
        backupSchemaVersion: preflight.schemaVersion,
        migratedTo,
        migrationsApplied: ledger.length,
        userCount,
        sizeBytes: preflight.size,
        sha256: preflight.sha256
      };
    } finally {
      closeQuietly(database);
    }
  } finally {
    if (options.keepScratch !== true) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  }
}

/**
 * Uncached column lookup scoped to the scratch database, matching the shape
 * `applyStartupMigrations` expects from the shared schema helper.
 */
function readTableColumns(database, tableName) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(columns.map((column) => column.name));
}

function drillError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function closeQuietly(database) {
  try {
    database.close();
  } catch {
    // The drill result is already decided; a close failure on a scratch copy
    // must not mask it.
  }
}
