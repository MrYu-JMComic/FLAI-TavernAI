import { normalizeAccessorySkills, isAccessorySkillActive, normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { processTransactionIntents, createConversationTransaction } from '../modules/economy.js';
import { addNpcBehavior, addNpcMemory, isConversationNpcHidden, upsertConversationNpc } from '../modules/npcs.js';
import { STATUS_BAR_VARIABLE_LIMIT, extractVariablesFromText, updateStatusBarVariables, upsertStatusBar } from '../modules/statusBars.js';
import { detectSceneAndEmotion, findBestMatch, listCharacterImages } from '../modules/characterImages.js';
import { deleteSceneEntity, listSceneWorkspace, upsertSceneItem } from '../modules/scenes.js';
import { completeSceneOrganization } from './sceneOrganizer.js';
import { hasUsableProvider, runToolCompletion } from './providers.js';
import { PIXEL_ICON_KEYS } from '../../../shared/pixelIconCatalog.js';
import { parseStatusTemplateToken } from '../../../shared/statusTemplateTokens.js';

const agentTimeoutMs = 20000;
const agentAbortGraceMs = 5000;
const AUTO_NPC_BEHAVIOR_LIMIT = 8;

export function getAccessorySkillsPayload(conversation, statusBar = null) {
  const skills = normalizeAccessorySkills(conversation?.settings?.accessorySkills || {});
  const advancedSettings = normalizeAdvancedSettings(conversation?.settings || {});
  const activeContext = {
    statusBar,
    statusBarPrompt: advancedSettings.statusBarPrompt,
    statusBarBlueprint: advancedSettings.statusBarBlueprint
  };
  const active = {};
  for (const key in skills) {
    if (!Object.prototype.hasOwnProperty.call(skills, key)) {
      continue;
    }
    active[key] = isAccessorySkillActive(skills, key, activeContext);
  }
  return {
    skills,
    active
  };
}

export async function runAccessoryAgents({
  db,
  userId,
  conversation,
  character,
  userMessage,
  assistantMessage,
  settings,
  statusBar,
  emit
}) {
  const { skills, active } = getAccessorySkillsPayload(conversation, statusBar);
  const jobs = [];
  let npcAgentFactory = null;
  let sceneAgentFactory = null;
  const observationWindow = buildObservationWindow(userMessage, assistantMessage);

  if (active.statusBarAgent) {
    jobs.push(runAgentJob('statusBarAgent', skills.statusBarAgent, emit, (signal) =>
      runStatusBarAgent({ db, userId, conversation, assistantMessage, observationWindow, settings, statusBar, skill: skills.statusBarAgent, signal })
    ));
  }
  if (active.npcAgent) {
    npcAgentFactory = () => runAgentJob('npcAgent', skills.npcAgent, emit, (signal) =>
      runNpcAgent({ db, userId, conversation, character, assistantMessage, observationWindow, settings, skill: skills.npcAgent, signal })
    );
  }
  if (active.economyAgent) {
    jobs.push(runAgentJob('economyAgent', skills.economyAgent, emit, (signal) =>
      runEconomyAgent({ db, userId, conversation, assistantMessage, observationWindow, settings, skill: skills.economyAgent, signal })
    ));
  }
  if (active.cgScene) {
    jobs.push(runAgentJob('cgScene', skills.cgScene, emit, () =>
      runCgSceneAgent({ db, character, assistantMessage })
    ));
  }
  if (active.sceneAgent) {
    sceneAgentFactory = () => runAgentJob('sceneAgent', skills.sceneAgent, emit, (signal) =>
      runSceneAgent({ db, userId, conversation, character, assistantMessage, observationWindow, settings, skill: skills.sceneAgent, signal })
    );
  }

  // Scene and NPC agents can both update the same stable itemCode. Run them
  // deterministically instead of racing last-writer-wins updates. Scene facts
  // are organized first, then actor ownership/clothing applies the final turn
  // state. Unrelated accessory agents still run in parallel with this sequence.
  if (sceneAgentFactory && npcAgentFactory) {
    jobs.push(runAgentSequence([sceneAgentFactory, npcAgentFactory]));
  } else if (sceneAgentFactory) {
    jobs.push(sceneAgentFactory());
  } else if (npcAgentFactory) {
    jobs.push(npcAgentFactory());
  }

  if (!jobs.length) {
    const results = [];
    emit?.('skills_done', { results });
    return results;
  }

  const settled = await Promise.allSettled(jobs);
  const results = [];
  for (const item of settled) {
    const value = item.status === 'fulfilled'
      ? item.value
      : { skill: 'unknown', ok: false, error: item.reason?.message || 'Accessory skill failed' };
    if (Array.isArray(value)) results.push(...value);
    else results.push(value);
  }
  emit?.('skills_done', { results });
  return results;
}

async function runAgentJob(skill, config, emit, handler) {
  emit?.('skill_start', { skill, model: config?.modelOverride || '' });
  // Abort the in-flight provider call at the deadline so the handler can fall
  // through to its cheap non-AI fallback; the outer race is only a backstop
  // for anything that ignores the signal.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => {
    controller.abort(new Error(`${skill} timed out`));
  }, agentTimeoutMs);
  let payload;
  try {
    const result = await withTimeout(handler(controller.signal), agentTimeoutMs + agentAbortGraceMs, `${skill} timed out`);
    payload = { skill, ok: true, result };
  } catch (error) {
    payload = { skill, ok: false, error: error?.message || `${skill} failed` };
  } finally {
    clearTimeout(abortTimer);
  }
  emit?.('skill_result', payload);
  return payload;
}

