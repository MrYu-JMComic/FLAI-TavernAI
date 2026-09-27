import { CAST_AUTO_SYNC_OPERATIONS, CAST_OPERATION_NAMES } from '../../domain/cast/constants.js';
import { resolveAccessorySkillSettings } from '../accessorySkillProvider.js';
import { resolveProviderModelCapabilities } from '../../../../shared/providerCapabilities.js';
import { THINKING_LEVELS, resolveThinkingPreferenceLevel } from '../../../../shared/providerThinking.js';

// The NPC management agent never receives tools: it proposes a CastChangePlanV1
// and the server validates every operation. This catalog is the user-facing
// "operation library" that decides which plan operations the agent may propose.
const OPERATION_CATALOG = Object.freeze([
  { name: 'member.create', label: '新建人物', description: '当剧情明确出现新的具名 NPC 时创建人物记录。' },
  { name: 'member.update', label: '更新人物资料与位置', description: '更新称呼、简介、关系、当前位置等基础资料。' },
  { name: 'member.hide', label: '隐藏人物', description: '把不再出现的人物从名册中隐藏（仅 AI 整理）。' },
  { name: 'member.restore', label: '恢复隐藏人物', description: '把误隐藏的人物恢复到名册（仅 AI 整理）。' },
  { name: 'memory.create', label: '写入人物记忆', description: '为人物记录其亲历、被告知或明确知晓的事件。' },
  { name: 'memory.update', label: '修正人物记忆', description: '修改已有人物记忆的内容或类型（仅 AI 整理）。' },
  { name: 'memory.delete', label: '删除人物记忆', description: '删除确认重复或错误的人物记忆（仅 AI 整理）。' },
  { name: 'behavior.create', label: '新增行为倾向', description: '记录人物新的习惯、计划或触发条件。' },
  { name: 'behavior.update', label: '更新行为倾向', description: '修改已有行为倾向的描述或触发条件。' },
  { name: 'behavior.delete', label: '删除行为倾向', description: '删除失效的行为倾向（仅 AI 整理）。' },
  { name: 'item.upsert', label: '新增或更新物品', description: '记录人物获得、装备或状态变化的物品与衣物。' },
  { name: 'item.transfer', label: '转移物品', description: '把物品在人物之间或与场景之间转移。' },
  { name: 'item.delete', label: '删除物品', description: '删除重复或不存在的物品记录（仅 AI 整理）。' },
  { name: 'appearance.update', label: '更新外貌与衣着', description: '更新人物当前外貌、衣着或明显状态。' }
]);

export function describeCastAgentOperations() {
  const autoSync = new Set(CAST_AUTO_SYNC_OPERATIONS);
  return OPERATION_CATALOG.map((operation) => ({
    name: operation.name,
    label: operation.label,
    description: operation.description,
    effect: 'write',
    autoSync: autoSync.has(operation.name),
    organize: true,
    enabledByDefault: true
  }));
}

export function resolveCastAgentOperations(castTracking = {}, sourceKind = 'auto_sync') {
  const base = sourceKind === 'auto_sync' ? CAST_AUTO_SYNC_OPERATIONS : CAST_OPERATION_NAMES;
  const switches = sourceKind === 'auto_sync' ? castTracking?.autoSyncOperations : castTracking?.organizeOperations;
  const map = switches && typeof switches === 'object' ? switches : {};
  return base.filter((name) => !Object.prototype.hasOwnProperty.call(map, name) || map[name] !== false);
}

export function resolveCastAgentSettings(database, userId, settings, castTracking = {}, options = {}) {
  const resolved = resolveAccessorySkillSettings(database, userId, settings, {
    providerProfileId: castTracking?.providerProfileId || '',
    modelOverride: castTracking?.modelOverride || ''
  }, options);
  return {
    ...resolved,
    ...resolveCastAgentThinking(resolved.settings, castTracking, options)
  };
}

export function resolveCastAgentThinking(settings = {}, castTracking = {}, options = {}) {
  const control = resolveProviderModelCapabilities(settings).thinking || {};
  const configuredLevel = optionalThinkingLevel(castTracking?.thinkingLevel ?? castTracking?.thinking_level);
  const inheritedLevel = optionalThinkingLevel(options.mainThinkingLevel ?? options.thinkingLevel);
  const inheritedEnabled = options.mainThinkingEnabled ?? options.thinkingEnabled;

  if (!control.supported || !Array.isArray(control.levels) || !control.levels.length) {
    return { thinkingLevel: '', thinkingEnabled: false, thinkingSource: 'unsupported' };
  }

  let requestedLevel = configuredLevel || inheritedLevel;
  let thinkingSource = configuredLevel ? 'agent' : inheritedLevel ? 'main' : 'provider-default';
  if (!requestedLevel && inheritedEnabled === false) {
    requestedLevel = 'off';
    thinkingSource = 'main';
  } else if (!requestedLevel && inheritedEnabled === true) {
    requestedLevel = control.defaultLevel;
    thinkingSource = 'main';
  }

  // Legacy/rebuilt jobs may not know the originating chat preference. In that
  // case leave the level unset so the provider's existing default/extra body wins.
  if (!requestedLevel) {
    return { thinkingLevel: '', thinkingEnabled: true, thinkingSource };
  }

  const thinkingLevel = resolveThinkingPreferenceLevel(requestedLevel, control, control.defaultLevel);
  return {
    thinkingLevel,
    thinkingEnabled: thinkingLevel !== 'off',
    thinkingSource
  };
}

function optionalThinkingLevel(value) {
  const level = String(value ?? '').trim().toLowerCase();
  return THINKING_LEVELS.includes(level) ? level : '';
}
