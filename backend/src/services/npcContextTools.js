import {
  listNpcBehaviors,
  listNpcMemories,
  resolveConversationNpcLookup
} from '../modules/npcs.js';
import { evaluateActorAppearance, listActorItems, listSceneWorkspace } from '../modules/scenes.js';

const NPC_LOOKUP_MAX_ROUNDS = 4;
const ACTOR_OWNER_TYPES = Object.freeze(['npc', 'protagonist']);
const ACTOR_OWNER_TYPE_SET = new Set(ACTOR_OWNER_TYPES);
const NPC_LOOKUP_TOOL_NAMES = new Set([
  'get_npc_profile',
  'get_npc_memories',
  'get_npc_behaviors',
  'get_actor_items',
  'get_scene_locations'
]);

export function buildNpcLookupTools(options = {}) {
  const tools = [
    npcProfileLookupTool(),
    npcMemoryLookupTool(),
    npcBehaviorLookupTool(),
    actorItemsLookupTool()
  ];
  if (options.includeSceneLocations === true) {
    tools.push(sceneLocationsLookupTool());
  }
  return tools;
}

export function isNpcLookupTool(toolName) {
  return NPC_LOOKUP_TOOL_NAMES.has(String(toolName || ''));
}

export function executeNpcLookupTool(context = {}, toolName, args = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const payload = args && typeof args === 'object' ? args : {};
  const db = source.db;
  const userId = source.userId;
  const conversationId = source.conversationId;
  const mainCharacterName = source.mainCharacterName || '';

  if (toolName === 'get_scene_locations') {
    const workspace = listSceneWorkspace(db, userId, conversationId);
    return {
      ok: true,
      locations: workspace.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        nodeType: node.nodeType,
        name: node.name,
        description: node.description,
        tags: node.tags
      }))
    };
  }

  if (toolName === 'get_actor_items') {
    const ownerType = String(payload.ownerType || '').trim();
    if (!ACTOR_OWNER_TYPE_SET.has(ownerType)) {
      return {
        ok: false,
        error: 'ACTOR_OWNER_TYPE_INVALID',
        allowedOwnerTypes: ACTOR_OWNER_TYPES
      };
    }
    if (ownerType === 'protagonist') {
      const items = listActorItems(db, userId, conversationId, 'protagonist', '');
      return {
        ok: true,
        ownerType: 'protagonist',
        ownerName: mainCharacterName,
        items,
        appearance: evaluateActorAppearance(items)
      };
    }
  }

  if (!['get_npc_profile', 'get_npc_memories', 'get_npc_behaviors', 'get_actor_items'].includes(toolName)) {
    return { ok: false, error: `Unsupported NPC lookup tool: ${toolName}` };
  }

  const lookup = resolveConversationNpcLookup(
    db,
    userId,
    conversationId,
    payload.npcName,
    mainCharacterName
  );
  const resolution = lookup.resolution;
  if (!resolution.ok) {
    return {
      ok: false,
      error: resolution.error,
      candidates: resolution.candidates || [],
      availableNames: resolution.roster.map((npc) => npc.names)
    };
  }

  const canonicalName = resolution.npc.name;
  const summary = lookup.summary;
  const identity = {
    name: canonicalName,
    aliases: resolution.npc.aliases,
    resolvedFrom: resolution.resolvedFrom
  };

  if (toolName === 'get_npc_profile') {
    return {
      ok: true,
      npc: {
        ...identity,
        source: summary?.source || 'item',
        confidence: Number(summary?.confidence || 0),
        evidence: summary?.evidence || '',
        status: summary?.status || 'active',
        customStatus: summary?.customStatus || '',
        currentLocation: summary?.currentLocation || '',
        relationship: summary?.relationship || '',
        memoryCount: Number(summary?.memoryCount || 0),
        behaviorCount: Number(summary?.behaviorCount || 0),
        memorySealed: Boolean(summary?.memorySealed),
        memorySealActive: Boolean(summary?.memorySealActive)
      }
    };
  }

  if (toolName === 'get_npc_memories') {
    const memorySealActive = Boolean(summary?.memorySealActive);
    const includeSealed = payload.includeSealed === true;
    return {
      ok: true,
      npc: identity,
      memorySealActive,
      memories: memorySealActive && !includeSealed
        ? []
        : listNpcMemories(db, userId, conversationId, canonicalName)
    };
  }

  if (toolName === 'get_npc_behaviors') {
    const behaviors = listNpcBehaviors(db, userId, conversationId, canonicalName);
    return {
      ok: true,
      npc: identity,
      behaviors: payload.includeDisabled === true
        ? behaviors
        : behaviors.filter((behavior) => behavior.enabled)
    };
  }

  const items = listActorItems(db, userId, conversationId, 'npc', canonicalName);
  return {
    ok: true,
    ownerType: 'npc',
    ownerName: canonicalName,
    resolvedFrom: resolution.resolvedFrom,
    items,
    appearance: evaluateActorAppearance(items)
  };
}

