<script setup>
import { computed } from 'vue';

const props = defineProps({
  statusBar: {
    type: Object,
    default: null
  }
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
    'EXP': '#2ecc71',
    '饥饿': '#e67e22',
    '心情': '#9b59b6'
  };
  for (const [key, color] of Object.entries(colorMap)) {
    if (name.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return '#6c757d';
}

function barStyle(variable) {
  return {
    width: `${variable.percentage}%`,
    backgroundColor: variable.color
  };
}
</script>

<template>
  <div v-if="hasContent" class="status-bar-container">
    <div class="status-bar-name">{{ statusBar.name || '状态栏' }}</div>
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
.status-bar-container {
  background: linear-gradient(135deg, rgba(30, 30, 40, 0.92), rgba(25, 25, 35, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 12px;
  backdrop-filter: blur(8px);
}

.status-bar-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

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
  margin-bottom: 4px;
}

.variable-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.variable-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

.variable-bar-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.variable-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.2);
}

/* ── Mobile Responsive ── */

@media (max-width: 768px) {
  .status-bar-container {
    padding: 8px 10px;
    border-radius: 8px;
    margin-bottom: 8px;
  }

  .status-bar-name {
    font-size: 11px;
    margin-bottom: 6px;
  }

  .status-bar-variables {
    gap: 8px;
  }

  .status-bar-variable {
    flex: 1 1 100px;
    min-width: 80px;
  }

  .variable-name {
    font-size: 12px;
  }

  .variable-value {
    font-size: 11px;
  }

  .variable-bar-track {
    height: 5px;
  }
}

@media (max-width: 480px) {
  .status-bar-container {
    padding: 6px 8px;
  }

  .status-bar-name {
    font-size: 10px;
    margin-bottom: 4px;
  }

  .status-bar-variables {
    gap: 6px;
  }

  .status-bar-variable {
    flex: 1 1 80px;
    min-width: 60px;
  }

  .variable-name {
    font-size: 11px;
  }

  .variable-value {
    font-size: 10px;
  }

  .variable-bar-track {
    height: 4px;
  }
}
</style>
