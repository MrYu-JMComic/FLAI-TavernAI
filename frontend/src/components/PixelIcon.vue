<script setup>
import { computed } from 'vue';
import { findPixelIcon } from '../../../shared/pixelIconCatalog.js';

const props = defineProps({
  iconKey: { type: String, default: '' },
  size: { type: Number, default: 24 },
  label: { type: String, default: '' }
});

const icon = computed(() => findPixelIcon(props.iconKey) || findPixelIcon('item.chest'));
const gridSize = computed(() => Number(icon.value?.gridSize || 12));
const pixels = computed(() => {
  const result = [];
  const rows = icon.value?.pixels || [];
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      const colorIndex = Number(rows[y][x] || 0);
      if (colorIndex > 0) result.push({ x, y, color: icon.value.palette[colorIndex] });
    }
  }
  return result;
});
</script>

<template>
  <svg
    class="pixel-icon"
    :viewBox="`0 0 ${gridSize} ${gridSize}`"
    :width="size"
    :height="size"
    shape-rendering="crispEdges"
    :aria-label="label || icon?.label"
    :aria-hidden="label ? undefined : 'true'"
  >
    <rect v-for="pixel in pixels" :key="`${pixel.x}-${pixel.y}`" :x="pixel.x" :y="pixel.y" width="1" height="1" :fill="pixel.color" />
  </svg>
</template>

<style scoped>
.pixel-icon {
  display: block;
  overflow: visible;
  image-rendering: pixelated;
  filter: drop-shadow(0 1px 0 rgba(8, 12, 24, 0.42));
}
</style>
