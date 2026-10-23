import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

async function openEditor(page) {
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', { method: 'POST', body: {
    name: `已保存角色 ${uniqueSuffix()}`, persona: '原始角色人设。', openingMessage: '欢迎来到雾港。'
  } });
  await page.clock.install();
  await page.goto(`/#/characters/${character.id}/edit`);
  await expect(page.locator('.character-editor-header h1')).toHaveText(character.name);
  return { character, storageKey: `flai-character-form-draft:edit:${character.id}` };
}

async function expectNoDraft(page, storageKey) {
  await expect(page.getByRole('button', { name: '丢弃草稿', exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
}

async function expectActionSizes(page) {
  const mobile = page.viewportSize().width <= 760;
  const sizes = await page.locator('.character-editor-header-actions button, .character-draft-actions button, .character-studio-action-buttons > button, .character-mobile-actionbar > button')
    .evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().height > 0).map(button => ({
      label: button.textContent.trim(), height: button.getBoundingClientRect().height, fontSize: getComputedStyle(button).fontSize,
      draftAction: Boolean(button.closest('.character-draft-actions')),
      icons: [...button.querySelectorAll(':scope > svg')].map(icon => ({ width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height }))
    })));
  expect(sizes.length).toBeGreaterThan(3);
  for (const button of sizes) {
    expect(button.height, button.label).toBe(mobile ? (button.draftAction ? 36 : 40) : 44);
    expect(button.fontSize, button.label).toBe(mobile ? '13px' : '14px');
    for (const icon of button.icons) expect(icon, button.label).toEqual({ width: mobile ? 16 : 18, height: mobile ? 16 : 18 });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('desktop can discard current and pending drafts without the autosave timer recreating them', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 959, height: 930 });
  const { character, storageKey } = await openEditor(page);
  const name = page.locator('#character-name');
  await name.fill('未保存的修改');
  await page.clock.fastForward(1300);
  await expect(page.locator('.character-draft-note')).toContainText('服务器草稿已保存');
  await page.locator('.page-shell').evaluate(element => { element.scrollTop = 0; });
  await expectActionSizes(page);
  await page.screenshot({ path: testInfo.outputPath('character-editor-draft-959.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '丢弃草稿', exact: true }).click();
  await expect(name).toHaveValue(character.name);
  await expectNoDraft(page, storageKey);
  await page.clock.fastForward(31_000);
  await expectNoDraft(page, storageKey);
  expect((await apiRequest(page, `/api/characters/${character.id}`)).name).toBe(character.name);

  await name.fill('待恢复的服务器草稿');
  await page.clock.fastForward(1300);
  await expect(page.locator('.character-draft-note')).toContainText('服务器草稿已保存');
  const [draft] = await apiRequest(page, `/api/character-assistant/sessions?characterId=${character.id}`);
  expect((await apiRequest(page, `/api/character-assistant/sessions/${draft.id}`)).character.name).toBe('待恢复的服务器草稿');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: '恢复草稿', exact: true })).toBeVisible();
  await expect(name).toHaveValue(character.name);
  await expectActionSizes(page);
  await page.screenshot({ path: testInfo.outputPath('character-editor-pending-959.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '丢弃草稿', exact: true }).click();
  await page.clock.fastForward(31_000);
  await expectNoDraft(page, storageKey);
  await page.reload();
  await expect(name).toHaveValue(character.name);
  await expectNoDraft(page, storageKey);
  await expect(page.getByRole('button', { name: '恢复草稿', exact: true })).toHaveCount(0);
});

test('phone draft controls stay clear and discard restores the saved form', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { character, storageKey } = await openEditor(page);
  await page.locator('.character-mobile-section-item[data-section-id="basic"]').click();
  await page.locator('#character-name').fill('手机未保存的修改');
  await page.clock.fastForward(1300);
  await expect(page.locator('.character-draft-note')).toContainText('服务器草稿已保存');
  await page.getByRole('button', { name: '返回分区列表', exact: true }).click();
  await page.locator('.page-shell').evaluate(element => { element.scrollTop = 0; });
  await expectActionSizes(page);
  await page.screenshot({ path: testInfo.outputPath('character-editor-draft-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '丢弃草稿', exact: true }).click();
  await expect(page.locator('.character-mobile-identity-text h2')).toHaveText(character.name);
  await page.clock.fastForward(31_000);
  await expectNoDraft(page, storageKey);
  await page.reload();
  await expect(page.locator('.character-mobile-identity-text h2')).toHaveText(character.name);
  await expectNoDraft(page, storageKey);
  await page.locator('.character-mobile-section-item[data-section-id="basic"]').click();
  await expect(page.locator('#character-name')).toHaveValue(character.name);
});

for (const width of [360, 390, 412]) {
  test(`pending phone draft buttons stay compact at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const { character, storageKey } = await openEditor(page);
    await page.locator('.character-mobile-section-item[data-section-id="basic"]').click();
    await page.locator('#character-name').fill('手机待恢复的服务器草稿');
    await page.clock.fastForward(1300);
    await expect(page.locator('.character-draft-note')).toContainText('服务器草稿已保存');
    await page.reload();
    const banner = page.locator('.character-draft-note.pending');
    await expect(banner.getByRole('button', { name: '恢复草稿', exact: true })).toBeVisible();
    await expect(banner.getByRole('button', { name: '丢弃草稿', exact: true })).toBeVisible();
    await page.locator('.page-shell').evaluate(element => { element.scrollTop = 0; });
    const layout = await banner.evaluate(element => {
      const describe = node => {
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
          display: style.display, flexDirection: style.flexDirection, flexBasis: style.flexBasis,
          alignItems: style.alignItems, alignContent: style.alignContent, minHeight: style.minHeight };
      };
      return {
        banner: describe(element), copy: describe(element.querySelector('.character-draft-copy')),
        actions: describe(element.querySelector('.character-draft-actions')),
        buttons: [...element.querySelectorAll('button')].map(describe)
      };
    });
    await testInfo.attach(`pending-draft-layout-${width}`, { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath(`character-editor-pending-${width}.png`), animations: 'disabled' });
    await expectActionSizes(page);
    expect(layout.actions.height).toBe(36);
    expect(layout.buttons[0].y).toBe(layout.buttons[1].y);
    expect(layout.buttons[0].width + layout.buttons[1].width + 8).toBeLessThan(layout.actions.width);
    expect(layout.buttons[1].x + layout.buttons[1].width).toBe(layout.actions.x + layout.actions.width);
    expect(layout.banner.height).toBeLessThanOrEqual(104);
    await banner.getByRole('button', { name: '丢弃草稿', exact: true }).click();
    await expectNoDraft(page, storageKey);
    await page.clock.fastForward(31_000);
    await expectNoDraft(page, storageKey);
    await page.reload();
    await expect(page.locator('.character-mobile-identity-text h2')).toHaveText(character.name);
    await expectNoDraft(page, storageKey);
  });
}

test('every assistant entry purges browser draft content and loads the same server draft', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { character } = await openEditor(page);
  const serverCharacter = { ...character, name: '服务器当前草稿', persona: '仅存在服务器的当前人设',
    authorAdvancedSettings: { ...character.authorAdvancedSettings, statusBarBlueprint: {
      name: '服务器面板', template: '<p>SERVER {{HP}}</p>', variables: [{ name: 'HP', type: 'number', value: 97 }]
    } } };
  const session = await apiRequest(page, '/api/character-assistant/sessions', { method: 'POST', body: {
    characterId: character.id, title: '服务器会话', character: serverCharacter, state: { selectedWorldBookIds: [] }
  } });
  const sessionId = session.session?.id || session.id;
  const seedLegacyDrafts = () => {
    localStorage.setItem('flai-character-form-draft:new', JSON.stringify({ payload: { name: 'LOCAL NEW' } }));
    localStorage.setItem('flai-character-form-draft:edit:other-character', 'LOCAL OTHER');
    localStorage.setItem('flai-character-ai-session:legacy-character', JSON.stringify({ version: 4, requirement: 'LOCAL AI' }));
    localStorage.setItem('draft-purge-unrelated-preference', 'preserve');
  };
  await page.evaluate(seedLegacyDrafts);
  await page.goto(`/#/characters/${character.id}/assistant`);
  const composer = page.getByRole('textbox', { name: '给角色助手发送消息' });
  await expect(composer).toBeEnabled();
  await expect(page.locator('.character-assistant-header h1')).toHaveText('服务器当前草稿');
  const assertBrowserHasNoDrafts = async () => {
    const stored = await page.evaluate(() => ({
      draftKeys: Object.keys(localStorage).filter(key => key.startsWith('flai-character-form-draft:') || key.startsWith('flai-character-ai-session:')),
      preference: localStorage.getItem('draft-purge-unrelated-preference'),
      sessionDraftContent: Object.values(sessionStorage).some(value => value.includes('仅存在服务器的当前人设') || value.includes('SERVER {{HP}}'))
    }));
    expect(stored).toEqual({ draftKeys: [], preference: 'preserve', sessionDraftContent: false });
  };
  await assertBrowserHasNoDrafts();
  await page.getByRole('button', { name: '预览状态栏', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '状态栏预览', exact: true })).toContainText('SERVER 97');
  await page.getByRole('button', { name: '关闭状态栏预览', exact: true }).click();
  await page.getByRole('button', { name: '返回角色编辑', exact: true }).first().click();
  await expect(page.locator('#character-name')).toHaveValue('服务器当前草稿');
  expect((await apiRequest(page, `/api/characters/${character.id}`)).name).toBe(character.name);
  await page.reload();
  await expect(page.getByRole('button', { name: '恢复草稿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(page.locator('#character-name')).toHaveValue('服务器当前草稿');
  await page.evaluate(seedLegacyDrafts);
  await page.getByRole('button', { name: 'AI 完善助手', exact: true }).click();
  await expect(composer).toBeEnabled();
  await assertBrowserHasNoDrafts();
  expect((await apiRequest(page, `/api/character-assistant/sessions?characterId=${character.id}`)).map(item => item.id)).toEqual([sessionId]);
  await expect(page.locator('.character-assistant-header h1')).toHaveText('服务器当前草稿');
});
