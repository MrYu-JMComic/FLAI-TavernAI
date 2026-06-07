import { ref } from 'vue';

function normalizePendingKey(key) {
  if (key === null || typeof key === 'undefined' || key === '') {
    return null;
  }
  return String(key);
}

export function usePendingKeys() {
  const pendingKeys = ref(new Set());

  function isPending(key) {
    const normalizedKey = normalizePendingKey(key);
    return Boolean(normalizedKey && pendingKeys.value.has(normalizedKey));
  }

  function start(key) {
    const normalizedKey = normalizePendingKey(key);
    if (!normalizedKey || pendingKeys.value.has(normalizedKey)) {
      return false;
    }

    const nextKeys = new Set(pendingKeys.value);
    nextKeys.add(normalizedKey);
    pendingKeys.value = nextKeys;
    return true;
  }

  function finish(key) {
    const normalizedKey = normalizePendingKey(key);
    if (!normalizedKey || !pendingKeys.value.has(normalizedKey)) {
      return;
    }

    const nextKeys = new Set(pendingKeys.value);
    nextKeys.delete(normalizedKey);
    pendingKeys.value = nextKeys;
  }

  function reset() {
    if (pendingKeys.value.size) {
      pendingKeys.value = new Set();
    }
  }

  return {
    pendingKeys,
    isPending,
    start,
    finish,
    reset
  };
}