async function runStatusBarAgent({ db, userId, conversation, assistantMessage, observationWindow, settings, statusBar, skill, signal }) {
  const statusBarPrompt = normalizeAdvancedSettings(conversation?.settings || {}).statusBarPrompt;
  if (!statusBar?.variables?.length && !statusBarPrompt) {
    return { statusBar: null, updates: [] };
  }

  const currentStatusBar = statusBar || { name: '状态栏', variables: [], template: '' };
  let updates = [];
  let skippedUpdate = false;
  if (hasUsableProvider(settings)) {
    const toolResult = await runToolCompletion(
      withModelOverride(settings, skill),
      buildStatusBarMessages(currentStatusBar, observationWindow, statusBarPrompt),
      [statusBarTool(), statusBarSkipTool()],
      async (toolName, args) => {
        if (toolName === 'skip_status_bar_update') {
          skippedUpdate = true;
          return { ok: true, skipped: true, stop: true };
        }
        if (toolName === 'update_status_bar') {
          updates = normalizeStatusUpdates(args);
          return { ok: true, updates };
        }
        return { ok: false, error: `Unsupported tool: ${toolName}` };
      },
      { maxRounds: 2, thinkingEnabled: false, signal }
    ).catch((error) => {
      logAccessoryAgentFailure('status-bar', error);
      return null;
    });

    if (skippedUpdate) {
      return { statusBar, updates: [], skipped: true };
    }

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

  if (!statusUpdatesChangeVariables(currentStatusBar.variables, updates)) {
    return { statusBar, updates: [] };
  }
  const nextStatusBar = statusBar
    ? updateStatusBarVariables(db, userId, conversation.id, updates, { allowCreate: true })
    : upsertStatusBar(db, userId, conversation.id, {
        name: currentStatusBar.name,
        variables: updates,
        template: currentStatusBar.template
      });
  return { statusBar: nextStatusBar, updates };
}

async function runNpcAgent({ db, userId, conversation, character, assistantMessage, observationWindow, settings, skill, signal }) {
  const recorded = [];
  const behaviors = [];
  const npcs = [];
  const items = [];
  const sceneWorkspace = listSceneWorkspace(db, userId, conversation.id);

  if (hasUsableProvider(settings)) {
    await runToolCompletion(
      withModelOverride(settings, skill),
      buildNpcMessages(character, observationWindow, sceneWorkspace),
      [npcUpsertTool(), npcMemoryTool(), npcBehaviorTool(), actorItemTool(), actorItemDeleteTool()],
      async (toolName, args) => {
        if (toolName === 'upsert_npc') {
          const npc = upsertNpcFromAgent(db, userId, conversation.id, args);
          if (npc) {
            npcs.push(npc);
          }
          return { ok: true, npc };
        }
        if (toolName === 'record_npc_memory') {
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
        }
        if (toolName === 'record_npc_behavior') {
          const npc = upsertNpcFromAgent(db, userId, conversation.id, {
            npcName: args.npcName,
            evidence: args.triggerCondition || args.action,
            confidence: args.confidence ?? 75
          });
          if (npc) {
            npcs.push(npc);
          }
          const behavior = addNpcBehaviorIfNew(db, userId, conversation.id, args.npcName, {
            behaviorType: args.behaviorType || 'reaction',
            triggerCondition: args.triggerCondition || '',
            action: args.action || '',
            priority: args.priority ?? 0,
            enabled: args.enabled ?? true
          });
          if (behavior) {
            behaviors.push(behavior);
          }
          return { ok: true, behavior };
        }
        if (toolName === 'upsert_actor_item') {
          const item = upsertSceneItem(db, userId, conversation.id, { ...args, movable: true, auditActor: 'agent' });
          if (item) items.push(item);
          return { ok: Boolean(item), item };
        }
        if (toolName === 'delete_actor_item') {
          const item = findWorkspaceItem(sceneWorkspace.items, args);
          const deleted = item
            ? deleteSceneEntity(db, userId, conversation.id, 'item', item.id, { actor: 'agent' })
            : false;
          return { ok: deleted, deletedId: deleted ? item.id : '' };
        }
        return { ok: false, error: `Unsupported tool: ${toolName}` };
      },
      { maxRounds: 3, thinkingEnabled: false, signal }
    ).catch((error) => {
      logAccessoryAgentFailure('npc', error);
      return null;
    });
  }

  return { npcs, memories: recorded, behaviors, items };
}

async function runAgentSequence(factories = []) {
  const results = [];
  for (const factory of factories) {
    results.push(await factory());
  }
  return results;
}

async function runEconomyAgent({ db, userId, conversation, assistantMessage, observationWindow, settings, skill, signal }) {
  const transactions = [];

  if (hasUsableProvider(settings)) {
    await runToolCompletion(
      withModelOverride(settings, skill),
      buildEconomyMessages(observationWindow),
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
      { maxRounds: 3, thinkingEnabled: false, signal }
    ).catch((error) => {
      logAccessoryAgentFailure('economy', error);
      return null;
    });
  }

  if (!transactions.length) {
    transactions.push(...processTransactionIntents(db, userId, conversation.id, assistantMessage.content));
  }

  return { transactions };
}

async function runSceneAgent({ db, userId, conversation, character, assistantMessage, observationWindow, settings, skill, signal }) {
  const result = await completeSceneOrganization(withModelOverride(settings, skill), {
    database: db,
    userId,
    conversationId: conversation.id,
    conversation,
    character,
    requirement: '仅提取本轮明确出现或变化的场景、路线、房间布局和物品位置；已有物品位置变化时保留原 itemCode。',
    messages: [{ role: 'user', content: JSON.stringify(observationWindow) }],
    signal
  }).catch((error) => {
    logAccessoryAgentFailure('scene', error);
    return { ok: false, changes: [], error: error?.message || 'scene agent failed' };
  });
  return { ...result, workspace: listSceneWorkspace(db, userId, conversation.id) };
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

function logAccessoryAgentFailure(agentName, error) {
  console.error(`[accessory-agent:${agentName}] failed`, error);
}

function withModelOverride(settings, skill = {}) {
  return {
    ...settings,
    model: skill.modelOverride || settings.model
  };
}

function buildObservationWindow(userMessage, assistantMessage) {
  return {
    user: String(userMessage?.content || '').trim(),
    assistant: String(assistantMessage?.content || '').trim()
  };
}

function buildStatusBarMessages(statusBar, observationWindow, statusBarPrompt = '') {
  return [
    {
      role: 'system',
      content: [
        'You are a state bar updater for a roleplay chat.',
        'Use only the current turn observation window as evidence for changes.',
        'Call update_status_bar only when the current turn clearly changes one or more variables.',
        'Call skip_status_bar_update when no status value should change, and do not write explanatory prose instead.',
        'Do not convert world lore, prior history, plans, examples, hypotheticals, or unchanged state into status updates.',
        'The variable value can be a number for meters or a short string for profile/status text.',
        'Pay close attention to short text fields for outfit, clothing, equipment, carried items, location, mood, and memory.',
        'Template rows may combine multiple child variables, for example "Location = {{Region}} > {{Place}}".',
        'Use templateHints.compositeRows as the map from visible row labels to child variable names.',
        'For composite rows, update the child variables separately and never update the wrapper label as a value.',
        'Example: for "Location = {{Region}} > {{Place}}", update Region and Place separately when the reply names both.',
        'For each changed text field, return only the new field value, not surrounding prose, separators, or template markup.',
        'Never return raw placeholder text like "{{Variable}}" as a variable value.',
        'If the reply only gives one clear part of a composite row, update only that child variable and preserve the rest.',
        'Update only the named entries that changed. Never rewrite, reorder, rename, or remove unrelated variables.',
        'You may create a new variable only when the author/session guidance explicitly requests that named variable.',
        'Do not invent changes.',
        statusBarPrompt ? `Additional author/session guidance:\n${statusBarPrompt}` : ''
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        variables: statusBar.variables,
        template: statusBar.template || '',
        templateHints: buildStatusBarTemplateHints(statusBar.template || ''),
        observationWindow,
        reply: observationWindow.assistant
      })
    }
  ];
}

function buildStatusBarTemplateHints(template = '') {
  const raw = String(template || '').trim();
  if (!raw || raw[0] === '{') {
    return { compositeRows: [], placeholders: [] };
  }
  return {
    compositeRows: extractStatusTemplateCompositeRows(raw).slice(0, 20),
    placeholders: extractStatusTemplatePlaceholderNames(raw).slice(0, STATUS_BAR_VARIABLE_LIMIT)
  };
}

function extractStatusTemplateCompositeRows(template = '') {
  const rows = [];
  const seen = new Set();
  const addRow = (rawLabel, rawValue) => {
    const label = normalizeStatusTemplateText(rawLabel).slice(0, 60);
    const key = statusVariableKey(label);
    if (!label || !key || seen.has(key)) {
      return;
    }
    const variables = extractStatusTemplatePlaceholderNames(rawValue, label).slice(0, 8);
    if (variables.length < 2) {
      return;
    }
    rows.push({ label, variables });
    seen.add(key);
  };

  const pairPattern = /<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-label\b[^'"]*\1[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,180}?<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\3[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match;
  while ((match = pairPattern.exec(String(template || '')))) {
    addRow(match[2], match[4]);
  }

  const inlineValuePattern = /(?:^|>|\n)([^<>\n]{1,40}?)[\s:\uFF1A]+<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\2[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = inlineValuePattern.exec(String(template || '')))) {
    addRow(match[1], match[3]);
  }
  return rows;
}

function extractStatusTemplatePlaceholderNames(value = '', label = '') {
  const names = [];
  const seen = new Set();
  const labelKey = statusVariableKey(label);
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(normalizeStatusTemplateText(value)))) {
    const token = String(match[1] || match[2] || '').trim();
    const parsed = parseStatusTemplateToken(token);
    const rawProperty = parsed.rawProperty.trim() || 'value';
    const name = normalizeStatusTemplateText(parsed.rawName.trim()).slice(0, 60);
    const key = statusVariableKey(name);
    if (!name || !key || key === labelKey || seen.has(key) || isMeterTemplateProperty(rawProperty)) {
      continue;
    }
    names.push(name);
    seen.add(key);
  }
  return names;
}

