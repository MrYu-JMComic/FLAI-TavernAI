import { normalizeAccessorySkills, isAccessorySkillActive, normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { processTransactionIntents, createConversationTransaction } from '../modules/economy.js';
import { addNpcMemory, isConversationNpcHidden, upsertConversationNpc } from '../modules/npcs.js';
import { STATUS_BAR_VARIABLE_LIMIT, applyVariableUpdates, extractVariablesFromText, upsertStatusBar } from '../modules/statusBars.js';
import { detectSceneAndEmotion, findBestMatch, listCharacterImages } from '../modules/characterImages.js';
import { hasUsableProvider, runToolCompletion } from './providers.js';

const agentTimeoutMs = 20000;

export function getAccessorySkillsPayload(conversation, statusBar = null) {
  const skills = normalizeAccessorySkills(conversation?.settings?.accessorySkills || {});
  const advancedSettings = normalizeAdvancedSettings(conversation?.settings || {});
  return {
    skills,
    active: Object.fromEntries(
      Object.keys(skills).map((key) => [
        key,
        isAccessorySkillActive(skills, key, {
          statusBar,
          statusBarPrompt: advancedSettings.statusBarPrompt,
          statusBarBlueprint: advancedSettings.statusBarBlueprint
        })
      ])
    )
  };
}

export async function runAccessoryAgents({
  db,
  userId,
  conversation,
  character,
  assistantMessage,
  settings,
  statusBar,
  emit
}) {
  const { skills, active } = getAccessorySkillsPayload(conversation, statusBar);
  const jobs = [];

  if (active.statusBarAgent) {
    jobs.push(runAgentJob('statusBarAgent', skills.statusBarAgent, emit, () =>
      runStatusBarAgent({ db, userId, conversation, assistantMessage, settings, statusBar, skill: skills.statusBarAgent })
    ));
  }
  if (active.npcAgent) {
    jobs.push(runAgentJob('npcAgent', skills.npcAgent, emit, () =>
      runNpcAgent({ db, userId, conversation, character, assistantMessage, settings, skill: skills.npcAgent })
    ));
  }
  if (active.economyAgent) {
    jobs.push(runAgentJob('economyAgent', skills.economyAgent, emit, () =>
      runEconomyAgent({ db, userId, conversation, assistantMessage, settings, skill: skills.economyAgent })
    ));
  }
  if (active.cgScene) {
    jobs.push(runAgentJob('cgScene', skills.cgScene, emit, () =>
      runCgSceneAgent({ db, character, assistantMessage })
    ));
  }

  if (!jobs.length) {
    const results = [];
    emit?.('skills_done', { results });
    return results;
  }

  const settled = await Promise.allSettled(jobs);
  const results = settled.map((item) => (
    item.status === 'fulfilled'
      ? item.value
      : { skill: 'unknown', ok: false, error: item.reason?.message || 'Accessory skill failed' }
  ));
  emit?.('skills_done', { results });
  return results;
}

async function runAgentJob(skill, config, emit, handler) {
  emit?.('skill_start', { skill, model: config?.modelOverride || '' });
  let payload;
  try {
    const result = await withTimeout(handler(), agentTimeoutMs, `${skill} timed out`);
    payload = { skill, ok: true, result };
  } catch (error) {
    payload = { skill, ok: false, error: error?.message || `${skill} failed` };
  }
  emit?.('skill_result', payload);
  return payload;
}

async function runStatusBarAgent({ db, userId, conversation, assistantMessage, settings, statusBar, skill }) {
  const statusBarPrompt = normalizeAdvancedSettings(conversation?.settings || {}).statusBarPrompt;
  if (!statusBar?.variables?.length && !statusBarPrompt) {
    return { statusBar: null, updates: [] };
  }

  const currentStatusBar = statusBar || { name: '状态栏', variables: [], template: '' };
  let updates = [];
  if (hasUsableProvider(settings)) {
    const toolResult = await runToolCompletion(
      withModelOverride(settings, skill),
      buildStatusBarMessages(currentStatusBar, assistantMessage.content, statusBarPrompt),
      [statusBarTool()],
      async (toolName, args) => {
        if (toolName !== 'update_status_bar') {
          return { ok: false, error: `Unsupported tool: ${toolName}` };
        }
        updates = normalizeStatusUpdates(args);
        return { ok: true, updates };
      },
      { maxRounds: 2, thinkingEnabled: false }
    ).catch(() => null);

    if (!updates.length && toolResult?.content) {
      updates = extractVariablesFromText(toolResult.content, currentStatusBar.variables);
    }
  }

  if (!updates.length) {
    updates = extractVariablesFromText(assistantMessage.content, currentStatusBar.variables);
  }

  if (!updates.length) {
    return { statusBar, updates: [] };
  }

  const nextStatusBar = upsertStatusBar(db, userId, conversation.id, {
    name: currentStatusBar.name,
    variables: mergeStatusVariables(currentStatusBar.variables, updates),
    template: currentStatusBar.template
  });
  return { statusBar: nextStatusBar, updates };
}

async function runNpcAgent({ db, userId, conversation, character, assistantMessage, settings, skill }) {
  const recorded = [];
  const npcs = [];

  if (hasUsableProvider(settings)) {
    await runToolCompletion(
      withModelOverride(settings, skill),
      buildNpcMessages(character, assistantMessage.content),
      [npcUpsertTool(), npcMemoryTool()],
      async (toolName, args) => {
        if (toolName === 'upsert_npc') {
          const npc = upsertNpcFromAgent(db, userId, conversation.id, args);
          if (npc) {
            npcs.push(npc);
          }
          return { ok: true, npc };
        }
        if (toolName !== 'record_npc_memory') {
          return { ok: false, error: `Unsupported tool: ${toolName}` };
        }
        const npc = upsertNpcFromAgent(db, userId, conversation.id, {
          npcName: args.npcName,
          evidence: args.content,
          confidence: args.confidence ?? 75
        });
        if (npc) {
          npcs.push(npc);
        }
        const memory = addNpcMemoryIfNew(db, userId, conversation.id, args.npcName, {
          memoryType: args.memoryType || 'event',
          content: args.content || ''
        });
        if (memory) {
          recorded.push(memory);
        }
        return { ok: true, memory };
      },
      { maxRounds: 3, thinkingEnabled: false }
    ).catch(() => null);
  }

  return { npcs, memories: recorded };
}

async function runEconomyAgent({ db, userId, conversation, assistantMessage, settings, skill }) {
  const transactions = [];

  if (hasUsableProvider(settings)) {
    await runToolCompletion(
      withModelOverride(settings, skill),
      buildEconomyMessages(assistantMessage.content),
      [economyTool()],
      async (toolName, args) => {
        if (toolName !== 'record_economy_transaction') {
          return { ok: false, error: `Unsupported tool: ${toolName}` };
        }
        const result = createConversationTransaction(db, userId, conversation.id, args);
        if (result?.transaction) {
          transactions.push(result);
        }
        return { ok: true, transaction: result?.transaction || null };
      },
      { maxRounds: 3, thinkingEnabled: false }
    ).catch(() => null);
  }

  if (!transactions.length) {
    transactions.push(...processTransactionIntents(db, userId, conversation.id, assistantMessage.content));
  }

  return { transactions };
}

async function runCgSceneAgent({ db, character, assistantMessage }) {
  const images = listCharacterImages(db, character.id);
  if (!images.length) {
    return { image: null };
  }
  const { sceneTag, emotionTag } = detectSceneAndEmotion(assistantMessage.content);
  return {
    sceneTag,
    emotionTag,
    image: findBestMatch(images, sceneTag, emotionTag)
  };
}

function withModelOverride(settings, skill = {}) {
  return {
    ...settings,
    model: skill.modelOverride || settings.model
  };
}

function buildStatusBarMessages(statusBar, content, statusBarPrompt = '') {
  return [
    {
      role: 'system',
      content: [
        'You are a state bar updater for a roleplay chat.',
        'Call update_status_bar only when the assistant reply clearly changes one or more variables.',
        'The variable value can be a number for meters or a short string for profile/status text.',
        'Pay close attention to short text fields for outfit, clothing, equipment, carried items, location, mood, and memory.',
        'You may create a new variable when the guidance asks for it and the reply contains a clear value.',
        'Do not invent changes.',
        statusBarPrompt ? `Additional author/session guidance:\n${statusBarPrompt}` : ''
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        variables: statusBar.variables,
        reply: content
      })
    }
  ];
}

