import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const economyPanelSource = readRepoText('frontend/src/components/EconomyPanel.vue');

test('EconomyPanel disables history controls while economy or history is loading', () => {
  const scriptSetup = readVueBlock(economyPanelSource, 'script');
  const template = readVueBlock(economyPanelSource, 'template');
  const style = readVueBlock(economyPanelSource, 'style');

  assert.match(scriptSetup, /const historyActionDisabled = computed\(\(\) => loading\.value \|\| historyLoading\.value\)/);
  assert.match(scriptSetup, /function handleCurrencyFilterChange\(\)\s*{\s*if \(historyActionDisabled\.value\) return;/);
  assert.match(scriptSetup, /function retryEconomyLoad\(\)\s*{\s*if \(loading\.value\) return;/);
  assert.match(scriptSetup, /function retryHistoryLoad\(\)\s*{\s*if \(historyActionDisabled\.value\) return;/);
  assert.match(scriptSetup, /function goToPrevPage\(\)\s*{\s*if \(hasPrevPage\.value && !historyActionDisabled\.value\)/);
  assert.match(scriptSetup, /function goToNextPage\(\)\s*{\s*if \(hasNextPage\.value && !historyActionDisabled\.value\)/);

  assert.match(template, /:disabled="loading"/);
  assert.match(template, /:aria-busy="loading"/);
  assert.match(template, /:disabled="historyActionDisabled"/);
  assert.match(template, /:aria-busy="historyLoading"/);
  assert.match(template, /:disabled="!hasPrevPage \|\| historyActionDisabled"/);
  assert.match(template, /:disabled="!hasNextPage \|\| historyActionDisabled"/);
  assert.equal(countMatches(template, /:aria-busy="historyLoading"/g), 4);

  assert.match(style, /\.economy-retry-button:hover:not\(:disabled\)/);
  assert.match(style, /\.economy-retry-button:disabled/);
  assert.match(style, /\.history-currency-select:disabled/);
});
