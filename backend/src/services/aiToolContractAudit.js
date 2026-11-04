import { z } from 'zod';
import { getCharacterAssistantToolDefinitions } from './characterAssistant.js';
import { getWorldBookAssistantToolDefinitions } from './worldBookAssistant.js';
import { statusBarTool, statusBarSkipTool, economyTool, worldDirectorTools } from './accessoryAgents.js';
import { statusBarEditingTools } from './statusBarAgentTools.js';
import { buildSceneOrganizerTools } from './sceneOrganizer.js';
import { buildMemoryAgentToolDefinitions } from './conversationMemoryAgent.js';
import { MEMORY_AGENT_TOOLS } from '../../../shared/memoryAgentTools.js';
import { DEEPSEEK_ONLINE_SEARCH_TOOLS } from './deepSeekSearch.js';
import { describeAiTool, listAiToolPolicies } from './toolRegistry.js';

/** Enumerates actual runtime builders, including optional and planning tools, without calling providers. */
export function collectAiToolContracts() {
  const families = {
    character: getCharacterAssistantToolDefinitions(),
    'character-plan': getCharacterAssistantToolDefinitions({ planPhase: true }),
    'world-book': getWorldBookAssistantToolDefinitions(),
    'world-book-plan': getWorldBookAssistantToolDefinitions({ planPhase: true }),
    'world-book-legacy': getWorldBookAssistantToolDefinitions({ legacyDraft: true }),
    'world-book-legacy-plan': getWorldBookAssistantToolDefinitions({ legacyDraft: true, planPhase: true }),
    status: [statusBarTool(), statusBarSkipTool(), ...statusBarEditingTools()],
    economy: [economyTool()],
    director: worldDirectorTools({ travelEnabled: true, rewardEnabled: true }),
    scene: buildSceneOrganizerTools(),
    memory: buildMemoryAgentToolDefinitions(MEMORY_AGENT_TOOLS.map(tool => tool.name)),
    web: DEEPSEEK_ONLINE_SEARCH_TOOLS
  };
  return Object.entries(families).flatMap(([family, definitions]) => definitions.map(definition => ({ family, definition })));
}

/** Checks explicit shape, bounded collections, local validator compilation and registry coverage. */
export function auditAiToolContracts(contracts = collectAiToolContracts()) {
  const errors = [];
  const exceptions = [];
  const inventory = new Map();
  const checked = new Set();
  for (const { family, definition } of contracts) {
    const { name, parameters } = definition?.function || {};
    if (!name || definition.type !== 'function') { errors.push(`${family}: invalid function definition`); continue; }
    if (!inventory.has(name)) inventory.set(name, { name, families: [], ...describeAiTool(name) });
    inventory.get(name).families.push(family);
    if (describeAiTool(name).effect === 'unknown') errors.push(`${name}: no execution policy`);
    const key = `${name}:${JSON.stringify(parameters)}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (parameters?.type !== 'object') errors.push(`${name}: root must be an object`);
    inspect(parameters, `${name}.parameters`, name);
    try { z.fromJSONSchema(parameters); }
    catch (error) { errors.push(`${name}: local validator cannot compile: ${error.message}`); }
  }
  for (const policy of listAiToolPolicies()) if (!inventory.has(policy.name)) errors.push(`${policy.name}: registered tool absent from runtime inventory`);
  return { tools: [...inventory.values()].sort((a, b) => a.name.localeCompare(b.name)), variants: checked.size, errors, exceptions };

  function inspect(schema, path, name) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) { errors.push(`${path}: schema must be an object`); return; }
    const unions = ['anyOf', 'oneOf', 'allOf'];
    if (!schema.type && !unions.some(key => Array.isArray(schema[key])) && !schema.$ref) {
      const pointerValue = name === 'patch_character_data'
        && /\.properties\.edits\.items\.properties\.(oldValue|value)$/.test(path);
      if (pointerValue) exceptions.push({ path, reason: 'Allowlisted JSON Pointer values are checked against the addressed field and previous value by the handler.' });
      else errors.push(`${path}: missing value type`);
    }
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.includes('object')) {
      if (schema.additionalProperties !== false && (!schema.additionalProperties || typeof schema.additionalProperties !== 'object')) {
        errors.push(`${path}: fixed object must be closed or have a typed dictionary`);
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        if (!Number.isInteger(schema.maxProperties) || schema.maxProperties < 0) errors.push(`${path}: dictionary requires maxProperties`);
        inspect(schema.additionalProperties, `${path}.additionalProperties`, name);
      }
      for (const required of schema.required || []) if (!Object.hasOwn(schema.properties || {}, required)) errors.push(`${path}: required field ${required} is not declared`);
    }
    if (types.includes('array')) {
      if (!Number.isInteger(schema.maxItems) || schema.maxItems < 0) errors.push(`${path}: array requires maxItems`);
      if (!schema.items) errors.push(`${path}: array requires items`);
      else inspect(schema.items, `${path}.items`, name);
    }
    for (const [key, child] of Object.entries(schema.properties || {})) inspect(child, `${path}.properties.${key}`, name);
    for (const key of unions) for (const [index, child] of (schema[key] || []).entries()) inspect(child, `${path}.${key}[${index}]`, name);
    for (const [key, child] of Object.entries(schema.$defs || {})) inspect(child, `${path}.$defs.${key}`, name);
  }
}
