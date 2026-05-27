import { nowIso } from '../security.js';
import { normalizeAdvancedSettings } from './advancedSettings.js';

const defaultAppearance = () => ({
  desktopBackgroundUrl: '',
  mobileBackgroundUrl: '',
  customCss: '',
  customJs: '',
  statusBarPrompt: ''
});

export function normalizeConversationAppearance(input = {}) {
  const desktopBackgroundUrl = normalizeImageUrl(
    input.desktopBackgroundUrl ?? input.desktop_background_url ?? input.desktopBgUrl ?? ''
  );
  const mobileBackgroundUrl = normalizeImageUrl(
    input.mobileBackgroundUrl ?? input.mobile_background_url ?? input.mobileBgUrl ?? ''
  );
  const customCss = normalizeMultilineText(input.customCss ?? input.custom_css ?? '');
  const customJs = normalizeMultilineText(input.customJs ?? input.custom_js ?? '');
  const statusBarPrompt = normalizeMultilineText(input.statusBarPrompt ?? input.status_bar_prompt ?? '');

  return {
    desktopBackgroundUrl,
    mobileBackgroundUrl,
    customCss,
    customJs,
    statusBarPrompt
  };
}

export function getConversationAppearance(database, userId, conversationId) {
  const row = database
    .prepare(
      `SELECT desktop_background_url, mobile_background_url, custom_css, custom_js, user_advanced_settings
       FROM conversations
       WHERE id = ? AND user_id = ?`
    )
    .get(conversationId, userId);

  if (!row) {
    return null;
  }

  return toLegacyAppearance(normalizeConversationAppearance({
    ...row,
    ...parseJson(row.user_advanced_settings, {})
  }));
}

export function saveConversationAppearance(database, userId, conversationId, payload = {}) {
  const current = database
    .prepare('SELECT id, user_advanced_settings FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!current) {
    return null;
  }

  const appearance = normalizeConversationAppearance(payload);
  const existingAdvancedSettings = parseJson(current.user_advanced_settings, {});
  database.prepare(
    `UPDATE conversations
     SET desktop_background_url = ?,
         mobile_background_url = ?,
         custom_css = ?,
         custom_js = ?,
         user_advanced_settings = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    appearance.desktopBackgroundUrl,
    appearance.mobileBackgroundUrl,
    appearance.customCss,
    appearance.customJs,
    JSON.stringify(normalizeAdvancedSettings({ ...existingAdvancedSettings, ...appearance })),
    nowIso(),
    conversationId,
    userId
  );

  return toLegacyAppearance(appearance);
}

export function mergeConversationAppearance(row = {}) {
  return {
    ...defaultAppearance(),
    ...normalizeConversationAppearance(row)
  };
}

function normalizeImageUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  const unwrapped = input.replace(/^url\((.*)\)$/i, '$1').trim().replace(/^['"]|['"]$/g, '');
  if (
    /^https?:\/\//i.test(unwrapped)
    || unwrapped.startsWith('/')
    || /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(unwrapped)
  ) {
    return unwrapped;
  }

  return '';
}

function normalizeMultilineText(value) {
  const text = String(value || '');
  return text.trim() ? text : '';
}

function toLegacyAppearance(appearance) {
  return {
    desktopBackgroundUrl: appearance.desktopBackgroundUrl,
    mobileBackgroundUrl: appearance.mobileBackgroundUrl,
    customCss: appearance.customCss,
    customJs: appearance.customJs
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}