function isMeterTemplateProperty(value = '') {
  return ['max', 'percent', 'percentage'].includes(String(value || '').trim());
}

function normalizeStatusTemplateText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNpcMessages(character, observationWindow, sceneWorkspace = {}) {
  return [
    {
      role: 'system',
      content: [
        'You are an NPC management assistant for a roleplay chat.',
        'Use only the current turn observation window as evidence for NPC updates.',
        'Call upsert_npc for named side characters that clearly appear in the current turn.',
        'Update currentLocation when the current turn clearly places or moves an NPC. Use concise physical locations, and do not infer a location from vague presence.',
        'Update status when the current turn clearly says an NPC left, permanently left, died, is on a mission, follows, or has another stable custom state.',
        'Aliases are exact alternate ways this same individual is called. Stable nicknames or titles count only when they uniquely identify this NPC. Generic roles, vague references, pronouns, and group labels do not count.',
        'Call record_npc_memory only when there is a concise useful memory about that side character.',
        'Prefer record_npc_memory for observations, facts, relationship changes, opinions, emotions, and events.',
        'Do not convert world lore, prior history, plans, examples, or unchanged state into NPC memory.',
        'Call record_npc_behavior only for explicit, stable, reusable future rules with a clear trigger condition.',
        'Do not create behavior rules for ordinary dialogue, one-time actions, temporary moods, scene movement, or details already covered by memory.',
        'When unsure, skip record_npc_behavior because too many behavior rules can over-constrain the character.',
        'Skip the main character, user/player, generic section titles, status panels, and markdown headings.',
        'Do not report narrative fragments, pronouns, or UI labels as NPCs.',
        'Call upsert_actor_item only for explicit current-turn possession, transfer, dropping, clothing, dressing, or undressing changes involving the protagonist or an NPC.',
        'Reuse an existing id or itemCode for the same physical item. One item must never be copied to multiple owners.',
        'Use ownerType=world with an exact existing nodeId when an item is dropped or left in the scene. Call delete_actor_item only when an item is explicitly consumed, destroyed, or confirmed to no longer exist.',
        'For clothing, update one entry at a time and set slot, equipped, and coverage. A dress or long top covering groin/buttocks hides lower underwear; underwear is visible when no higher layer covers it.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        mainCharacter: character?.name || '',
        existingItems: Array.isArray(sceneWorkspace.items) ? sceneWorkspace.items : [],
        sceneNodes: Array.isArray(sceneWorkspace.nodes) ? sceneWorkspace.nodes : [],
        observationWindow,
        reply: observationWindow.assistant
      })
    }
  ];
}

