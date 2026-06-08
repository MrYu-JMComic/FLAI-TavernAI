export function callEventMethod(event, methodName) {
  const method = event?.[methodName];
  if (typeof method !== 'function') {
    return false;
  }
  method.call(event);
  return true;
}
