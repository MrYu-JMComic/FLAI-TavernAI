import { newId, nowIso } from '../security.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { clampInteger } from '../utils/number.js';

const NPC_STATUS_VALUES = new Set([
  'active',
  'left',
  'permanently_left',
  'dead',
  'on_mission',
  'following',
  'custom'
]);
const TERMINAL_NPC_STATUSES = new Set(['permanently_left', 'dead']);
const NPC_ALIAS_LIMIT = 20;

// ── NPC Memories ──

export function listNpcMemories(database, userId, conversationId, npcName) {
  assertConversationAccess(database, userId, conversationId);
  return database
    .prepare(
      `SELECT * FROM npc_memories
       WHERE conversation_id = ? AND npc_name = ?
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(conversationId, npcName)
    .map(toNpcMemory);
}

export function addNpcMemory(database, userId, conversationId, npcName, payload = {}) {
  assertConversationAccess(database, userId, conversationId);
  payload = normalizePayload(payload);
  const id = newId();
  const timestamp = nowIso();
  const memoryType = normalizeMemoryType(payload.memoryType);
  const content = normalizeContent(payload.content);

  database
    .prepare(
      `INSERT INTO npc_memories (id, conversation_id, npc_name, memory_type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, conversationId, npcName, memoryType, content, timestamp);

  return toNpcMemory(database.prepare('SELECT * FROM npc_memories WHERE id = ?').get(id));
}

export function deleteNpcMemory(database, userId, conversationId, memoryId, npcName = '') {
  const scopedNpcName = String(npcName || '');
  const row = database
    .prepare(
      `SELECT npc_memories.id FROM npc_memories
       JOIN conversations ON conversations.id = npc_memories.conversation_id
       WHERE npc_memories.id = ?
         AND npc_memories.conversation_id = ?
         AND conversations.user_id = ?
         AND (? = '' OR npc_memories.npc_name = ?)`
    )
    .get(memoryId, conversationId, userId, scopedNpcName, scopedNpcName);
  if (!row) return false;

  const result = database
    .prepare('DELETE FROM npc_memories WHERE id = ? AND conversation_id = ? AND (? = \'\' OR npc_name = ?)')
    .run(memoryId, conversationId, scopedNpcName, scopedNpcName);
  return result.changes > 0;
}

// ── NPC Behaviors ──

export function updateNpcMemory(database, userId, conversationId, memoryId, payload = {}, npcName = '') {
  payload = normalizePayload(payload);
  const scopedNpcName = String(npcName || '');
  const existing = database
    .prepare(
      `SELECT npc_memories.* FROM npc_memories
       JOIN conversations ON conversations.id = npc_memories.conversation_id
       WHERE npc_memories.id = ?
         AND npc_memories.conversation_id = ?
         AND conversations.user_id = ?
         AND (? = '' OR npc_memories.npc_name = ?)`
    )
    .get(memoryId, conversationId, userId, scopedNpcName, scopedNpcName);
  if (!existing) return null;

  const memoryType = payload.memoryType !== undefined ? normalizeMemoryType(payload.memoryType) : existing.memory_type;
  const content = payload.content !== undefined ? normalizeContent(payload.content) : existing.content;

  const result = database
    .prepare(
      `UPDATE npc_memories
       SET memory_type = ?, content = ?
       WHERE id = ? AND conversation_id = ? AND (? = '' OR npc_name = ?)`
    )
    .run(memoryType, content, memoryId, conversationId, scopedNpcName, scopedNpcName);
  if (result.changes === 0) return null;

  return toNpcMemory(database
    .prepare('SELECT * FROM npc_memories WHERE id = ? AND conversation_id = ? AND (? = \'\' OR npc_name = ?)')
    .get(memoryId, conversationId, scopedNpcName, scopedNpcName));
}

export function listNpcBehaviors(database, userId, conversationId, npcName) {
  assertConversationAccess(database, userId, conversationId);
  return database
    .prepare(
      `SELECT * FROM npc_behaviors
       WHERE conversation_id = ? AND npc_name = ?
       ORDER BY priority DESC, created_at ASC, rowid ASC`
    )
    .all(conversationId, npcName)
    .map(toNpcBehavior);
}

export function addNpcBehavior(database, userId, conversationId, npcName, payload = {}) {
  assertConversationAccess(database, userId, conversationId);
  payload = normalizePayload(payload);
  const id = newId();
  const timestamp = nowIso();
  const behaviorType = normalizeBehaviorType(payload.behaviorType);
  const triggerCondition = normalizeContent(payload.triggerCondition);
  const action = normalizeContent(payload.action);
  const priority = clampInteger(payload.priority, 0, 100, 0);
  const enabled = normalizeBoolean(payload.enabled, true) ? 1 : 0;

  database
    .prepare(
      `INSERT INTO npc_behaviors (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, conversationId, npcName, behaviorType, triggerCondition, action, priority, enabled, timestamp);

  return toNpcBehavior(database.prepare('SELECT * FROM npc_behaviors WHERE id = ?').get(id));
}

export function updateNpcBehavior(database, userId, conversationId, behaviorId, payload = {}, npcName = '') {
  payload = normalizePayload(payload);
  const scopedNpcName = String(npcName || '');
  const existing = database
    .prepare(
      `SELECT npc_behaviors.* FROM npc_behaviors
       JOIN conversations ON conversations.id = npc_behaviors.conversation_id
       WHERE npc_behaviors.id = ?
         AND npc_behaviors.conversation_id = ?
         AND conversations.user_id = ?
         AND (? = '' OR npc_behaviors.npc_name = ?)`
    )
    .get(behaviorId, conversationId, userId, scopedNpcName, scopedNpcName);
  if (!existing) return null;

  const behaviorType = payload.behaviorType !== undefined ? normalizeBehaviorType(payload.behaviorType) : existing.behavior_type;
  const triggerCondition = payload.triggerCondition !== undefined ? normalizeContent(payload.triggerCondition) : existing.trigger_condition;
  const action = payload.action !== undefined ? normalizeContent(payload.action) : existing.action;
  const priority = payload.priority !== undefined ? clampInteger(payload.priority, 0, 100, existing.priority) : existing.priority;
  const enabled = payload.enabled !== undefined ? (normalizeBoolean(payload.enabled, existing.enabled) ? 1 : 0) : existing.enabled;

  const result = database
    .prepare(
      `UPDATE npc_behaviors
       SET behavior_type = ?, trigger_condition = ?, action = ?, priority = ?, enabled = ?
       WHERE id = ? AND conversation_id = ? AND (? = '' OR npc_name = ?)`
    )
    .run(behaviorType, triggerCondition, action, priority, enabled, behaviorId, conversationId, scopedNpcName, scopedNpcName);
  if (result.changes === 0) return null;

  return toNpcBehavior(database
    .prepare('SELECT * FROM npc_behaviors WHERE id = ? AND conversation_id = ? AND (? = \'\' OR npc_name = ?)')
    .get(behaviorId, conversationId, scopedNpcName, scopedNpcName));
}

export function deleteNpcBehavior(database, userId, conversationId, behaviorId, npcName = '') {
  const scopedNpcName = String(npcName || '');
  const row = database
    .prepare(
      `SELECT npc_behaviors.id FROM npc_behaviors
       JOIN conversations ON conversations.id = npc_behaviors.conversation_id
       WHERE npc_behaviors.id = ?
         AND npc_behaviors.conversation_id = ?
         AND conversations.user_id = ?
         AND (? = '' OR npc_behaviors.npc_name = ?)`
    )
    .get(behaviorId, conversationId, userId, scopedNpcName, scopedNpcName);
  if (!row) return false;

  const result = database
    .prepare('DELETE FROM npc_behaviors WHERE id = ? AND conversation_id = ? AND (? = \'\' OR npc_name = ?)')
    .run(behaviorId, conversationId, scopedNpcName, scopedNpcName);
  return result.changes > 0;
}

export function upsertConversationNpc(database, userId, conversationId, payload = {}) {
  assertConversationAccess(database, userId, conversationId);
  payload = normalizePayload(payload);
  const npcName = normalizeNpcName(payload.npcName ?? payload.name);
  if (!npcName) {
    return null;
  }
  const timestamp = nowIso();
  const existing = database
    .prepare('SELECT * FROM npc_registry WHERE conversation_id = ? AND npc_name = ?')
    .get(conversationId, npcName);
  const source = payload.source !== undefined
    ? normalizeNpcSource(payload.source)
    : existing?.source || 'manual';
  const evidence = payload.evidence !== undefined
    ? normalizeEvidence(payload.evidence)
    : existing?.evidence || '';
  const confidence = payload.confidence !== undefined
    ? clampInteger(payload.confidence, 0, 100, Number(existing?.confidence || 0))
    : Number(existing?.confidence || 0);
  const hidden = payload.hidden !== undefined
    ? (normalizeBoolean(payload.hidden, Boolean(existing?.hidden)) ? 1 : 0)
    : Number(existing?.hidden || 0);
  const shouldUnhide = normalizeBoolean(payload.unhide);
  const statusPayload = normalizeNpcStatusPayload(payload, existing);
  const aliases = hasAliasPayload(payload)
    ? normalizeNpcAliases(payload.aliases ?? payload.aliasesText ?? payload.alias)
    : parseNpcAliases(existing?.aliases);
  const memorySealed = hasMemorySealedPayload(payload)
    ? (normalizeBoolean(payload.memorySealed ?? payload.memory_sealed, Boolean(existing?.memory_sealed)) ? 1 : 0)
    : Number(existing?.memory_sealed || 0);

  if (existing) {
    const nextHidden = existing.hidden && !shouldUnhide ? 1 : hidden;
    database
      .prepare(
        `UPDATE npc_registry
         SET source = ?, evidence = ?, confidence = ?, hidden = ?, status = ?, custom_status = ?, aliases = ?, memory_sealed = ?, updated_at = ?
         WHERE conversation_id = ? AND npc_name = ?`
      )
      .run(
        source,
        evidence || existing.evidence || '',
        Math.max(Number(existing.confidence || 0), confidence),
        nextHidden,
        statusPayload.status,
        statusPayload.customStatus,
        JSON.stringify(aliases),
        memorySealed,
        timestamp,
        conversationId,
        npcName
      );
  } else {
    database
      .prepare(
        `INSERT INTO npc_registry (id, conversation_id, npc_name, source, evidence, confidence, hidden, status, custom_status, aliases, memory_sealed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId(),
        conversationId,
        npcName,
        source,
        evidence,
        confidence,
        hidden,
        statusPayload.status,
        statusPayload.customStatus,
        JSON.stringify(aliases),
        memorySealed,
        timestamp,
        timestamp
      );
  }

  return toNpcRegistry(database
    .prepare('SELECT * FROM npc_registry WHERE conversation_id = ? AND npc_name = ?')
    .get(conversationId, npcName));
}

export function updateConversationNpc(database, userId, conversationId, npcName, payload = {}) {
  return upsertConversationNpc(database, userId, conversationId, {
    ...normalizePayload(payload),
    npcName,
    unhide: payload?.unhide ?? false
  });
}

export function hideConversationNpc(database, userId, conversationId, npcName) {
  return upsertConversationNpc(database, userId, conversationId, {
    npcName,
    source: 'hidden',
    evidence: '',
    confidence: 0,
    hidden: true
  });
}

export function hideEmptyConversationNpcs(database, userId, conversationId, mainCharacterName = '') {
  const emptyNpcs = listConversationNpcs(database, userId, conversationId, mainCharacterName)
    .filter((npc) => Number(npc.memoryCount || 0) === 0 && Number(npc.behaviorCount || 0) === 0);
  const hidden = [];
  for (const npc of emptyNpcs) {
    const hiddenNpc = hideConversationNpc(database, userId, conversationId, npc.name);
    if (hiddenNpc) {
      hidden.push(hiddenNpc);
    }
  }
  return {
    count: hidden.length,
    hidden
  };
}

export function isConversationNpcHidden(database, conversationId, npcName) {
  const name = normalizeNpcName(npcName);
  if (!name) {
    return false;
  }
  const row = database
    .prepare('SELECT hidden FROM npc_registry WHERE conversation_id = ? AND npc_name = ?')
    .get(conversationId, name);
  return Boolean(row?.hidden);
}

// ── NPC Discovery ──

/**
 * Legacy text-pattern NPC scanning is disabled. NPC discovery should come from
 * the assistant agent's structured tool calls, or from explicit memory/behavior
 * entries created by the user.
 */
export function scanNpcsFromMessages(messages, mainCharacterName = '') {
  return [];
}

/**
 * List all NPCs in a conversation with their memory/behavior counts.
 */
export function listConversationNpcs(database, userId, conversationId, mainCharacterName = '') {
  assertConversationAccess(database, userId, conversationId);

  const memoryRows = database
    .prepare(`SELECT npc_name, COUNT(*) AS count FROM npc_memories WHERE conversation_id = ? GROUP BY npc_name`)
    .all(conversationId);

  const behaviorRows = database
    .prepare(`SELECT npc_name, COUNT(*) AS count FROM npc_behaviors WHERE conversation_id = ? GROUP BY npc_name`)
    .all(conversationId);

  const registryRows = database
    .prepare(`SELECT * FROM npc_registry WHERE conversation_id = ?`)
    .all(conversationId);

  const hiddenNames = new Set();
  const npcSummaries = new Map();

  for (const row of registryRows) {
    const normalizedName = normalizeNpcName(row.npc_name);
    if (!normalizedName) {
      continue;
    }
    const key = normalizedName.toLowerCase();
    if (row.hidden) {
      hiddenNames.add(key);
      continue;
    }
    ensureNpcSummary(npcSummaries, normalizedName).registry = toNpcRegistry(row);
  }

  for (const row of memoryRows) {
    const summary = ensureNpcSummary(npcSummaries, row.npc_name);
    if (summary) {
      summary.memoryCount = Number(row.count || 0);
    }
  }

  for (const row of behaviorRows) {
    const summary = ensureNpcSummary(npcSummaries, row.npc_name);
    if (summary) {
      summary.behaviorCount = Number(row.count || 0);
    }
  }

  const visibleNames = [];
  for (const summary of npcSummaries.values()) {
    if (!hiddenNames.has(summary.key)) {
      visibleNames.push(summary.name);
    }
  }
  visibleNames.sort();

  const result = [];
  for (const npcName of visibleNames) {
    const summary = npcSummaries.get(npcName.toLowerCase());
    const registry = summary.registry;
    const memoryCount = summary.memoryCount;
    const behaviorCount = summary.behaviorCount;
    result.push({
      name: summary.name,
      memoryCount: Number(memoryCount),
      behaviorCount: Number(behaviorCount),
      source: registry?.source || (Number(memoryCount) > 0 ? 'memory' : Number(behaviorCount) > 0 ? 'behavior' : 'scan'),
      confidence: registry?.confidence || 0,
      evidence: registry?.evidence || '',
      status: registry?.status || 'active',
      customStatus: registry?.customStatus || '',
      aliases: registry?.aliases || [],
      memorySealed: Boolean(registry?.memorySealed),
      memorySealActive: Boolean(registry?.memorySealActive)
    });
  }

  return result;
}

function ensureNpcSummary(summaries, npcName) {
  const normalizedName = normalizeNpcName(npcName);
  if (!normalizedName) {
    return null;
  }
  const key = normalizedName.toLowerCase();
  let summary = summaries.get(key);
  if (!summary) {
    summary = {
      key,
      name: normalizedName,
      registry: null,
      memoryCount: 0,
      behaviorCount: 0
    };
    summaries.set(key, summary);
  }
  return summary;
}

// ── NPC Behavior Prompt Builder ──

/**
 * Build a system prompt fragment that injects NPC behavior rules and memories
 * into the AI context, so the AI can autonomously act NPCs.
 */
export function buildNpcBehaviorPrompt(database, conversationId) {
  const behaviors = database
    .prepare(
      `SELECT * FROM npc_behaviors
       WHERE conversation_id = ? AND enabled = 1
       ORDER BY priority DESC, created_at ASC, rowid ASC`
    )
    .all(conversationId);

  const memories = database
    .prepare(
      `SELECT * FROM npc_memories
       WHERE conversation_id = ?
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(conversationId);

  return buildNpcBehaviorPromptFromRows(database, conversationId, behaviors, memories);
}

// ── Helpers ──

function buildNpcBehaviorPromptFromRows(database, conversationId, behaviors, memories) {
  const registryRows = database
    .prepare(
      `SELECT * FROM npc_registry
       WHERE conversation_id = ?`
    )
    .all(conversationId);
  const hiddenNames = new Set();
  const registryMeta = new Map();
  for (const row of registryRows) {
    const normalizedName = normalizeNpcName(row.npc_name);
    if (!normalizedName) {
      continue;
    }
    const key = normalizedName.toLowerCase();
    const registry = toNpcRegistry(row);
    registryMeta.set(key, registry);
    if (registry.hidden) {
      hiddenNames.add(key);
    }
  }
  const npcMap = new Map();

  const ensureNpcSection = (npcName) => {
    const normalizedName = normalizeNpcName(npcName);
    if (!normalizedName || hiddenNames.has(normalizedName.toLowerCase())) {
      return null;
    }
    const key = normalizedName.toLowerCase();
    if (!npcMap.has(key)) {
      npcMap.set(key, {
        name: normalizedName,
        registry: registryMeta.get(key) || null,
        behaviors: [],
        memories: []
      });
    }
    return npcMap.get(key);
  };

  for (const registry of registryMeta.values()) {
    if (!registry.hidden && hasPromptRegistryMetadata(registry)) {
      ensureNpcSection(registry.name);
    }
  }
  for (const behavior of behaviors) {
    ensureNpcSection(behavior.npc_name)?.behaviors.push(behavior);
  }
  for (const memory of memories) {
    const section = ensureNpcSection(memory.npc_name);
    if (section && !isNpcRegistryMemorySealActive(section.registry) && section.memories.length < 5) {
      section.memories.push(memory);
    }
  }

  const sections = [];
  for (const npc of npcMap.values()) {
    const metadataLines = buildNpcMetadataPromptLines(npc.registry);
    const ruleLines = npc.behaviors.map((rule) => {
      const trigger = rule.trigger_condition ? `Trigger: ${rule.trigger_condition}` : 'Trigger: always/contextual';
      return `  - [${rule.behavior_type}] ${trigger}; Action: ${rule.action}`;
    });
    const memorySealActive = isNpcRegistryMemorySealActive(npc.registry);
    const memoryLines = npc.memories.map((memory) => `  - [${memory.memory_type}] ${memory.content}`);
    const metadataSection = metadataLines.length ? `\n${metadataLines.join('\n')}` : '';
    const behaviorSection = ruleLines.length ? `\n  Behavior rules:\n${ruleLines.join('\n')}` : '';
    const memorySection = memorySealActive
      ? '\n  Memories: sealed for this status; stored memories are intentionally omitted until the status changes.'
      : memoryLines.length
        ? `\n  Memories:\n${memoryLines.join('\n')}`
        : '';
    sections.push(`NPC "${npc.name}" context:${metadataSection}${behaviorSection}${memorySection}`);
  }

  if (sections.length === 0) {
    return '';
  }
  return `\n[NPC 自主行为引擎 / NPC autonomous behavior engine]\n${sections.join('\n\n')}\nUse the NPC status, exact aliases, behavior rules, and available memories to keep side characters consistent. Exact aliases identify the same NPC; stable nicknames or titles count only when they uniquely name this NPC. Generic roles, vague references, pronouns, and group labels are not aliases. If an NPC is dead or permanently_left, do not portray them as present or active unless the story explicitly changes that status. Do not invent memories that are not provided.\n`;
}

function buildNpcMetadataPromptLines(registry) {
  if (!registry) {
    return [];
  }
  const lines = [];
  if (registry.status && registry.status !== 'active') {
    lines.push(`  Status: ${formatNpcStatusForPrompt(registry)}`);
  }
  if (registry.aliases.length > 0) {
    lines.push(`  Exact aliases: ${registry.aliases.join(', ')}`);
  }
  if (isNpcRegistryMemorySealActive(registry)) {
    lines.push('  Memory seal: active because this NPC is dead or permanently_left.');
  }
  return lines;
}

function hasPromptRegistryMetadata(registry) {
  return Boolean(
    registry &&
      !registry.hidden &&
      ((registry.status && registry.status !== 'active') ||
        registry.aliases.length > 0 ||
        isNpcRegistryMemorySealActive(registry))
  );
}

function formatNpcStatusForPrompt(registry) {
  if (registry.status === 'custom' && registry.customStatus) {
    return `custom (${registry.customStatus})`;
  }
  return registry.status || 'active';
}

function normalizeNpcCandidate(value) {
  return String(value || '')
    .replace(/^[\s"'“”‘’「」《》【】\[\]（）()]+|[\s"'“”‘’「」《》【】\[\]（）()]+$/g, '')
    .replace(/^(NPC|角色|人物|旁白)\s*[:：-]\s*/i, '')
    .trim();
}

function normalizeNpcName(value) {
  return normalizeNpcCandidate(value).slice(0, 80);
}

function normalizePayload(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeNpcSource(value) {
  const source = String(value || 'manual').trim().toLowerCase();
  return ['manual', 'agent', 'memory', 'behavior', 'scan', 'hidden'].includes(source) ? source : 'manual';
}

function normalizeEvidence(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeNpcStatusPayload(payload = {}, existing = null) {
  const rawStatus = payload.status ?? payload.npcStatus ?? existing?.status ?? 'active';
  const normalized = normalizeNpcStatus(rawStatus);
  const customInput = payload.customStatus ?? payload.custom_status;
  const customStatus = customInput !== undefined
    ? normalizeCustomStatus(customInput)
    : normalizeCustomStatus(existing?.custom_status || '');
  if (normalized === 'custom') {
    return {
      status: 'custom',
      customStatus: customStatus || normalizeCustomStatus(rawStatus)
    };
  }
  return {
    status: normalized,
    customStatus: normalized === 'active' ? '' : customStatus
  };
}

function normalizeNpcStatus(value) {
  const normalized = String(value || 'active').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return NPC_STATUS_VALUES.has(normalized) ? normalized : 'custom';
}

function normalizeCustomStatus(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function hasAliasPayload(payload = {}) {
  return payload.aliases !== undefined || payload.aliasesText !== undefined || payload.alias !== undefined;
}

function hasMemorySealedPayload(payload = {}) {
  return payload.memorySealed !== undefined || payload.memory_sealed !== undefined;
}

function parseNpcAliases(value) {
  if (Array.isArray(value)) {
    return normalizeNpcAliases(value);
  }
  try {
    return normalizeNpcAliases(JSON.parse(String(value || '[]')));
  } catch {
    return [];
  }
}

function normalizeNpcAliases(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;|]+/);
  const aliases = [];
  const seen = new Set();
  for (const item of rawItems) {
    const alias = normalizeNpcName(item);
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) {
      continue;
    }
    aliases.push(alias);
    seen.add(key);
    if (aliases.length >= NPC_ALIAS_LIMIT) {
      break;
    }
  }
  return aliases;
}

function isNpcRegistryMemorySealActive(registry) {
  return Boolean(registry?.memorySealed && TERMINAL_NPC_STATUSES.has(registry.status));
}

function assertConversationAccess(database, userId, conversationId) {
  const conversation = database
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) {
    throw new Error('对话不存在');
  }
}

function toNpcMemory(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    npcName: row.npc_name,
    memoryType: row.memory_type,
    content: row.content,
    createdAt: row.created_at
  };
}

function toNpcBehavior(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    npcName: row.npc_name,
    behaviorType: row.behavior_type,
    triggerCondition: row.trigger_condition,
    action: row.action,
    priority: row.priority,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at
  };
}

function toNpcRegistry(row) {
  const registry = {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.npc_name,
    source: row.source,
    evidence: row.evidence || '',
    confidence: Number(row.confidence || 0),
    hidden: Boolean(row.hidden),
    status: normalizeNpcStatus(row.status || 'active'),
    customStatus: normalizeCustomStatus(row.custom_status || ''),
    aliases: parseNpcAliases(row.aliases),
    memorySealed: Boolean(row.memory_sealed),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  return {
    ...registry,
    memorySealActive: isNpcRegistryMemorySealActive(registry)
  };
}

function normalizeMemoryType(value) {
  const valid = ['event', 'relationship', 'opinion', 'knowledge', 'emotion'];
  const normalized = String(value || 'event').trim().toLowerCase();
  return valid.includes(normalized) ? normalized : 'event';
}

function normalizeBehaviorType(value) {
  const valid = ['reaction', 'dialogue', 'action', 'emotion', 'movement'];
  const normalized = String(value || 'reaction').trim().toLowerCase();
  return valid.includes(normalized) ? normalized : 'reaction';
}

function normalizeContent(value) {
  const str = String(value || '').trim();
  return str.length > 2000 ? str.slice(0, 2000) : str;
}
