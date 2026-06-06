const SAVEPOINT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function withSavepoint(database, name, operation) {
  if (!SAVEPOINT_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid savepoint name: ${name}`);
  }

  database.exec(`SAVEPOINT ${name}`);
  try {
    const result = operation();
    database.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    database.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    try {
      database.exec(`RELEASE SAVEPOINT ${name}`);
    } catch {
      // The rollback already restored state; preserve the original operation error.
    }
    throw error;
  }
}
