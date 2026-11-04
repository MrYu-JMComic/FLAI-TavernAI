import { newId, nowIso } from '../security.js';
import { sanitizeDiagnosticValue } from './diagnosticRedaction.js';
import { getConversationMutationContext } from './conversationMutationContext.js';

const groups = [
  ['character-draft', 'draft', 'request', [
    'update_character_profile',
    'update_character_story',
    'edit_character_text',
    'patch_character_data',
    'replace_character_regex_rules',
    'replace_character_render_plugins',
    'update_character_status_bar',
    'update_character_agents',
    'update_character_presentation',
    'set_character_recommendations'
  ]],
  ['character-draft', 'validate', 'request', ['report_character_progress', 'finish_character_draft']],
  ['character-draft', 'read', 'read-only', ['read_character_field', 'search_character_draft']],
  ['world-book-draft', 'draft', 'request', ['create_world_book', 'create_character_world_book', 'set_world_book_profile', 'replace_world_book_entries', 'upsert_world_book_entry', 'remove_world_book_entry', 'patch_world_book_text', 'batch_world_book_entries']],
  ['world-book-draft', 'read', 'read-only', ['search_world_books', 'select_world_book', 'read_world_book', 'preview_world_book_entries']],
  ['world-book-draft', 'validate', 'request', ['finish_world_book_task']],
  ['status', 'write', 'job-step', ['update_status_bar', 'upsert_status_bar_variable', 'remove_status_bar_variable', 'update_status_bar_metadata', 'replace_status_bar_template', 'update_status_bar_code']],
  ['status', 'read', 'read-only', ['skip_status_bar_update', 'read_status_bar']],
  ['memory', 'write', 'job-step', ['record_memory', 'update_memory', 'merge_memories', 'invalidate_memory', 'pin_memory', 'batch_memory_changes']],
  ['memory', 'read', 'read-only', ['search_memories', 'search_history', 'finish_memory_review']],
  ['web', 'read', 'read-only', ['deepseek_web_search', 'deepseek_web_fetch']],
  ['economy', 'write', 'job-step', ['record_economy_transaction']],
  ['scene', 'write', 'job-step', ['upsert_scene_node', 'upsert_scene_route', 'merge_scene_nodes', 'remove_scene_route', 'patch_scene_text', 'batch_scene_changes']],
  ['scene', 'read', 'read-only', ['finish_scene_organization']],
  ['world', 'write', 'job-step', ['create_quest', 'advance_quest_objective', 'advance_world_time', 'set_world_weather', 'request_skill_check', 'discover_location', 'travel_to_location', 'propose_reward']],
  ['assistant-plan', 'validate', 'request', ['submit_character_plan', 'submit_world_book_plan']]
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
