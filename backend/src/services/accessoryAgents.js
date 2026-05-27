import { normalizeAccessorySkills, isAccessorySkillActive, normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { processTransactionIntents, createConversationTransaction } from '../modules/economy.js';
import { addNpcMemory, scanNpcsFromMessages } from '../modules/npcs.js';
import { applyVariableUpdates, extractVariablesFromText, upsertStatusBar } from '../modules/statusBars.js';
import { detectSceneAndEmotion, findBestMatch, listCharacterImages } from '../modules/characterImages.js';
import { hasUsableProvider, runToolCompletion } from './providers.js';

const agentTimeoutMs = 20000;

export function getAccessorySkillsPayload(conversation, statusBar = null) {
  const skills = normalizeAccessorySkills(conversation?.settings?.accessorySkills || {});
  return {
    skills,
    active: Object.fromEntries(
      Object.keys(skills).map((key) => [
        key,
        isAccessorySkillActive(skills, key, { statusBar })
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
  if (!statusBar?.variables?.length) {
    return { statusBar: null, updates: [] };
  }

  let updates = [];
  if (hasUsableProvider(settings)) {
    const toolResult = await runToolCompletion(
      withModelOverride(settings, skill),
      buildStatusBarMessages(statusBar, assistantMessage.content, normalizeAdvancedSettings(conversation?.settings || {}).statusBarPrompt),
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
      updates = extractVariablesFromText(toolResult.content, statusBar.variables);
    }
  }

  if (!updates.length) {
    updates = extractVariablesFromText(assistantMessage.content, statusBar.variables);
  }

  if (!updates.length) {
    return { statusBar, updates: [] };
  }

  const nextStatusBar = upsertStatusBar(db, userId, conversation.id, {
    name: statusBar.name,
    variables: applyVariableUpdates(statusBar.variables, updates),
    template: statusBar.template
  });
  return { statusBar: nextStatusBar, updates };
}

async function runNpcAgent({ db, userId, conversation, character, assistantMessage, settings, skill }) {
  const recorded = [];

  if (hasUsableProvider(settings)) {
    await runToolCompletion(
      withModelOverride(settings, skill),
      buildNpcMessages(character, assistantMessage.content),
      [npcMemoryTool()],
      async (toolName, args) => {
        if (toolName !== 'record_npc_memory') {
          return { ok: false, error: `Unsupported tool: ${toolName}` };
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

  if (!recorded.length) {
    const names = scanNpcsFromMessages([{ role: 'assistant', content: assistantMessage.content }], character?.name || '');
    for (const npcName of names.slice(0, 5)) {
      const memory = addNpcMemoryIfNew(db, userId, conversation.id, npcName, {
        memoryType: 'event',
        content: snippet(assistantMessage.content)
      });
      if (memory) {
        recorded.push(memory);
      }
    }
  }

  return { memories: recorded };
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
        'Call record_npc_memory for named side characters that appear in the reply.',
        'Skip the main character and skip generic section titles.'
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
                value: { type: 'number' },
                max: { type: 'number' }
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
    .map((item) => ({
      name: String(item?.name || '').trim(),
      value: Number(item?.value),
      ...(item?.max !== undefined ? { max: Number(item.max) } : {})
    }))
    .filter((item) => item.name && Number.isFinite(item.value))
    .slice(0, 20);
}

function addNpcMemoryIfNew(db, userId, conversationId, npcName, payload) {
  const name = String(npcName || '').trim().slice(0, 80);
  const content = String(payload?.content || '').trim();
  if (!name || !content) {
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

function snippet(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
