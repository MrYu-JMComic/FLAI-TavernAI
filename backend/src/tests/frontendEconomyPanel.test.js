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

test('EconomyPanel preserves unchanged account and transaction list references', () => {
  assert.match(
    economyPanelScript,
    /function setAccountsIfChanged\(nextAccounts\)\s*{\s*const normalizedAccounts = Array\.isArray\(nextAccounts\) \? nextAccounts : \[\];[\s\S]*if \(sameListItems\(currentAccounts, normalizedAccounts, sameAccountSummary\)\) {\s*return false;\s*}[\s\S]*accounts\.value = normalizedAccounts;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    economyPanelScript,
    /function setTransactionsIfChanged\(nextTransactions\)\s*{\s*const normalizedTransactions = Array\.isArray\(nextTransactions\) \? nextTransactions : \[\];[\s\S]*if \(sameListItems\(currentTransactions, normalizedTransactions, sameTransactionSummary\)\) {\s*return false;\s*}[\s\S]*transactions\.value = normalizedTransactions;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    economyPanelScript,
    /function sameListItems\(currentItems, nextItems, sameItem\)\s*{[\s\S]*if \(currentItems === nextItems\) {\s*return true;\s*}[\s\S]*if \(currentItems\.length !== nextItems\.length\) {\s*return false;\s*}[\s\S]*currentItems\.every\(\(item, index\) => sameItem\(item, nextItems\[index\]\)\);[\s\S]*}/
  );
  assert.match(
    economyPanelScript,
    /function sameAccountSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*current\?\.conversationId === next\?\.conversationId[\s\S]*current\?\.currencyType === next\?\.currencyType[\s\S]*current\?\.balance === next\?\.balance;[\s\S]*}/
  );
  assert.match(
    economyPanelScript,
    /function sameTransactionSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*current\?\.currencyType === next\?\.currencyType[\s\S]*current\?\.type === next\?\.type[\s\S]*current\?\.amount === next\?\.amount[\s\S]*current\?\.description === next\?\.description[\s\S]*current\?\.createdAt === next\?\.createdAt;[\s\S]*}/
  );

  assert.match(economyPanelScript, /setAccountsIfChanged\(\[\]\);[\s\S]*setTransactionsIfChanged\(\[\]\);/);
  assert.match(economyPanelScript, /setAccountsIfChanged\(result\.accounts\);/);
  assert.match(economyPanelScript, /setTransactionsIfChanged\(result\.transactions\);/);
  assert.ok(countMatches(economyPanelScript, /setAccountsIfChanged\(/g) >= 4);
  assert.ok(countMatches(economyPanelScript, /setTransactionsIfChanged\(/g) >= 5);
  assert.doesNotMatch(economyPanelScript, /\n\s+accounts\.value = \[\];/);
  assert.doesNotMatch(economyPanelScript, /\n\s+transactions\.value = \[\];/);
  assert.doesNotMatch(economyPanelScript, /\n\s+accounts\.value = result\.accounts/);
  assert.doesNotMatch(economyPanelScript, /\n\s+transactions\.value = result\.transactions/);
});
