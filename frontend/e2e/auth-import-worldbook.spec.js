import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiRequest, loginUser, logoutUser, registerUser, uniqueSuffix } from './helpers.js';

test('logs in and imports a local character card JSON', async ({ page }, testInfo) => {
  const account = await registerUser(page);
  const suffix = account.suffix;
  const importedName = `E2E Imported ${suffix}`;
  const importPath = testInfo.outputPath(`character-${suffix}.json`);

  await logoutUser(page);
  await loginUser(page, account);

  await fs.writeFile(importPath, JSON.stringify({
    character: {
      name: importedName,
      gender: '测试',
      age: '1',
      background: 'Imported through Playwright.',
      worldview: 'Local-first import smoke.',
      persona: 'Stable imported character.',
      openingMessage: `Imported opening ${suffix}`,
      visibility: 'public'
    },
    tags: [`tag-${suffix}`],
    regex_rules: [],
    world_book: {
      name: `Imported Lore ${suffix}`,
      description: 'Imported with the character card.',
      entries: [
        {
          name: `Imported Entry ${suffix}`,
          trigger_keys: `import-key-${suffix}`,
          content: 'Imported lore content.',
          enabled: true
        }
      ]
    }
  }), 'utf8');

  await page.locator('input[type="file"][accept=".json"]').first().setInputFiles(importPath);
  await expect(page.locator('.home-import-panel-head h2', { hasText: importedName })).toBeVisible();
  await page.getByRole('button', { name: /直接导入/ }).click();
  await expect(page.locator('.home-character-card').filter({ hasText: importedName }).first()).toBeVisible();
});

test('previews a world book trigger hit in the match lab', async ({ page }) => {
  const account = await registerUser(page);
  const suffix = uniqueSuffix();
  const trigger = `azure-comet-${suffix}`;
  const book = await apiRequest(page, '/api/world-books', {
    method: 'POST',
    body: {
      name: `E2E Match Book ${suffix}`,
      description: 'World book E2E match preview.',
      scanDepth: 4,
      lorebookContextPercent: 25
    }
  });
  await apiRequest(page, `/api/world-books/${book.id}/entries`, {
    method: 'POST',
    body: {
      name: `E2E Match Entry ${suffix}`,
      triggerKeys: trigger,
      content: `World book content for ${account.username}.`,
      position: 'before_char',
      enabled: true
    }
  });

  await page.goto(`/#/world-books/${book.id}`);
  await expect(page.getByRole('heading', { name: book.name })).toBeVisible();
  await page.getByLabel('测试文本').fill(`The scene mentions ${trigger} near the old gate.`);
  await page.getByRole('button', { name: /测试触发/ }).click();

  await expect(page.getByText(`E2E Match Entry ${suffix}`)).toBeVisible();
  await expect(page.getByText(`关键词：${trigger}`)).toBeVisible();
  await expect(page.getByText(/1 条命中/)).toBeVisible();
});
