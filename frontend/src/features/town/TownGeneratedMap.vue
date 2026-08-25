<script setup>
import { nextTick, onMounted, ref, watch } from 'vue';

const props = defineProps({
  mapConfig: {
    type: Object,
    required: true
  },
  label: {
    type: String,
    default: 'AI 生成的世界地图'
  }
});

const canvas = ref(null);

onMounted(drawMap);
watch(
  () => props.mapConfig,
  () => void nextTick(drawMap)
);

function drawMap() {
  const element = canvas.value;
  if (!element) return;
  const map = props.mapConfig || {};
  const width = positiveNumber(map.width, 1600);
  const height = positiveNumber(map.height, 900);
  if (element.width !== width) element.width = width;
  if (element.height !== height) element.height = height;
  const context = element.getContext('2d');
  if (!context) return;

  const palette = normalizePalette(map.palette);
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.ground;
  context.fillRect(0, 0, width, height);

  drawTerrain(context, map.terrainPatches, palette);
  drawDecorations(context, map.decorations, palette);
  drawWater(context, map.waterBodies, palette);
  drawRoads(context, map.roads, palette);
  drawLocationCenters(context, map.locations, palette);
  drawBuildings(context, map.buildings, palette);
  drawTexture(context, width, height, Number(map.seed) || 1);
  drawVignette(context, width, height);
}

function drawTerrain(context, patches, palette) {
  for (const patch of arrayOrEmpty(patches)) {
    context.save();
    context.globalAlpha = clampNumber(patch.opacity, 0.04, 0.3, 0.12);
    context.fillStyle = palette.groundAlt;
    context.beginPath();
    context.ellipse(
      finiteNumber(patch.x),
      finiteNumber(patch.y),
      positiveNumber(patch.radiusX, 80),
      positiveNumber(patch.radiusY, 50),
      0,
      0,
      Math.PI * 2
    );
    context.fill();
    context.restore();
  }
}

