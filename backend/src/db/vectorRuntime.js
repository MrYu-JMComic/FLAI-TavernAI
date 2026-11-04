import { DatabaseSync } from 'node:sqlite';
import { load } from 'sqlite-vec';

const initialized = new WeakSet();
export const VECTOR_DIMENSIONS = Object.freeze([256, 512, 768, 1024]);

/** Load only the pinned package binary, then disable arbitrary extension loading. */
export function initializeVectorRuntime(database) {
  if (initialized.has(database)) return database;
  try {
    load(database);
    const version = database.prepare('SELECT vec_version() AS version').get()?.version;
    if (version !== 'v0.1.9') throw new Error('Unexpected sqlite-vec binary version.');
    initialized.add(database);
    return database;
  } finally {
    database.enableLoadExtension(false);
  }
}

/** Open an independent connection without changing application caches or globals. */
export function openVectorDatabase(filename, options = {}) {
  const database = new DatabaseSync(filename, { ...options, allowExtension: true });
  try {
    return initializeVectorRuntime(database);
  } catch (error) {
    database.close();
    throw error;
  }
}

export function vectorTableName(dimensions) {
  if (!VECTOR_DIMENSIONS.includes(Number(dimensions))) throw new Error('Unsupported embedding dimensions.');
  return `memory_vectors_${Number(dimensions)}`;
}

/** Provision a fixed-dimension vec0 table with conversation/index partitioning. */
export function ensureVectorTable(database, dimensions) {
  const table = vectorTableName(dimensions);
  database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(
    document_id TEXT PRIMARY KEY,
    scope_key TEXT PARTITION KEY,
    embedding FLOAT[${Number(dimensions)}] DISTANCE_METRIC=cosine
  );
  CREATE TRIGGER IF NOT EXISTS ${table}_cleanup AFTER DELETE ON memory_embedding_documents
  WHEN OLD.dimensions = ${Number(dimensions)} BEGIN
    DELETE FROM ${table} WHERE document_id = OLD.id;
  END;`);
  return table;
}