function actorItemTool() {
  return {
    type: 'function',
    function: {
      name: 'upsert_actor_item',
      description: 'Create or update one uniquely identified protagonist/NPC item when the current turn explicitly changes possession or clothing state.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          itemCode: { type: 'string' },
          ownerType: { type: 'string', enum: ['world', 'protagonist', 'npc'] },
          ownerName: { type: 'string' },
          nodeId: { type: 'string', description: 'Required when ownerType is world.' },
          name: { type: 'string' },
          description: { type: 'string' },
          itemKind: { type: 'string', enum: ['item', 'clothing'] },
          quantity: { type: 'integer', minimum: 1 },
          clothingSlot: { type: 'string', enum: ['upper_underwear', 'lower_underwear', 'top', 'bottom', 'socks', 'shoes', 'outfit'] },
          equipped: { type: 'boolean' },
          coverage: { type: 'array', items: { type: 'string', enum: ['chest', 'abdomen', 'groin', 'buttocks', 'thighs', 'legs', 'feet'] }, uniqueItems: true },
          iconKey: { type: 'string', enum: PIXEL_ICON_KEYS },
          state: { type: 'object' }
        },
        required: ['ownerType', 'name', 'itemKind', 'iconKey']
      }
    }
  };
}

function actorItemDeleteTool() {
  return {
    type: 'function',
    function: {
      name: 'delete_actor_item',
      description: 'Delete one existing item only when the current turn explicitly consumes, destroys, or removes it from existence.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          itemCode: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    }
  };
}

function findWorkspaceItem(items, args = {}) {
  const id = String(args.id || '').trim();
  const itemCode = String(args.itemCode || '').trim();
  for (const item of Array.isArray(items) ? items : []) {
    if ((id && item.id === id) || (itemCode && item.itemCode === itemCode)) return item;
  }
  return null;
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
          confidence: { type: 'number', description: '0-100 confidence that this is a real side character name.' },
          status: { type: 'string', enum: ['active', 'left', 'permanently_left', 'dead', 'on_mission', 'following', 'custom'] },
          customStatus: { type: 'string' },
          currentLocation: { type: 'string', description: 'Concise current physical location if the reply clearly places or moves this NPC.' },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exact alternate proper names, stable nicknames, or unique titles for the same NPC.'
          },
          memorySealed: { type: 'boolean', description: 'Set true only when status is dead or permanently_left and stored memories should be omitted from main replies for token saving.' }
        },
        required: ['npcName', 'evidence']
      }
    }
  };
}

