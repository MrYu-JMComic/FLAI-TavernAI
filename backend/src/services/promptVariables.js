export const userVariableToken = '{user}';

export function resolvePromptUserName(user = {}) {
  if (typeof user === 'string') {
    return normalizePromptUserName(user);
  }
  if (!user || typeof user !== 'object') {
    return normalizePromptUserName('');
  }
  return normalizePromptUserName(user.displayName || user.display_name || user.accountName || user.username || '用户');
}

export function renderPromptVariables(value, user) {
  return String(value || '').replaceAll(userVariableToken, resolvePromptUserName(user));
}

function normalizePromptUserName(value) {
  return String(value || '').trim() || '用户';
}
