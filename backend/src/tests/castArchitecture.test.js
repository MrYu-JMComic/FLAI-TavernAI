import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const backendSourceRoot = fileURLToPath(new URL('../', import.meta.url));
const frontendSourceRoot = fileURLToPath(new URL('../../../frontend/src/', import.meta.url));
const promptPipelineSource = readFileSync(
  new URL('../services/promptPipeline.js', import.meta.url),
  'utf8'
);
const multiRoleSource = readFileSync(
  new URL('../services/cast/multiRoleService.js', import.meta.url),
  'utf8'
);

const CAST_TABLES = [
  'cast_members',
  'cast_member_aliases',
  'cast_memories',
  'cast_behaviors',
  'cast_appearances',
  'cast_personality_anchors',
  'cast_emotion_states',
  'cast_emotion_history',
  'cast_activities',
  'cast_turn_queue',
  'cast_change_batches',
  'cast_ooc_validations',
  'conversation_turns',
  'conversation_audit_events',
  'scene_items',
];

const LEGACY_RUNTIME_MARKERS = [
  'upsert_npc',
  'record_npc_memory',
  'record_npc_behavior',
  'get_npc_profile',
  'get_npc_memories',
  'get_npc_behaviors',
  'sync_npc_profile',
  'sync_npc_memories',
  'sync_npc_behaviors',
  'finish_npc_organization',
  'delegate_item_organization',
  'finish_item_organization',
  'npcAgent',
  '[NPC on-demand roster]',
  '[NPC autonomous behavior engine]',
];

test('runtime SQL access to cast tables stays inside repositories and database setup', () => {
  const sqlTablePattern = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?(?:${CAST_TABLES.join('|')})\\b`,
    'i'
  );
  const violations = [];

  for (const file of listJavaScriptFiles(backendSourceRoot)) {
    const relativePath = normalizePath(path.relative(backendSourceRoot, file));
    if (isSqlBoundaryFile(relativePath)) continue;
    const source = readFileSync(file, 'utf8');
    const match = source.match(sqlTablePattern);
    if (match) violations.push(`${relativePath}: ${match[0]}`);
  }

  assert.deepEqual(violations, []);
});

test('legacy NPC agent tools and prompts are absent from runtime source', () => {
  const violations = [];
  for (const root of [backendSourceRoot, frontendSourceRoot]) {
    for (const file of listJavaScriptFiles(root, ['.js', '.vue'])) {
      const relativePath = normalizePath(path.relative(root, file));
      if (root === backendSourceRoot && relativePath.startsWith('tests/')) continue;
      const source = readFileSync(file, 'utf8');
      for (const marker of LEGACY_RUNTIME_MARKERS) {
        if (source.includes(marker)) violations.push(`${relativePath}: ${marker}`);
      }
    }
  }
  assert.deepEqual(violations, []);

  for (const relativePath of [
    'modules/npcs.js',
    'routes/conversationNpcs.js',
    'services/npcContextTools.js',
    'services/npcOrganizer.js',
  ]) {
    assert.equal(existsSync(path.join(backendSourceRoot, relativePath)), false, relativePath);
  }
  assert.equal(
    existsSync(path.join(frontendSourceRoot, 'components/NpcPanel.vue')),
    false
  );
});

test('main and multi-role generation consume cast context without tool loops', () => {
  assert.match(promptPipelineSource, /import \{ buildCastContext \}/);
  assert.match(promptPipelineSource, /const castContext = buildCastContext\(/);
  assert.doesNotMatch(promptPipelineSource, /runToolCompletion|npcContextTools/);
  assert.match(multiRoleSource, /const castContext = buildCastContext\(/);
  assert.match(multiRoleSource, /generateCompletion/);
  assert.doesNotMatch(multiRoleSource, /runToolCompletion|tools\s*:/);
});

function listJavaScriptFiles(root, extensions = ['.js']) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(target, extensions));
    } else if (extensions.includes(path.extname(entry.name))) {
      files.push(target);
    }
  }
  return files;
}

function isSqlBoundaryFile(relativePath) {
  return relativePath.startsWith('repositories/')
    || relativePath.startsWith('db/migrations/')
    || relativePath.startsWith('tests/')
    || relativePath === 'db/schema.js'
    || relativePath === 'db/indexes.js';
}

function normalizePath(value) {
  return value.replaceAll(path.sep, '/');
}