function buildNpcMessages(character, content) {
  return [
    {
      role: 'system',
      content: [
        'You are an NPC memory extractor for a roleplay chat.',
        'Call upsert_npc for named side characters that clearly appear in the reply.',
        'Call record_npc_memory only when there is a concise useful memory about that side character.',
        'Skip the main character, user/player, generic section titles, status panels, and markdown headings.',
        'Do not report narrative fragments, pronouns, or UI labels as NPCs.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        mainCharacter: character?.name || '',
        reply: content
      })
    }
  ];
}

function npcUpsertTool() {
  return {
    type: 'function',
    function: {
      name: 'upsert_npc',
      description: 'Confirm that a named side character appeared in the reply.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          npcName: { type: 'string' },
          evidence: { type: 'string' },
          confidence: { type: 'number', description: '0-100 confidence that this is a real side character name.' }
        },
        required: ['npcName', 'evidence']
      }
    }
  };
}

function buildEconomyMessages(content) {
  return [
    {
      role: 'system',
      content: [
        'You extract explicit economy transactions from a roleplay reply.',
        'Call record_economy_transaction only for clear gains, spending, rewards, penalties, trades, or transfers.',
        'If no transaction is explicit, do not call a tool.'
      ].join('\n')
    },
    { role: 'user', content }
  ];
}