export function attachNpcLookupTools(options = {}, context = {}) {
  const roster = Array.isArray(context.roster) ? context.roster : [];
  if (!context.enabled || !roster.length) {
    return options;
  }

  const npcTools = buildNpcLookupTools();
  const npcToolNames = new Set(npcTools.map((tool) => tool.function.name));
  const existingTools = Array.isArray(options.tools)
    ? options.tools.filter((tool) => !npcToolNames.has(tool?.function?.name))
    : [];
  const existingExecutor = typeof options.executeTool === 'function' ? options.executeTool : null;

  return {
    ...options,
    maxRounds: options.maxRounds ?? NPC_LOOKUP_MAX_ROUNDS,
    tools: [...existingTools, ...npcTools],
    executeTool: async (toolName, args, call) => {
      if (npcToolNames.has(toolName)) {
        return executeNpcLookupTool(context, toolName, args);
      }
      return existingExecutor
        ? existingExecutor(toolName, args, call)
        : { ok: false, error: `Unsupported tool: ${toolName}` };
    }
  };
}

function npcNameProperty() {
  return {
    type: 'string',
    description: 'Exact canonical NPC name or exact alias from the supplied NPC roster.'
  };
}

function npcProfileLookupTool() {
  return {
    type: 'function',
    function: {
      name: 'get_npc_profile',
      description: 'Fetch one relevant NPC profile, including canonical identity, aliases, status, current location, relationship, and memory/behavior counts.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { npcName: npcNameProperty() },
        required: ['npcName']
      }
    }
  };
}

function npcMemoryLookupTool() {
  return {
    type: 'function',
    function: {
      name: 'get_npc_memories',
      description: 'Fetch stored memories for one relevant NPC. Query only when historical knowledge, relationship continuity, opinions, emotions, or past events matter to this turn.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          npcName: npcNameProperty(),
          includeSealed: {
            type: 'boolean',
            description: 'Use only when the current request explicitly needs historical memories of a dead or permanently-left NPC.'
          }
        },
        required: ['npcName']
      }
    }
  };
}

function npcBehaviorLookupTool() {
  return {
    type: 'function',
    function: {
      name: 'get_npc_behaviors',
      description: 'Fetch stable trigger-based behavior rules for one relevant NPC. Disabled rules are omitted unless explicitly requested for maintenance or deduplication.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          npcName: npcNameProperty(),
          includeDisabled: { type: 'boolean' }
        },
        required: ['npcName']
      }
    }
  };
}

function actorItemsLookupTool() {
  return {
    type: 'function',
    function: {
      name: 'get_actor_items',
      description: 'Fetch current possessions, clothing, equipment, and computed appearance for one NPC or for the protagonist.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ownerType: { type: 'string', enum: ACTOR_OWNER_TYPES },
          npcName: npcNameProperty()
        },
        required: ['ownerType']
      }
    }
  };
}

function sceneLocationsLookupTool() {
  return {
    type: 'function',
    function: {
      name: 'get_scene_locations',
      description: 'Fetch known scene location nodes only when an item must be placed in the world or an exact node id is required.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {}
      }
    }
  };
}
