<script setup>
const props = defineProps({
  rarity: { type: String, default: 'common' },
  name: { type: String, required: true },
  compact: { type: Boolean, default: false }
});

function rarityClass(rarity) {
  return `rarity-${rarity || 'common'}`;
}
</script>

<template>
  <span class="talent-badge" :class="[rarityClass(rarity), { compact }]">
    <span class="talent-badge-dot" />
    <span class="talent-badge-name">{{ name }}</span>
  </span>
</template>
