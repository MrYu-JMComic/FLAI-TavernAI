import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEXT_QUALITY_EVALUATION_KIND,
  runContextQualityEvaluation
} from '../services/contextQualityEvaluation.js';

test('deterministic context quality contract satisfies every fixed-story invariant', () => {
  const evaluation = runContextQualityEvaluation();
  assert.equal(evaluation.kind, CONTEXT_QUALITY_EVALUATION_KIND);
  assert.equal(evaluation.version, 3);
  assert.match(evaluation.description, /not a live-model semantic benchmark/);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.summary.failedInvariants, 0);
  assert.equal(evaluation.summary.erroneousStateChanges, 0);
  assert.equal(evaluation.summary.secretLeaks, 0);
  assert.equal(evaluation.summary.invariants, 42);
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
      ['branch_checkpoint', [
        ['branch_keeps_checkpoint_memory', true],
        ['branch_excludes_future_memory', true]
      ]],
      ['actor_truth', [
        ['author_retains_actual_location', true],
        ['informed_actor_knows_actual_location', true],
        ['false_belief_has_separate_text_and_truth_status', true],
        ['false_belief_does_not_leak_author_truth', true],
        ['uninformed_actor_cannot_recall_secret', true],
        ['actor_cannot_read_author_only_plan', true]
      ]],
      ['temporal_alias_graph', [
        ['portable_alias_resolves_one_entity', true],
        ['future_validity_does_not_change_current_state', true],
        ['promise_modality_never_establishes_completed_fact', true],
        ['entity_graph_recalls_the_evidenced_promise', true],
        ['same_turn_event_sequence_preserves_extraction_order', true]
      ]],
      ['commit_lineage', [
        ['same_order_pin_reads_selected_revision', true],
        ['rewind_reselects_old_membership', true],
        ['branch_copies_selected_ancestry_only', true],
        ['later_checkpoint_can_be_selected_again', true]
      ]],
      ['continuity_state', [
        ['object_initial_owner_visible_at_earlier_cutoff', true],
        ['object_transfer_supersedes_previous_owner', true],
        ['object_transfer_never_has_two_current_owners', true],
        ['alliance_active_before_termination', true],
        ['alliance_terminated_at_validity_boundary', true],
        ['historical_owner_restored_by_selected_commit', true],
        ['pronoun_remains_unresolved', true],
        ['ambiguous_pronoun_commit_rejected', true],
        ['ambiguous_pronoun_does_not_mutate_state', true]
      ]],
      ['delayed_disclosure_threads', [
        ['delayed_promise_recalled_after_twenty_rounds', true],
        ['delayed_promise_remains_open_without_completion', true],
        ['false_belief_remains_before_disclosure', true],
        ['disclosure_replaces_belief_with_learned_truth', true],
        ['disclosure_does_not_reveal_secret_to_outsider', true],
        ['clue_is_open_before_evidence', true],
        ['clue_resolves_only_after_evidence', true],
        ['checkpoint_restore_reopens_previously_unresolved_clue', true],
        ['restoring_later_checkpoint_recovers_resolved_clue', true]
      ]]
    ]
  );
});