function npcBehaviorTool() {
  return {
    type: 'function',
    function: {
      name: 'record_npc_behavior',
      description: 'Record a rare explicit, stable reusable future behavior rule with a clear trigger for an NPC side character.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          npcName: { type: 'string' },
          behaviorType: { type: 'string', enum: ['reaction', 'dialogue', 'action', 'emotion', 'movement'] },
          triggerCondition: { type: 'string' },
          action: { type: 'string' },
          priority: { type: 'number', description: '0-100 importance. Higher rules are injected first.' },
          enabled: { type: 'boolean' }
        },
        required: ['npcName', 'action']
      }
    }
  };
}

function buildEconomyMessages(observationWindow) {
  return [
    {
      role: 'system',
      content: [
        'You extract explicit economy transactions from a roleplay reply.',
        'Use only the current turn observation window as evidence for transactions.',
        'Call record_economy_transaction only for clear gains, spending, rewards, penalties, trades, or transfers in the current turn.',
        'Do not convert world lore, prior history, plans, examples, hypotheticals, or unchanged balances into transactions.',
        'If no transaction is explicit, do not call a tool.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        observationWindow,
        reply: observationWindow.assistant
      })
    }
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

function statusBarSkipTool() {
  return {
    type: 'function',
    function: {
      name: 'skip_status_bar_update',
      description: 'Confirm that the reply does not require any status bar variable update.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reason: {
            type: 'string',
            maxLength: 160,
            description: 'Optional short reason for skipping the status update.'
          }
        }
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
  const normalized = [];
  const sourceVariables = Array.isArray(args.variables) ? args.variables : [];
  for (let index = 0; index < sourceVariables.length && normalized.length < STATUS_BAR_VARIABLE_LIMIT; index += 1) {
    const item = sourceVariables[index];
    const value = normalizeStatusValue(item?.value);
    const name = String(item?.name || '').trim();
    if (!name || value === '') {
      continue;
    }
    normalized.push({
      name,
      value,
      ...(Number.isFinite(Number(item?.max)) ? { max: Number(item.max) } : {}),
      ...(typeof item?.color === 'string' && item.color.trim() ? { color: item.color.trim() } : {})
    });
  }
  return normalized;
}

function statusUpdatesChangeVariables(variables = [], updates = []) {
  const current = new Map();
  for (const variable of Array.isArray(variables) ? variables : []) {
    const key = statusVariableKey(variable?.name);
    if (key) {
      current.set(key, variable);
    }
  }
  for (const update of Array.isArray(updates) ? updates : []) {
    const key = statusVariableKey(update?.name);
    if (!key) {
      continue;
    }
    const variable = current.get(key);
    if (!variable || !Object.is(variable.value, update.value)) {
      return true;
    }
    if (Number.isFinite(Number(update.max)) && !Object.is(variable.max, Number(update.max))) {
      return true;
    }
    if (typeof update.color === 'string' && update.color.trim() && variable.color !== update.color.trim()) {
      return true;
    }
  }
  return false;
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
    content,
    auditActor: 'agent'
  });
}

