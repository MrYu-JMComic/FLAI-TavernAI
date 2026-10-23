export function appendProcessContent(step, text) {
  const value = String(text || '');
  if (!value) return;
  const activity = Array.isArray(step.activity) ? step.activity : (step.activity = []);
  const last = activity.at(-1);
  if (last?.type === 'content') {
    last.text += value;
    return;
  }
  activity.push({ type: 'content', text: value });
}

export function appendProcessTool(step, index) {
  const activity = Array.isArray(step.activity) ? step.activity : (step.activity = []);
  activity.push({ type: 'tool', index: Math.max(0, Number(index) || 0) });
}
