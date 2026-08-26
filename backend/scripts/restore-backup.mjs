import path from 'node:path';
import { restoreBackupOffline, preflightBackupRestore } from '../src/services/backup.js';

const args = parseArgs(process.argv.slice(2));
if (!args.database || !args.backup) {
  console.error('Usage: node scripts/restore-backup.mjs --database <path> --backup <filename> [--confirm-offline]');
  process.exitCode = 2;
} else {
  const options = {
    databasePath: path.resolve(args.database),
    filename: args.backup
  };
  try {
    const result = args.confirmOffline
      ? restoreBackupOffline({ ...options, confirmOffline: true })
      : preflightBackupRestore(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'BACKUP_RESTORE_FAILED',
      error: error?.message || String(error)
    }, null, 2));
    process.exitCode = 1;
  }
}

function parseArgs(values) {
  const output = { database: '', backup: '', confirmOffline: false };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--database') output.database = values[++index] || '';
    else if (values[index] === '--backup') output.backup = values[++index] || '';
    else if (values[index] === '--confirm-offline') output.confirmOffline = true;
  }
  return output;
}
