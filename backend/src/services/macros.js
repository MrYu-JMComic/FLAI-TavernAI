/**
 * Macro Replacement Engine — Sprint 2 (RX-2)
 *
 * Supports the following macro patterns:
 *   {{user}}           — current user display name
 *   {{char}}           — current character name
 *   {{random:a|b|c}}   — random choice from pipe-separated list
 *   {{roll:1d6}}       — dice roll (NdM format)
 *   {{date}}           — current date (YYYY-MM-DD)
 *   {{time}}           — current time (HH:mm)
 *   {{datetime}}       — current datetime (YYYY-MM-DD HH:mm)
 *   {{weekday}}        — current weekday name (Chinese)
 *   {{id}}             — random 8-char hex string (unique id)
 */

const WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function randomChoice(items) {
  if (!items.length) return '';
  return items[Math.floor(Math.random() * items.length)];
}

function rollDice(spec) {
  // Parse NdM or NdM+K or NdM-K
  const match = String(spec || '').trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return spec;
  const count = Math.min(Math.max(parseInt(match[1], 10), 1), 100);
  const sides = Math.min(Math.max(parseInt(match[2], 10), 1), 10000);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return String(total + modifier);
}

function randomHex(len = 8) {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

/**
 * Expand macros in a string.
 *
 * @param {string} text — text containing macro placeholders
 * @param {object} context — { userName, charName }
 * @returns {string} — text with macros expanded
 */
export function expandMacros(text, context = {}) {
  if (!text || typeof text !== 'string') return String(text || '');
  context = context ?? {};

  const userName = context.userName || context.user || '';
  const charName = context.charName || context.char || '';

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const weekday = WEEKDAY_CN[now.getDay()];

  return text.replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (full, macro, arg) => {
    switch (macro.toLowerCase()) {
      case 'user':
        return userName || '用户';
      case 'char':
        return charName || '角色';
      case 'random':
        if (!arg) return '';
        return randomChoice(arg.split('|').map(s => s.trim()).filter(Boolean));
      case 'roll':
        return rollDice(arg);
      case 'date':
        return dateStr;
      case 'time':
        return timeStr;
      case 'datetime':
        return `${dateStr} ${timeStr}`;
      case 'weekday':
        return weekday;
      case 'id':
        return randomHex(8);
      default:
        return full; // Unknown macro — leave as-is
    }
  });
}
