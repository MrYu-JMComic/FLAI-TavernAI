<script setup>
import { computed } from 'vue';

const VALID_VARIANTS = ['default', 'compact', 'minimal', 'neon'];
const VALID_DENSITIES = ['default', 'cozy', 'compact'];
const VALID_EFFECTS = ['glow', 'striped', 'pulse'];

const props = defineProps({
  statusBar: {
    type: Object,
    default: null
  },
  templateConfig: {
    type: Object,
    default: () => ({})
  }
});

const cfg = computed(() => {
  const raw = props.templateConfig || {};
  const variant = VALID_VARIANTS.includes(raw.variant) ? raw.variant : 'default';
  const density = VALID_DENSITIES.includes(raw.density) ? raw.density : 'default';
  const effects = Array.isArray(raw.effects)
    ? raw.effects.filter((e) => VALID_EFFECTS.includes(e))
    : [];
  const accentColor = typeof raw.accentColor === 'string' && raw.accentColor.trim()
    ? raw.accentColor.trim()
    : '';
  const customCss = typeof raw.customCss === 'string' ? raw.customCss : '';
  return { variant, density, effects, accentColor, customCss };
});

const hasContent = computed(() => {
  return props.statusBar && Array.isArray(props.statusBar.variables) && props.statusBar.variables.length > 0;
});

const displayVariables = computed(() => {
  if (!props.statusBar?.variables) return [];
  return props.statusBar.variables.map((v) => {
    const value = Number(v.value) || 0;
    const max = Number(v.max) || 100;
    const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    return {
      name: v.name || '?',
      value,
      max,
      percentage,
      color: v.color || defaultColor(v.name),
      displayValue: max > 0 ? `${value}/${max}` : String(value)
    };
  });
});

const wrapperClasses = computed(() => {
  const classes = ['status-bar-container'];
  if (cfg.value.variant !== 'default') classes.push(`sb-${cfg.value.variant}`);
  if (cfg.value.density !== 'default') classes.push(`sb-density-${cfg.value.density}`);
  for (const fx of cfg.value.effects) {
    classes.push(`sb-fx-${fx}`);
  }
  return classes;
});

const ALLOWED_STYLE_PROPS = new Set(['borderRadius', 'background', 'boxShadow', 'fontFamily']);

function parseSafeStyle(css) {
  if (!css || typeof css !== 'string') return {};
  const style = {};
  try {
    const obj = JSON.parse(css);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        if (ALLOWED_STYLE_PROPS.has(key) || key.startsWith('--sb-')) {
          style[key] = String(value);
        }
      }
      return style;
    }
  } catch (_) { /* not JSON, parse as CSS text */ }
  const segments = css.split(';');
  for (const seg of segments) {
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) continue;
    const rawProp = seg.substring(0, colonIdx).trim();
    const value = seg.substring(colonIdx + 1).trim();
    if (!rawProp || !value) continue;
    const camel = rawProp.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (ALLOWED_STYLE_PROPS.has(camel) || rawProp.startsWith('--sb-')) {
      style[camel] = value;
    }
  }
  return style;
}

const wrapperStyle = computed(() => {
  const style = {};
  if (cfg.value.accentColor) {
    style['--sb-accent'] = cfg.value.accentColor;
  }
  Object.assign(style, parseSafeStyle(cfg.value.customCss));
  return style;
});

