import { runToolCompletion, streamToolCompletion } from './providers.js';
import { cloneToolCalls, nullToEmptyObject, objectOrEmpty } from './assistantUtils.js';
import {
  addNpcBehavior,
  addNpcMemory,
  deleteNpcBehavior,
  deleteNpcMemory,
  hideConversationNpc,
  listConversationNpcs,
  listNpcBehaviors,
  listNpcMemories,
  updateConversationNpc,
  updateNpcBehavior,
  updateNpcMemory
} from '../modules/npcs.js';
import { deleteSceneEntity, listActorItems, listSceneWorkspace, upsertSceneItem } from '../modules/scenes.js';
import { PIXEL_ICON_KEYS } from '../../../shared/pixelIconCatalog.js';

const NPC_CONTEXT_LIMIT = 24;
const NPC_DETAIL_LIMIT = 18;
const RECENT_MESSAGE_LIMIT = 30;

const npcStatusValues = ['active', 'left', 'permanently_left', 'dead', 'on_mission', 'following', 'custom'];
const memoryTypeValues = ['event', 'relationship', 'opinion', 'knowledge', 'emotion'];
const behaviorTypeValues = ['reaction', 'dialogue', 'action', 'emotion', 'movement'];
const clothingSlotValues = ['upper_underwear', 'lower_underwear', 'top', 'bottom', 'socks', 'shoes', 'outfit'];
const bodyRegionValues = ['chest', 'abdomen', 'groin', 'buttocks', 'thighs', 'legs', 'feet'];

const npcOrganizerTools = [
  {
    type: 'function',
    function: {
      name: 'upsert_actor_item',
      description: 'Create or edit one uniquely identified item held by the protagonist or an NPC. Reuse id or itemCode for transfers and state changes. Never create copies for multiple owners. Clothing must be edited per entry with an exact slot, equipped state, and coverage.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          itemCode: { type: 'string' },
          ownerType: { type: 'string', enum: ['world', 'protagonist', 'npc'] },
          ownerName: { type: 'string' },
          nodeId: { type: 'string', description: 'Required when ownerType is world.' },
          name: { type: 'string' },
          description: { type: 'string' },
          itemKind: { type: 'string', enum: ['item', 'clothing'] },
          quantity: { type: 'integer', minimum: 1, maximum: 999999 },
          clothingSlot: { type: 'string', enum: clothingSlotValues },
          equipped: { type: 'boolean' },
          coverage: { type: 'array', items: { type: 'string', enum: bodyRegionValues }, uniqueItems: true },
          iconKey: { type: 'string', enum: PIXEL_ICON_KEYS },
          state: { type: 'object' }
        },
        required: ['ownerType', 'name', 'itemKind', 'iconKey'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_actor_item',
      description: 'Delete one incorrect or duplicate actor item by its internal id. Never delete merely because an item was transferred; transfer by updating the same entry instead.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          ownerType: { type: 'string', enum: ['protagonist', 'npc'] },
          ownerName: { type: 'string' }
        },
        required: ['id', 'ownerType'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upsert_npc_profile',
      description: 'Create or update an NPC profile: status, current location, relationship summary, aliases, memory seal, confidence, and evidence.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          status: { type: 'string', enum: npcStatusValues },
          customStatus: { type: 'string' },
          currentLocation: { type: 'string', description: 'The NPC current physical location. Use an empty string only to clear a wrong location.' },
          relationship: { type: 'string', description: 'A concise stable relationship summary, such as attitude, trust, allegiance, debt, rivalry, or connection to the protagonist or key cast.' },
          aliases: { type: 'array', items: { type: 'string' } },
          memorySealed: { type: 'boolean' },
          evidence: { type: 'string' },
          confidence: { type: 'integer', minimum: 0, maximum: 100 }
        },
        required: ['npcName'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'hide_npc_profile',
      description: 'Remove a false-positive or no-longer-useful NPC from the visible NPC list. This does not delete memories or behaviors.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' }
        },
        required: ['npcName'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_npc_memory',
      description: 'Add a concise memory grounded in the current conversation or existing NPC data.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          memoryType: { type: 'string', enum: memoryTypeValues },
          content: { type: 'string' }
        },
        required: ['npcName', 'content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_npc_memory',
      description: 'Edit an existing NPC memory by id. Use this for deduplication, correction, or clearer wording.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          memoryId: { type: 'string' },
          memoryType: { type: 'string', enum: memoryTypeValues },
          content: { type: 'string' }
        },
        required: ['npcName', 'memoryId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_npc_memory',
      description: 'Delete an existing NPC memory by id when it is empty, duplicate, stale, or clearly wrong.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          memoryId: { type: 'string' }
        },
        required: ['npcName', 'memoryId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_npc_behavior',
      description: 'Add a behavior rule that helps the main chat portray this NPC consistently.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          behaviorType: { type: 'string', enum: behaviorTypeValues },
          triggerCondition: { type: 'string' },
          action: { type: 'string' },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          enabled: { type: 'boolean' }
        },
        required: ['npcName', 'action'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_npc_behavior',
      description: 'Edit an existing behavior rule by id.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          behaviorId: { type: 'string' },
          behaviorType: { type: 'string', enum: behaviorTypeValues },
          triggerCondition: { type: 'string' },
          action: { type: 'string' },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          enabled: { type: 'boolean' }
        },
        required: ['npcName', 'behaviorId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_npc_behavior',
      description: 'Delete an existing behavior rule by id when it is duplicate, stale, or harmful to consistency.',
      parameters: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          behaviorId: { type: 'string' }
        },
        required: ['npcName', 'behaviorId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish_npc_organization',
      description: 'Finish after all useful NPC organization edits are complete, or when no edits are needed.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          changed: { type: 'boolean' }
        },
        required: ['summary'],
        additionalProperties: false
      }
    }
  }
];

