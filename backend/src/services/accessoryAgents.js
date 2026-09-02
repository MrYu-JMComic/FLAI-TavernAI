import { normalizeAccessorySkills, isAccessorySkillActive, normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { processTransactionIntents, createConversationTransaction } from '../modules/economy.js';
import { STATUS_BAR_VARIABLE_LIMIT, extractVariablesFromText, updateStatusBarVariables, upsertStatusBar } from '../modules/statusBars.js';
import { detectSceneAndEmotion, findBestMatch, listCharacterImages } from '../modules/characterImages.js';
import { listSceneWorkspace } from '../modules/scenes.js';
import { completeSceneOrganization } from './sceneOrganizer.js';
import { hasUsableProvider, runToolCompletion } from './providers.js';
import { parseStatusTemplateToken } from '../../../shared/statusTemplateTokens.js';
import { createQuest, listQuests, updateQuestObjective } from '../modules/quests.js';
import { advanceWorldTime, getWorldClock, setWorldWeather } from '../modules/dynamicWorld.js';
import { performSkillCheck } from '../modules/skillChecks.js';
import { recordWorldEvent } from '../modules/worldEvents.js';
import { discoverTravelNode, getTravelMap, travelToNode } from '../modules/travel.js';
import { listRewardGrants, proposeRewardGrant } from '../modules/rewards.js';

const agentTimeoutMs = 60000;
const statusBarAgentTimeoutMs = 60000;
const agentAbortGraceMs = 5000;

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
  let sceneAgentFactory = null;
  let worldDirectorFactory = null;
  const observationWindow = buildObservationWindow(userMessage, assistantMessage);

  if (active.statusBarAgent) {
    jobs.push(runAgentJob(
      'statusBarAgent',
      skills.statusBarAgent,
      emit,
      (signal) => runStatusBarAgent({
        db,
        userId,
        conversation,
        assistantMessage,
        observationWindow,
        settings,
        statusBar,
        skill: skills.statusBarAgent,
        signal
      }),
      { timeoutMs: statusBarAgentTimeoutMs }
    ));
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
  if (active.worldDirector) {
    worldDirectorFactory = () => runAgentJob('worldDirector', skills.worldDirector, emit, (signal) =>
      runWorldDirectorAgent({ db, userId, conversation, character, observationWindow, settings, skill: skills.worldDirector, travelEnabled: active.gameHud, encounterEnabled: active.encounterMode, rewardEnabled: active.rewardMode, signal })
    );
  }
  // State agents share scene, item, appearance, and memory records, so keep
  // their writes deterministic instead of racing last-writer-wins updates.
  const stateAgentFactories = [];
  if (sceneAgentFactory) stateAgentFactories.push(sceneAgentFactory);
  if (worldDirectorFactory) stateAgentFactories.push(worldDirectorFactory);
  if (stateAgentFactories.length) jobs.push(runAgentSequence(stateAgentFactories));

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

async function runAgentJob(skill, config, emit, handler, options = {}) {
  emit?.('skill_start', { skill, model: config?.modelOverride || '' });
  // Abort the in-flight provider call at the deadline so the handler can fall
  // through to its cheap non-AI fallback; the outer race is only a backstop
  // for anything that ignores the signal.
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Number(options.timeoutMs))
    : agentTimeoutMs;
  const abortTimer = setTimeout(() => {
    controller.abort(new Error(`${skill} timed out`));
  }, timeoutMs);
  let payload;
  try {
    const result = await withTimeout(handler(controller.signal), timeoutMs + agentAbortGraceMs, `${skill} timed out`);
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
  const advancedSettings = normalizeAdvancedSettings(conversation?.settings || {});
  const statusBarPrompt = advancedSettings.statusBarPrompt;
  const statusBarBlueprint = advancedSettings.statusBarBlueprint;
  const currentStatusBar = statusBar || createStatusBarFromBlueprint(statusBarBlueprint);
  if (!currentStatusBar.variables.length && !statusBarPrompt) {
    return { statusBar: null, updates: [] };
  }
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
          return { ok: true, updates, stop: true };
        }
        return { ok: false, error: `Unsupported tool: ${toolName}` };
      },
      {
        maxRounds: 2,
        thinkingEnabled: false,
        signal,
        database: db,
        userId,
        onNoToolCall: statusBarNoToolNudge
      }
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
        variables: mergeStatusVariablesForCreation(currentStatusBar.variables, updates),
        template: currentStatusBar.template
      });
  return { statusBar: nextStatusBar, updates };
}

