import { runContextQualityEvaluation } from '../src/services/contextQualityEvaluation.js';

try {
  const evaluation = runContextQualityEvaluation();
  process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
  if (!evaluation.passed) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    kind: 'deterministic_contract_evaluation',
    passed: false,
    error: error?.message || String(error)
  }, null, 2)}\n`);
  process.exitCode = 1;
}
