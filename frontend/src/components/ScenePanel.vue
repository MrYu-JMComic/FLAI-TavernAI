<script setup>
import { computed, ref, watch } from 'vue';
import {
  ArrowLeft, Box, Building2, ChevronRight, Compass, DoorOpen, Footprints,
  Layers3, Map as MapIcon, MapPin, Plus, RefreshCw, Route, Sparkles, Warehouse, X
} from '@lucide/vue';
import PixelIcon from './PixelIcon.vue';
import { PIXEL_ICON_CATALOG } from '../../../shared/pixelIconCatalog.js';
import {
  createSceneItem, createSceneNode, createSceneRoute, deleteSceneEntity,
  fetchConversationScenes, organizeScenes, updateSceneItem
} from '../api/chat.js';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  conversationId: { type: String, required: true },
  open: { type: Boolean, default: false }
});
const emit = defineEmits(['close']);
const notify = useNotify();

const workspace = ref({ nodes: [], routes: [], items: [] });
const loading = ref(false);
const busy = ref(false);
const viewMode = ref('map');
const selectedNodeId = ref('');
const activeContainerId = ref('');
const selectedItemId = ref('');
const managerOpen = ref(false);
const requirement = ref('');
const nodeForm = ref({ name: '', nodeType: 'room', parentId: '', description: '', x: 50, y: 50, iconKey: 'room.door' });
const itemForm = ref({ name: '', description: '', movable: true, position: '{"x":50,"y":50}', iconKey: 'item.chest' });
const routeForm = ref({ fromNodeId: '', toNodeId: '', label: '', description: '', bidirectional: true });

const nodeTypes = {
  main_scene: '主场景', map: '地图', building: '建筑', room: '房间', area: '区域'
};
const pixelIconOptions = PIXEL_ICON_CATALOG;
const selectedNode = computed(() => nodeById(selectedNodeId.value));
const activeContainer = computed(() => nodeById(activeContainerId.value));
const selectedItem = computed(() => workspace.value.items.find(item => item.id === selectedItemId.value) || null);
const rootNodes = computed(() => workspace.value.nodes.filter(node => !node.parentId || !nodeById(node.parentId)));
const structuralRoots = computed(() => rootNodes.value.filter(node => node.nodeType !== 'room' && node.nodeType !== 'area'));
const orphanRooms = computed(() => rootNodes.value.filter(node => node.nodeType === 'room' || node.nodeType === 'area'));
const mapNodes = computed(() => {
  if (!activeContainerId.value) return structuralRoots.value;
  const children = childrenOf(activeContainerId.value);
  return children.length ? children : [activeContainer.value].filter(Boolean);
});
const mapPoints = computed(() => {
  const points = new Map();
  for (let index = 0; index < mapNodes.value.length; index += 1) {
    points.set(mapNodes.value[index].id, resolveMapPoint(mapNodes.value[index], index, mapNodes.value.length));
  }
  return points;
});
const visibleRoutes = computed(() => workspace.value.routes.filter(route => mapPoints.value.has(route.fromNodeId) && mapPoints.value.has(route.toNodeId)));
const interiorRooms = computed(() => activeContainerId.value
  ? childrenOf(activeContainerId.value).filter(node => node.nodeType === 'room' || node.nodeType === 'area')
  : orphanRooms.value);
const roomItems = computed(() => workspace.value.items.filter(item => item.ownerType === 'world' && item.nodeId === selectedNodeId.value));
const connectedRoutes = computed(() => workspace.value.routes.filter(route => route.fromNodeId === selectedNodeId.value || route.toNodeId === selectedNodeId.value));
const breadcrumbs = computed(() => {
  const result = [];
  let current = selectedNode.value || activeContainer.value;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = nodeById(current.parentId);
  }
  return result;
});
const sceneStats = computed(() => ({
  scenes: workspace.value.nodes.filter(node => node.nodeType === 'main_scene' || node.nodeType === 'map').length,
  buildings: workspace.value.nodes.filter(node => node.nodeType === 'building').length,
  rooms: workspace.value.nodes.filter(node => node.nodeType === 'room' || node.nodeType === 'area').length,
  items: workspace.value.items.filter(item => item.ownerType === 'world').length
}));

function nodeById(id) {
  return workspace.value.nodes.find(node => node.id === id) || null;
}

function childrenOf(parentId) {
  return workspace.value.nodes.filter(node => node.parentId === parentId);
}

function nodeIcon(node) {
  if (node?.nodeType === 'building') return Building2;
  if (node?.nodeType === 'room') return DoorOpen;
  if (node?.nodeType === 'area') return MapPin;
  if (node?.nodeType === 'map') return MapIcon;
  return Compass;
}

function resolveMapPoint(node, index, count) {
  const x = normalizedCoordinate(node?.layout?.x ?? node?.layout?.position?.x);
  const y = normalizedCoordinate(node?.layout?.y ?? node?.layout?.position?.y);
  if (x !== null && y !== null) return { x, y };
  return unresolvedGridPoint(node?.id || `${index}-${count}`);
}

function unresolvedGridPoint(value) {
  let hash = 0;
  const text = String(value || 'scene');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return { x: 12 + Math.abs(hash % 76), y: 12 + Math.abs(Math.trunc(hash / 97) % 76), unresolved: true };
}

function nodePixelIcon(node) {
  if (node?.layout?.iconKey) return node.layout.iconKey;
  if (node?.nodeType === 'building') return 'building.house';
  if (node?.nodeType === 'room') return 'room.door';
  if (node?.nodeType === 'area') return 'map.district';
  return 'map.world';
}

function normalizedCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 0 && number <= 1) return Math.round(number * 100);
  return Math.min(92, Math.max(8, number));
}

function mapNodeStyle(node) {
  const point = mapPoints.value.get(node.id) || { x: 50, y: 50 };
  return { left: `${point.x}%`, top: `${point.y}%` };
}

function routeLine(route) {
  const from = mapPoints.value.get(route.fromNodeId);
  const to = mapPoints.value.get(route.toNodeId);
  return from && to ? { x1: from.x, y1: from.y, x2: to.x, y2: to.y } : null;
}

function itemStyle(item, index) {
  const x = normalizedCoordinate(item?.position?.x);
  const y = normalizedCoordinate(item?.position?.y);
  if (x !== null && y !== null) return { left: `${x}%`, top: `${y}%` };
  const point = unresolvedGridPoint(item?.itemCode || index);
  return { left: `${point.x}%`, top: `${point.y}%` };
}

function selectMapNode(node) {
  selectedNodeId.value = node.id;
  selectedItemId.value = '';
}

function preferredMapNode(node) {
  if (!node) return null;
  if (node.nodeType === 'map') return node;
  return childrenOf(node.id).find(child => child.nodeType === 'map') || null;
}

function openPreferredMap(node) {
  if (!node) return false;
  const mapNode = preferredMapNode(node);
  const container = mapNode || node;
  const entries = childrenOf(container.id);
  activeContainerId.value = container.id;
  selectedNodeId.value = entries[0]?.id || container.id;
  selectedItemId.value = '';
  viewMode.value = 'map';
  return Boolean(mapNode);
}

function enterNode(node = selectedNode.value) {
  if (!node) return;
  selectedNodeId.value = node.id;
  const children = childrenOf(node.id);
  if (preferredMapNode(node)) {
    openPreferredMap(node);
    return;
  }
  if (node.nodeType === 'room' || (node.nodeType === 'area' && !children.length)) {
    activeContainerId.value = node.parentId || activeContainerId.value;
    viewMode.value = 'interior';
    return;
  }
  activeContainerId.value = node.id;
  selectedNodeId.value = children[0]?.id || node.id;
  viewMode.value = children.some(child => child.nodeType === 'room' || child.nodeType === 'area') ? 'interior' : 'map';
}

