import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createAdminRouter } from '../routes/admin.js';
import { buildPrometheusMetrics } from '../services/metricsExposition.js';
import { withServer } from './routeTestUtils.js';

function metricValue(text, name, labels = '') {
  const prefix = `${name}${labels} `;
  const line = text.split('\n').find((row) => row.startsWith(prefix));
  return line ? Number(line.slice(prefix.length)) : null;
}

test('metrics exposition emits parseable Prometheus families without per-user detail', () => {
  const database = createAppDatabase(':memory:');
  try {
    database.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'alice', 'hash', '2026-01-01T00:00:00.000Z')"
    ).run();
    database.prepare(
      `INSERT INTO user_daily_usage (user_id, usage_date, request_count, cost_micros, updated_at)
       VALUES ('u1', '2026-01-01', 4, 250, '2026-01-01T00:00:00.000Z')`
    ).run();

    const text = buildPrometheusMetrics({ db: database, databasePath: '' });

    // Every non-comment line must be "name{labels} value" with a finite value.
    for (const line of text.split('\n').filter((row) => row && !row.startsWith('#'))) {
      assert.match(line, /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? -?\d+(\.\d+)?$/, `unparseable metric line: ${line}`);
    }
    assert.match(text, /^# TYPE flai_provider_requests_total counter$/m);
    assert.equal(metricValue(text, 'flai_provider_requests_total'), 4);
    assert.equal(metricValue(text, 'flai_provider_cost_micros_total'), 250);
    assert.ok(metricValue(text, 'flai_process_uptime_seconds') >= 0);
    assert.ok(metricValue(text, 'flai_process_resident_memory_bytes') > 0);
    // Aggregate only: no user ids or usernames may leak into the exposition.
    assert.equal(text.includes('u1'), false);
    assert.equal(text.includes('alice'), false);
  } finally {
    database.close();
  }
});

test('metrics exposition survives a database without the optional tables', () => {
  const database = createAppDatabase(':memory:');
  try {
    database.exec('DROP TABLE IF EXISTS jobs; DROP TABLE IF EXISTS user_daily_usage');
    const text = buildPrometheusMetrics({ db: database, databasePath: '/nonexistent/flai.sqlite' });
    assert.match(text, /flai_process_uptime_seconds/);
    assert.equal(metricValue(text, 'flai_sqlite_wal_bytes'), 0);
  } finally {
    database.close();
  }
});

test('admin metrics route serves Prometheus text to root admins only', async () => {
  const database = createAppDatabase(':memory:');
  const buildApp = (user) => {
    const app = express();
    app.use((request, _response, next) => {
      request.auth = { user };
      next();
    });
    app.use('/api/admin', createAdminRouter({
      db: database,
      databasePath: '',
      requireAuth: (_request, _response, next) => next(),
      requireRootAdmin: (request, response, next) => (
        request.auth.user.isRootAdmin ? next() : response.status(403).json({ error: 'forbidden' })
      )
    }));
    return app;
  };
  try {
    await withServer(buildApp({ id: 'root-user', isRootAdmin: true }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/metrics`);
      assert.equal(response.status, 200);
      // Express reorders content-type parameters, so match the parts that matter.
      assert.match(response.headers.get('content-type'), /^text\/plain;/);
      assert.match(response.headers.get('content-type'), /version=0\.0\.4/);
      assert.match(await response.text(), /# TYPE flai_process_uptime_seconds gauge/);
    });
    await withServer(buildApp({ id: 'plain-user', isRootAdmin: false }), async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/api/admin/metrics`)).status, 403);
    });
  } finally {
    database.close();
  }
});