function createStatusBarFromBlueprint(blueprint = {}) {
  return {
    name: String(blueprint?.name || '').trim() || '状态栏',
    variables: Array.isArray(blueprint?.variables) ? blueprint.variables : [],
    template: String(blueprint?.template || '')
  };
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
      { maxRounds: 3, thinkingEnabled: false, signal, database: db, userId }
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
    requirement: '仅把本轮 assistant 回复明确确认的新事实或状态变化写入场景资料；用户输入中的计划、尝试和假设不算已发生。更新已有物品时必须复用原 id 或 itemCode。',
    messages: [{ role: 'user', content: JSON.stringify(observationWindow) }],
    signal
  }).catch((error) => {
    logAccessoryAgentFailure('scene', error);
    return { ok: false, changes: [], error: error?.message || 'scene agent failed' };
  });
  return { ...result, workspace: listSceneWorkspace(db, userId, conversation.id) };
}

async function runWorldDirectorAgent({ db, userId, conversation, character, observationWindow, settings, skill, travelEnabled, encounterEnabled, rewardEnabled, signal }) {
  const executions = [];
  if (!hasUsableProvider(settings)) return { executions, skipped: true, reason: 'provider unavailable' };
  const context = {
    character: { name: character?.name || '' },
    clock: getWorldClock(db, userId, conversation.id),
    quests: listQuests(db, userId, conversation.id, { status: 'active' }) || [],
    scene: listSceneWorkspace(db, userId, conversation.id),
    travelMap: travelEnabled ? getTravelMap(db, userId, conversation.id) : null,
    pendingRewards: rewardEnabled ? listRewardGrants(db, userId, conversation.id, { status: 'pending' }) : []
  };
  await runToolCompletion(
    withModelOverride(settings, skill),
    buildWorldDirectorMessages(observationWindow, context),
    worldDirectorTools({ travelEnabled, encounterEnabled, rewardEnabled }),
    async (toolName, args) => executeWorldDirectorProposal({ db, userId, conversationId: conversation.id, character, toolName, args, executions, travelEnabled, encounterEnabled, rewardEnabled }),
    { maxRounds: 6, thinkingEnabled: false, signal, database: db, userId }
  ).catch((error) => {
    logAccessoryAgentFailure('world-director', error);
    executions.push({ tool: 'provider', ok: false, error: error?.message || 'world director failed' });
    return null;
  });
  let rejectedCount = 0;
  for (const execution of executions) if (!execution.ok) rejectedCount += 1;
  return { executions, rejectedCount };
}

function buildWorldDirectorMessages(observationWindow, context) {
  return [
    {
      role: 'system',
      content: [
        '你是 AI 世界导演，只能通过提供的结构化工具提交本轮 assistant 回复明确确认的规则变化。',
        '用户的计划、假设、命令或尝试不代表已经发生；没有明确变化时不要调用工具。',
        '不得提供或伪造骰点，骰点由服务器生成。不得绕过任务、路线或时间规则。',
        '工具失败时保留失败结果，不得换用其他工具规避同一规则。'
      ].join('\n')
    },
    { role: 'user', content: JSON.stringify({ turn: observationWindow, currentWorld: context }) }
  ];
}