function addNpcBehaviorIfNew(db, userId, conversationId, npcName, payload) {
  const name = String(npcName || '').trim().slice(0, 80);
  const action = String(payload?.action || '').trim();
  const triggerCondition = String(payload?.triggerCondition || '').trim();
  if (!name || !action || !triggerCondition) {
    return null;
  }
  if (isConversationNpcHidden(db, conversationId, name)) {
    return null;
  }
  if (countNpcBehaviors(db, conversationId, name) >= AUTO_NPC_BEHAVIOR_LIMIT) {
    return null;
  }
  const existing = db
    .prepare(
      `SELECT id FROM npc_behaviors
       WHERE conversation_id = ? AND npc_name = ? AND trigger_condition = ? AND action = ?
       LIMIT 1`
    )
    .get(conversationId, name, triggerCondition, action);
  if (existing) {
    return null;
  }
  return addNpcBehavior(db, userId, conversationId, name, {
    behaviorType: payload.behaviorType || 'reaction',
    triggerCondition,
    action,
    priority: payload.priority ?? 0,
    enabled: payload.enabled ?? true,
    auditActor: 'agent'
  });
}

function countNpcBehaviors(db, conversationId, npcName) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM npc_behaviors
       WHERE conversation_id = ? AND npc_name = ?`
    )
    .get(conversationId, npcName);
  return Number(row?.count || 0);
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
    confidence: Number.isFinite(Number(args.confidence)) ? Number(args.confidence) : 75,
    status: args.status,
    customStatus: args.customStatus,
    currentLocation: args.currentLocation,
    aliases: args.aliases,
    memorySealed: args.memorySealed
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