function statusBarTool() {
  return {
    type: 'function',
    function: {
      name: 'update_status_bar',
      description: 'Update current status bar variables.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          variables: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                value: { type: 'string', maxLength: 200 },
                max: { type: 'number' },
                color: { type: 'string' }
              },
              required: ['name', 'value']
            }
          }
        },
        required: ['variables']
      }
    }
  };
}

function npcMemoryTool() {
  return {
    type: 'function',
    function: {
      name: 'record_npc_memory',
      description: 'Record a concise memory for an NPC side character.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          npcName: { type: 'string' },
          memoryType: { type: 'string', enum: ['event', 'relationship', 'opinion', 'knowledge', 'emotion'] },
          content: { type: 'string' }
        },
        required: ['npcName', 'content']
      }
    }
  };
}

function economyTool() {
  return {
    type: 'function',
    function: {
      name: 'record_economy_transaction',
      description: 'Record one explicit economy transaction.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amount: { type: 'number' },
          type: { type: 'string', enum: ['income', 'expense', 'transfer', 'reward', 'penalty', 'trade'] },
          currencyType: { type: 'string', enum: ['gold', 'silver', 'copper', 'gem', 'credit'] },
          description: { type: 'string' },
          relatedNpc: { type: 'string' }
        },
        required: ['amount', 'type']
      }
    }
  };
}

function normalizeStatusUpdates(args = {}) {
  return (Array.isArray(args.variables) ? args.variables : [])
    .map((item) => {
      const value = normalizeStatusValue(item?.value);
      return {
        name: String(item?.name || '').trim(),
        value,
        ...(Number.isFinite(Number(item?.max)) ? { max: Number(item.max) } : {}),
        ...(typeof item?.color === 'string' && item.color.trim() ? { color: item.color.trim() } : {})
      };
    })
    .filter((item) => item.name && item.value !== '')
    .slice(0, STATUS_BAR_VARIABLE_LIMIT);
}

function mergeStatusVariables(variables = [], updates = []) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return variables;
  }
  const current = applyVariableUpdates(Array.isArray(variables) ? variables : [], updates);
  const seen = new Set(current.map((item) => statusVariableKey(item.name)));
  const additions = updates
    .filter((item) => item.name && !seen.has(statusVariableKey(item.name)))
    .map((item) => ({
      name: item.name,
      value: item.value,
      ...(Number.isFinite(Number(item.max))
        ? { max: Number(item.max) }
        : typeof item.value === 'number'
          ? { max: 100 }
          : {}),
      color: item.color || ''
    }));
  return [...current, ...additions].slice(0, STATUS_BAR_VARIABLE_LIMIT);
}

function statusVariableKey(value) {
  return String(value || '')
    .replace(/[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002\u3001/\\|()[\]{}"'`~!@#$%^&*_+=?<>-]+/g, '')
    .trim()
    .toLowerCase();
}

function normalizeStatusValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) {
    return numeric;
  }
  return text.length > 200 ? text.slice(0, 200) : text;
}

function addNpcMemoryIfNew(db, userId, conversationId, npcName, payload) {
  const name = String(npcName || '').trim().slice(0, 80);
  const content = String(payload?.content || '').trim();
  if (!name || !content) {
    return null;
  }
  if (isConversationNpcHidden(db, conversationId, name)) {
    return null;
  }
  const existing = db
    .prepare(
      `SELECT id FROM npc_memories
       WHERE conversation_id = ? AND npc_name = ? AND content = ?
       LIMIT 1`
    )
    .get(conversationId, name, content);
  if (existing) {
    return null;
  }
  return addNpcMemory(db, userId, conversationId, name, {
    memoryType: payload.memoryType || 'event',
    content
  });
}

function upsertNpcFromAgent(db, userId, conversationId, args = {}) {
  const npcName = String(args.npcName || args.name || '').trim();
  if (!npcName || isConversationNpcHidden(db, conversationId, npcName)) {
    return null;
  }
  return upsertConversationNpc(db, userId, conversationId, {
    npcName,
    source: 'agent',
    evidence: args.evidence || '',
    confidence: Number.isFinite(Number(args.confidence)) ? Number(args.confidence) : 75
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