export async function completeNpcOrganization(settings, request = {}) {
  const state = createNpcOrganizerState(request);
  const result = await runToolCompletion(
    settings,
    buildNpcOrganizerMessages(state),
    npcOrganizerTools,
    (name, args) => executeNpcOrganizerTool(name, args, state),
    { maxRounds: 80, thinkingEnabled: false, signal: state.signal, onNoToolCall: () => npcOrganizerNoToolNudge(state) }
  );

  return buildNpcOrganizerResult(state, result);
}

export async function streamNpcOrganization(settings, request = {}) {
  const state = createNpcOrganizerState(request);
  const result = await streamToolCompletion(
    settings,
    buildNpcOrganizerMessages(state),
    npcOrganizerTools,
    (name, args) => executeNpcOrganizerTool(name, args, state),
    state.emit,
    state.signal,
    { maxRounds: 80, thinkingEnabled: false, onNoToolCall: () => npcOrganizerNoToolNudge(state) }
  );

  return buildNpcOrganizerResult(state, result);
}

export function applyNpcOrganizerTool(database, userId, conversationId, name, args = {}, options = {}) {
  return executeNpcOrganizerTool(name, args, {
    database,
    userId,
    conversationId,
    selectedNpc: String(options.selectedNpc || '').trim(),
    selectedActorType: String(options.selectedActorType || '').trim(),
    finishSummary: ''
  });
}

function createNpcOrganizerState(request = {}) {
  const source = nullToEmptyObject(request);
  return {
    database: source.database,
    userId: source.userId,
    conversationId: source.conversationId,
    conversation: objectOrEmpty(source.conversation),
    character: objectOrEmpty(source.character),
    requirement: String(source.requirement || '').trim(),
    selectedNpc: String(source.selectedNpc || '').trim(),
    selectedActorType: String(source.selectedActorType || '').trim(),
    signal: source.signal,
    emit: typeof source.emit === 'function' ? source.emit : () => {},
    finishSummary: ''
  };
}