function openRootMap(node) {
  openPreferredMap(node);
}

function openUnsortedRooms() {
  activeContainerId.value = '';
  selectedNodeId.value = orphanRooms.value[0]?.id || '';
  selectedItemId.value = '';
  viewMode.value = 'interior';
}

async function repairHierarchy() {
  requirement.value = '整理现有场景结构：合并重复房间，为孤立房间补充正确的建筑父级；删除没有剧情依据的放射状路线。不要新增无依据的地点。';
  await organize();
}

function goBack() {
  const container = activeContainer.value;
  if (viewMode.value === 'interior' && container) {
    selectedNodeId.value = container.id;
    viewMode.value = 'map';
    return;
  }
  if (container?.parentId) {
    activeContainerId.value = container.parentId;
    selectedNodeId.value = container.id;
    viewMode.value = 'map';
    return;
  }
  activeContainerId.value = '';
  selectedNodeId.value = rootNodes.value[0]?.id || '';
}

function routeTarget(route) {
  const targetId = route.fromNodeId === selectedNodeId.value ? route.toNodeId : route.fromNodeId;
  return nodeById(targetId)?.name || '未知地点';
}

function syncSelection() {
  if (!workspace.value.nodes.length) {
    selectedNodeId.value = '';
    activeContainerId.value = '';
    return;
  }
  const preferredRoot = structuralRoots.value[0] || orphanRooms.value[0] || workspace.value.nodes[0];
  if (!nodeById(selectedNodeId.value)) selectedNodeId.value = preferredRoot.id;
  if (activeContainerId.value && !nodeById(activeContainerId.value)) activeContainerId.value = '';
  if (!activeContainerId.value && structuralRoots.value.length) {
    const root = structuralRoots.value[0];
    const mapNode = preferredMapNode(root);
    const container = mapNode || root;
    activeContainerId.value = container.id;
    if (selectedNodeId.value === root.id && mapNode) {
      selectedNodeId.value = childrenOf(container.id)[0]?.id || container.id;
    }
    viewMode.value = 'map';
  }
  if (!structuralRoots.value.length && orphanRooms.value.length) viewMode.value = 'interior';
  nodeForm.value.parentId = selectedNodeId.value;
  routeForm.value.fromNodeId = selectedNodeId.value;
}

async function load() {
  if (!props.conversationId || loading.value) return;
  loading.value = true;
  try {
    workspace.value = await fetchConversationScenes(props.conversationId);
    syncSelection();
  } catch (error) {
    notify.error(error.message || '场景加载失败');
  } finally {
    loading.value = false;
  }
}

async function organize() {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await organizeScenes(props.conversationId, { requirement: requirement.value });
    workspace.value = result.workspace;
    syncSelection();
    notify.success(result.summary || '场景已整理');
  } catch (error) {
    notify.error(error.message || '场景助手失败');
  } finally {
    busy.value = false;
  }
}

async function saveNode() {
  if (!nodeForm.value.name.trim() || busy.value) return;
  busy.value = true;
  try {
    const payload = {
      name: nodeForm.value.name,
      nodeType: nodeForm.value.nodeType,
      parentId: nodeForm.value.parentId,
      description: nodeForm.value.description,
      layout: { x: Number(nodeForm.value.x), y: Number(nodeForm.value.y), iconKey: nodeForm.value.iconKey }
    };
    const node = await createSceneNode(props.conversationId, payload);
    workspace.value.nodes.push(node);
    selectedNodeId.value = node.id;
    nodeForm.value = { name: '', nodeType: 'room', parentId: node.id, description: '', x: 50, y: 50, iconKey: 'room.door' };
    notify.success('场景节点已保存');
  } catch (error) {
    notify.error(error.message || '场景节点保存失败');
  } finally {
    busy.value = false;
  }
}

async function saveItem() {
  if (!selectedNodeId.value || !itemForm.value.name.trim() || busy.value) return;
  busy.value = true;
  try {
    const position = JSON.parse(itemForm.value.position || '{}');
    const item = await createSceneItem(props.conversationId, {
      ...itemForm.value,
      nodeId: selectedNodeId.value,
      position,
      ownerType: 'world',
      itemKind: 'item'
    });
    workspace.value.items.push(item);
    selectedItemId.value = item.id;
    itemForm.value = { name: '', description: '', movable: true, position: '{"x":50,"y":50}', iconKey: 'item.chest' };
    notify.success(`物品已保存 · ${item.itemCode}`);
  } catch (error) {
    notify.error(error.message || '物品保存失败，请检查位置 JSON');
  } finally {
    busy.value = false;
  }
}

async function saveRoute() {
  if (!routeForm.value.fromNodeId || !routeForm.value.toNodeId || busy.value) return;
  busy.value = true;
  try {
    const route = await createSceneRoute(props.conversationId, routeForm.value);
    workspace.value.routes.push(route);
    routeForm.value = { ...routeForm.value, toNodeId: '', label: '', description: '' };
    notify.success('路线已连接');
  } catch (error) {
    notify.error(error.message || '路线保存失败');
  } finally {
    busy.value = false;
  }
}

async function updateItemPosition(item, event) {
  try {
    const position = JSON.parse(event.target.value || '{}');
    const next = await updateSceneItem(props.conversationId, item.id, {
      nodeId: item.nodeId, name: item.name, description: item.description,
      itemCode: item.itemCode, movable: item.movable, state: item.state, position
    });
    const index = workspace.value.items.findIndex(value => value.id === item.id);
    if (index >= 0) workspace.value.items[index] = next;
    notify.success('物品位置已更新');
  } catch (error) {
    notify.error(error.message || '位置 JSON 格式无效');
  }
}

async function remove(type, id) {
  if (busy.value) return;
  busy.value = true;
  try {
    await deleteSceneEntity(props.conversationId, type, id);
    await load();
  } catch (error) {
    notify.error(error.message || '删除失败');
  } finally {
    busy.value = false;
  }
}

watch(() => props.open, (open) => {
  if (open) load();
}, { immediate: true });
watch(selectedNodeId, (id) => {
  if (!id) return;
  nodeForm.value.parentId = id;
  routeForm.value.fromNodeId = id;
});
</script>

