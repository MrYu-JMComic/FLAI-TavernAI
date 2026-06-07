export async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export function insertUser(database, userId, overrides = {}) {
  database.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, permission_group, is_root_admin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    overrides.username ?? userId,
    overrides.passwordHash ?? 'hash',
    overrides.displayName ?? '',
    overrides.permissionGroup ?? 'user',
    overrides.isRootAdmin ?? 0,
    overrides.createdAt ?? new Date().toISOString()
  );
}
