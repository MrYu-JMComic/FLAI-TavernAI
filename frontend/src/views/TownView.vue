<script setup>
import TownExperience from '../features/town/TownExperience.vue';

const emit = defineEmits(['navigate']);
</script>

<template>
  <TownExperience @navigate="emit('navigate', $event)" />
</template>
