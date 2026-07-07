export function cloneProviderMessages(messages = []) {
  const cloned = [];
  if (!messages || typeof messages[Symbol.iterator] !== 'function') {
    return cloned;
  }
  for (const message of messages) {
    cloned.push({ ...message });
  }
  return cloned;
}
