import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEXT_QUALITY_EVALUATION_KIND,
  runContextQualityEvaluation
} from '../services/contextQualityEvaluation.js';

test('deterministic context quality contract satisfies every fixed-story invariant', () => {
  const evaluation = runContextQualityEvaluation();
  assert.equal(evaluation.kind, CONTEXT_QUALITY_EVALUATION_KIND);
  assert.match(evaluation.description, /not a live-model semantic benchmark/);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.summary.failedInvariants, 0);
  assert.equal(evaluation.summary.erroneousStateChanges, 0);
  assert.equal(evaluation.summary.secretLeaks, 0);
  assert.equal(evaluation.summary.retrieval.recall, 1);
  assert.equal(evaluation.summary.retrieval.precision, 1);
  assert.ok(evaluation.summary.estimatedPromptTokens > 0);
  assert.ok(evaluation.summary.promptCharacters > 0);
  assert.ok(evaluation.summary.elapsedMs >= 0);
  assert.ok(evaluation.summary.p50Ms >= 0);
  assert.ok(evaluation.summary.p95Ms >= 0);
  assert.deepEqual(
    evaluation.cases.map((entry) => [entry.id, entry.invariants.map((invariant) => [invariant.id, invariant.passed])]),
    [
      ['memory_evidence', [
        ['explicit_user_action_accepted', true],
        ['intent_not_completed_state', true],
        ['hypothesis_not_completed_state', true]
      ]],
      ['prompt_context', [
        ['hidden_secret_excluded', true],
        ['foreign_secret_excluded', true],
        ['older_relevant_memory_recalled', true],
        ['recent_history_window_bounded', true]
      ]],
      ['item_ownership', [
        ['duplicate_owner_write_rejected', true],
        ['item_has_exactly_one_owner', true]
      ]],
      ['branch_checkpoint', [
        ['branch_keeps_checkpoint_memory', true],
        ['branch_excludes_future_memory', true]
      ]]
    ]
  );
});
