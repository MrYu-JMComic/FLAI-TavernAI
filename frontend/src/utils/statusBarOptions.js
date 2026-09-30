// Built-in status bar appearance options. The chat settings drawer writes them
// into the template field as JSON; StatusBar.vue, the chat accessory composable
// and the character blueprint preview all parse that JSON with these lists.

export const STATUS_BAR_VARIANTS = Object.freeze(['default', 'compact', 'minimal', 'neon', 'glass', 'parchment', 'terminal']);
export const STATUS_BAR_DENSITIES = Object.freeze(['default', 'cozy', 'compact']);
export const STATUS_BAR_EFFECTS = Object.freeze(['glow', 'striped', 'pulse']);
export const STATUS_BAR_DISPLAY_MODES = Object.freeze(['immersive', 'compact']);
export const STATUS_BAR_LAYOUTS = Object.freeze(['grid', 'list']);
export const STATUS_BAR_CHARACTER_STATUSES = Object.freeze(['active', 'dead', 'forgotten', 'left', 'hidden']);

export const STATUS_BAR_VARIANT_OPTIONS = Object.freeze([
  { value: 'default', label: '默认' },
  { value: 'compact', label: '紧凑' },
  { value: 'minimal', label: '极简' },
  { value: 'neon', label: '霓虹' },
  { value: 'glass', label: '毛玻璃' },
  { value: 'parchment', label: '羊皮纸' },
  { value: 'terminal', label: '终端' }
]);

export const STATUS_BAR_LAYOUT_OPTIONS = Object.freeze([
  { value: 'grid', label: '网格' },
  { value: 'list', label: '列表' }
]);