function defaultColor(name) {
  const colorMap = {
    'HP': '#e74c3c',
    'MP': '#3498db',
    'SP': '#f39c12',
    '体力': '#27ae60',
    '魔力': '#8e44ad',
    '好感度': '#e91e63',
    '好感': '#e91e63',
    '生命': '#e74c3c',
    '法力': '#3498db',
    '能量': '#f39c12',
    '怒气': '#c0392b',
    '经验': '#2ecc71',
    'EXP': '#2ecc71',
    '饥饿': '#e67e22',
    '心情': '#9b59b6'
  };
  for (const [key, color] of Object.entries(colorMap)) {
    if (name.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return 'var(--sb-accent, #6c757d)';
}

function barStyle(variable) {
  return {
    width: `${variable.percentage}%`,
    backgroundColor: variable.color
  };
}
</script>

<template>
  <div v-if="hasContent" :class="wrapperClasses" :style="wrapperStyle" class="status-bar-root">
    <div class="status-bar-header">
      <span class="status-bar-label">状态同步</span>
      <span class="status-bar-context">关联最新 AI 回复</span>
      <span class="status-bar-name">{{ statusBar.name || '状态栏' }}</span>
    </div>
    <div class="status-bar-variables">
      <div
        v-for="(variable, index) in displayVariables"
        :key="index"
        class="status-bar-variable"
      >
        <div class="variable-header">
          <span class="variable-name">{{ variable.name }}</span>
          <span class="variable-value">{{ variable.displayValue }}</span>
        </div>
        <div class="variable-bar-track">
          <div class="variable-bar-fill" :style="barStyle(variable)"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* -- Scoped CSS variable bridge -- */
.status-bar-root {
  --sb-accent: var(--primary, #8f3f2f);
}

/* -- Base Card -- */
.status-bar-container {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 80%, transparent);
  border-radius: 14px;
  padding: 14px 16px;
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface, #fffaf2) 82%, transparent),
      color-mix(in srgb, var(--surface, #fffaf2) 64%, transparent));
  box-shadow:
    0 2px 12px rgba(67, 45, 30, 0.06),
    inset 0 1px 0 color-mix(in srgb, #ffffff 36%, transparent);
  backdrop-filter: blur(10px);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

:root[data-theme="dark"] .status-bar-container {
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface, #24201d) 88%, transparent),
      color-mix(in srgb, var(--surface, #24201d) 72%, transparent));
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
}

/* -- Header -- */
.status-bar-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.status-bar-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--sb-accent);
  background: color-mix(in srgb, var(--sb-accent) 12%, transparent);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.6;
}

.status-bar-label::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sb-accent);
  opacity: 0.7;
}

.status-bar-name {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--muted, #75685e);
  letter-spacing: 0.02em;
}

.status-bar-context {
  font-size: 0.64rem;
  color: var(--muted, #75685e);
  opacity: 0.72;
  letter-spacing: 0.01em;
}

/* -- Variables Grid -- */
.status-bar-variables {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.status-bar-variable {
  flex: 1 1 140px;
  min-width: 120px;
}

.variable-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.variable-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text, #241f1b);
}

.variable-value {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--muted, #75685e);
  font-variant-numeric: tabular-nums;
}

.variable-bar-track {
  height: 7px;
  background: color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 50%, transparent);
  border-radius: 4px;
  overflow: hidden;
}

.variable-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

/* ---------------------------------------
   VARIANT -- compact
   --------------------------------------- */
.sb-compact {
  padding: 10px 12px;
  border-radius: 10px;
}

.sb-compact .status-bar-header {
  margin-bottom: 6px;
}

.sb-compact .status-bar-label {
  font-size: 0.62rem;
  padding: 1px 6px;
}

.sb-compact .status-bar-name {
  font-size: 0.76rem;
}

.sb-compact .status-bar-variables {
  gap: 8px;
}

.sb-compact .status-bar-variable {
  flex: 1 1 100px;
  min-width: 80px;
}

.sb-compact .variable-name {
  font-size: 0.76rem;
}

.sb-compact .variable-value {
  font-size: 0.7rem;
}

.sb-compact .variable-bar-track {
  height: 5px;
}

/* ---------------------------------------
   VARIANT -- minimal
   --------------------------------------- */
.sb-minimal {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--line) 40%, transparent);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.sb-minimal .status-bar-header {
  margin-bottom: 4px;
}

.sb-minimal .status-bar-label {
  font-size: 0.6rem;
  padding: 1px 5px;
}

.sb-minimal .status-bar-name {
  font-size: 0.72rem;
}

.sb-minimal .variable-bar-track {
  height: 4px;
  border-radius: 2px;
}

.sb-minimal .variable-bar-fill {
  border-radius: 2px;
  box-shadow: none;
}

/* ---------------------------------------
   VARIANT -- neon
   --------------------------------------- */
.sb-neon {
  border-color: color-mix(in srgb, var(--sb-accent) 30%, transparent);
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface) 60%, transparent),
      color-mix(in srgb, var(--sb-accent) 6%, transparent));
  box-shadow:
    0 0 18px color-mix(in srgb, var(--sb-accent) 10%, transparent),
    0 2px 12px rgba(0, 0, 0, 0.06);
}

.sb-neon .status-bar-label {
  color: var(--sb-accent);
  background: color-mix(in srgb, var(--sb-accent) 18%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--sb-accent) 14%, transparent);
}

.sb-neon .variable-bar-track {
  background: color-mix(in srgb, var(--sb-accent) 10%, transparent);
}

.sb-neon .variable-bar-fill {
  box-shadow:
    0 0 6px color-mix(in srgb, var(--sb-accent) 30%, transparent),
    0 1px 4px rgba(0, 0, 0, 0.1);
}

