/** Replaces an exact snippet only when its occurrence count and final field length match the contract. */
export function applyToolTextPatch(source, { oldText, newText, expectedOccurrences = 1 }, maxLength) {
  if (typeof oldText !== 'string' || !oldText || typeof newText !== 'string'
    || !Number.isSafeInteger(expectedOccurrences) || expectedOccurrences < 1 || expectedOccurrences > 1000) {
    throw Object.assign(new Error('请提供精确 oldText、newText 和有效匹配次数。'), { code: 'TEXT_PATCH_INVALID' });
  }
  const text = String(source ?? '');
  const occurrences = text.split(oldText).length - 1;
  if (occurrences !== expectedOccurrences) {
    throw Object.assign(new Error(`匹配次数为 ${occurrences}，预期 ${expectedOccurrences}；请重新读取原文。`),
      { code: 'TEXT_PATCH_CONFLICT', occurrences });
  }
  const result = text.split(oldText).join(newText);
  if (result.length > maxLength) throw Object.assign(new Error('修改后文本超过字段长度限制。'), { code: 'TEXT_PATCH_TOO_LARGE' });
  return result;
}