export async function executeWorldDirectorProposal({ db, userId, conversationId, character, toolName, args, executions = [], travelEnabled = false, encounterEnabled = false, rewardEnabled = false }) {
  let result = null;
  let error = '';
  if (toolName === 'create_quest') {
    result = createQuest(db, userId, conversationId, { ...args, source: 'world-director' });
    if (!result) error = '任务数据无效';
  } else if (toolName === 'advance_quest_objective') {
    const quests = listQuests(db, userId, conversationId) || [];
    const quest = quests.find(item => item.id === args.questId);
    const objective = quest?.objectives?.find(item => item.id === args.objectiveId);
    if (!objective) error = '任务目标不存在';
    else result = updateQuestObjective(db, userId, conversationId, quest.id, objective.id, {
      currentValue: objective.currentValue + Math.max(1, Math.trunc(Number(args.delta || 1))), source: 'world-director'
    });
  } else if (toolName === 'advance_world_time') {
    result = advanceWorldTime(db, userId, conversationId, { minutes: args.minutes, source: 'world-director' });
    if (!result) error = '时间推进失败';
  } else if (toolName === 'set_world_weather') {
    result = setWorldWeather(db, userId, conversationId, args.weather, 'world-director');
    if (!result) error = '天气无效';
  } else if (toolName === 'request_skill_check') {
    result = performSkillCheck(db, userId, conversationId, {
      actorName: args.actorName || character?.name || '', skill: args.skill, difficulty: args.difficulty,
      modifier: args.modifier, context: args.context, source: 'world-director'
    });
    if (!result) error = '检定数据无效';
  } else if (toolName === 'discover_location' || toolName === 'travel_to_location') {
    if (!travelEnabled) error = '地图与旅行功能已关闭';
    else if (toolName === 'discover_location') {
      const discovered = discoverTravelNode(db, userId, conversationId, args.nodeId, 'world-director');
      result = discovered.ok ? discovered : null;
      error = discovered.ok ? '' : discovered.error;
    } else {
      const traveled = travelToNode(db, userId, conversationId, { destinationNodeId: args.destinationNodeId, source: 'world-director' });
      result = traveled.ok ? traveled : null;
      error = traveled.ok ? '' : traveled.error;
    }
  } else if (toolName === 'propose_reward') {
    if (!rewardEnabled) error = '奖励功能已关闭';
    else {
      const proposed = proposeRewardGrant(db, userId, conversationId, { ...args, source: 'world-director' });
      result = proposed.ok ? proposed.grant : null;
      error = proposed.ok ? '' : proposed.error;
    }
  } else {
    error = `Unsupported tool: ${toolName}`;
  }
  const execution = { tool: toolName, ok: Boolean(result), ...(result ? { result } : { error: error || '规则拒绝了该提案' }) };
  executions.push(execution);
  if (!execution.ok) recordWorldEvent(db, userId, conversationId, {
    eventType: 'director.action.rejected', source: 'world-director', title: `导演提案被拒绝：${toolName}`,
    detail: execution.error, entityType: 'director_action', entityId: toolName, severity: 'warning', payload: { arguments: args }
  });
  return execution;
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
        '你是角色扮演对话的结构化状态栏更新器。只能通过 update_status_bar 或 skip_status_bar_update 返回结果，不要输出解释性正文。',
        '证据范围仅限 observationWindow：user 是本轮用户输入，assistant 是已经生成的剧情结果。状态变化通常必须由 assistant 明确确认；用户的计划、命令、尝试或假设本身不代表已经发生。',
        'statusBarPrompt 只定义要跟踪的字段和判断规则，不是本轮变化证据。variables 是更新前状态；templateHints 只描述展示结构。',
        '只有当前轮明确产生新状态时才调用 update_status_bar；未变化、无法确认、仅重复旧状态或只有历史回顾时调用 skip_status_bar_update。两种工具每轮只调用一种。',
        '不得把世界设定、旧历史、计划、示例、假设、否定内容、占位符或模板文字写成当前值。',
        '数值量表使用 number；姓名、服装、装备、携带物、地点、心情、事件摘要等文本字段使用简短 string。文本值只包含最终字段值，不带标签、解释、分隔符或模板标记。',
        '复合行例如“Location = {{Region}} > {{Place}}”只是展示包装。根据 templateHints.compositeRows 分别更新 Region、Place；绝不能把 Location 包装标签作为子变量值。',
        '若本轮只确认复合行的一部分，只更新对应子变量，保留其余值。',
        '只提交真正变化的变量。不得重排、重命名、删除或重复提交未变化变量。只有 statusBarPrompt 明确要求某个新变量名时才允许创建该变量。',
        statusBarPrompt ? `作者/会话字段规则（仅定义跟踪方式）：\n${statusBarPrompt}` : ''
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        variables: statusBar.variables,
        templateHints: buildStatusBarTemplateHints(statusBar.template || ''),
        observationWindow,
        reply: observationWindow.assistant
      })
    }
  ];
}

