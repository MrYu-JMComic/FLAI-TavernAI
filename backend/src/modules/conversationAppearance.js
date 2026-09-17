import { nowIso } from '../security.js';
import { conversationBackgroundOwnerTypes, saveBackgroundImageInput } from '../services/avatars.js';
import { parseJson } from '../utils/json.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { normalizeAdvancedSettings } from './advancedSettings.js';

export function normalizeConversationAppearance(input = {}) {
  input = input ?? {};
  const desktopBackgroundUrl = normalizeImageUrl(
    input.desktopBackgroundUrl ?? input.desktop_background_url ?? input.desktopBgUrl ?? ''
  );
  const mobileBackgroundUrl = normalizeImageUrl(
    input.mobileBackgroundUrl ?? input.mobile_background_url ?? input.mobileBgUrl ?? ''
  );
  const customCss = normalizeMultilineText(input.customCss ?? input.custom_css ?? '');
  const customCssEnabled = normalizeBoolean(input.customCssEnabled ?? input.custom_css_enabled, false);
  const customCssRiskAccepted = normalizeBoolean(input.customCssRiskAccepted ?? input.custom_css_risk_accepted, false);
  const customJs = normalizeMultilineText(input.customJs ?? input.custom_js ?? '');
  const customJsEnabled = normalizeBoolean(input.customJsEnabled ?? input.custom_js_enabled, false);
  const customJsRiskAccepted = normalizeBoolean(input.customJsRiskAccepted ?? input.custom_js_risk_accepted, false);
  const statusBarPrompt = normalizeMultilineText(input.statusBarPrompt ?? input.status_bar_prompt ?? '');
  const showWorldBookMatches = normalizeBoolean(input.showWorldBookMatches ?? input.show_world_book_matches, true);
  const highlightDialogue = normalizeBoolean(input.highlightDialogue ?? input.highlight_dialogue, true);
  const castTrackingSource = input.castTracking ?? input.cast_tracking ?? {};
  const normalizedCastTracking = normalizeAdvancedSettings({ castTracking: castTrackingSource }).castTracking;
  const castTracking = hasConfiguredCastTracking(normalizedCastTracking)
    ? normalizedCastTracking
    : { enabled: normalizedCastTracking.enabled };

  return {
    desktopBackgroundUrl,
    mobileBackgroundUrl,
    customCss,
    customCssEnabled,
    customCssRiskAccepted,
    customJs,
    customJsEnabled,
    customJsRiskAccepted,
    statusBarPrompt,
    showWorldBookMatches,
    highlightDialogue,
    castTracking
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

  const existingAdvancedSettings = parseJson(current.user_advanced_settings, {});
  const appearance = normalizeConversationAppearance({
    ...payload,
    // Older clients omit this display preference when saving other settings.
    highlightDialogue: payload?.highlightDialogue ?? payload?.highlight_dialogue
      ?? existingAdvancedSettings?.highlightDialogue ?? existingAdvancedSettings?.highlight_dialogue
  });
  const existingCastTracking = normalizeAdvancedSettings(existingAdvancedSettings).castTracking;
  const requestedCastTracking = payload?.castTracking ?? payload?.cast_tracking;
  const mergedCastTracking = requestedCastTracking && typeof requestedCastTracking === 'object'
    ? { ...existingCastTracking, ...requestedCastTracking }
    : existingCastTracking;
  const normalizedCastTracking = normalizeAdvancedSettings({ castTracking: mergedCastTracking }).castTracking;
  // Keep the legacy one-field response for old/simple callers, while preserving
  // the complete NPC Agent configuration whenever either side uses it.
  appearance.castTracking = hasConfiguredCastTracking(normalizedCastTracking)
    ? normalizedCastTracking
    : { enabled: normalizedCastTracking.enabled };
  appearance.desktopBackgroundUrl = saveBackgroundImageInput(database, {
    userId,
    ownerType: conversationBackgroundOwnerTypes.desktop,
    ownerId: conversationId,
    value: appearance.desktopBackgroundUrl
  });
  appearance.mobileBackgroundUrl = saveBackgroundImageInput(database, {
    userId,
    ownerType: conversationBackgroundOwnerTypes.mobile,
    ownerId: conversationId,
    value: appearance.mobileBackgroundUrl
  });

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

function hasConfiguredCastTracking(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Boolean(
    String(value.providerProfileId || '').trim()
    || String(value.modelOverride || '').trim()
    || String(value.thinkingLevel || '').trim()
    || Object.keys(value.autoSyncOperations || {}).length
    || Object.keys(value.organizeOperations || {}).length
  );
}

function toLegacyAppearance(appearance) {
  return {
    desktopBackgroundUrl: appearance.desktopBackgroundUrl,
    mobileBackgroundUrl: appearance.mobileBackgroundUrl,
    customCss: appearance.customCss,
    customCssEnabled: appearance.customCssEnabled,
    customCssRiskAccepted: appearance.customCssRiskAccepted,
    customJs: appearance.customJs,
    customJsEnabled: appearance.customJsEnabled,
    customJsRiskAccepted: appearance.customJsRiskAccepted,
    showWorldBookMatches: appearance.showWorldBookMatches,
    highlightDialogue: appearance.highlightDialogue,
    castTracking: appearance.castTracking
  };
}
