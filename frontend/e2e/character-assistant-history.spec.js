import http from 'node:http';
import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

const originalPersona = '原始人设：谨慎的领航员，始终记录航线。';
const improvedPersona = '完善后人设：谨慎的领航员，会在风暴前主动检查星图。';
const historicalStatusTemplate = '<p class="history-status">历史角色卡状态栏</p>';

async function createCharacter(page) {
  await registerUser(page);
  return apiRequest(page, '/api/characters', { method: 'POST', body: {
    name: `History ${uniqueSuffix()}`, persona: originalPersona, openingMessage: '欢迎来到雾港。',
    authorAdvancedSettings: { statusBarBlueprint: { name: '航海面板', template: historicalStatusTemplate, variables: [] } }
  } });
}

async function openAssistant(page, characterId) {
  await page.goto(`/#/characters/${characterId}/assistant`);
  await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '草稿历史版本', exact: true })).toBeEnabled();
}

async function headerAction(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: '更多助手操作', exact: true }).click();
  await button.click();
  return button;
}

async function expectPersonaPreview(page, persona) {
  await headerAction(page, '预览角色卡');
  const preview = page.getByRole('dialog', { name: '角色卡预览', exact: true });
  await expect(preview.locator('.character-card-preview-section').filter({ has: page.getByRole('heading', { name: '角色人设', exact: true }) })).toContainText(persona);
  await preview.getByRole('button', { name: '关闭角色卡预览', exact: true }).click();
  await expect(preview).toHaveCount(0);
}

async function expectDraftStatusPreview(page, content) {
  await headerAction(page, '预览状态栏');
  const dialog = page.getByRole('dialog', { name: '状态栏预览', exact: true });
  await expect(dialog.locator('header p')).toContainText('当前草稿');
  await expect(dialog.locator('.history-status')).toHaveText(content);
  await dialog.getByRole('button', { name: '关闭状态栏预览', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function expectDialogFits(page, dialog) {
  await expect.poll(() => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth + 1
      && bounds.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function personaProvider() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text || '{}');
      requests.push(body);
      const toolCalls = [
        { id: 'history-persona', type: 'function', function: { name: 'update_character_story', arguments: JSON.stringify({ persona: improvedPersona }) } },
        { id: 'history-finish', type: 'function', function: { name: 'finish_character_draft', arguments: JSON.stringify({ summary: '已完善领航员人设。', reviewedSections: ['persona'], warnings: [] }) } }
      ];
      if (body.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
        response.end([
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: toolCalls.map((call, index) => ({ index, ...call })) }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
          'data: [DONE]\n\n'
        ].join(''));
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }] }));
      }
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

