export function cloneAiToolList(tools = []) {
  const clonedTools = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    clonedTools.push(tool);
  }
  return clonedTools;
}

export function appendAiToolList(tools = [], log) {
  const nextTools = cloneAiToolList(tools);
  nextTools.push(log);
  return nextTools;
}
