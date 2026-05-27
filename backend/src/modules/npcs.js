import { newId, nowIso } from '../security.js';

// ── NPC Memories ──

export function listNpcMemories(database, userId, conversationId, npcName) {
  assertConversationAccess(database, userId, conversationId);
  return database
    .prepare(
      `SELECT * FROM npc_memories
       WHERE conversation_id = ? AND npc_name = ?
       ORDER BY created_at DESC`
    )
    .all(conversationId, npcName)
    .map(toNpcMemory);
}

export function addNpcMemory(database, userId, conversationId, npcName, payload = {}) {
  assertConversationAccess(database, userId, conversationId);
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

export function deleteNpcMemory(database, userId, conversationId, memoryId) {
  const row = database
    .prepare(
      `SELECT npc_memories.id FROM npc_memories
       JOIN conversations ON conversations.id = npc_memories.conversation_id
       WHERE npc_memories.id = ? AND npc_memories.conversation_id = ? AND conversations.user_id = ?`
    )
    .get(memoryId, conversationId, userId);
  if (!row) return false;

  const result = database.prepare('DELETE FROM npc_memories WHERE id = ?').run(memoryId);
  return result.changes > 0;
}

// ── NPC Behaviors ──

export function listNpcBehaviors(database, userId, conversationId, npcName) {
  assertConversationAccess(database, userId, conversationId);
  return database
    .prepare(
      `SELECT * FROM npc_behaviors
       WHERE conversation_id = ? AND npc_name = ?
       ORDER BY priority DESC, created_at ASC`
    )
    .all(conversationId, npcName)
    .map(toNpcBehavior);
}

export function addNpcBehavior(database, userId, conversationId, npcName, payload = {}) {
  assertConversationAccess(database, userId, conversationId);
  const id = newId();
  const timestamp = nowIso();
  const behaviorType = normalizeBehaviorType(payload.behaviorType);
  const triggerCondition = normalizeContent(payload.triggerCondition);
  const action = normalizeContent(payload.action);
  const priority = clampNumber(payload.priority, 0, 100, 0);
  const enabled = payload.enabled !== false ? 1 : 0;

  database
    .prepare(
      `INSERT INTO npc_behaviors (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, conversationId, npcName, behaviorType, triggerCondition, action, priority, enabled, timestamp);

  return toNpcBehavior(database.prepare('SELECT * FROM npc_behaviors WHERE id = ?').get(id));
}

export function updateNpcBehavior(database, userId, conversationId, behaviorId, payload = {}) {
  const row = database
    .prepare(
      `SELECT npc_behaviors.id FROM npc_behaviors
       JOIN conversations ON conversations.id = npc_behaviors.conversation_id
       WHERE npc_behaviors.id = ? AND npc_behaviors.conversation_id = ? AND conversations.user_id = ?`
    )
    .get(behaviorId, conversationId, userId);
  if (!row) return null;

  const existing = database.prepare('SELECT * FROM npc_behaviors WHERE id = ?').get(behaviorId);
  if (!existing) return null;

  const behaviorType = payload.behaviorType !== undefined ? normalizeBehaviorType(payload.behaviorType) : existing.behavior_type;
  const triggerCondition = payload.triggerCondition !== undefined ? normalizeContent(payload.triggerCondition) : existing.trigger_condition;
  const action = payload.action !== undefined ? normalizeContent(payload.action) : existing.action;
  const priority = payload.priority !== undefined ? clampNumber(payload.priority, 0, 100, existing.priority) : existing.priority;
  const enabled = payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : existing.enabled;

  database
    .prepare(
      `UPDATE npc_behaviors
       SET behavior_type = ?, trigger_condition = ?, action = ?, priority = ?, enabled = ?
       WHERE id = ?`
    )
    .run(behaviorType, triggerCondition, action, priority, enabled, behaviorId);

  return toNpcBehavior(database.prepare('SELECT * FROM npc_behaviors WHERE id = ?').get(behaviorId));
}

export function deleteNpcBehavior(database, userId, conversationId, behaviorId) {
  const row = database
    .prepare(
      `SELECT npc_behaviors.id FROM npc_behaviors
       JOIN conversations ON conversations.id = npc_behaviors.conversation_id
       WHERE npc_behaviors.id = ? AND npc_behaviors.conversation_id = ? AND conversations.user_id = ?`
    )
    .get(behaviorId, conversationId, userId);
  if (!row) return false;

  const result = database.prepare('DELETE FROM npc_behaviors WHERE id = ?').run(behaviorId);
  return result.changes > 0;
}

// ── NPC Discovery ──

/**
 * Scan messages for NPC names. Returns a deduplicated list of NPC names
 * found in assistant messages (excluding the main character name).
 */
export function scanNpcsFromMessages(messages, mainCharacterName = '') {
  const npcNames = new Set();
  const mainName = (mainCharacterName || '').trim().toLowerCase();

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const names = extractNpcNamesFromText(message.content || '');
    for (const name of names) {
      if (name.toLowerCase() !== mainName) {
        npcNames.add(name);
      }
    }
  }

  return [...npcNames].sort();
}

/**
 * List all NPCs in a conversation with their memory/behavior counts.
 */
export function listConversationNpcs(database, userId, conversationId, mainCharacterName = '') {
  assertConversationAccess(database, userId, conversationId);

  const memoryNpcs = database
    .prepare(`SELECT DISTINCT npc_name FROM npc_memories WHERE conversation_id = ?`)
    .all(conversationId)
    .map((r) => r.npc_name);

  const behaviorNpcs = database
    .prepare(`SELECT DISTINCT npc_name FROM npc_behaviors WHERE conversation_id = ?`)
    .all(conversationId)
    .map((r) => r.npc_name);

  const messages = database
    .prepare(`SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at ASC`)
    .all(conversationId);

  const scannedNpcs = extractNpcNamesFromMessages(messages, mainCharacterName);
  const allNpcNames = new Set([...memoryNpcs, ...behaviorNpcs, ...scannedNpcs]);

  return [...allNpcNames].sort().map((npcName) => {
    const memoryCount = database
      .prepare(`SELECT COUNT(*) AS count FROM npc_memories WHERE conversation_id = ? AND npc_name = ?`)
      .get(conversationId, npcName)?.count || 0;
    const behaviorCount = database
      .prepare(`SELECT COUNT(*) AS count FROM npc_behaviors WHERE conversation_id = ? AND npc_name = ?`)
      .get(conversationId, npcName)?.count || 0;
    return {
      name: npcName,
      memoryCount: Number(memoryCount),
      behaviorCount: Number(behaviorCount)
    };
  });
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
       ORDER BY priority DESC, created_at ASC`
    )
    .all(conversationId);

  if (behaviors.length === 0) return '';

  const npcMap = new Map();
  for (const b of behaviors) {
    if (!npcMap.has(b.npc_name)) {
      npcMap.set(b.npc_name, []);
    }
    npcMap.get(b.npc_name).push(b);
  }

  const sections = [];
  for (const [npcName, rules] of npcMap) {
    const ruleLines = rules.map((r) => {
      const trigger = r.trigger_condition ? `触发条件：${r.trigger_condition}` : '无特定触发条件';
      return `  - [${r.behavior_type}] ${trigger} → 行动：${r.action}`;
    });

    const memories = database
      .prepare(
        `SELECT content, memory_type FROM npc_memories
         WHERE conversation_id = ? AND npc_name = ?
         ORDER BY created_at DESC LIMIT 5`
      )
      .all(conversationId, npcName);

    let memorySection = '';
    if (memories.length > 0) {
      const memoryLines = memories.map((m) => `  - [${m.memory_type}] ${m.content}`);
      memorySection = `\n  记忆：\n${memoryLines.join('\n')}`;
    }

    sections.push(
      `NPC「${npcName}」行为规则：\n${ruleLines.join('\n')}${memorySection}`
    );
  }

  return `\n[NPC 自主行为引擎]\n${sections.join('\n\n')}\n请根据以上 NPC 行为规则，在回复中自然地体现 NPC 的自主行为和反应。`;
}

// ── Helpers ──

/**
 * Extract NPC names from AI reply text using common patterns.
 */
function extractNpcNamesFromText(text) {
  if (!text) return [];
  const names = new Set();

  // Pattern 1: 【Name】dialogue
  for (const match of text.matchAll(/【([^】]{1,20})】/g)) {
    const name = match[1].trim();
    if (isValidNpcName(name)) names.add(name);
  }

  // Pattern 2: **Name** (bold, likely character names in dialogue)
  for (const match of text.matchAll(/\*\*([^*]{1,20})\*\*/g)) {
    const name = match[1].trim();
    if (isValidNpcName(name) && !isCommonNonNameWord(name)) names.add(name);
  }

  // Pattern 3: "Name" said/说 patterns
  for (const match of text.matchAll(/[\u201c"\u300c]([^"\u201d\u300d]{1,20})[\u201d"\u300d]\s*(?:说道|说|道|喊|叫|问|答|笑|叹|低语|大喊|轻声|冷冷|怒)/g)) {
    const name = match[1].trim();
    if (isValidNpcName(name)) names.add(name);
  }

  // Pattern 4: Name 说/道/曰 patterns (Chinese)
  for (const match of text.matchAll(/(?:^|[\n\s])([^\n\s,，。.!?！？:：]{1,10})\s*(?:说道|说|道|喊道|叫道|问道|答道|笑道|叹道)/gm)) {
    const name = match[1].trim();
    if (isValidNpcName(name)) names.add(name);
  }

  return [...names];
}

function extractNpcNamesFromMessages(messages, mainCharacterName) {
  const npcNames = new Set();
  const mainName = (mainCharacterName || '').trim().toLowerCase();

  for (const message of messages) {
    const names = extractNpcNamesFromText(message.content || '');
    for (const name of names) {
      if (name.toLowerCase() !== mainName) {
        npcNames.add(name);
      }
    }
  }

  return [...npcNames].sort();
}

function isValidNpcName(name) {
  if (!name || name.length < 1 || name.length > 20) return false;
  if (/^[\d\s]+$/.test(name)) return false;
  if (/^[^\p{L}]+$/u.test(name)) return false;
  return true;
}

function isCommonNonNameWord(word) {
  const common = ['注意', '警告', '提示', '说明', '备注', '总结', '摘要', '标题', '正文', '附录'];
  return common.includes(word);
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

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}