test('AI draft changes retain recoverable versions without saving the character', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const character = await createCharacter(page);
  await openAssistant(page, character.id);
  const composer = page.getByRole('textbox', { name: '给角色助手发送消息' });
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  await composer.fill('仅讨论现有人设，不修改草稿。');
  await send.click();
  await expect(page.locator('.assistant-message.from-assistant')).toContainText('当前使用本地 Mock');
  await expect(page.getByRole('log', { name: '与角色完善助手的对话' })).toHaveAttribute('aria-busy', 'false');
  const [session] = await apiRequest(page, `/api/character-assistant/sessions?characterId=${character.id}`);
  const versionsPath = `/api/character-assistant/sessions/${session.id}/versions`;
  expect(await apiRequest(page, versionsPath)).toEqual([]);

  // The built-in Mock only discusses drafts. A local deterministic gateway
  // exercises the actual tool, checkpoint, history and restore paths.
  const provider = await personaProvider();
  try {
    const profile = await apiRequest(page, '/api/providers', { method: 'POST', body: {
      providerType: 'custom', gatewayName: 'History test gateway', baseUrl: provider.baseUrl,
      model: 'history-persona', apiKey: 'e2e-history-fixture', extraBody: '{}'
    } });
    await apiRequest(page, `/api/providers/${profile.provider.id}/select`, { method: 'POST' });
    await page.reload();
    await expect(composer).toBeEnabled();
    await composer.fill('完善领航员人设，补充风暴前检查星图的习惯。');
    await send.click();
    await expect(page.locator('.assistant-message.from-assistant').last()).toContainText('已完善领航员人设');
    await expect(page.getByRole('log', { name: '与角色完善助手的对话' })).toHaveAttribute('aria-busy', 'false');
    expect(provider.requests.length).toBeGreaterThan(0);
    expect((await apiRequest(page, `/api/characters/${character.id}`)).persona).toBe(originalPersona);
    expect((await apiRequest(page, `/api/character-assistant/sessions/${session.id}`)).character.persona).toBe(improvedPersona);
    const versions = await apiRequest(page, versionsPath);
    expect(versions).toHaveLength(2);
    expect(versions.map(version => version.title)).toEqual([expect.stringContaining('修改后'), expect.stringContaining('修改前')]);
    await expectPersonaPreview(page, improvedPersona);

    const historyOpener = await headerAction(page, '草稿历史版本');
    const history = page.getByRole('dialog', { name: '草稿历史版本', exact: true });
    await expect(history.locator('li')).toHaveCount(2);
    await expect(history.getByRole('button', { name: '关闭历史版本', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(history.getByRole('button', { name: '用已保存角色卡覆盖草稿', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(history.getByRole('button', { name: '关闭历史版本', exact: true })).toBeFocused();
    await expectDialogFits(page, history);
    await page.screenshot({ path: testInfo.outputPath('assistant-history-desktop.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(history).toHaveCount(0);
    await expect(historyOpener).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await headerAction(page, '草稿历史版本');
    await expect(history.locator('li')).toHaveCount(2);
    await expectDialogFits(page, history);
    await page.screenshot({ path: testInfo.outputPath('assistant-history-mobile.png'), animations: 'disabled' });

    await history.locator('li').filter({ hasText: '修改前' }).getByRole('button', { name: '恢复此版', exact: true }).click();
    await expect(history).toHaveCount(0);
    await expectPersonaPreview(page, originalPersona);
    expect((await apiRequest(page, `/api/characters/${character.id}`)).persona).toBe(originalPersona);
    await page.reload();
    await expect(composer).toBeEnabled();
    await expectPersonaPreview(page, originalPersona);
    expect((await apiRequest(page, `/api/character-assistant/sessions/${session.id}`)).character.persona).toBe(originalPersona);

    await headerAction(page, '草稿历史版本');
    await history.locator('li').filter({ hasText: '修改后' }).getByRole('button', { name: '恢复此版', exact: true }).click();
    await expect(history).toHaveCount(0);
    await expectPersonaPreview(page, improvedPersona);
    expect((await apiRequest(page, `/api/characters/${character.id}`)).persona).toBe(originalPersona);
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/characters/${character.id}`)
      && response.request().method() === 'PATCH' && response.ok());
    await headerAction(page, '保存角色');
    expect((await (await saved).json()).persona).toBe(improvedPersona);
    expect((await apiRequest(page, `/api/characters/${character.id}`)).persona).toBe(improvedPersona);

    const previousSaved = await apiRequest(page, `/api/characters/${character.id}`);
    const currentSavedPersona = '数据库定稿：已经完成最新航海设定。';
    const currentSavedTemplate = '<p class="history-status">数据库最新角色卡状态栏</p>';
    const latestSaved = await apiRequest(page, `/api/characters/${character.id}`, { method: 'PATCH', body: {
      ...previousSaved, persona: currentSavedPersona,
      authorAdvancedSettings: { ...previousSaved.authorAdvancedSettings, statusBarBlueprint: {
        ...previousSaved.authorAdvancedSettings.statusBarBlueprint, template: currentSavedTemplate
      } }
    } });
    await expectPersonaPreview(page, improvedPersona);
    await expectDraftStatusPreview(page, '历史角色卡状态栏');
    const draftBeforeReset = await apiRequest(page, `/api/character-assistant/sessions/${session.id}`);
    await headerAction(page, '草稿历史版本');
    const resetDraft = history.getByRole('button', { name: '用已保存角色卡覆盖草稿', exact: true });
    const resetPath = `/api/character-assistant/sessions/${session.id}/reset-draft-from-character`;
    let resetRequests = 0;
    page.on('request', request => {
      if (request.url().endsWith(resetPath) && request.method() === 'POST') resetRequests += 1;
    });
    page.once('dialog', dialog => dialog.dismiss());
    await resetDraft.click();
    expect(resetRequests).toBe(0);
    expect((await apiRequest(page, `/api/character-assistant/sessions/${session.id}`)).character).toEqual(draftBeforeReset.character);

    let releaseReset;
    const resetGate = new Promise(resolve => { releaseReset = resolve; });
    await page.route(`**${resetPath}`, async route => {
      await resetGate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟覆盖草稿失败，请重试' }) });
    });
    page.once('dialog', dialog => dialog.accept());
    await resetDraft.click();
    await expect(resetDraft).toBeDisabled();
    await expect(resetDraft).toHaveAttribute('aria-busy', 'true');
    await expect(history.getByRole('button', { name: '关闭历史版本', exact: true })).toBeDisabled();
    releaseReset();
    await expect(history.getByRole('alert')).toContainText('模拟覆盖草稿失败');
    await expect(history.locator('li').first()).toBeVisible();
    await expect(resetDraft).toBeEnabled();
    await expect(history.getByText('已用已保存角色卡覆盖当前草稿。', { exact: true })).toHaveCount(0);
    const failedReset = await apiRequest(page, `/api/character-assistant/sessions/${session.id}`);
    expect(failedReset.character).toEqual(draftBeforeReset.character);
    expect(failedReset.state).toEqual(draftBeforeReset.state);
    expect(failedReset.messages).toEqual(draftBeforeReset.messages);
    expect(await apiRequest(page, `/api/characters/${character.id}`)).toEqual(latestSaved);
    await page.unroute(`**${resetPath}`);
    page.once('dialog', dialog => dialog.accept());
    await history.getByRole('button', { name: '重试覆盖草稿', exact: true }).click();
    await expect(history.getByText('已用已保存角色卡覆盖当前草稿。', { exact: true })).toBeVisible();
    await expect(history.getByRole('alert')).toHaveCount(0);
    expect(await apiRequest(page, `/api/characters/${character.id}`)).toEqual(latestSaved);
    const draftAfterReset = await apiRequest(page, `/api/character-assistant/sessions/${session.id}`);
    expect(draftAfterReset.character.persona).toBe(currentSavedPersona);
    expect(draftAfterReset.character.authorAdvancedSettings.statusBarBlueprint.template).toBe(currentSavedTemplate);
    expect(draftAfterReset.messages).toEqual(draftBeforeReset.messages);
    expect(draftAfterReset.state.checkpoint).toBeFalsy();
    expect(draftAfterReset.state.worldBookChanges || []).toEqual([]);
    for (const viewport of [{ width: 360, height: 800 }, { width: 730, height: 930 }]) {
      await page.setViewportSize(viewport);
      await expectDialogFits(page, history);
      await expect(resetDraft).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`assistant-history-reset-${viewport.width}.png`), animations: 'disabled' });
    }
    await history.getByRole('button', { name: '关闭历史版本', exact: true }).click();
    await expect(page.locator('.assistant-context-inspector')).toHaveCount(0);
    await expectPersonaPreview(page, currentSavedPersona);
    await expectDraftStatusPreview(page, '数据库最新角色卡状态栏');
    await page.reload();
    await expect(composer).toBeEnabled();
    await expectPersonaPreview(page, currentSavedPersona);
    await expectDraftStatusPreview(page, '数据库最新角色卡状态栏');
    const savedAgain = page.waitForResponse(response => response.url().endsWith(`/api/characters/${character.id}`)
      && response.request().method() === 'PATCH' && response.ok());
    await headerAction(page, '保存角色');
    const savedAfterReset = await (await savedAgain).json();
    expect(savedAfterReset.persona).toBe(currentSavedPersona);
    expect(savedAfterReset.authorAdvancedSettings.statusBarBlueprint.template).toBe(currentSavedTemplate);
    const requestsBeforeResetVerification = provider.requests.length;
    await composer.fill('检查当前角色卡状态栏，继续讨论。');
    await send.click();
    await expect.poll(() => provider.requests.length).toBeGreaterThan(requestsBeforeResetVerification);
    const requestAfterReset = provider.requests[requestsBeforeResetVerification];
    const resetPayload = JSON.parse(requestAfterReset.messages.at(-1).content);
    expect(resetPayload.currentCharacter.persona).toBe(currentSavedPersona);
    expect(resetPayload.currentCharacter.authorAdvancedSettings.statusBarBlueprint.template).toBe(currentSavedTemplate);
    await expect(page.getByRole('log', { name: '与角色完善助手的对话' })).toHaveAttribute('aria-busy', 'false');
    expect((await apiRequest(page, `/api/characters/${character.id}`)).authorAdvancedSettings.statusBarBlueprint.template).toBe(currentSavedTemplate);
  } finally { await provider.close(); }
});

for (const action of ['保存角色', '返回角色编辑']) {
  test(`${action} locks the assistant while the preceding draft write is pending`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const character = await createCharacter(page);
    await openAssistant(page, character.id);
    const [session] = await apiRequest(page, `/api/character-assistant/sessions?characterId=${character.id}`);
    let releaseWrite;
    const writeGate = new Promise(resolve => { releaseWrite = resolve; });
    await page.route(`**/api/character-assistant/sessions/${session.id}`, async route => {
      if (route.request().method() === 'PATCH') await writeGate;
      await route.continue();
    });
    const writeStarted = page.waitForRequest(request => request.url().endsWith(`/api/character-assistant/sessions/${session.id}`)
      && request.method() === 'PATCH');
    const composer = page.getByRole('textbox', { name: '给角色助手发送消息' });
    await composer.fill('保留本次未发送的要求。');
    const actionButton = action === '返回角色编辑'
      ? page.getByRole('button', { name: action, exact: true }).first()
      : page.getByRole('button', { name: action, exact: true });
    await actionButton.click();
    await writeStarted;
    await expect(composer).toBeDisabled();
    await expect(page.getByRole('button', { name: '草稿历史版本', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存角色', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '添加图片', exact: true })).toBeDisabled();
    releaseWrite();
    if (action === '返回角色编辑') {
      await expect(page).toHaveURL(new RegExp(`#/characters/${character.id}/edit$`));
    } else {
      await expect(page.getByText('角色已保存', { exact: true })).toBeVisible();
      await expect(composer).toBeEnabled();
    }
  });
}

test('pending world book drafts only write when Save Character is chosen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const character = await createCharacter(page);
  const created = await apiRequest(page, '/api/world-books/apply-changes', { method: 'POST', body: {
    requestId: crypto.randomUUID(), changes: [{ ref: 'new:original', profile: { name: '原始雾港规则' },
      entries: [{ name: '夜航', content: '原始夜航规则。', triggerKeys: '夜航' }] }]
  } });
  const book = created.books[0].book;
  await apiRequest(page, `/api/characters/${character.id}/world-books`, { method: 'POST', body: { worldBookId: book.id } });
  await openAssistant(page, character.id);
  const [session] = await apiRequest(page, `/api/character-assistant/sessions?characterId=${character.id}`);
  const existing = {
    ref: `existing:${book.id}`, bookId: book.id, baseRevision: book.revision, name: book.name,
    profile: {}, before: { name: book.name },
    upserts: [{ entryId: book.entries[0].id, before: book.entries[0], patch: { content: '草稿夜航规则：必须检查星图。' } }], removals: []
  };
  const newBookName = `待保存航海手册 ${uniqueSuffix()}`;
  const addition = { ref: 'new:manual', bookId: null, profile: { name: newBookName },
    entries: [{ name: '星图', content: '出航前检查星图。', triggerKeys: '星图' }], upserts: [], removals: [], addToCharacter: true };
  const workspace = { version: 1, activeRef: existing.ref, selectedBookIds: [book.id], targets: [
    { ref: existing.ref, bookId: book.id, baseRevision: book.revision, profile: { name: book.name }, profilePatch: {}, upserts: existing.upserts, removals: [] }, addition
  ] };
  await apiRequest(page, `/api/character-assistant/sessions/${session.id}`, { method: 'PATCH', body: {
    character: session.character,
    state: { ...session.state, status: 'completed', worldBookWorkspace: workspace, worldBookChanges: [existing, addition] }
  } });
  const applyRequests = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/world-books/apply-changes') && request.method() === 'POST') applyRequests.push(request);
  });
  await page.reload();
  const changes = page.locator('.worldbook-changes');
  await expect(changes.locator('.worldbook-change')).toHaveCount(2);
  await expect(changes.locator('.worldbook-apply')).toHaveCount(0);
  await expect(changes.locator('.worldbook-change-head input')).toHaveCount(0);
  await expect(changes).toContainText('点击保存角色后生效');
  await changes.locator('.worldbook-change-detail summary').first().click();
  await expect(changes.getByRole('button', { name: '放弃此项', exact: true }).first()).toBeVisible();
  expect((await apiRequest(page, `/api/world-books/${book.id}`)).entries[0].content).toBe('原始夜航规则。');
  expect((await apiRequest(page, '/api/world-books')).some(item => item.name === newBookName)).toBe(false);
  expect(applyRequests).toHaveLength(0);
  await page.reload();
  await expect(changes.locator('.worldbook-change')).toHaveCount(2);
  expect(applyRequests).toHaveLength(0);

  const saved = page.waitForResponse(response => response.url().endsWith(`/api/characters/${character.id}`)
    && response.request().method() === 'PATCH' && response.ok());
  await headerAction(page, '保存角色');
  await saved;
  await expect(changes).toHaveCount(0);
  expect(applyRequests).toHaveLength(1);
  expect((await apiRequest(page, `/api/world-books/${book.id}`)).entries[0].content).toBe('草稿夜航规则：必须检查星图。');
  const newBooks = (await apiRequest(page, `/api/world-books?history-check=${uniqueSuffix()}`)).filter(item => item.name === newBookName);
  expect(newBooks).toHaveLength(1);
  expect((await apiRequest(page, `/api/characters/${character.id}/world-books`)).map(item => item.id).sort()).toEqual([book.id, newBooks[0].id].sort());
  await page.reload();
  await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
  await expect(changes).toHaveCount(0);
  expect(applyRequests).toHaveLength(1);
});