function statusBarNoToolNudge() {
  return [
    '你尚未调用状态栏工具。不要输出解释、分析、Markdown 或 JSON 正文。',
    '若 observationWindow 明确确认了任一变量的新值，立即调用 update_status_bar，且只提交发生变化的变量。',
    '若没有任何可确认变化，立即调用 skip_status_bar_update。现在必须且只能调用其中一个工具。'
  ].join('\n');
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

function buildEconomyMessages(observationWindow) {
  return [
    {
      role: 'system',
      content: [
        '你是角色扮演对话的结构化经济流水记录器。只通过 record_economy_transaction 记录本轮已完成的交易，不输出正文。',
        '证据范围仅限 observationWindow：user 是用户意图，assistant 是剧情结果。报价、计划、尝试购买、谈判、假设和未完成承诺都不是已完成交易，除非 assistant 明确确认钱款或资产已经变化。',
        '只记录本轮明确完成的收入、支出、奖励、惩罚、交易或转账。amount 填正数金额，type 决定收入或扣款方向；currencyType 必须与文本明确货币一致。',
        'description 简短说明本次交易原因；relatedNpc 只在交易明确关联某个 NPC 时填写。',
        '不得把世界设定、旧历史、示例、假设、价格信息或未变化余额写成交易。没有明确完成的交易时不要调用工具。'
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
      description: 'Write only status variables whose current values clearly changed in this turn. Omit unchanged variables and wrapper labels.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: {
                  anyOf: [
                    { type: 'number' },
                    { type: 'string', maxLength: 200 }
                  ]
                },
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
      description: 'Use when this turn contains no confirmed status-variable change. This is mutually exclusive with update_status_bar.',
      parameters: {
        type: 'object',
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

function economyTool() {
  return {
    type: 'function',
    function: {
      name: 'record_economy_transaction',
      description: 'Record one completed economy transaction confirmed by the assistant reply. amount is a positive magnitude; type controls balance direction.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', minimum: 0.0001 },
          type: { type: 'string', enum: ['income', 'expense', 'transfer', 'reward', 'penalty', 'trade'] },
          currencyType: { type: 'string', enum: ['gold', 'silver', 'copper', 'gem', 'credit'] },
          description: { type: 'string' },
          relatedNpc: { type: 'string' }
        },
        required: ['amount', 'type', 'currencyType']
      }
    }
  };
}

function worldDirectorTools(options = {}) {
  const tools = [
    directorTool('create_quest', 'Create a quest only when the assistant reply explicitly establishes a new actionable objective.', {
      title: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 2000 },
      priority: { type: 'integer', minimum: -100, maximum: 100 },
      objectives: { type: 'array', maxItems: 12, items: { type: 'object', properties: { description: { type: 'string', maxLength: 500 }, targetValue: { type: 'integer', minimum: 1, maximum: 1000000 } }, required: ['description'] } }
    }, ['title']),
    directorTool('advance_quest_objective', 'Advance an existing objective only when this turn confirms measurable progress.', {
      questId: { type: 'string' }, objectiveId: { type: 'string' }, delta: { type: 'integer', minimum: 1, maximum: 1000000 }
    }, ['questId', 'objectiveId']),
    directorTool('advance_world_time', 'Advance time only when the assistant reply explicitly confirms elapsed time.', {
      minutes: { type: 'integer', minimum: 1, maximum: 1440 }
    }, ['minutes']),
    directorTool('set_world_weather', 'Set weather only when the assistant reply explicitly confirms a weather change.', {
      weather: { type: 'string', maxLength: 80 }
    }, ['weather']),
    directorTool('request_skill_check', 'Request a trusted server-side d20 check. Never include a roll or outcome.', {
      actorName: { type: 'string', maxLength: 120 }, skill: { type: 'string', maxLength: 100 },
      difficulty: { type: 'integer', minimum: 2, maximum: 40 }, modifier: { type: 'integer', minimum: -20, maximum: 20 },
      context: { type: 'string', maxLength: 1000 }
    }, ['skill', 'difficulty'])
  ];
  if (options.travelEnabled) {
    tools.push(
      directorTool('discover_location', 'Reveal an existing scene node on the player map only when this turn explicitly discovers it.', { nodeId: { type: 'string' } }, ['nodeId']),
      directorTool('travel_to_location', 'Move the player only through a directly available server-validated route. Travel time is computed by the server.', { destinationNodeId: { type: 'string' } }, ['destinationNodeId'])
    );
  }
  if (options.rewardEnabled) {
    tools.push(directorTool('propose_reward', 'Propose one bounded reward for a server-confirmed encounter victory or completed quest. The player claims it separately; never invent negative or duplicate quantities.', {
      sourceType: { type: 'string', enum: ['encounter', 'quest'] }, sourceId: { type: 'string' }, title: { type: 'string', maxLength: 200 },
      rewards: { type: 'object', properties: {
        currency: { type: 'array', maxItems: 5, items: { type: 'object', properties: { currencyType: { type: 'string', enum: ['gold','silver','copper','gem','credit'] }, amount: { type: 'integer', minimum: 1, maximum: 1000000 } }, required: ['currencyType','amount'] } },
        items: { type: 'array', maxItems: 20, items: { type: 'object', properties: { itemCode: { type: 'string', maxLength: 80 }, name: { type: 'string', maxLength: 160 }, quantity: { type: 'integer', minimum: 1, maximum: 9999 }, description: { type: 'string', maxLength: 1000 }, iconKey: { type: 'string', maxLength: 80 } }, required: ['itemCode','name','quantity'] } },
        questProgress: { type: 'array', maxItems: 12, items: { type: 'object', properties: { questId: { type: 'string' }, objectiveId: { type: 'string' }, delta: { type: 'integer', minimum: 1, maximum: 1000000 } }, required: ['questId','objectiveId','delta'] } },
        growthPoints: { type: 'integer', minimum: 0, maximum: 1000000 }
      } }
    }, ['sourceType','sourceId','rewards']));
  }
  return tools;
}

function directorTool(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
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

function mergeStatusVariablesForCreation(variables = [], updates = []) {
  const updateByKey = new Map();
  for (const update of Array.isArray(updates) ? updates : []) {
    const key = statusVariableKey(update?.name);
    if (key) {
      updateByKey.set(key, update);
    }
  }

  const merged = [];
  const seen = new Set();
  for (const variable of Array.isArray(variables) ? variables : []) {
    const key = statusVariableKey(variable?.name);
    if (!key || seen.has(key)) {
      continue;
    }
    const update = updateByKey.get(key);
    merged.push(update ? { ...variable, ...update, name: variable.name } : variable);
    seen.add(key);
  }
  for (const update of Array.isArray(updates) ? updates : []) {
    const key = statusVariableKey(update?.name);
    if (!key || seen.has(key)) {
      continue;
    }
    merged.push(update);
    seen.add(key);
  }
  return merged;
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

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
