export const CAST_MEMBER_TYPES = Object.freeze(['protagonist', 'npc']);
export const CAST_VISIBILITIES = Object.freeze(['visible', 'hidden']);
export const CAST_SOURCE_KINDS = Object.freeze(['manual', 'auto_sync', 'ai_organize', 'migration']);

export const CAST_PLAN_LIMITS = Object.freeze({
  auto_sync: 40,
  ai_organize_member: 80,
  ai_organize_conversation: 200,
  manual: 200,
  migration: 10_000,
});

export const CAST_OPERATION_NAMES = Object.freeze([
  'member.create',
  'member.update',
  'member.hide',
  'member.restore',
  'memory.create',
  'memory.update',
  'memory.delete',
  'behavior.create',
  'behavior.update',
  'behavior.delete',
  'item.upsert',
  'item.transfer',
  'item.delete',
  'appearance.update',
]);

export const CAST_AUTO_SYNC_OPERATIONS = Object.freeze([
  'member.create',
  'member.update',
  'memory.create',
  'behavior.create',
  'behavior.update',
  'item.upsert',
  'item.transfer',
  'appearance.update',
]);

export const CAST_SCHEMA_VERSION_KEY = 'cast_domain_v1';
export const CAST_SCHEMA_VERSION = '1';
