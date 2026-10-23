export function normalizeProviderModel(providerType, model) {
  const value = String(model || '').trim();
  if (providerType === 'deepseek' && ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash'].includes(value.toLowerCase())) {
    return 'deepseek-flash';
  }
  return value;
}