function buildNpcOrganizerMessages(state) {
  return [
    {
      role: 'system',
      content: [
        'You are the dedicated NPC organizer for FLAI Tavern AI.',
        'You must use tools to organize NPC profiles, current locations, relationship summaries, memories, and behavior rules; do not answer with prose only.',
        'Make small, reviewable edits. Preserve user-written data unless it is duplicate, empty, stale, contradictory, or clearly a false positive.',
        'Ground new memories and behavior rules in the current NPC data or recent conversation evidence.',
        'Use profile tools for current location, relationship summary, status, exact aliases, and memory sealing. Update current location only when evidence clearly moves or places the NPC. Update relationship only when the conversation gives stable evidence about attitude, trust, allegiance, debt, rivalry, or connection.',
        'Use memory tools for facts, relationships, opinions, knowledge, emotions, and events.',
        'Use behavior tools only for stable portrayal rules that should affect future chat replies.',
        'Use actor item tools for protagonist/NPC possessions and clothing. Every physical item has one stable itemCode and exactly one current owner. Transfer by updating the same entry, never by creating a second copy.',
        'Clothing slots are upper underwear, lower underwear, top, bottom/skirt, socks (including tights or pantyhose), shoes, and one-piece outfit. Coverage controls what observers can actually see; a dress or long top covering groin/buttocks hides lower underwear.',
        'Hide NPC profiles only for false positives or entries the user would not expect to see as NPCs.',
        state.selectedActorType === 'protagonist'
          ? 'Strict scope: modify only protagonist items and clothing. Never mutate an NPC profile, memory, or behavior.'
          : state.selectedNpc
          ? `Strict scope: modify only the selected NPC "${state.selectedNpc}". Never call a mutation tool for another NPC.`
          : 'No NPC is selected, so you may organize any NPC required by the user request.',
        'For Chinese roleplay, write concise polished Chinese content. Keep memories and behavior actions short enough to be useful in prompt context.',
        'When there is nothing useful to change, call finish_npc_organization with changed=false.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify(buildNpcOrganizerContext(state), null, 2)
    }
  ];
}

function buildNpcOrganizerContext(state) {
  return {
    requirement: state.requirement || '整理当前 NPC 资料、关系、记忆和行为，合并重复项，补足明显缺口，移除错误或空泛项。',
    selectedNpc: state.selectedNpc,
    selectedActorType: state.selectedActorType,
    conversation: {
      id: state.conversationId,
      title: state.conversation?.title || ''
    },
    character: {
      id: state.character?.id || state.conversation?.characterId || '',
      name: state.character?.name || state.conversation?.characterName || '',
      worldview: limitText(state.character?.worldview, 1200),
      persona: limitText(state.character?.persona, 1200)
    },
    npcs: buildNpcDetailRecords(state),
    protagonistItems: listActorItems(state.database, state.userId, state.conversationId, 'protagonist'),
    npcItems: state.selectedNpc ? listActorItems(state.database, state.userId, state.conversationId, 'npc', state.selectedNpc) : [],
    sceneNodes: listSceneWorkspace(state.database, state.userId, state.conversationId).nodes,
    recentMessages: listRecentMessages(state.database, state.userId, state.conversationId)
  };
}

function buildNpcDetailRecords(state) {
  const summaries = listConversationNpcs(
    state.database,
    state.userId,
    state.conversationId,
    state.character?.name || state.conversation?.characterName || ''
  );
  const records = [];
  const seen = new Set();
  if (state.selectedNpc) {
    pushNpcDetailRecord(records, seen, state, summaries, state.selectedNpc);
    return records;
  }
  for (const npc of summaries) {
    if (records.length >= NPC_CONTEXT_LIMIT) {
      break;
    }
    pushNpcDetailRecord(records, seen, state, summaries, npc?.name);
  }
  return records;
}

function pushNpcDetailRecord(records, seen, state, summaries, npcName) {
  const name = String(npcName || '').trim();
  const key = name.toLowerCase();
  if (!name || seen.has(key) || records.length >= NPC_CONTEXT_LIMIT) {
    return;
  }
  seen.add(key);
  const summary = findNpcSummary(summaries, name);
  if (!summary) {
    return;
  }
  records.push({
    ...summary,
    memories: limitNpcDetailRows(listNpcMemories(state.database, state.userId, state.conversationId, name)),
    behaviors: limitNpcDetailRows(listNpcBehaviors(state.database, state.userId, state.conversationId, name))
  });
}

function findNpcSummary(summaries, npcName) {
  for (const summary of Array.isArray(summaries) ? summaries : []) {
    if (summary?.name === npcName) {
      return summary;
    }
  }
  return null;
}

function limitNpcDetailRows(rows) {
  const limited = [];
  const sourceRows = Array.isArray(rows) ? rows : [];
  for (const row of sourceRows) {
    limited.push(row);
    if (limited.length >= NPC_DETAIL_LIMIT) {
      break;
    }
  }
  return limited;
}

function listRecentMessages(database, userId, conversationId) {
  const rows = database
    .prepare(
      `SELECT role, content, reasoning, created_at
       FROM messages
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(userId, conversationId, RECENT_MESSAGE_LIMIT);
  const messages = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    messages.push({
      role: row.role,
      content: limitText(row.content, 1800),
      reasoning: limitText(row.reasoning, 800),
      createdAt: row.created_at
    });
  }
  return messages;
}

function executeNpcOrganizerTool(name, args, state) {
  const toolArgs = objectOrEmpty(args);
  if (isNpcMutationTool(name) && !isNpcMutationInScope(toolArgs, state)) {
    return { ok: false, error: `Selected NPC scope only allows changes to ${state.selectedNpc}` };
  }
  if (name === 'upsert_npc_profile') {
    return upsertNpcProfileTool(toolArgs, state);
  }
  if (name === 'hide_npc_profile') {
    return hideNpcProfileTool(toolArgs, state);
  }
  if (name === 'add_npc_memory') {
    return addNpcMemoryTool(toolArgs, state);
  }
  if (name === 'update_npc_memory') {
    return updateNpcMemoryTool(toolArgs, state);
  }
  if (name === 'delete_npc_memory') {
    return deleteNpcMemoryTool(toolArgs, state);
  }
  if (name === 'add_npc_behavior') {
    return addNpcBehaviorTool(toolArgs, state);
  }
  if (name === 'update_npc_behavior') {
    return updateNpcBehaviorTool(toolArgs, state);
  }
  if (name === 'delete_npc_behavior') {
    return deleteNpcBehaviorTool(toolArgs, state);
  }
  if (name === 'upsert_actor_item') {
    return upsertActorItemTool(toolArgs, state);
  }
  if (name === 'delete_actor_item') {
    return deleteActorItemTool(toolArgs, state);
  }
  if (name === 'finish_npc_organization') {
    state.finishSummary = limitText(toolArgs.summary, 1000);
    return { ok: true, changed: toolArgs.changed === true, summary: state.finishSummary, stop: true };
  }
  return { ok: false, error: `Unknown NPC organizer tool: ${name}` };
}

function isNpcMutationTool(name) {
  return name !== 'finish_npc_organization' && name !== 'upsert_actor_item' && name !== 'delete_actor_item';
}

function isNpcMutationInScope(args, state) {
  if (state.selectedActorType === 'protagonist') {
    return false;
  }
  if (!state.selectedNpc) {
    return true;
  }
  return normalizeNpcScopeKey(args.npcName) === normalizeNpcScopeKey(state.selectedNpc);
}

function actorItemMutationInScope(args, state) {
  const existing = findActorItemForMutation(args, state);
  if (state.selectedActorType === 'protagonist') {
    return args.ownerType === 'protagonist' || existing?.ownerType === 'protagonist';
  }
  if (!state.selectedNpc) return true;
  const targetMatches = args.ownerType === 'npc'
    && normalizeNpcScopeKey(args.ownerName) === normalizeNpcScopeKey(state.selectedNpc);
  const existingMatches = existing?.ownerType === 'npc'
    && normalizeNpcScopeKey(existing.ownerName) === normalizeNpcScopeKey(state.selectedNpc);
  return targetMatches || existingMatches;
}

function findActorItemForMutation(args, state) {
  const workspace = listSceneWorkspace(state.database, state.userId, state.conversationId);
  const id = String(args.id || '').trim();
  const itemCode = String(args.itemCode || '').trim();
  return workspace.items.find(item => (id && item.id === id) || (itemCode && item.itemCode === itemCode)) || null;
}

function normalizeNpcScopeKey(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function upsertNpcProfileTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  if (!npcName) {
    return { ok: false, error: 'npcName is required' };
  }
  const payload = {
    source: 'agent',
    evidence: limitText(args.evidence, 500),
    confidence: normalizeInteger(args.confidence, 0, 100, 70),
    hidden: false,
    unhide: true
  };
  if (args.status !== undefined) {
    payload.status = normalizeEnum(args.status, npcStatusValues, 'active');
  }
  if (args.customStatus !== undefined) {
    payload.customStatus = limitText(args.customStatus, 80);
  }
  if (args.currentLocation !== undefined) {
    payload.currentLocation = limitText(args.currentLocation, 160);
  }
  if (args.relationship !== undefined) {
    payload.relationship = limitText(args.relationship, 240);
  }
  if (args.aliases !== undefined) {
    payload.aliases = normalizeStringList(args.aliases, 20, 80);
  }
  if (args.memorySealed !== undefined) {
    payload.memorySealed = args.memorySealed === true;
  }
  const npc = updateConversationNpc(state.database, state.userId, state.conversationId, npcName, payload);
  return npc ? { ok: true, npc } : { ok: false, error: 'Invalid NPC name' };
}

function hideNpcProfileTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  if (!npcName) {
    return { ok: false, error: 'npcName is required' };
  }
  const hidden = hideConversationNpc(state.database, state.userId, state.conversationId, npcName);
  return hidden ? { ok: true, hidden } : { ok: false, error: 'Invalid NPC name' };
}

function addNpcMemoryTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  const content = normalizeRequiredText(args.content, 2000);
  if (!npcName || !content) {
    return { ok: false, error: 'npcName and content are required' };
  }
  const memory = addNpcMemory(state.database, state.userId, state.conversationId, npcName, {
    memoryType: normalizeEnum(args.memoryType, memoryTypeValues, 'event'),
    content,
    auditActor: 'agent'
  });
  return { ok: true, memory };
}

function updateNpcMemoryTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  const memoryId = normalizeRequiredText(args.memoryId, 120);
  if (!npcName || !memoryId) {
    return { ok: false, error: 'npcName and memoryId are required' };
  }
  const payload = {};
  if (args.memoryType !== undefined) {
    payload.memoryType = normalizeEnum(args.memoryType, memoryTypeValues, 'event');
  }
  if (args.content !== undefined) {
    const content = normalizeRequiredText(args.content, 2000);
    if (!content) {
      return { ok: false, error: 'content cannot be empty' };
    }
    payload.content = content;
  }
  payload.auditActor = 'agent';
  const memory = updateNpcMemory(state.database, state.userId, state.conversationId, memoryId, payload, npcName);
  return memory ? { ok: true, memory } : { ok: false, error: 'Memory not found' };
}

function deleteNpcMemoryTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  const memoryId = normalizeRequiredText(args.memoryId, 120);
  if (!npcName || !memoryId) {
    return { ok: false, error: 'npcName and memoryId are required' };
  }
  const deleted = deleteNpcMemory(state.database, state.userId, state.conversationId, memoryId, npcName, { auditActor: 'agent' });
  return deleted ? { ok: true, deletedId: memoryId } : { ok: false, error: 'Memory not found' };
}

function addNpcBehaviorTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  const action = normalizeRequiredText(args.action, 2000);
  if (!npcName || !action) {
    return { ok: false, error: 'npcName and action are required' };
  }
  const behavior = addNpcBehavior(state.database, state.userId, state.conversationId, npcName, {
    behaviorType: normalizeEnum(args.behaviorType, behaviorTypeValues, 'reaction'),
    triggerCondition: limitText(args.triggerCondition, 2000),
    action,
    priority: normalizeInteger(args.priority, 0, 100, 0),
    enabled: args.enabled !== false,
    auditActor: 'agent'
  });
  return { ok: true, behavior };
}

function updateNpcBehaviorTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  const behaviorId = normalizeRequiredText(args.behaviorId, 120);
  if (!npcName || !behaviorId) {
    return { ok: false, error: 'npcName and behaviorId are required' };
  }
  const payload = {};
  if (args.behaviorType !== undefined) {
    payload.behaviorType = normalizeEnum(args.behaviorType, behaviorTypeValues, 'reaction');
  }
  if (args.triggerCondition !== undefined) {
    payload.triggerCondition = limitText(args.triggerCondition, 2000);
  }
  if (args.action !== undefined) {
    const action = normalizeRequiredText(args.action, 2000);
    if (!action) {
      return { ok: false, error: 'action cannot be empty' };
    }
    payload.action = action;
  }
  if (args.priority !== undefined) {
    payload.priority = normalizeInteger(args.priority, 0, 100, 0);
  }
  if (args.enabled !== undefined) {
    payload.enabled = args.enabled === true;
  }
  payload.auditActor = 'agent';
  const behavior = updateNpcBehavior(state.database, state.userId, state.conversationId, behaviorId, payload, npcName);
  return behavior ? { ok: true, behavior } : { ok: false, error: 'Behavior not found' };
}

function deleteNpcBehaviorTool(args, state) {
  const npcName = normalizeRequiredText(args.npcName, 80);
  const behaviorId = normalizeRequiredText(args.behaviorId, 120);
  if (!npcName || !behaviorId) {
    return { ok: false, error: 'npcName and behaviorId are required' };
  }
  const deleted = deleteNpcBehavior(state.database, state.userId, state.conversationId, behaviorId, npcName, { auditActor: 'agent' });
  return deleted ? { ok: true, deletedId: behaviorId } : { ok: false, error: 'Behavior not found' };
}

function upsertActorItemTool(args, state) {
  if (!actorItemMutationInScope(args, state)) {
    return { ok: false, error: 'Actor item mutation is outside the selected actor scope' };
  }
  const name = normalizeRequiredText(args.name, 160);
  if (!name) return { ok: false, error: 'name is required' };
  const existingItem = findActorItemForMutation(args, state);
  const itemKind = normalizeEnum(args.itemKind, ['item', 'clothing'], 'item');
  const clothingSlot = itemKind === 'clothing'
    ? (args.clothingSlot !== undefined
        ? normalizeEnum(args.clothingSlot, clothingSlotValues, '')
        : existingItem?.clothingSlot || '')
    : '';
  if (itemKind === 'clothing' && !clothingSlot) {
    return { ok: false, error: 'clothingSlot is required when creating clothing' };
  }
  const ownerType = normalizeEnum(args.ownerType, ['world', 'protagonist', 'npc'], 'protagonist');
  const payload = {
    ownerType,
    ownerName: ownerType === 'npc' ? limitText(args.ownerName ?? existingItem?.ownerName, 100) : '',
    name,
    itemKind,
    clothingSlot,
    iconKey: normalizeEnum(args.iconKey, PIXEL_ICON_KEYS, itemKind === 'clothing' ? 'clothing.outfit' : 'item.bag'),
    movable: true,
    auditActor: 'agent'
  };
  if (args.id !== undefined) payload.id = normalizeRequiredText(args.id, 120);
  if (args.itemCode !== undefined) payload.itemCode = normalizeRequiredText(args.itemCode, 80);
  if (args.nodeId !== undefined) payload.nodeId = normalizeRequiredText(args.nodeId, 120);
  if (args.description !== undefined) payload.description = limitText(args.description, 5000);
  if (args.quantity !== undefined) payload.quantity = normalizeInteger(args.quantity, 1, 999999, 1);
  if (args.equipped !== undefined) payload.equipped = itemKind === 'clothing' && args.equipped === true;
  if (args.coverage !== undefined) payload.coverage = normalizeStringList(args.coverage, 7, 20).filter(region => bodyRegionValues.includes(region));
  if (args.state !== undefined) payload.state = objectOrEmpty(args.state);
  const item = upsertSceneItem(state.database, state.userId, state.conversationId, payload);
  return item ? { ok: true, item } : { ok: false, error: 'Invalid actor item or owner' };
}

function deleteActorItemTool(args, state) {
  if (!actorItemMutationInScope(args, state)) {
    return { ok: false, error: 'Actor item mutation is outside the selected actor scope' };
  }
  const id = normalizeRequiredText(args.id, 120);
  if (!id) return { ok: false, error: 'id is required' };
  const ownedItems = listActorItems(
    state.database,
    state.userId,
    state.conversationId,
    args.ownerType,
    args.ownerName || ''
  );
  if (!ownedItems.some(item => item.id === id)) return { ok: false, error: 'Actor item not found for owner' };
  const deleted = deleteSceneEntity(state.database, state.userId, state.conversationId, 'item', id, { actor: 'agent' });
  return deleted ? { ok: true, deletedId: id } : { ok: false, error: 'Actor item not found' };
}

function buildNpcOrganizerResult(state, result = {}) {
  const npcs = listConversationNpcs(
    state.database,
    state.userId,
    state.conversationId,
    state.character?.name || state.conversation?.characterName || ''
  );
  return {
    summary: state.finishSummary || result.content || summarizeNpcOrganization(result.toolCalls),
    toolCalls: cloneToolCalls(result.toolCalls),
    process: result.process || [],
    reasoning: collectReasoning(result.process),
    usage: result.usage || null,
    npcs
  };
}

function summarizeNpcOrganization(toolCalls = []) {
  const count = Array.isArray(toolCalls) ? toolCalls.length : 0;
  return count ? `Applied ${count} NPC organizer tools.` : 'No NPC organization changes were needed.';
}

function npcOrganizerNoToolNudge(state) {
  if (state.finishSummary) {
    return '';
  }
  return [
    'You have not used any NPC organization tool yet.',
    'If changes are needed, call the appropriate profile, memory, or behavior tools now.',
    'If no changes are needed, call finish_npc_organization with a short summary and changed=false.'
  ].join('\n');
}

function collectReasoning(process = []) {
  let reasoning = '';
  const steps = Array.isArray(process) ? process : [];
  for (const step of steps) {
    if (step?.reasoning) {
      reasoning += step.reasoning;
    }
  }
  return reasoning;
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim();
  for (const item of allowed) {
    if (item === normalized) {
      return item;
    }
  }
  return fallback;
}

function normalizeInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function normalizeRequiredText(value, limit) {
  return limitText(value, limit).trim();
}

function limitText(value, limit = 2000) {
  const text = String(value || '').trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

function normalizeStringList(value, limit = 20, itemLimit = 80) {
  const sourceItems = Array.isArray(value) ? value : [value];
  const items = [];
  const seen = new Set();
  for (const item of sourceItems) {
    const text = limitText(item, itemLimit);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }
    items.push(text);
    seen.add(key);
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}
