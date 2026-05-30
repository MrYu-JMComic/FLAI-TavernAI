<script setup>
import { computed } from 'vue';

const VALID_VARIANTS = ['default', 'compact', 'minimal', 'neon'];
const VALID_DENSITIES = ['default', 'cozy', 'compact'];
const VALID_EFFECTS = ['glow', 'striped', 'pulse'];
const VALID_DISPLAY_MODES = ['immersive', 'compact'];
const VALID_CHAR_STATUSES = ['active', 'dead', 'forgotten', 'left', 'hidden'];

const STATUS_LABELS = {
  active: '在线',
  dead: '死亡',
  forgotten: '遗忘',
  left: '离开',
  hidden: '隐藏'
};

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

const emit = defineEmits(['quick-reply']);

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
  const displayMode = VALID_DISPLAY_MODES.includes(raw.displayMode) ? raw.displayMode : 'compact';
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  const quickReplies = Array.isArray(raw.quickReplies) ? raw.quickReplies : [];
  return { variant, density, effects, accentColor, customCss, displayMode, characters, quickReplies };
});

const hasContent = computed(() => {
  return props.statusBar && Array.isArray(props.statusBar.variables) && props.statusBar.variables.length > 0;
});

const hasImmersiveContent = computed(() => {
  return cfg.value.displayMode === 'immersive' && cfg.value.characters.length > 0;
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
  if (hasImmersiveContent.value) classes.push('sb-immersive');
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

function charStyle(ch) {
  const style = {};
  if (ch.accentColor) style['--sb-ch-accent'] = ch.accentColor;
  Object.assign(style, parseSafeStyle(ch.customCss));
  return style;
}

function charVariables(ch) {
  if (!ch.variables || !Array.isArray(ch.variables)) return [];
  return ch.variables.map((v) => {
    const value = Number(v.value) || 0;
    const max = Number(v.max) || 100;
    const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    return {
      name: v.name || '?',
      value,
      max,
      percentage,
      color: v.color || '#6c757d',
      displayValue: max > 0 ? `${value}/${max}` : String(value)
    };
  });
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function statusClass(status) {
  return `sb-char-status-${status}`;
}

function onQuickReply(text) {
  if (text) emit('quick-reply', text);
}
</script>

<template>
  <div v-if="hasContent || hasImmersiveContent" :class="wrapperClasses" :style="wrapperStyle" class="status-bar-root">
    <div v-if="hasContent" class="status-bar-header">
      <span class="status-bar-label">状态同步</span>
      <span class="status-bar-context">关联最新 AI 回复</span>
      <span class="status-bar-name">{{ statusBar.name || '状态栏' }}</span>
    </div>
    <div v-if="hasContent" class="status-bar-variables">
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

    <div v-if="hasImmersiveContent" class="sb-characters-section">
      <div
        v-for="ch in cfg.characters"
        :key="ch.id"
        class="sb-char-card"
        :class="statusClass(ch.status)"
        :style="charStyle(ch)"
      >
        <div class="sb-char-header">
          <span class="sb-char-name">{{ ch.name }}</span>
          <span v-if="ch.role" class="sb-char-role">{{ ch.role }}</span>
          <span class="sb-char-status" :class="statusClass(ch.status)">{{ statusLabel(ch.status) }}</span>
        </div>
        <p v-if="ch.note" class="sb-char-note">{{ ch.note }}</p>
        <div v-if="charVariables(ch).length" class="sb-char-variables">
          <div
            v-for="(v, vi) in charVariables(ch)"
            :key="vi"
            class="sb-char-variable"
          >
            <div class="variable-header">
              <span class="variable-name">{{ v.name }}</span>
              <span class="variable-value">{{ v.displayValue }}</span>
            </div>
            <div class="variable-bar-track">
              <div class="variable-bar-fill" :style="barStyle(v)"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="cfg.quickReplies.length" class="sb-quick-replies">
      <button
        v-for="(qr, qi) in cfg.quickReplies"
        :key="qi"
        class="sb-quick-reply-btn"
        type="button"
        @click="onQuickReply(qr.text)"
      >
        {{ qr.label }}
      </button>
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

/* -- Immersive Multi-Character Section -- */
.sb-immersive {
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.sb-immersive .status-bar-header,
.sb-immersive .status-bar-variables {
  display: none;
}

.sb-characters-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  margin-top: 0;
}

.sb-char-card {
  --sb-ch-accent: var(--sb-accent, var(--primary, #8f3f2f));
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--sb-ch-accent) 18%, var(--line, rgba(62,48,38,0.14)));
  border-radius: 10px;
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface, #fffaf2) 88%, transparent),
      color-mix(in srgb, var(--sb-ch-accent) 4%, transparent));
}

.sb-char-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.sb-char-name {
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--text, #241f1b);
}

.sb-char-role {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 6px;
  color: var(--sb-ch-accent);
  background: color-mix(in srgb, var(--sb-ch-accent) 12%, transparent);
}

.sb-char-status {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 6px;
  line-height: 1.5;
}

.sb-char-status-active {
  color: var(--green, #2e6654);
  background: var(--green-soft, #dfeee6);
}

.sb-char-status-dead {
  color: var(--danger, #b83232);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.sb-char-status-forgotten {
  color: var(--muted, #75685e);
  background: color-mix(in srgb, var(--muted) 12%, transparent);
}

.sb-char-status-left {
  color: #a86400;
  background: color-mix(in srgb, #ffc76a 24%, transparent);
}

.sb-char-status-hidden {
  color: var(--muted, #75685e);
  background: color-mix(in srgb, var(--muted) 8%, transparent);
  opacity: 0.7;
}

.sb-char-card.sb-char-status-hidden {
  opacity: 0.55;
  border-style: dashed;
  border-color: color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 60%, transparent);
  background: color-mix(in srgb, var(--surface, #fffaf2) 40%, transparent);
}

.sb-char-card.sb-char-status-hidden .sb-char-name {
  color: var(--muted, #75685e);
}

.sb-char-note {
  margin: 4px 0 6px;
  font-size: 0.78rem;
  color: var(--muted, #75685e);
  line-height: 1.4;
}

.sb-char-variables {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.sb-char-variable {
  flex: 1 1 120px;
  min-width: 100px;
}

/* -- Quick Replies -- */
.sb-quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.sb-quick-reply-btn {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--sb-accent, var(--primary)) 30%, var(--line, rgba(62,48,38,0.14)));
  border-radius: 8px;
  color: var(--sb-accent, var(--primary, #8f3f2f));
  background: color-mix(in srgb, var(--sb-accent, var(--primary)) 8%, var(--surface, #fffaf2));
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.sb-quick-reply-btn:hover {
  background: color-mix(in srgb, var(--sb-accent, var(--primary)) 16%, var(--surface, #fffaf2));
  border-color: color-mix(in srgb, var(--sb-accent, var(--primary)) 50%, var(--line));
}

@media (prefers-reduced-motion: reduce) {
  .sb-quick-reply-btn {
    transition: none;
  }
}

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

  .sb-characters-section {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 6px;
  }

  .sb-char-card {
    padding: 8px 10px;
  }

  .sb-char-name {
    font-size: 0.82rem;
  }

  .sb-char-role {
    font-size: 0.68rem;
    padding: 1px 5px;
  }

  .sb-char-status {
    font-size: 0.64rem;
    padding: 1px 5px;
  }

  .sb-char-note {
    font-size: 0.74rem;
  }

  .sb-char-variables {
    gap: 8px;
  }

  .sb-char-variable {
    flex: 1 1 100px;
    min-width: 80px;
  }

  .sb-quick-replies {
    gap: 4px;
    margin-top: 8px;
  }

  .sb-quick-reply-btn {
    min-height: 28px;
    padding: 0 10px;
    font-size: 0.76rem;
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

  .sb-characters-section {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .sb-char-card {
    padding: 6px 8px;
  }

  .sb-char-header {
    gap: 4px;
  }

  .sb-char-name {
    font-size: 0.78rem;
  }

  .sb-char-role {
    font-size: 0.64rem;
  }

  .sb-char-status {
    font-size: 0.6rem;
  }

  .sb-char-note {
    font-size: 0.7rem;
  }

  .sb-char-variable {
    flex: 1 1 80px;
    min-width: 60px;
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