/* ---------------------------------------
   DENSITY -- cozy
   --------------------------------------- */
.sb-density-cozy {
  padding: 18px 20px;
}

.sb-density-cozy .status-bar-header {
  margin-bottom: 14px;
}

.sb-density-cozy .status-bar-variables {
  gap: 16px;
}

.sb-density-cozy .variable-bar-track {
  height: 9px;
}

/* ---------------------------------------
   DENSITY -- compact
   --------------------------------------- */
.sb-density-compact {
  padding: 8px 10px;
}

.sb-density-compact .status-bar-header {
  margin-bottom: 6px;
}

.sb-density-compact .status-bar-variables {
  gap: 6px;
}

.sb-density-compact .variable-bar-track {
  height: 4px;
}

/* ---------------------------------------
   EFFECT -- glow
   --------------------------------------- */
.sb-fx-glow {
  box-shadow:
    0 0 20px color-mix(in srgb, var(--sb-accent) 12%, transparent),
    0 2px 12px rgba(0, 0, 0, 0.06);
  animation: sbGlowPulse 3s ease-in-out infinite;
}

@keyframes sbGlowPulse {
  0%, 100% {
    box-shadow:
      0 0 16px color-mix(in srgb, var(--sb-accent) 10%, transparent),
      0 2px 12px rgba(0, 0, 0, 0.06);
  }
  50% {
    box-shadow:
      0 0 28px color-mix(in srgb, var(--sb-accent) 18%, transparent),
      0 2px 16px rgba(0, 0, 0, 0.08);
  }
}

/* ---------------------------------------
   EFFECT -- striped
   --------------------------------------- */
.sb-fx-striped .variable-bar-fill {
  background-image: linear-gradient(
    -45deg,
    color-mix(in srgb, #ffffff 18%, transparent) 25%,
    transparent 25%,
    transparent 50%,
    color-mix(in srgb, #ffffff 18%, transparent) 50%,
    color-mix(in srgb, #ffffff 18%, transparent) 75%,
    transparent 75%,
    transparent
  );
  background-size: 14px 14px;
  animation: sbStripedMove 0.8s linear infinite;
}

@keyframes sbStripedMove {
  0% { background-position: 0 0; }
  100% { background-position: 14px 0; }
}

/* ---------------------------------------
   EFFECT -- pulse
   --------------------------------------- */
.sb-fx-pulse .variable-bar-fill {
  animation: sbBarPulse 2s ease-in-out infinite;
}

@keyframes sbBarPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

/* ---------------------------------------
   EFFECT -- combined glow+striped+pulse
   --------------------------------------- */
.sb-fx-glow.sb-fx-striped.sb-fx-pulse .variable-bar-fill {
  animation:
    sbBarPulse 2s ease-in-out infinite,
    sbStripedMove 0.8s linear infinite;
}

/* -- Mobile Responsive -- */

@media (max-width: 768px) {
  .status-bar-container {
    padding: 10px 12px;
    border-radius: 10px;
  }

  .status-bar-header {
    margin-bottom: 8px;
  }

  .status-bar-label {
    font-size: 0.62rem;
    padding: 1px 6px;
  }

  .status-bar-name {
    font-size: 0.76rem;
  }

  .status-bar-variables {
    gap: 8px;
  }

  .status-bar-variable {
    flex: 1 1 100px;
    min-width: 80px;
  }

  .variable-name {
    font-size: 0.76rem;
  }

  .variable-value {
    font-size: 0.7rem;
  }

  .variable-bar-track {
    height: 5px;
  }
}

@media (max-width: 480px) {
  .status-bar-container {
    padding: 8px 10px;
  }

  .status-bar-header {
    margin-bottom: 6px;
  }

  .status-bar-label {
    font-size: 0.58rem;
    padding: 1px 5px;
  }

  .status-bar-name {
    font-size: 0.72rem;
  }

  .status-bar-variables {
    gap: 6px;
  }

  .status-bar-variable {
    flex: 1 1 80px;
    min-width: 60px;
  }

  .variable-name {
    font-size: 0.7rem;
  }

  .variable-value {
    font-size: 0.66rem;
  }

  .variable-bar-track {
    height: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sb-fx-glow {
    animation: none;
  }

  .sb-fx-striped .variable-bar-fill {
    animation: none;
  }

  .sb-fx-pulse .variable-bar-fill {
    animation: none;
  }

  .sb-fx-glow.sb-fx-striped.sb-fx-pulse .variable-bar-fill {
    animation: none;
  }
}
</style>
