import { newId, nowIso } from '../security.js';
import { normalizeBoolean } from '../utils/boolean.js';

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
  const priority = clampNumber(payload.priority, 0, 100, 0);
  const enabled = normalizeBoolean(payload.enabled, true) ? 1 : 0;

  database
    .prepare(
      `INSERT INTO npc_behaviors (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, conversationId, npcName, behaviorType, triggerCondition, action, priority, enabled, timestamp);

  return toNpcBehavior(database.prepare('SELECT * FROM npc_behaviors WHERE id = ?').get(id));
}

export function updateNpcBehavior(database, userId, conversationId, behaviorId, payload = {}) {
  payload = normalizePayload(payload);
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
  const enabled = payload.enabled !== undefined ? (normalizeBoolean(payload.enabled, existing.enabled) ? 1 : 0) : existing.enabled;

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

export function upsertConversationNpc(database, userId, conversationId, payload = {}) {
  assertConversationAccess(database, userId, conversationId);
  payload = normalizePayload(payload);
  const npcName = normalizeNpcName(payload.npcName ?? payload.name);
  if (!npcName) {
    return null;
  }
  const timestamp = nowIso();
  const source = normalizeNpcSource(payload.source);
  const evidence = normalizeEvidence(payload.evidence);
  const confidence = clampNumber(payload.confidence, 0, 100, 0);
  const hidden = normalizeBoolean(payload.hidden) ? 1 : 0;
  const shouldUnhide = normalizeBoolean(payload.unhide);
  const existing = database
    .prepare('SELECT * FROM npc_registry WHERE conversation_id = ? AND npc_name = ?')
    .get(conversationId, npcName);

  if (existing) {
    const nextHidden = existing.hidden && !shouldUnhide ? 1 : hidden;
    database
      .prepare(
        `UPDATE npc_registry
         SET source = ?, evidence = ?, confidence = ?, hidden = ?, updated_at = ?
         WHERE conversation_id = ? AND npc_name = ?`
      )
      .run(
        source,
        evidence || existing.evidence || '',
        Math.max(Number(existing.confidence || 0), confidence),
        nextHidden,
        timestamp,
        conversationId,
        npcName
      );
  } else {
    database
      .prepare(
        `INSERT INTO npc_registry (id, conversation_id, npc_name, source, evidence, confidence, hidden, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(newId(), conversationId, npcName, source, evidence, confidence, hidden, timestamp, timestamp);
  }

  return toNpcRegistry(database
    .prepare('SELECT * FROM npc_registry WHERE conversation_id = ? AND npc_name = ?')
    .get(conversationId, npcName));
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

  const memoryNpcs = database
    .prepare(`SELECT DISTINCT npc_name FROM npc_memories WHERE conversation_id = ?`)
    .all(conversationId)
    .map((r) => r.npc_name);

  const behaviorNpcs = database
    .prepare(`SELECT DISTINCT npc_name FROM npc_behaviors WHERE conversation_id = ?`)
    .all(conversationId)
    .map((r) => r.npc_name);

  const registryRows = database
    .prepare(`SELECT * FROM npc_registry WHERE conversation_id = ?`)
    .all(conversationId);
  const hiddenNames = new Set(
    registryRows
      .filter((row) => row.hidden)
      .map((row) => normalizeNpcName(row.npc_name).toLowerCase())
  );
  const registryNpcs = registryRows
    .filter((row) => !row.hidden)
    .map((row) => row.npc_name);
  const registryMeta = new Map(
    registryRows.map((row) => [normalizeNpcName(row.npc_name).toLowerCase(), toNpcRegistry(row)])
  );

  const allNpcNames = new Set([...memoryNpcs, ...behaviorNpcs, ...registryNpcs]);

  return [...allNpcNames].sort().map((npcName) => {
    const normalizedName = normalizeNpcName(npcName);
    if (!normalizedName || hiddenNames.has(normalizedName.toLowerCase())) {
      return null;
    }
    const registry = registryMeta.get(normalizedName.toLowerCase());
    const memoryCount = database
      .prepare(`SELECT COUNT(*) AS count FROM npc_memories WHERE conversation_id = ? AND npc_name = ?`)
      .get(conversationId, normalizedName)?.count || 0;
    const behaviorCount = database
      .prepare(`SELECT COUNT(*) AS count FROM npc_behaviors WHERE conversation_id = ? AND npc_name = ?`)
      .get(conversationId, normalizedName)?.count || 0;
    return {
      name: normalizedName,
      memoryCount: Number(memoryCount),
      behaviorCount: Number(behaviorCount),
      source: registry?.source || (Number(memoryCount) > 0 ? 'memory' : Number(behaviorCount) > 0 ? 'behavior' : 'scan'),
      confidence: registry?.confidence || 0,
      evidence: registry?.evidence || ''
    };
  }).filter(Boolean);
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
         ORDER BY created_at DESC, rowid DESC LIMIT 5`
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
    const name = normalizeNpcCandidate(match[1]);
    if (isValidNpcName(name)) names.add(name);
  }

  // Pattern 1b: 「Name」/《Name》 as dialogue speaker labels
  for (const match of text.matchAll(/[「《]([^」》]{1,20})[」》]\s*(?:[:：，,。]|说|道|问|答|笑|叹|低语|喊|叫)/g)) {
    const name = normalizeNpcCandidate(match[1]);
    if (isValidNpcName(name)) names.add(name);
  }

  // Pattern 2: **Name** (bold, likely character names in dialogue)
  for (const match of text.matchAll(/\*\*([^*]{1,20})\*\*/g)) {
    const name = normalizeNpcCandidate(match[1]);
    if (isValidNpcName(name)) names.add(name);
  }

  // Pattern 3: "Name" said/说 patterns
  for (const match of text.matchAll(/[\u201c"\u300c]([^"\u201d\u300d]{1,20})[\u201d"\u300d]\s*(?:说道|说|道|喊|叫|问|答|笑|叹|低语|大喊|轻声|冷冷|怒)/g)) {
    const name = normalizeNpcCandidate(match[1]);
    if (isValidNpcName(name)) names.add(name);
  }

  // Pattern 4: Name 说/道/曰 patterns (Chinese)
  for (const match of text.matchAll(/(?:^|[\n\s])([^\n\s,，。.!?！？:：]{1,10})\s*(?:说道|说|道|喊道|叫道|问道|答道|笑道|叹道)/gm)) {
    const name = normalizeNpcCandidate(match[1]);
    if (isValidNpcName(name)) names.add(name);
  }

  // Pattern 5: speaker label lines, e.g. "老板娘：欢迎回来。"
  for (const match of text.matchAll(/(?:^|\n)\s*([^\n,，。.!?！？:：]{1,12})\s*[:：]\s*(?:[“"「]|[^:：\n]{2,})/gm)) {
    const name = normalizeNpcCandidate(match[1]);
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
  if (isCommonNonNameWord(name)) return false;
  if (isNarrativeFragmentName(name)) return false;
  if (/^[\d\s]+$/.test(name)) return false;
  if (/^[^\p{L}]+$/u.test(name)) return false;
  if (/^[.…·•~\-]+/.test(name) || /[.…]{2,}/.test(name)) return false;
  if (/[。！？!?，,；;：:、【】\[\]{}<>《》]/.test(name)) return false;
  if (/\s{2,}/.test(name)) return false;
  return true;
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

function isCommonNonNameWord(word) {
  const normalized = String(word || '').trim().toLowerCase();
  const common = new Set([
    '注意', '警告', '提示', '说明', '备注', '总结', '摘要', '标题', '正文', '附录',
    '状态栏', '状态', '生理状态', '心理状态', '记忆', '近期清晰记忆', '模糊记忆', '深刻记忆',
    '主角', '主角信息', '其他角色', '特殊要素', '基础信息', '角色信息', '人物信息',
    '角色状态', '角色状态面板', '角色面板', '设定信息', '背景设定', '用户', '玩家', '旁白', '系统', '作者', '助手', 'ai', 'npc',
    '角色', '角色名', '姓名', '性别', '年龄', '身份', '职业',
    'hp', 'mp', 'sp', 'exp', 'level', '等级', '好感', '好感度',
    '饥饿', '口渴', '疼痛', '伤病', '疲劳', '其他', '当前情绪', '压力水平', '心理倾向',
    '无', '暂无', '待定', '未知', '平静', '低', '高', '轻微', '普通', '正常',
    '我', '你', '他', '她', '它', '我们', '你们', '他们', '她们'
  ]);
  if (common.has(normalized) || common.has(word)) {
    return true;
  }
  return /^(第[一二三四五六七八九十\d]+章|chapter\s*\d+|scene\s*\d+)$/i.test(normalized);
}

function isNarrativeFragmentName(name) {
  const normalized = String(name || '').trim();
  if (/^(我|你|他|她|它|我们|你们|他们|她们|这|那|此|其)(没有|不是|已经|正在|只是|还是|不会|不能|可以|觉得|知道|看到|听到|说|问|答|笑|叹|想|看|听|走|拿|把|被|将|却|便|都|就|还|很|更|又|再|的)/.test(normalized)) {
    return true;
  }
  return /(没有|不是|已经|正在|如果|因为|所以|但是|然后|突然|继续|开始|说道|问道|答道)$/.test(normalized);
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
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.npc_name,
    source: row.source,
    evidence: row.evidence || '',
    confidence: Number(row.confidence || 0),
    hidden: Boolean(row.hidden),
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
