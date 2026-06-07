import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: economyPanelScript,
  template: economyPanelTemplate,
  style: economyPanelStyle
} = readVueBlocks('frontend/src/components/EconomyPanel.vue', ['script', 'template', 'style']);

test('EconomyPanel disables history controls while economy or history is loading', () => {
  assert.match(economyPanelScript, /const historyActionDisabled = computed\(\(\) => loading\.value \|\| historyLoading\.value\)/);
  assert.match(economyPanelScript, /function handleCurrencyFilterChange\(\)\s*{\s*if \(historyActionDisabled\.value\) return;/);
  assert.match(economyPanelScript, /function retryEconomyLoad\(\)\s*{\s*if \(loading\.value\) return;/);
  assert.match(economyPanelScript, /function retryHistoryLoad\(\)\s*{\s*if \(historyActionDisabled\.value\) return;/);
  assert.match(economyPanelScript, /function goToPrevPage\(\)\s*{\s*if \(hasPrevPage\.value && !historyActionDisabled\.value\)/);
  assert.match(economyPanelScript, /function goToNextPage\(\)\s*{\s*if \(hasNextPage\.value && !historyActionDisabled\.value\)/);

  assert.match(economyPanelTemplate, /:disabled="loading"/);
  assert.match(economyPanelTemplate, /:aria-busy="loading"/);
  assert.match(economyPanelTemplate, /:disabled="historyActionDisabled"/);
  assert.match(economyPanelTemplate, /:aria-busy="historyLoading"/);
  assert.match(economyPanelTemplate, /:disabled="!hasPrevPage \|\| historyActionDisabled"/);
  assert.match(economyPanelTemplate, /:disabled="!hasNextPage \|\| historyActionDisabled"/);
  assert.equal(countMatches(economyPanelTemplate, /:aria-busy="historyLoading"/g), 4);

  assert.match(economyPanelStyle, /\.economy-retry-button:hover:not\(:disabled\)/);
  assert.match(economyPanelStyle, /\.economy-retry-button:disabled/);
  assert.match(economyPanelStyle, /\.history-currency-select:disabled/);
});
