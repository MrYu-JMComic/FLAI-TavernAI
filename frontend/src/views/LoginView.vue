<script setup>
import AuthView from './AuthView.vue';

const emit = defineEmits(['authenticated']);
</script>

<template>
  <AuthView initial-mode="login" @authenticated="emit('authenticated', $event)" />
</template>
