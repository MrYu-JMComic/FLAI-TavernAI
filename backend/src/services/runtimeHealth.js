import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config.js';
import { avatarUploadDir, backendRoot, dataDir } from '../db/runtime.js';

const REQUIRED_TABLES = "('users','characters','conversations','messages')";

export function buildRuntimeLiveness(options = {}) {
  return {
    ok: true,
    service: appConfig.serviceName,
    version: appConfig.version,
    timestamp: getHealthTimestamp(options),
    uptimeSeconds: Math.floor(process.uptime())
  };
}

export function createReadinessProbe(database, options = {}) {
  const ttlMs = Math.max(250, Number(options.ttlMs || 5000));
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  let cached = null;
  let expiresAt = 0;
  return () => {
    const now = Number(clock());
    if (cached && now < expiresAt) {
      return cached;
    }
    try {
      const row = database.prepare('SELECT 1 AS ok').get();
      cached = {
        ok: row?.ok === 1,
        service: appConfig.serviceName,
        timestamp: new Date(now).toISOString()
      };
    } catch {
      cached = {
        ok: false,
        service: appConfig.serviceName,
        timestamp: new Date(now).toISOString()
      };
    }
    expiresAt = now + ttlMs;
    return cached;
  };
}

export function buildRuntimeHealth(database, options = {}) {
  const checks = {
    database: checkDatabase(database),
    storage: checkStorage(),
    config: checkConfig(),
    bundle: checkRuntimeBundle()
  };

  return {
    ok: areRequiredChecksHealthy(checks),
    service: appConfig.serviceName,
    version: appConfig.version,
    timestamp: getHealthTimestamp(options),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: appConfig.nodeEnv,
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: checks.bundle.present === true
    },
    checks
  };
}

function checkDatabase(database) {
  try {
    const selectResult = database.prepare('SELECT 1 AS ok').get();
    const quickCheck = readFirstRowValue(database.prepare('PRAGMA quick_check(1)').get());
    const tableRow = database
      .prepare(`SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ${REQUIRED_TABLES}`)
      .get();
    const foreignKeys = readFirstRowValue(database.prepare('PRAGMA foreign_keys').get());
    const journalMode = readFirstRowValue(database.prepare('PRAGMA journal_mode').get());
    const schemaReady = Number(tableRow?.count || 0) === 4;

    return {
      ok: selectResult?.ok === 1 && quickCheck === 'ok' && schemaReady,
      status: schemaReady ? 'ready' : 'schema_incomplete',
      quickCheck,
      schemaReady,
      foreignKeys: Number(foreignKeys) === 1,
      journalMode: String(journalMode || '')
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unavailable',
      error: normalizeHealthError(error)
    };
  }
}

function checkStorage() {
  const data = checkDirectoryWritable(dataDir);
  const avatars = checkDirectoryWritable(avatarUploadDir);
  return {
    ok: data.ok && avatars.ok,
    data,
    avatars
  };
}

function checkDirectoryWritable(directoryPath) {
  try {
    fs.accessSync(directoryPath, fs.constants.R_OK | fs.constants.W_OK);
    return {
      ok: true,
      writable: true
    };
  } catch (error) {
    return {
      ok: false,
      writable: false,
      error: normalizeHealthError(error)
    };
  }
}

function checkConfig() {
  return {
    ok: true,
    port: appConfig.port,
    nodeEnv: appConfig.nodeEnv,
    isProduction: appConfig.isProduction,
    logLevel: appConfig.logLevel,
    providerDefaultType: appConfig.providerDefaultType,
    mockProviderEnabled: appConfig.mockProviderEnabled,
    uploadLimits: {
      avatarMaxBytes: appConfig.upload.avatarMaxBytes,
      backgroundMaxBytes: appConfig.upload.backgroundMaxBytes,
      chatImageMaxBytes: appConfig.upload.chatImageMaxBytes,
      assetMaxBytes: appConfig.upload.assetMaxBytes,
      imageMaxPixels: appConfig.upload.imageMaxPixels
    }
  };
}

function checkRuntimeBundle() {
  const markerPath = path.join(backendRoot, '.flai-runtime-source.json');
  if (!fs.existsSync(markerPath)) {
    return {
      ok: true,
      present: false
    };
  }

  try {
    const marker = parseRuntimeMarkerText(fs.readFileSync(markerPath, 'utf8'));
    return {
      ok: true,
      present: true,
      builtAt: normalizeMarkerField(marker?.builtAt),
      gitHead: normalizeMarkerField(marker?.gitHead),
      source: normalizeMarkerField(marker?.source)
    };
  } catch (error) {
    return {
      ok: false,
      present: true,
      status: 'invalid_marker',
      error: normalizeHealthError(error)
    };
  }
}

export function parseRuntimeMarkerText(text) {
  return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
}

function areRequiredChecksHealthy(checks) {
  for (const check of Object.values(checks)) {
    if (check?.ok !== true) {
      return false;
    }
  }
  return true;
}

function getHealthTimestamp(options) {
  if (typeof options.now === 'function') {
    return String(options.now());
  }
  return new Date().toISOString();
}

function readFirstRowValue(row) {
  if (!row || typeof row !== 'object') {
    return '';
  }
  for (const key of Object.keys(row)) {
    return row[key];
  }
  return '';
}

function normalizeMarkerField(value) {
  return String(value || '').trim().slice(0, 120);
}

function normalizeHealthError(error) {
  const name = String(error?.name || 'Error').replace(/[^a-z0-9_ -]/gi, '').trim();
  return name || 'Error';
}