<template>
  <div v-if="open" class="scene-overlay" @click.self="emit('close')">
    <section class="scene-explorer" role="dialog" aria-modal="true" aria-labelledby="scene-panel-title">
      <header class="scene-topbar">
        <div class="scene-brand">
          <span class="scene-brand-icon"><Compass :size="21" /></span>
          <div>
            <p>SCENE ATLAS · 永久空间档案</p>
            <h2 id="scene-panel-title">场景构建助手</h2>
          </div>
        </div>
        <div class="scene-topbar-actions">
          <button type="button" :disabled="loading || busy" title="刷新场景" aria-label="刷新场景" @click="load"><RefreshCw :size="17" /></button>
          <button class="scene-ai-button" type="button" :disabled="busy" @click="organize"><Sparkles :size="16" /><span>AI 完善世界</span></button>
          <button type="button" aria-label="关闭场景构建助手" @click="emit('close')"><X :size="19" /></button>
        </div>
      </header>

      <div class="scene-shell">
        <aside class="scene-sidebar">
          <div class="scene-stats">
            <span><strong>{{ sceneStats.scenes }}</strong>世界</span>
            <span><strong>{{ sceneStats.buildings }}</strong>建筑</span>
            <span><strong>{{ sceneStats.rooms }}</strong>房间</span>
            <span><strong>{{ sceneStats.items }}</strong>物品</span>
          </div>

          <nav class="scene-view-tabs" aria-label="场景视图">
            <button type="button" :class="{ active: viewMode === 'map' }" @click="viewMode = 'map'"><MapIcon :size="16" />地图</button>
            <button type="button" :class="{ active: viewMode === 'interior' }" :disabled="!activeContainer" @click="viewMode = 'interior'"><Building2 :size="16" />建筑</button>
            <button type="button" :class="{ active: managerOpen }" @click="managerOpen = !managerOpen"><Layers3 :size="16" />编辑</button>
          </nav>

          <div class="scene-world-list">
            <div class="scene-sidebar-title"><span>场景索引</span><small>{{ workspace.nodes.length }}</small></div>
            <button
              v-for="node in structuralRoots"
              :key="node.id"
              type="button"
              class="scene-world-card"
              :class="{ active: activeContainerId === node.id }"
              @click="openRootMap(node)"
            >
              <component :is="nodeIcon(node)" :size="17" />
              <span><strong>{{ node.name }}</strong><small>{{ nodeTypes[node.nodeType] || node.nodeType }}</small></span>
              <ChevronRight :size="15" />
            </button>
            <button v-if="orphanRooms.length" type="button" class="scene-world-card scene-unsorted-card" :class="{ active: !activeContainerId && viewMode === 'interior' }" @click="openUnsortedRooms">
              <Layers3 :size="17" />
              <span><strong>待整理房间</strong><small>{{ orphanRooms.length }} 个房间缺少建筑归属</small></span>
              <ChevronRight :size="15" />
            </button>
            <div v-if="!workspace.nodes.length && !loading" class="scene-sidebar-empty">
              <Compass :size="28" />
              <strong>世界尚未绘制</strong>
              <span>点击“AI 完善世界”，从剧情中生成第一张地图。</span>
            </div>
          </div>

          <label class="scene-ai-prompt">
            <span><Sparkles :size="14" /> 给场景助手的指令</span>
            <textarea v-model="requirement" rows="3" placeholder="例如：补全酒馆二层、后院路线与房间物品" />
          </label>
        </aside>

        <main class="scene-stage">
          <div class="scene-breadcrumbs">
            <button v-if="activeContainerId || (viewMode === 'interior' && structuralRoots.length)" type="button" aria-label="返回上一层" @click="goBack"><ArrowLeft :size="16" /></button>
            <span>场景宇宙</span>
            <template v-for="crumb in breadcrumbs" :key="crumb.id">
              <ChevronRight :size="13" />
              <strong>{{ crumb.name }}</strong>
            </template>
          </div>

          <section v-if="viewMode === 'map'" class="scene-map-view">
            <div class="scene-map-grid" aria-label="场景路线图">
              <div class="scene-map-light light-one"></div>
              <div class="scene-map-light light-two"></div>
              <svg class="scene-route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <template v-for="route in visibleRoutes" :key="route.id">
                  <line
                    v-if="routeLine(route)"
                    :x1="routeLine(route).x1"
                    :y1="routeLine(route).y1"
                    :x2="routeLine(route).x2"
                    :y2="routeLine(route).y2"
                  />
                </template>
              </svg>
              <button
                v-for="node in mapNodes"
                :key="node.id"
                type="button"
                class="scene-map-marker"
                :class="[`type-${node.nodeType}`, { selected: selectedNodeId === node.id, unresolved: mapPoints.get(node.id)?.unresolved }]"
                :style="mapNodeStyle(node)"
                @click="selectMapNode(node)"
                @dblclick="enterNode(node)"
              >
                <span class="scene-marker-pulse"></span>
                <span class="scene-marker-icon"><PixelIcon :icon-key="nodePixelIcon(node)" :size="24" /></span>
                <span class="scene-marker-copy"><strong>{{ node.name }}</strong><small>{{ nodeTypes[node.nodeType] }}</small></span>
              </button>
              <div v-if="!mapNodes.length" class="scene-map-empty">
                <MapIcon :size="42" />
                <h3>这片区域还是空白</h3>
                <p>让场景助手根据最近剧情绘制地点、建筑和路线。</p>
                <button type="button" :disabled="busy" @click="organize"><Sparkles :size="15" />生成场景地图</button>
              </div>
              <div class="scene-map-legend"><span><i class="legend-scene"></i>场景</span><span><i class="legend-building"></i>建筑</span><span><i class="legend-room"></i>房间</span></div>
            </div>

            <aside v-if="selectedNode" class="scene-location-card">
              <div class="scene-location-heading">
                <span><component :is="nodeIcon(selectedNode)" :size="19" /></span>
                <div><small>{{ nodeTypes[selectedNode.nodeType] }}</small><h3>{{ selectedNode.name }}</h3></div>
              </div>
              <p>{{ selectedNode.description || '这里的细节仍等待剧情揭示。' }}</p>
              <div class="scene-location-meta">
                <span><DoorOpen :size="14" />{{ childrenOf(selectedNode.id).length }} 个子区域</span>
                <span><Route :size="14" />{{ connectedRoutes.length }} 条路线</span>
                <span><Box :size="14" />{{ workspace.items.filter(item => item.ownerType === 'world' && item.nodeId === selectedNode.id).length }} 件物品</span>
              </div>
              <button class="scene-enter-button" type="button" @click="enterNode()"><Footprints :size="16" />进入 {{ selectedNode.name }}<ChevronRight :size="16" /></button>
            </aside>
          </section>

          <section v-else class="scene-interior-view">
            <div v-if="!activeContainerId && orphanRooms.length" class="scene-repair-banner">
              <div><Layers3 :size="19" /><span><strong>这些房间还没有归属建筑</strong><small>场景助手会合并重复寝室、补全建筑层级并清理无依据路线。</small></span></div>
              <button type="button" :disabled="busy" @click="repairHierarchy"><Sparkles :size="14" />一键整理</button>
            </div>
            <header class="scene-interior-header">
              <div><small>{{ activeContainer ? nodeTypes[activeContainer.nodeType] : '室内地图' }}</small><h3>{{ activeContainer?.name || selectedNode?.name || '建筑内部' }}</h3><p>{{ activeContainer?.description || '选择房间以查看布局、物品与通往其他地点的路线。' }}</p></div>
              <Warehouse :size="42" />
            </header>

            <div class="scene-room-grid">
              <button
                v-for="room in interiorRooms"
                :key="room.id"
                type="button"
                class="scene-room-card"
                :class="{ selected: selectedNodeId === room.id }"
                @click="selectedNodeId = room.id; selectedItemId = ''"
              >
                <span class="scene-room-icon"><component :is="nodeIcon(room)" :size="20" /></span>
                <span><small>{{ nodeTypes[room.nodeType] }}</small><strong>{{ room.name }}</strong><em>{{ workspace.items.filter(item => item.ownerType === 'world' && item.nodeId === room.id).length }} 件物品</em></span>
              </button>
              <div v-if="!interiorRooms.length" class="scene-room-empty">该建筑尚未记录房间。可使用 AI 完善或在编辑区手动添加。</div>
            </div>

            <div v-if="selectedNode" class="scene-room-focus">
              <div class="scene-floorplan">
                <div class="scene-floor-grid"></div>
                <div class="scene-floor-label"><DoorOpen :size="17" /><span><small>{{ nodeTypes[selectedNode.nodeType] }}</small><strong>{{ selectedNode.name }}</strong></span></div>
                <button
                  v-for="(item, index) in roomItems"
                  :key="item.id"
                  type="button"
                  class="scene-item-marker"
                  :class="{ selected: selectedItemId === item.id }"
                  :style="itemStyle(item, index)"
                  :title="`${item.name} · ${item.itemCode}`"
                  @click="selectedItemId = item.id"
                ><PixelIcon :icon-key="item.iconKey || 'item.chest'" :size="17" /><span>{{ item.name }}</span></button>
                <div v-if="!roomItems.length" class="scene-floor-empty"><Box :size="28" /><span>尚未记录房间物品</span></div>
              </div>

              <aside class="scene-room-inspector">
                <template v-if="selectedItem">
                  <small>唯一物品编号</small>
                  <code>{{ selectedItem.itemCode }}</code>
                  <h4>{{ selectedItem.name }}</h4>
                  <p>{{ selectedItem.description || '暂无物品描述。' }}</p>
                  <label><span>当前位置 JSON</span><input :value="JSON.stringify(selectedItem.position)" @change="updateItemPosition(selectedItem, $event)" /></label>
                  <div class="scene-item-state"><span>可移动</span><strong>{{ selectedItem.movable ? '是' : '否' }}</strong></div>
                  <button class="scene-danger-button" type="button" :disabled="busy" @click="remove('items', selectedItem.id)">从场景移除</button>
                </template>
                <template v-else>
                  <small>房间档案</small>
                  <h4>{{ selectedNode.name }}</h4>
                  <p>{{ selectedNode.description || '暂无房间描述。' }}</p>
                  <div v-if="connectedRoutes.length" class="scene-route-list">
                    <span v-for="route in connectedRoutes" :key="route.id"><Route :size="13" /><strong>{{ route.label || '通道' }}</strong> → {{ routeTarget(route) }}</span>
                  </div>
                  <p v-else class="scene-muted">该房间暂无路线记录。</p>
                </template>
              </aside>
            </div>
          </section>
        </main>

        <aside v-if="managerOpen" class="scene-manager">
          <header><div><small>ARCHITECT MODE</small><h3>场景编辑器</h3></div><button type="button" aria-label="关闭场景编辑器" @click="managerOpen = false"><X :size="17" /></button></header>
          <form @submit.prevent="saveNode">
            <span class="scene-form-title"><Plus :size="14" />添加地点</span>
            <input v-model="nodeForm.name" aria-label="场景节点名称" placeholder="地点名称" />
            <div class="scene-form-row"><select v-model="nodeForm.nodeType" aria-label="场景节点类型"><option v-for="(label, value) in nodeTypes" :key="value" :value="value">{{ label }}</option></select><select v-model="nodeForm.parentId" aria-label="场景父节点"><option value="">无上级</option><option v-for="node in workspace.nodes" :key="node.id" :value="node.id">{{ node.name }}</option></select></div>
            <textarea v-model="nodeForm.description" rows="2" aria-label="场景节点描述" placeholder="空间布局、氛围与用途" />
            <div class="scene-form-row"><input v-model.number="nodeForm.x" type="number" min="0" max="100" aria-label="地点横坐标" placeholder="X 0-100" /><input v-model.number="nodeForm.y" type="number" min="0" max="100" aria-label="地点纵坐标" placeholder="Y 0-100" /></div>
            <label class="scene-icon-picker"><span>像素图标</span><select v-model="nodeForm.iconKey" aria-label="地点像素图标"><option v-for="icon in pixelIconOptions" :key="icon.key" :value="icon.key">{{ icon.label }} · {{ icon.key }}</option></select></label>
            <button type="submit" :disabled="busy || !nodeForm.name.trim()">保存地点</button>
          </form>
          <form @submit.prevent="saveRoute">
            <span class="scene-form-title"><Route :size="14" />连接路线</span>
            <select v-model="routeForm.fromNodeId" aria-label="路线起点"><option value="">选择起点</option><option v-for="node in workspace.nodes" :key="node.id" :value="node.id">{{ node.name }}</option></select>
            <select v-model="routeForm.toNodeId" aria-label="路线终点"><option value="">选择终点</option><option v-for="node in workspace.nodes" :key="node.id" :value="node.id" :disabled="node.id === routeForm.fromNodeId">{{ node.name }}</option></select>
            <input v-model="routeForm.label" aria-label="路线名称" placeholder="路线名称，如：旋转楼梯" />
            <button type="submit" :disabled="busy || !routeForm.fromNodeId || !routeForm.toNodeId">连接地点</button>
          </form>
          <form @submit.prevent="saveItem">
            <span class="scene-form-title"><Box :size="14" />放置物品</span>
            <p class="scene-form-context">放置到：{{ selectedNode?.name || '请先选择房间' }}</p>
            <input v-model="itemForm.name" aria-label="场景物品名称" placeholder="物品名称" :disabled="!selectedNode" />
            <input v-model="itemForm.description" aria-label="场景物品描述" placeholder="外观与当前状态" :disabled="!selectedNode" />
            <input v-model="itemForm.position" aria-label="场景物品位置" placeholder='位置，如：{"x":35,"y":60}' :disabled="!selectedNode" />
            <label class="scene-icon-picker"><span>像素图标</span><select v-model="itemForm.iconKey" aria-label="物品像素图标" :disabled="!selectedNode"><option v-for="icon in pixelIconOptions" :key="icon.key" :value="icon.key">{{ icon.label }} · {{ icon.key }}</option></select></label>
            <button type="submit" :disabled="busy || !selectedNode || !itemForm.name.trim()">生成唯一编号并放置</button>
          </form>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scene-panel-overlay{position:fixed;inset:0;z-index:80;display:flex;justify-content:flex-end;background:rgba(16,24,40,.3)}.scene-panel{width:min(760px,100%);height:100%;overflow:auto;background:var(--surface,#fff);box-shadow:-18px 0 50px rgba(0,0,0,.18);color:var(--text,#20242b)}.scene-panel-header{display:flex;justify-content:space-between;gap:16px;padding:24px;border-bottom:1px solid var(--line,#ddd)}.scene-eyebrow{display:flex;align-items:center;gap:6px;color:var(--primary,#6b5dd3);font-size:.78rem}.scene-panel h2{margin:6px 0 4px}.scene-panel-header p{margin:0;color:var(--muted,#687080);font-size:.86rem}.scene-close{border:0;background:transparent;cursor:pointer}.scene-panel-body{padding:18px}.scene-toolbar{display:flex;gap:8px;margin-bottom:12px}.scene-toolbar button,.scene-forms button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line,#ddd);border-radius:7px;padding:7px 11px;background:var(--surface-strong,#f6f7fb);cursor:pointer}.scene-toolbar .scene-ai{background:var(--primary,#6b5dd3);color:#fff;border-color:transparent}.scene-field,.scene-forms form{display:grid;gap:6px}.scene-field span,.scene-forms strong{font-size:.8rem;color:var(--muted,#687080)}textarea,input,select{border:1px solid var(--line,#d8dbe3);border-radius:6px;padding:8px;background:transparent;color:inherit}.scene-layout{display:grid;grid-template-columns:210px 1fr;gap:14px;margin-top:16px}.scene-tree{border-right:1px solid var(--line,#ddd);padding-right:10px}.scene-section-title{display:flex;justify-content:space-between;margin-bottom:8px;font-size:.82rem;color:var(--muted,#687080)}.scene-node-button{width:100%;display:grid;text-align:left;gap:2px;padding:9px;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer}.scene-node-button span{font-size:.7rem;color:var(--muted,#687080)}.scene-node-button.active{background:color-mix(in srgb,var(--primary,#6b5dd3) 14%,transparent)}.scene-detail-heading{display:flex;justify-content:space-between}.scene-detail-heading span{font-size:.75rem;color:var(--primary,#6b5dd3)}.scene-detail-heading h3{margin:3px 0}.scene-description{font-size:.86rem;color:var(--muted,#687080)}.scene-children{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}.scene-children span{padding:4px 8px;border-radius:99px;background:var(--surface-strong,#f1f2f7);cursor:pointer;font-size:.78rem}.scene-item-card{display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--line,#ddd);border-radius:8px;margin:8px 0}.scene-item-card>div{flex:1}.scene-item-card p{margin:4px 0 0;color:var(--muted,#687080);font-size:.78rem}.scene-item-card code{margin-left:8px;color:var(--primary,#6b5dd3);font-size:.7rem}.scene-position{font-size:.7rem;color:var(--muted,#687080)}.scene-position input{display:block;width:130px;margin-top:3px;font-size:.7rem}.scene-delete{border:0;background:transparent;color:#b14b5d;cursor:pointer;font-size:.75rem}.scene-empty{color:var(--muted,#687080);font-size:.82rem}.scene-empty-large{padding:50px 20px;text-align:center}.scene-forms{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#ddd)}.scene-forms form button{justify-content:center}.scene-forms form button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:640px){.scene-layout,.scene-forms{grid-template-columns:1fr}.scene-tree{border-right:0;border-bottom:1px solid var(--line,#ddd);padding:0 0 10px}}
.scene-routes{list-style:none;padding:0;margin:0 0 14px}.scene-routes li{display:grid;grid-template-columns:auto 1fr;gap:4px 8px;padding:7px 9px;border-radius:7px;background:var(--surface-strong,#f5f6fa);font-size:.78rem}.scene-routes li+li{margin-top:5px}.scene-routes span{color:var(--muted,#687080)}.scene-routes small{grid-column:1/-1;color:var(--muted,#687080)}

.scene-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:stretch;justify-content:center;background:rgba(9,14,28,.68);backdrop-filter:blur(10px);padding:clamp(0px,3vw,34px)}
.scene-explorer{display:flex;flex-direction:column;width:min(1420px,100%);height:min(900px,100%);overflow:hidden;border:1px solid color-mix(in srgb,#9eafff 26%,var(--line,#252d45));border-radius:24px;background:#10182a;color:#edf2ff;box-shadow:0 30px 100px rgba(0,0,0,.46)}
.scene-topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 24px;border-bottom:1px solid rgba(177,191,255,.13);background:linear-gradient(110deg,#141f38,#10182a 58%,#172043)}
.scene-brand{display:flex;align-items:center;gap:12px}.scene-brand-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;color:#dbe4ff;background:linear-gradient(145deg,#5768ef,#7c54d9);box-shadow:0 8px 22px rgba(86,100,239,.35)}.scene-brand p{margin:0;color:#8f9ac0;font-size:.65rem;letter-spacing:.15em}.scene-brand h2{margin:3px 0 0;font-size:1.12rem;font-weight:700}.scene-topbar-actions{display:flex;align-items:center;gap:8px}.scene-topbar-actions button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:38px;height:36px;padding:0 10px;border:1px solid rgba(173,188,255,.18);border-radius:10px;color:#dbe4ff;background:rgba(255,255,255,.055);cursor:pointer}.scene-topbar-actions button:hover:not(:disabled){background:rgba(255,255,255,.12)}.scene-topbar-actions .scene-ai-button{padding:0 14px;background:linear-gradient(135deg,#6678fb,#9c62df);border-color:transparent;color:#fff}.scene-topbar-actions button:disabled{opacity:.45;cursor:not-allowed}
.scene-shell{display:grid;grid-template-columns:245px minmax(0,1fr) 280px;min-height:0;flex:1}.scene-sidebar{display:flex;flex-direction:column;min-height:0;border-right:1px solid rgba(177,191,255,.12);background:#111b30}.scene-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;padding:14px;background:rgba(0,0,0,.14)}.scene-stats span{display:grid;gap:2px;text-align:center;color:#7f8bae;font-size:.6rem}.scene-stats strong{color:#e7ecff;font-size:1.05rem}.scene-view-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:10px 12px;border-bottom:1px solid rgba(177,191,255,.1)}.scene-view-tabs button{display:flex;align-items:center;justify-content:center;gap:5px;padding:8px 2px;border:0;border-radius:8px;color:#8390b4;background:transparent;font-size:.7rem;cursor:pointer}.scene-view-tabs button.active{color:#fff;background:rgba(112,127,248,.2)}.scene-view-tabs button:disabled{opacity:.35;cursor:not-allowed}.scene-world-list{min-height:0;overflow:auto;padding:14px 12px}.scene-sidebar-title{display:flex;justify-content:space-between;margin-bottom:9px;color:#8692b6;font-size:.7rem;text-transform:uppercase;letter-spacing:.1em}.scene-sidebar-title small{color:#aeb9df}.scene-world-card{display:flex;align-items:center;gap:9px;width:100%;margin:5px 0;padding:10px;border:1px solid transparent;border-radius:11px;text-align:left;color:#b9c4e4;background:transparent;cursor:pointer}.scene-world-card:hover{background:rgba(255,255,255,.05)}.scene-world-card.active{border-color:rgba(124,145,255,.38);color:#fff;background:linear-gradient(100deg,rgba(91,108,236,.25),rgba(75,62,160,.12))}.scene-world-card>span{display:grid;min-width:0;flex:1;gap:2px}.scene-world-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem}.scene-world-card small{color:#7885a8;font-size:.64rem}.scene-sidebar-empty{display:grid;justify-items:center;gap:7px;padding:35px 14px;text-align:center;color:#7683a7;font-size:.72rem}.scene-sidebar-empty strong{color:#b3bfdf;font-size:.76rem}.scene-ai-prompt{display:grid;gap:7px;padding:13px;border-top:1px solid rgba(177,191,255,.1);background:rgba(0,0,0,.12)}.scene-ai-prompt span{display:flex;align-items:center;gap:5px;color:#9da9ce;font-size:.68rem}.scene-ai-prompt textarea{resize:none;min-height:62px;border:1px solid rgba(157,174,255,.2);border-radius:9px;padding:8px;color:#e6ebff;background:rgba(255,255,255,.05);font:inherit;font-size:.72rem}.scene-ai-prompt textarea:focus{outline:2px solid rgba(124,145,255,.35);border-color:#7588ff}
.scene-stage{position:relative;min-width:0;overflow:auto;background:radial-gradient(circle at 50% 20%,rgba(70,93,180,.13),transparent 46%),#0c1425}.scene-breadcrumbs{display:flex;align-items:center;gap:6px;height:52px;padding:0 22px;border-bottom:1px solid rgba(177,191,255,.1);color:#7582a5;font-size:.72rem}.scene-breadcrumbs strong{color:#dce5ff}.scene-breadcrumbs button{display:grid;place-items:center;width:28px;height:28px;margin-right:3px;border:1px solid rgba(177,191,255,.18);border-radius:8px;color:#bdc9ea;background:rgba(255,255,255,.05);cursor:pointer}.scene-map-view{display:grid;grid-template-columns:minmax(0,1fr) 245px;gap:15px;min-height:calc(100% - 52px);padding:18px}.scene-map-grid{position:relative;min-height:540px;overflow:hidden;border:1px solid rgba(151,169,255,.22);border-radius:20px;background:linear-gradient(135deg,rgba(46,63,117,.42),rgba(14,27,52,.8) 60%),repeating-linear-gradient(0deg,transparent 0 39px,rgba(157,177,255,.045) 40px),repeating-linear-gradient(90deg,transparent 0 39px,rgba(157,177,255,.045) 40px);box-shadow:inset 0 0 70px rgba(3,7,19,.5)}.scene-map-grid::before{position:absolute;inset:10%;border:1px dashed rgba(163,179,255,.13);border-radius:48% 36% 58% 32%;content:"";transform:rotate(-8deg)}.scene-map-light{position:absolute;width:260px;height:260px;border-radius:50%;filter:blur(34px);opacity:.2;pointer-events:none}.light-one{top:-90px;left:18%;background:#596af4}.light-two{right:4%;bottom:-100px;background:#a755d3}.scene-route-layer{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.scene-route-layer line{stroke:#8798f8;stroke-width:.55;stroke-dasharray:2 1.5;opacity:.7}.scene-map-marker{position:absolute;display:flex;align-items:center;gap:7px;max-width:175px;padding:0;border:0;color:#e9eeff;background:transparent;cursor:pointer;transform:translate(-50%,-50%);transition:transform .2s ease,filter .2s ease}.scene-map-marker:hover,.scene-map-marker.selected{z-index:3;filter:brightness(1.2);transform:translate(-50%,-50%) scale(1.06)}.scene-marker-pulse{position:absolute;left:13px;width:30px;height:30px;border:1px solid rgba(124,143,255,.46);border-radius:50%;animation:scenePulse 2.5s ease-out infinite}.scene-marker-icon{position:relative;display:grid;place-items:center;width:34px;height:34px;border:1px solid rgba(191,204,255,.35);border-radius:11px;color:#eef2ff;background:linear-gradient(145deg,#475fd5,#273b7d);box-shadow:0 5px 16px rgba(19,31,88,.52)}.type-building .scene-marker-icon{background:linear-gradient(145deg,#b45fce,#673886)}.type-room .scene-marker-icon,.type-area .scene-marker-icon{background:linear-gradient(145deg,#39ad9b,#1f5e69)}.scene-marker-copy{display:grid;min-width:0;text-align:left;text-shadow:0 2px 8px #091126}.scene-marker-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem}.scene-marker-copy small{color:#98a6d0;font-size:.62rem}.scene-map-empty{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:8px;text-align:center;color:#8896bc}.scene-map-empty h3{margin:4px 0 0;color:#d7e0ff;font-size:1rem}.scene-map-empty p{max-width:250px;margin:0;font-size:.75rem}.scene-map-empty button{display:flex;align-items:center;gap:6px;margin-top:5px;padding:8px 12px;border:0;border-radius:9px;color:#fff;background:#6577ee;cursor:pointer}.scene-map-legend{position:absolute;right:14px;bottom:13px;display:flex;gap:10px;padding:7px 9px;border:1px solid rgba(177,191,255,.14);border-radius:9px;color:#9aa7c9;background:rgba(8,15,33,.72);font-size:.62rem}.scene-map-legend span{display:flex;align-items:center;gap:4px}.scene-map-legend i{display:block;width:7px;height:7px;border-radius:50%;background:#6579ec}.scene-map-legend .legend-building{background:#b767d4}.scene-map-legend .legend-room{background:#42b7aa}.scene-location-card{align-self:start;margin-top:1px;padding:16px;border:1px solid rgba(155,173,255,.2);border-radius:16px;background:linear-gradient(145deg,rgba(33,48,93,.74),rgba(22,27,58,.65));box-shadow:0 12px 32px rgba(3,6,20,.28)}.scene-location-heading{display:flex;align-items:center;gap:9px}.scene-location-heading>span{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;color:#dce5ff;background:rgba(104,124,246,.22)}.scene-location-heading small,.scene-interior-header small{color:#8290b8;font-size:.64rem}.scene-location-heading h3{margin:2px 0 0;font-size:.94rem}.scene-location-card p{margin:13px 0;color:#9ba9cc;font-size:.74rem;line-height:1.55}.scene-location-meta{display:grid;gap:7px;padding:10px 0;border-top:1px solid rgba(177,191,255,.1);border-bottom:1px solid rgba(177,191,255,.1)}.scene-location-meta span{display:flex;align-items:center;gap:6px;color:#9ca9ca;font-size:.68rem}.scene-enter-button{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:13px;padding:9px;border:0;border-radius:9px;color:#fff;background:linear-gradient(105deg,#596be9,#8656d2);font:inherit;font-size:.74rem;cursor:pointer}.scene-enter-button svg:last-child{margin-left:auto}.scene-interior-view{padding:18px}.scene-interior-header{display:flex;align-items:center;justify-content:space-between;min-height:94px;padding:18px 20px;border:1px solid rgba(156,174,255,.16);border-radius:16px;background:linear-gradient(105deg,rgba(53,68,126,.56),rgba(30,34,76,.5))}.scene-interior-header h3{margin:4px 0;font-size:1.2rem}.scene-interior-header p{margin:0;color:#99a7ca;font-size:.74rem}.scene-interior-header>svg{color:#8d9df2;opacity:.7}.scene-room-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px;margin:15px 0}.scene-room-card{display:flex;align-items:center;gap:9px;min-height:72px;padding:11px;border:1px solid rgba(157,174,255,.14);border-radius:13px;text-align:left;color:#dbe4ff;background:rgba(28,42,78,.68);cursor:pointer}.scene-room-card:hover,.scene-room-card.selected{border-color:rgba(124,145,255,.55);background:rgba(76,92,180,.28)}.scene-room-icon{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:10px;color:#7fe0d1;background:rgba(55,164,158,.18)}.scene-room-card>span:last-child{display:grid;min-width:0;gap:2px}.scene-room-card small,.scene-room-card em{color:#8190b5;font-size:.6rem;font-style:normal}.scene-room-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.76rem}.scene-room-empty{padding:20px;color:#8290b5;font-size:.75rem}.scene-room-focus{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:13px}.scene-floorplan{position:relative;min-height:340px;overflow:hidden;border:1px solid rgba(149,170,255,.2);border-radius:18px;background:#14223e}.scene-floor-grid{position:absolute;inset:0;background:linear-gradient(90deg,rgba(143,161,240,.08) 1px,transparent 1px),linear-gradient(rgba(143,161,240,.08) 1px,transparent 1px);background-size:32px 32px}.scene-floor-plan::after{position:absolute;inset:15%;border:1px solid rgba(183,196,255,.24);border-radius:8px;content:""}.scene-floor-label{position:absolute;top:14px;left:16px;display:flex;align-items:center;gap:8px;color:#dbe5ff}.scene-floor-label span{display:grid;gap:2px}.scene-floor-label small{color:#8290b5;font-size:.6rem}.scene-floor-label strong{font-size:.8rem}.scene-item-marker{position:absolute;display:flex;align-items:center;gap:4px;padding:5px 7px;border:1px solid rgba(165,183,255,.2);border-radius:8px;color:#c9d5f7;background:rgba(23,40,76,.88);font:inherit;font-size:.65rem;cursor:pointer;transform:translate(-50%,-50%)}.scene-item-marker:hover,.scene-item-marker.selected{z-index:2;border-color:#8c9eff;color:#fff;background:#4c5fba;box-shadow:0 0 0 4px rgba(118,140,255,.16)}.scene-floor-empty{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:7px;color:#8290b5;font-size:.72rem}.scene-room-inspector{align-self:start;min-height:210px;padding:15px;border:1px solid rgba(155,173,255,.17);border-radius:15px;background:rgba(24,35,67,.76)}.scene-room-inspector>small{color:#8290b5;font-size:.62rem}.scene-room-inspector code{display:block;margin:6px 0 12px;color:#9da9ff;font-size:.64rem}.scene-room-inspector h4{margin:0 0 7px;font-size:.9rem}.scene-room-inspector p{margin:0 0 13px;color:#98a7ca;font-size:.72rem;line-height:1.55}.scene-room-inspector label{display:grid;gap:5px;color:#8998bd;font-size:.65rem}.scene-room-inspector input{width:100%;box-sizing:border-box;border:1px solid rgba(157,174,255,.18);border-radius:7px;padding:7px;color:#dce6ff;background:rgba(255,255,255,.05);font:inherit;font-size:.64rem}.scene-item-state{display:flex;justify-content:space-between;margin-top:12px;color:#8998bd;font-size:.68rem}.scene-item-state strong{color:#83d6c9}.scene-danger-button{width:100%;margin-top:16px;padding:7px;border:1px solid rgba(224,112,145,.3);border-radius:7px;color:#e895af;background:transparent;font:inherit;font-size:.67rem;cursor:pointer}.scene-route-list{display:grid;gap:7px;padding-top:9px;border-top:1px solid rgba(177,191,255,.1)}.scene-route-list span{display:flex;align-items:center;gap:5px;color:#aab7d8;font-size:.68rem}.scene-route-list strong{color:#dce5ff}.scene-muted{color:#727f9f!important;font-size:.68rem!important}.scene-manager{min-height:0;overflow:auto;border-left:1px solid rgba(177,191,255,.12);background:#111a30}.scene-manager>header{display:flex;align-items:center;justify-content:space-between;padding:18px 16px;border-bottom:1px solid rgba(177,191,255,.12)}.scene-manager header small{color:#7887af;font-size:.59rem;letter-spacing:.1em}.scene-manager header h3{margin:4px 0 0;font-size:.92rem}.scene-manager header button{display:grid;place-items:center;width:27px;height:27px;border:0;border-radius:7px;color:#aab8da;background:rgba(255,255,255,.06);cursor:pointer}.scene-manager form{display:grid;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(177,191,255,.1)}.scene-form-title{display:flex;align-items:center;gap:5px;color:#cbd6f5;font-size:.72rem;font-weight:600}.scene-manager input,.scene-manager select,.scene-manager textarea{width:100%;box-sizing:border-box;border:1px solid rgba(157,174,255,.18);border-radius:8px;padding:8px;color:#dce6ff;background:rgba(255,255,255,.045);font:inherit;font-size:.68rem}.scene-manager textarea{resize:vertical}.scene-form-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}.scene-manager form button{padding:8px;border:1px solid rgba(124,145,255,.2);border-radius:8px;color:#dfe6ff;background:rgba(100,119,238,.18);font:inherit;font-size:.68rem;cursor:pointer}.scene-manager form button:hover:not(:disabled){background:rgba(100,119,238,.32)}.scene-manager form button:disabled{opacity:.4;cursor:not-allowed}.scene-form-context{margin:0;color:#8090b6;font-size:.65rem}.scene-manager input:focus,.scene-manager select:focus,.scene-manager textarea:focus,.scene-room-inspector input:focus{outline:2px solid rgba(126,146,255,.35);border-color:#7f92ff}@keyframes scenePulse{0%{opacity:.75;transform:scale(.7)}80%,100%{opacity:0;transform:scale(1.65)}}
@media(max-width:1100px){.scene-shell{grid-template-columns:220px minmax(0,1fr)}.scene-manager{position:absolute;z-index:4;top:73px;right:0;bottom:0;width:280px;box-shadow:-22px 0 50px rgba(0,0,0,.32)}.scene-map-view{grid-template-columns:1fr}.scene-location-card{position:absolute;right:32px;bottom:28px;width:220px}}
@media(max-width:720px){.scene-overlay{padding:0}.scene-explorer{height:100%;border-radius:0}.scene-topbar{padding:14px 15px}.scene-topbar-actions .scene-ai-button span{display:none}.scene-shell{display:block;overflow:auto}.scene-sidebar{border-right:0}.scene-stats{padding:9px}.scene-world-list{max-height:155px}.scene-ai-prompt{display:none}.scene-stage{min-height:620px}.scene-map-view{display:block;padding:10px}.scene-map-grid{min-height:500px}.scene-location-card{position:relative;right:auto;bottom:auto;margin-top:10px;width:auto}.scene-room-focus{grid-template-columns:1fr}.scene-room-inspector{min-height:0}.scene-manager{top:69px;width:min(280px,88vw)}}
</style>
<style scoped>
.scene-floorplan::after{position:absolute;inset:15%;border:1px solid rgba(183,196,255,.24);border-radius:8px;content:"";pointer-events:none}
.scene-unsorted-card{border-color:rgba(235,174,89,.22);color:#f2d6a6;background:rgba(134,91,38,.12)}
.scene-unsorted-card small{color:#ae8e65}
.scene-repair-banner{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:13px;padding:12px 14px;border:1px solid rgba(235,174,89,.25);border-radius:13px;background:linear-gradient(100deg,rgba(136,91,35,.22),rgba(68,51,56,.12))}
.scene-repair-banner>div{display:flex;align-items:center;gap:9px;color:#e8c68d}.scene-repair-banner span{display:grid;gap:2px}.scene-repair-banner strong{font-size:.75rem}.scene-repair-banner small{color:#a99884;font-size:.65rem}.scene-repair-banner button{display:flex;align-items:center;gap:5px;flex:0 0 auto;padding:7px 10px;border:1px solid rgba(239,190,112,.28);border-radius:8px;color:#f5d9a6;background:rgba(181,119,48,.18);font:inherit;font-size:.67rem;cursor:pointer}.scene-repair-banner button:disabled{opacity:.45;cursor:not-allowed}
.scene-map-grid{background:radial-gradient(circle at 28% 18%,rgba(79,99,190,.24),transparent 34%),radial-gradient(circle at 78% 74%,rgba(126,73,158,.18),transparent 38%),linear-gradient(135deg,rgba(46,63,117,.42),rgba(14,27,52,.88) 60%)}
.scene-floor-grid{display:none}
.scene-map-marker.unresolved .scene-marker-icon{border-style:dashed;opacity:.72}
.scene-map-marker.unresolved .scene-marker-copy small::after{content:" · 待 AI 定位";color:#e5b56f}
.scene-icon-picker{display:grid;gap:5px;color:#8998bd;font-size:.64rem}

/* Visual system alignment */
.scene-overlay {
  background: color-mix(in srgb, var(--text, #20241f) 36%, transparent);
  backdrop-filter: blur(8px);
}

.scene-explorer {
  --scene-accent: var(--primary, #8d4a43);
  --scene-accent-soft: color-mix(in srgb, var(--scene-accent) 10%, var(--surface, #fbfaf6));
  --scene-green: var(--green, #2f6d5a);
  --scene-surface: var(--surface, #fbfaf6);
  --scene-surface-strong: var(--surface-strong, #edf1ec);
  --scene-line: color-mix(in srgb, var(--line, #d8ddd6) 84%, transparent);
  --scene-text: var(--text, #20241f);
  --scene-muted: var(--muted, #657064);
  --scene-map-canvas: color-mix(in srgb, var(--scene-surface-strong) 78%, #e2e9df);
  border-color: var(--scene-line);
  background: var(--scene-surface);
  color: var(--scene-text);
  box-shadow: 0 28px 84px color-mix(in srgb, var(--text, #20241f) 28%, transparent);
}

:root[data-theme="dark"] .scene-explorer {
  --scene-map-canvas: color-mix(in srgb, var(--scene-surface-strong) 84%, #09110e);
  box-shadow: 0 28px 84px rgba(0, 0, 0, 0.48);
}

.scene-topbar,
.scene-sidebar,
.scene-manager {
  border-color: var(--scene-line);
  background: color-mix(in srgb, var(--scene-surface) 96%, transparent);
}

.scene-topbar {
  padding: 16px 20px;
}

.scene-brand-icon {
  color: var(--scene-accent);
  background: var(--scene-accent-soft);
  box-shadow: none;
}

.scene-brand p,
.scene-sidebar-title,
.scene-sidebar-title small,
.scene-world-card small,
.scene-ai-prompt span,
.scene-breadcrumbs,
.scene-location-heading small,
.scene-interior-header small,
.scene-location-card p,
.scene-location-meta span,
.scene-room-card small,
.scene-room-card em,
.scene-room-empty,
.scene-floor-label small,
.scene-room-inspector > small,
.scene-room-inspector p,
.scene-room-inspector label,
.scene-item-state,
.scene-muted,
.scene-form-context {
  color: var(--scene-muted) !important;
}

.scene-brand h2,
.scene-stats strong,
.scene-breadcrumbs strong,
.scene-map-empty h3,
.scene-location-heading h3,
.scene-interior-header h3,
.scene-floor-label,
.scene-room-inspector h4,
.scene-route-list strong,
.scene-manager header h3,
.scene-form-title {
  color: var(--scene-text);
}

.scene-topbar-actions button,
.scene-breadcrumbs button,
.scene-manager header button {
  border-color: var(--scene-line);
  color: var(--scene-text);
  background: color-mix(in srgb, var(--scene-surface-strong) 66%, transparent);
}

.scene-topbar-actions button:hover:not(:disabled),
.scene-breadcrumbs button:hover,
.scene-manager header button:hover {
  background: var(--scene-accent-soft);
  color: var(--scene-accent);
}

.scene-topbar-actions .scene-ai-button,
.scene-enter-button,
.scene-map-empty button {
  border-color: transparent;
  color: #fff;
  background: var(--scene-accent);
  box-shadow: none;
}

.scene-shell {
  background: var(--scene-surface);
}

.scene-stats {
  background: color-mix(in srgb, var(--scene-surface-strong) 72%, transparent);
}

.scene-stats span,
.scene-view-tabs button,
.scene-world-card,
.scene-sidebar-empty {
  color: var(--scene-muted);
}

.scene-view-tabs,
.scene-ai-prompt,
.scene-manager > header,
.scene-manager form,
.scene-route-list {
  border-color: var(--scene-line);
}

.scene-view-tabs button.active,
.scene-world-card.active {
  border-color: color-mix(in srgb, var(--scene-accent) 36%, var(--scene-line));
  color: var(--scene-accent);
  background: var(--scene-accent-soft);
}

.scene-world-card:hover {
  color: var(--scene-text);
  background: color-mix(in srgb, var(--scene-surface-strong) 72%, transparent);
}

.scene-ai-prompt {
  background: color-mix(in srgb, var(--scene-surface-strong) 58%, transparent);
}

.scene-ai-prompt textarea,
.scene-manager input,
.scene-manager select,
.scene-manager textarea,
.scene-room-inspector input {
  border-color: var(--scene-line);
  color: var(--scene-text);
  background: var(--scene-surface);
}

.scene-ai-prompt textarea:focus,
.scene-manager input:focus,
.scene-manager select:focus,
.scene-manager textarea:focus,
.scene-room-inspector input:focus {
  outline: 2px solid color-mix(in srgb, var(--scene-accent) 22%, transparent);
  border-color: color-mix(in srgb, var(--scene-accent) 52%, var(--scene-line));
}

.scene-stage {
  background: color-mix(in srgb, var(--scene-surface-strong) 58%, var(--scene-surface));
}

.scene-breadcrumbs {
  border-color: var(--scene-line);
}

.scene-map-grid {
  border-color: var(--scene-line);
  background:
    radial-gradient(circle at 24% 18%, color-mix(in srgb, var(--scene-green) 10%, transparent), transparent 30%),
    radial-gradient(circle at 78% 72%, color-mix(in srgb, var(--scene-accent) 8%, transparent), transparent 34%),
    linear-gradient(color-mix(in srgb, var(--scene-line) 46%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--scene-line) 46%, transparent) 1px, transparent 1px),
    var(--scene-map-canvas);
  background-size: auto, auto, 34px 34px, 34px 34px, auto;
  box-shadow: inset 0 0 56px color-mix(in srgb, var(--scene-text) 6%, transparent);
}

.scene-map-grid::before {
  border-color: color-mix(in srgb, var(--scene-accent) 18%, transparent);
}

.scene-map-light {
  opacity: 0.08;
}

.light-one,
.light-two {
  background: var(--scene-accent);
}

.scene-route-layer line {
  stroke: var(--scene-accent);
  opacity: 0.44;
}

.scene-map-marker {
  color: var(--scene-text);
}

.scene-marker-pulse {
  border-color: color-mix(in srgb, var(--scene-accent) 38%, transparent);
}

.scene-marker-icon,
.type-building .scene-marker-icon,
.type-room .scene-marker-icon,
.type-area .scene-marker-icon {
  border-color: color-mix(in srgb, var(--scene-accent) 34%, var(--scene-line));
  color: var(--scene-accent);
  background: var(--scene-surface);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--scene-text) 14%, transparent);
}

.scene-map-marker.selected .scene-marker-icon {
  color: #fff;
  background: var(--scene-accent);
}

.scene-marker-copy {
  text-shadow: 0 1px 2px color-mix(in srgb, var(--scene-surface) 88%, transparent);
}

.scene-marker-copy small,
.scene-map-empty {
  color: var(--scene-muted);
}

.scene-map-legend,
.scene-location-card,
.scene-interior-header,
.scene-room-card,
.scene-floorplan,
.scene-room-inspector {
  border-color: var(--scene-line);
  color: var(--scene-text);
  background: color-mix(in srgb, var(--scene-surface) 94%, transparent);
  box-shadow: none;
}

.scene-map-legend {
  color: var(--scene-muted);
  backdrop-filter: blur(12px);
}

.scene-map-legend i,
.scene-map-legend .legend-building,
.scene-map-legend .legend-room {
  background: var(--scene-accent);
}

.scene-location-heading > span,
.scene-room-icon {
  color: var(--scene-accent);
  background: var(--scene-accent-soft);
}

.scene-location-meta {
  border-color: var(--scene-line);
}

.scene-room-card:hover,
.scene-room-card.selected,
.scene-item-marker:hover,
.scene-item-marker.selected {
  border-color: color-mix(in srgb, var(--scene-accent) 44%, var(--scene-line));
  color: var(--scene-accent);
  background: var(--scene-accent-soft);
  box-shadow: none;
}

.scene-floor-grid {
  display: block;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--scene-line) 54%, transparent) 1px, transparent 1px),
    linear-gradient(color-mix(in srgb, var(--scene-line) 54%, transparent) 1px, transparent 1px);
  background-size: 32px 32px;
}

.scene-floorplan::after {
  border-color: color-mix(in srgb, var(--scene-accent) 24%, var(--scene-line));
}

.scene-item-marker {
  border-color: var(--scene-line);
  color: var(--scene-text);
  background: var(--scene-surface);
}

.scene-room-inspector code,
.scene-item-state strong {
  color: var(--scene-accent);
}

.scene-manager form button {
  border-color: color-mix(in srgb, var(--scene-accent) 30%, var(--scene-line));
  color: var(--scene-accent);
  background: var(--scene-accent-soft);
}

.scene-manager form button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--scene-accent) 16%, var(--scene-surface));
}

@media (max-width: 720px) {
  .scene-topbar {
    padding: 12px 14px;
  }

  .scene-brand-icon {
    width: 36px;
    height: 36px;
    border-radius: 11px;
  }

  .scene-brand p {
    display: none;
  }

  .scene-map-grid {
    min-height: 460px;
    border-radius: 14px;
  }
}
</style>