function drawWater(context, waterBodies, palette) {
  for (const body of arrayOrEmpty(waterBodies)) {
    if (body.kind === 'coast') {
      const points = normalizePoints(body.points);
      if (points.length < 3) continue;
      context.save();
      tracePolygon(context, points);
      context.fillStyle = palette.water;
      context.fill();
      context.strokeStyle = palette.waterEdge;
      context.lineWidth = 14;
      context.lineJoin = 'round';
      context.stroke();
      context.restore();
      continue;
    }

    if (body.kind === 'river') {
      const points = normalizePoints(body.points);
      if (points.length < 2) continue;
      const width = positiveNumber(body.width, 76);
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      traceSmoothLine(context, points);
      context.strokeStyle = palette.waterEdge;
      context.lineWidth = width + 18;
      context.stroke();
      traceSmoothLine(context, points);
      context.strokeStyle = palette.water;
      context.lineWidth = width;
      context.stroke();
      context.globalAlpha = 0.3;
      context.setLineDash([18, 24]);
      traceSmoothLine(context, points);
      context.strokeStyle = '#d8f4f2';
      context.lineWidth = 3;
      context.stroke();
      context.restore();
      continue;
    }

    if (body.kind === 'lake') {
      const radiusX = positiveNumber(body.radiusX, 160);
      const radiusY = positiveNumber(body.radiusY, 95);
      const rotation = finiteNumber(body.rotation) * Math.PI / 180;
      context.save();
      context.translate(finiteNumber(body.x), finiteNumber(body.y));
      context.rotate(rotation);
      context.fillStyle = palette.waterEdge;
      context.beginPath();
      context.ellipse(0, 0, radiusX + 11, radiusY + 11, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = palette.water;
      context.beginPath();
      context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.28;
      context.strokeStyle = '#e1fbf6';
      context.lineWidth = 3;
      for (const offset of [-0.32, 0.08, 0.42]) {
        context.beginPath();
        context.ellipse(0, radiusY * offset, radiusX * 0.55, radiusY * 0.16, 0, 0, Math.PI);
        context.stroke();
      }
      context.restore();
    }
  }
}

function drawRoads(context, roads, palette) {
  for (const road of arrayOrEmpty(roads)) {
    const points = normalizePoints(road.points);
    if (points.length < 2) continue;
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    traceSmoothLine(context, points);
    context.strokeStyle = palette.roadEdge;
    context.lineWidth = 25;
    context.stroke();
    traceSmoothLine(context, points);
    context.strokeStyle = palette.road;
    context.lineWidth = 15;
    context.stroke();
    context.globalAlpha = 0.22;
    context.setLineDash([8, 13]);
    traceSmoothLine(context, points);
    context.strokeStyle = '#fff3cf';
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }
}

function drawLocationCenters(context, locations, palette) {
  for (const location of arrayOrEmpty(locations)) {
    const importance = clampNumber(location.importance, 1, 5, 3);
    context.save();
    context.translate(finiteNumber(location.x), finiteNumber(location.y));
    context.globalAlpha = 0.28;
    context.fillStyle = palette.road;
    context.beginPath();
    context.ellipse(0, 0, 28 + importance * 7, 18 + importance * 4, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.42;
    context.strokeStyle = palette.roadEdge;
    context.lineWidth = 3;
    context.stroke();
    context.restore();
  }
}

function drawDecorations(context, decorations, palette) {
  for (const decoration of arrayOrEmpty(decorations)) {
    const scale = clampNumber(decoration.scale, 0.3, 2, 1);
    const x = finiteNumber(decoration.x);
    const y = finiteNumber(decoration.y);
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    if (decoration.kind === 'tree') {
      context.globalAlpha = 0.2;
      context.fillStyle = '#11190e';
      context.beginPath();
      context.ellipse(4, 7, 13, 7, 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = '#5f4a33';
      context.fillRect(-2, 2, 5, 9);
      context.fillStyle = palette.tree;
      for (const [offsetX, offsetY, radius] of [[0, -4, 9], [-6, 1, 7], [6, 1, 7]]) {
        context.beginPath();
        context.arc(offsetX, offsetY, radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 0.18;
      context.fillStyle = '#f4f2d0';
      context.beginPath();
      context.arc(-3, -7, 4, 0, Math.PI * 2);
      context.fill();
    } else {
      context.globalAlpha = 0.24;
      context.fillStyle = '#121411';
      context.beginPath();
      context.ellipse(3, 4, 9, 5, -0.2, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = palette.rock;
      context.beginPath();
      context.moveTo(-7, 4);
      context.lineTo(-4, -5);
      context.lineTo(3, -8);
      context.lineTo(9, -1);
      context.lineTo(6, 6);
      context.closePath();
      context.fill();
      context.globalAlpha = 0.22;
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.moveTo(-3, -4);
      context.lineTo(2, -6);
      context.lineTo(4, -2);
      context.closePath();
      context.fill();
    }
    context.restore();
  }
}

function drawBuildings(context, buildings, palette) {
  const sorted = [...arrayOrEmpty(buildings)].sort((first, second) => finiteNumber(first.y) - finiteNumber(second.y));
  for (const building of sorted) {
    const width = positiveNumber(building.width, 36);
    const height = positiveNumber(building.height, 28);
    const landmark = building.kind && building.kind !== 'house';
    context.save();
    context.translate(finiteNumber(building.x), finiteNumber(building.y));
    context.rotate(finiteNumber(building.rotation) * Math.PI / 180);

    context.globalAlpha = 0.24;
    context.fillStyle = '#11100e';
    context.beginPath();
    context.ellipse(5, height * 0.38, width * 0.62, height * 0.38, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;

    const floors = clampNumber(building.floors, 1, 3, 1);
    for (let floor = floors - 1; floor >= 0; floor -= 1) {
      const offset = floor * 3;
      context.fillStyle = palette.wall;
      context.strokeStyle = landmark ? '#f3d08a' : palette.roadEdge;
      context.lineWidth = landmark ? 2.5 : 1.5;
      context.fillRect(-width / 2 - offset, -height / 2 - offset, width, height);
      context.strokeRect(-width / 2 - offset, -height / 2 - offset, width, height);
    }

    context.fillStyle = palette.roof;
    context.beginPath();
    context.moveTo(-width * 0.62, -height * 0.1);
    context.lineTo(0, -height * 0.72);
    context.lineTo(width * 0.62, -height * 0.1);
    context.lineTo(0, height * 0.28);
    context.closePath();
    context.fill();
    context.strokeStyle = landmark ? '#f2c76d' : palette.roadEdge;
    context.lineWidth = landmark ? 2.4 : 1.3;
    context.stroke();

    context.globalAlpha = 0.34;
    context.strokeStyle = '#fff3d0';
    context.beginPath();
    context.moveTo(0, -height * 0.69);
    context.lineTo(0, height * 0.24);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = '#4b352b';
    context.fillRect(-3, height * 0.23, 6, Math.max(5, height * 0.18));

    if (landmark) {
      context.fillStyle = '#f4cf72';
      context.beginPath();
      context.arc(0, -height * 0.18, 3.2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function drawTexture(context, width, height, seed) {
  let state = seed >>> 0;
  context.save();
  context.globalAlpha = 0.055;
  context.fillStyle = '#0a0b0b';
  for (let index = 0; index < 900; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = state / 4294967296 * width;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const y = state / 4294967296 * height;
    context.fillRect(x, y, 1.2, 1.2);
  }
  context.restore();
}

function drawVignette(context, width, height) {
  const gradient = context.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, width * 0.72);
  gradient.addColorStop(0, 'rgba(7, 10, 16, 0)');
  gradient.addColorStop(1, 'rgba(7, 10, 16, 0.24)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function tracePolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
}

function traceSmoothLine(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  context.lineTo(last.x, last.y);
}

function normalizePoints(value) {
  return arrayOrEmpty(value)
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function normalizePalette(value = {}) {
  return {
    ground: value.ground || '#8f9b68',
    groundAlt: value.groundAlt || '#73845a',
    water: value.water || '#4d8392',
    waterEdge: value.waterEdge || '#b8c79b',
    road: value.road || '#c4a66e',
    roadEdge: value.roadEdge || '#7f6a4d',
    wall: value.wall || '#d7c394',
    roof: value.roof || '#744b3e',
    tree: value.tree || '#496545',
    rock: value.rock || '#77796f'
  };
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}
</script>

<template>
  <canvas ref="canvas" class="town-generated-map" role="img" :aria-label="label">
    {{ label }}
  </canvas>
</template>

<style scoped>
.town-generated-map {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  background: #788665;
  user-select: none;
  pointer-events: none;
}
</style>
