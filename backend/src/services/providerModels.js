export function normalizeProviderModel(providerType, model) {
  const value = String(model || '').trim();
  if (providerType === 'deepseek' && ['deepseek-chat', 'deepseek-reasoner'].includes(value)) {
    return 'deepseek-v4-flash';
  }
  return value;
}
