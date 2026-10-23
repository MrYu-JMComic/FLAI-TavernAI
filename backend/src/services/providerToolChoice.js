export function resolveToolChoice(toolChoice, context = {}) {
  if (typeof toolChoice !== 'function') {
    return toolChoice;
  }
  try {
    return toolChoice(context);
  } catch {
    return 'auto';
  }
}
