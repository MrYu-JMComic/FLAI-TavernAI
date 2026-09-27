import { newId, nowIso } from '../security.js';
import { sanitizeDiagnosticValue } from './diagnosticRedaction.js';
import { getConversationMutationContext } from './conversationMutationContext.js';

const groups = [
  ['character-draft', 'draft', 'request', [
    'update_character_profile',
    'update_character_story',
    'replace_character_regex_rules',
    'replace_character_render_plugins',
    'update_character_status_bar',
    'update_character_agents',
    'update_character_presentation',
    'set_character_recommendations'
  ]],
  ['character-draft', 'validate', 'request', ['report_character_progress', 'finish_character_draft']],
  ['world-book-draft', 'draft', 'request', ['set_world_book_profile', 'replace_world_book_entries', 'upsert_world_book_entry', 'remove_world_book_entry']],
  ['world-book-draft', 'read', 'read-only', ['preview_world_book_entries']],
  ['status', 'write', 'job-step', ['update_status_bar']],
  ['status', 'read', 'read-only', ['skip_status_bar_update']],
  ['memory', 'write', 'job-step', ['record_memory', 'update_memory', 'merge_memories', 'invalidate_memory', 'pin_memory']],
  ['memory', 'read', 'read-only', ['search_memories', 'search_history', 'finish_memory_review']],
  ['economy', 'write', 'job-step', ['record_economy_transaction']],
  ['scene', 'write', 'job-step', ['upsert_scene_node', 'upsert_scene_route', 'merge_scene_nodes', 'remove_scene_route']],
  ['scene', 'read', 'read-only', ['finish_scene_organization']],
  ['world', 'write', 'job-step', ['create_quest', 'advance_quest_objective', 'advance_world_time', 'set_world_weather', 'request_skill_check', 'discover_location', 'travel_to_location', 'propose_reward']],
  ['town', 'proposal', 'domain-plan', ['create_town_world', 'advance_town_world', 'plan_town_resident_cognition']]
];
const policies = new Map();
for (const [domain, effect, idempotency, names] of groups) {
  for (const name of names) policies.set(name, Object.freeze({ name, domain, effect, idempotency }));
}

export function describeAiTool(name) {
  return policies.get(name) || { name, domain: 'unclassified', effect: 'unknown', idempotency: 'none' };
}

export function listAiToolPolicies() {
  return [...policies.values()].map((policy) => ({ ...policy }));
}

export function startToolExecution(name, args, metadata = {}) {
  const context = { ...metadata, ...getConversationMutationContext() };
  const policy = describeAiTool(name);
  if (!context.database || !context.userId) return { policy };
  context.assert?.();
  const id = newId();
  context.database.prepare(`INSERT INTO ai_tool_executions
    (id, user_id, conversation_id, job_id, step_key, attempt, tool_name, domain, effect, idempotency, status, arguments_json, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, '{}', ?)`)
    .run(id, context.userId, context.conversationId || null, context.jobId || null, context.stepKey || '',
      context.attempt || 1, name, policy.domain, policy.effect, policy.idempotency, boundedJson(args), nowIso());
  return { id, context, policy };
}

export function finishToolExecution(execution, result, status) {
  if (execution.id) {
    execution.context.database.prepare('UPDATE ai_tool_executions SET status = ?, result_json = ? WHERE id = ?')
      .run(status, boundedJson(result), execution.id);
  }
  return execution.policy;
}

function boundedJson(value) {
  const text = JSON.stringify(sanitizeDiagnosticValue(value)) || 'null';
  return text.length <= 32_000 ? text : JSON.stringify({ truncated: true, originalCharacters: text.length, preview: text.slice(0, 31_000) });
}
