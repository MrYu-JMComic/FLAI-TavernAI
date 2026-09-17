import { runBackupRestoreDrill } from '../src/services/backupRestoreDrill.js';

const databasePath = process.argv[2] || process.env.FLAI_DB_PATH;
if (!databasePath) {
  console.error('Usage: node scripts/backup-restore-drill.mjs <database-path>');
  process.exit(2);
}

try {
  console.log(JSON.stringify(runBackupRestoreDrill({ databasePath, filename: process.argv[3] })));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'DRILL_FAILED', error: String(error?.message || error) }));
  process.exit(1);
}
