export const WORLD_BOOK_LIMITS = Object.freeze({
  name: 80,
  description: 2_000,
  scanDepthMin: 1,
  scanDepthMax: 50,
  contextPercentMin: 1,
  contextPercentMax: 100
});

export const WORLD_BOOK_ENTRY_LIMITS = Object.freeze({
  id: 160,
  name: 100,
  triggerKeys: 2_000,
  content: 50_000,
  keysSecondary: 2_000,
  group: 100,
  depthMax: 10,
  probabilityMax: 100,
  stateDurationMax: 9_999
});

export const WORLD_BOOK_ASSISTANT_ENTRY_LIMIT = 30;

