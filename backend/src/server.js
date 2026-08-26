import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { appConfig } from './config.js';
import { startTownSimulationEngine } from './modules/townEngine.js';
import { cleanupExpiredSessions } from './security.js';
import { migrateLegacyAvatarUploads } from './services/avatars.js';
import { createBackup, listBackups, preflightBackupRestore, scheduleDailyBackup } from './services/backup.js';
import { sanitizeDiagnosticText } from './services/diagnosticRedaction.js';
import { logger } from './services/logger.js';
import { createDefaultJobHandlers } from './services/jobs/jobHandlers.js';
import { startJobWorker } from './services/jobs/jobWorker.js';

export async function startServer(context = {}) {
  const config = context.config || appConfig;
  const applicationLogger = context.logger || logger;
  let database;
  let databasePath;
  if (context.db) {
    database = context.db;
    databasePath = context.databasePath || ':memory:';
    if (context.backupOnStartup !== false) {
      createBackup({ database, databasePath, label: 'startup' });
    }
  } else {
    const { createAppDatabase, dataDir } = await import('./db/runtime.js');
    databasePath = config.databasePath || path.join(dataDir, 'flai.sqlite');
    database = createAppDatabase(databasePath, {
      beforeInitialize: context.backupOnStartup === false
        ? undefined
        : (activeDatabase) => createBackup({
          database: activeDatabase,
          databasePath,
          label: 'startup'
        })
    });
  }
  const backupOptions = { database, databasePath };

  migrateLegacyAvatarUploads(database);
  cleanupExpiredSessions(database);

  const app = createApp({
    db: database,
    config,
    logger: applicationLogger,
    backupService: {
      create: () => createBackup({ ...backupOptions, withMetadata: true }),
      list: () => listBackups(backupOptions),
      preflight: (filename) => preflightBackupRestore({ ...backupOptions, filename })
    }
  });
  const stopTownEngine = startTownSimulationEngine(database, {
    onError: (error) => applicationLogger.error('town_engine_error', {
      message: sanitizeDiagnosticText(error?.message || error)
    })
  });
  const stopJobWorker = startJobWorker(database, {
    handlers: context.jobHandlers || createDefaultJobHandlers(database),
    onError: (error, job) => applicationLogger.error('job_worker_error', {
      jobId: job?.id,
      type: job?.type,
      message: sanitizeDiagnosticText(error?.message || error)
    })
  });
  const sessionCleanupTimer = setInterval(() => {
    try {
      cleanupExpiredSessions(database);
    } catch (error) {
      applicationLogger.warn('session_cleanup_failed', {
        message: sanitizeDiagnosticText(error?.message || error)
      });
    }
  }, 60 * 60 * 1000);
  sessionCleanupTimer.unref?.();
  const stopDailyBackup = scheduleDailyBackup(backupOptions);

  const server = await listen(app, config.port);
  applicationLogger.info('server_listening', { url: `http://localhost:${config.port}` });

  let closing = null;
  const close = (signal = 'manual') => {
    if (closing) return closing;
    closing = closeServer(server).then(() => {
      applicationLogger.info('server_shutdown_started', { signal });
      clearInterval(sessionCleanupTimer);
      stopTownEngine?.();
      return stopJobWorker?.();
    }).then(() => {
      stopDailyBackup?.();
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      database.close();
      applicationLogger.info('server_database_closed');
    });
    return closing;
  };

  return { app, server, database, close };
}

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function isMainModule() {
  return Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
}

if (isMainModule()) {
  startServer().then(({ close }) => {
    const shutdown = (signal) => {
      close(signal).catch((error) => {
        logger.error('server_shutdown_failed', {
          message: sanitizeDiagnosticText(error?.message || error)
        });
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }).catch((error) => {
    logger.error('server_start_failed', {
      message: sanitizeDiagnosticText(error?.message || error),
      stack: sanitizeDiagnosticText(error?.stack)
    });
    process.exitCode = 1;
  });
}
