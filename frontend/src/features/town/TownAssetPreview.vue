<script setup>
import { onMounted, ref, watch } from 'vue';
import { TOWN_ASSETS } from '../../../../shared/townAssets.js';
import { drawTownAsset } from './townAssetRenderer.js';

const props = defineProps({ assetId: { type: String, required: true }, architecture: { type: String, default: 'modern' }, label: { type: String, required: true } });
const canvas = ref(null);
const palette = { wall: '#e2d3b4', roof: '#a96655', tree: '#377455' };
function draw() {
  const context = canvas.value?.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, 160, 112);
  context.fillStyle = '#e4ece5';
  context.fillRect(0, 0, 160, 112);
  drawTownAsset(context, { ...TOWN_ASSETS[props.assetId], assetId: props.assetId, architecture: props.architecture, x: 80, y: 78 }, palette);
}
onMounted(draw);
watch(() => [props.assetId, props.architecture], draw);
</script>

<template>
  <canvas ref="canvas" class="town-asset-preview" width="160" height="112" role="img" :aria-label="label"></canvas>
</template>

<style scoped>
.town-asset-preview { display: block; width: 100%; height: auto; aspect-ratio: 10 / 7; }
</style>
