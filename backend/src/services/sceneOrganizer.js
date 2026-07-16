import { runToolCompletion } from './providers.js';
import { buildActorStateContext, buildSceneContext, consolidateSceneWorkspace, deleteSceneEntity, listSceneWorkspace, mergeSceneNodes, upsertSceneItem, upsertSceneNode, upsertSceneRoute } from '../modules/scenes.js';
import { PIXEL_ICON_KEYS } from '../../../shared/pixelIconCatalog.js';

const nodeTypes = ['main_scene', 'map', 'building', 'room', 'area'];
const ownerTypes = ['world', 'protagonist', 'npc'];
const clothingSlots = ['upper_underwear', 'lower_underwear', 'top', 'bottom', 'socks', 'shoes', 'outfit'];
const bodyRegions = ['chest', 'abdomen', 'groin', 'buttocks', 'thighs', 'legs', 'feet'];

export async function completeSceneOrganization(settings, request = {}) {
  const state = { ...request, changes: [], summary: '', cleanup: null };
  state.cleanup = consolidateSceneWorkspace(state.database, state.userId, state.conversationId);
  const tools = [
    { type: 'function', function: { name: 'upsert_scene_node', description: 'Create or update exactly one permanent scene node. Build a strict hierarchy: main_scene/map -> building -> room/area. Reuse the existing id when updating. layout must assign the complete hidden-grid placement using x and y from 0 to 100, optional width/height, and iconKey.', parameters: { type: 'object', properties: { id: { type: 'string' }, parentId: { type: 'string' }, parentName: { type: 'string' }, nodeType: { type: 'string', enum: nodeTypes }, name: { type: 'string' }, description: { type: 'string' }, layout: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 }, width: { type: 'number', minimum: 1, maximum: 100 }, height: { type: 'number', minimum: 1, maximum: 100 }, iconKey: { type: 'string', enum: PIXEL_ICON_KEYS } }, required: ['x', 'y', 'iconKey'], additionalProperties: true }, tags: { type: 'array', items: { type: 'string' } } }, required: ['name', 'nodeType', 'layout'], additionalProperties: false } } },
    { type: 'function', function: { name: 'upsert_scene_route', description: 'Connect two existing scene nodes only when the conversation explicitly establishes a door, corridor, stair, path, or travel connection. Never connect every room just to make a graph.', parameters: { type: 'object', properties: { id: { type: 'string' }, fromNodeId: { type: 'string' }, toNodeId: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' }, bidirectional: { type: 'boolean' } }, required: ['fromNodeId', 'toNodeId'], additionalProperties: false } } },
    { type: 'function', function: { name: 'upsert_scene_item', description: 'Create or update exactly one unique physical item. Always reuse id or itemCode when the same item moves, changes holder, is equipped, or changes state. A world item needs nodeId and hidden-grid position x/y. A protagonist or NPC item has one exclusive owner and may omit nodeId. Clothing entries must be edited independently and include slot, equipped state, and visual coverage.', parameters: { type: 'object', properties: { id: { type: 'string' }, nodeId: { type: 'string' }, itemCode: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, state: { type: 'object' }, position: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 }, detail: { type: 'string' } }, additionalProperties: true }, movable: { type: 'boolean' }, ownerType: { type: 'string', enum: ownerTypes }, ownerName: { type: 'string' }, itemKind: { type: 'string', enum: ['item', 'clothing'] }, quantity: { type: 'integer', minimum: 1 }, clothingSlot: { type: 'string', enum: clothingSlots }, equipped: { type: 'boolean' }, coverage: { type: 'array', items: { type: 'string', enum: bodyRegions }, uniqueItems: true }, iconKey: { type: 'string', enum: PIXEL_ICON_KEYS } }, required: ['name', 'ownerType', 'itemKind', 'iconKey'], additionalProperties: false } } },
    { type: 'function', function: { name: 'merge_scene_nodes', description: 'Merge a duplicate scene node into the canonical node, preserving its children, routes, and items. Use when two names clearly describe the same room or building.', parameters: { type: 'object', properties: { sourceId: { type: 'string' }, targetId: { type: 'string' } }, required: ['sourceId', 'targetId'], additionalProperties: false } } },
    { type: 'function', function: { name: 'remove_scene_route', description: 'Remove a route that was inferred incorrectly or is not supported by the conversation.', parameters: { type: 'object', properties: { routeId: { type: 'string' } }, required: ['routeId'], additionalProperties: false } } },
    { type: 'function', function: { name: 'finish_scene_organization', description: 'Finish after all scene facts are stored.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false } } }
  ];
  await runToolCompletion(settings, buildMessages(state), tools, async (name, args) => {
    if (name === 'upsert_scene_node') {
      const node = upsertSceneNode(state.database, state.userId, state.conversationId, args);
      state.changes.push({ type: 'node', node });
      return { ok: Boolean(node), node };
    }
    if (name === 'upsert_scene_route') {
      const route = upsertSceneRoute(state.database, state.userId, state.conversationId, args);
      state.changes.push({ type: 'route', route });
      return { ok: Boolean(route), route };
    }
    if (name === 'upsert_scene_item') {
      const item = upsertSceneItem(state.database, state.userId, state.conversationId, { ...args, auditActor: 'agent' });
      state.changes.push({ type: 'item', item });
      return { ok: Boolean(item), item };
    }
    if (name === 'merge_scene_nodes') {
      const node = mergeSceneNodes(state.database, state.userId, state.conversationId, args.sourceId, args.targetId);
      state.changes.push({ type: 'merge', node });
      return { ok: Boolean(node), node };
    }
    if (name === 'remove_scene_route') {
      const removed = deleteSceneEntity(state.database, state.userId, state.conversationId, 'route', args.routeId);
      state.changes.push({ type: 'remove_route', routeId: args.routeId, removed });
      return { ok: removed };
    }
    if (name === 'finish_scene_organization') { state.summary = String(args.summary || '场景资料已整理'); return { ok: true, stop: true }; }
    return { ok: false, error: 'Unsupported scene tool' };
  }, { maxRounds: 12, thinkingEnabled: false, signal: state.signal });
  state.cleanup = consolidateSceneWorkspace(state.database, state.userId, state.conversationId);
  return { ok: true, summary: state.summary || '场景资料已整理', changes: state.changes, cleanup: state.cleanup, workspace: listSceneWorkspace(state.database, state.userId, state.conversationId) };
}

function buildMessages(state) {
  const recent = Array.isArray(state.messages) ? state.messages.slice(-24).map(message => `${message.role || 'unknown'}: ${message.content || ''}`).join('\n') : '';
  return [
    { role: 'system', content: '你是场景与物品构建助手。只记录对话中明确或高置信度的事实。先检查已有资料并合并同一地点或同一物品的不同说法。严格使用主场景/地图 -> 建筑 -> 房间/区域层级。隐藏网格仅用于内部定位：每个地点、建筑、房间和世界物品都必须由你给出 0-100 的 x/y，界面不会显示网格；不得依赖前端自动排布。只有剧情明确建立门、走廊、楼梯、通道或移动路线时才建立路线。每个物品只有一个稳定 itemCode 和一个当前持有者；转移物品时更新同一条目，绝不能给多个角色复制同一物品。衣物按内衣上、内衣下、衣服、裤子/裙、袜子（含连裤袜）、鞋子、连体套装分类。衣物 coverage 决定视觉遮挡：长上衣或连衣裙可覆盖 groin/buttocks；只有内裤而无外层遮挡时内衣可被看见。逐条修改，禁止整表重写或凭空创造细节。' },
    { role: 'user', content: `已有场景：${buildSceneContext(state.database, state.conversationId) || '暂无'}\n已有角色物品：${buildActorStateContext(state.database, state.conversationId) || '暂无'}\n可用像素图标：${PIXEL_ICON_KEYS.join(', ')}\n本次要求：${state.requirement || '从最近剧情中提取并补全场景、物品位置和持有状态'}\n最近剧情：\n${recent}` }
  ];
}
