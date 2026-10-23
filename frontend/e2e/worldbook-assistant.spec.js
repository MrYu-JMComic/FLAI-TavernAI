import { expect, test } from '@playwright/test';
import { apiRequest, registerUser } from './helpers.js';

const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const profile = book => ({ name: book.name, description: book.description, scanDepth: book.scanDepth, lorebookContextPercent: book.lorebookContextPercent });
const target = book => ({ ref: `existing:${book.id}`, bookId: book.id, baseRevision: book.revision, profile: profile(book), profilePatch: {}, upserts: [], removals: [] });
const newEntry = { name: '远航准备', content: '出发前检查星图和淡水。', triggerKeys: '远航' };
const newTarget = { ref: 'new:voyage', bookId: null, profile: { name: '远航手册', description: '航海者的实用指南' }, entries: [newEntry], upserts: [], removals: [] };
const newChange = { ref: 'new:voyage', bookId: null, name: '远航手册', profile: newTarget.profile, entries: [newEntry], upserts: [], removals: [] };

async function seedBook(page, name, count = 1) {
  const created = await apiRequest(page, '/api/world-books/apply-changes', {
    method: 'POST', body: { requestId: crypto.randomUUID(), changes: [{
      ref: `new:${name}`, profile: { name },
      entries: Array.from({ length: count }, (_, index) => ({ name: `设定 ${index + 1}`, content: `原始内容 ${index + 1}`, triggerKeys: `词${index + 1}`, enabled: index !== 2, orderIndex: index }))
    }] }
  });
  return created.books[0].book;
}

function updateChange(book, entry, content) {
  return { ref: `existing:${book.id}`, bookId: book.id, baseRevision: book.revision, name: book.name, profile: {}, before: profile(book), upserts: [{ entryId: entry.id, before: entry, patch: { content } }], removals: [], linkedCharacterCount: book.linkedCharacters?.length || 0 };
}

async function reply(route, result) {
  await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: event('workspace', { workspace: result.workspace, changes: result.changes }) + event('done', { process: [], toolCalls: [], ...result }) });
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test('selected book supports two draft turns, creation, real atomic apply and follow-up', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
  });
  await registerUser(page);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  const book = await seedBook(page, '雾港设定', 80);
  const requests = [];
  await page.route('**/api/world-books/complete-draft', async route => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    if (requests.length > 2) return reply(route, { workspace: payload.workspace, changes: [], reply: '现有两本书均已保存。' });
    const content = requests.length === 1 ? '夜间禁止独自出港。' : '夜间禁止独自出港；巡逻队可结伴出港。';
    const change = updateChange(book, book.entries[64], content);
    const existing = { ...target(book), upserts: change.upserts };
    return reply(route, { workspace: { version: 1, activeRef: existing.ref, selectedBookIds: [book.id], targets: [existing, newTarget] }, changes: [change, newChange], reply: '已更新雾港规则，**请确认**。\n下面两项请留意：\n\n- 夜间限制\n- 巡逻例外' });
  });
  await page.goto(`/#/world-books/${book.id}`);
  const panel = page.locator('.worldbook-ai-panel');
  await expect(panel.locator('.worldbook-target-chip')).toContainText('雾港设定');
  await panel.getByRole('button', { name: '新建世界书', exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue(/另外创建一本独立世界书/);
  await panel.getByRole('textbox').fill('修改第65条夜间规则，另外创建远航手册');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(2);
  await panel.getByRole('textbox').fill('补充巡逻队结伴出港的例外\n**原样输入**');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].selectedBookIds).toEqual([book.id]);
  expect(requests[1].history).toHaveLength(2);
  expect(requests[1].workspace.targets[0].upserts[0].patch.content).toBe('夜间禁止独自出港。');
  await expect(panel.locator('.worldbook-messages article')).toHaveCount(4);
  const assistantMessage = panel.locator('.worldbook-message.assistant').first();
  await expect(assistantMessage.locator('.markdown-content strong')).toHaveText('请确认');
  await expect(assistantMessage.locator('.markdown-content > p').first().locator('br')).toHaveCount(1);
  await expect(assistantMessage.locator('.markdown-content > ul > li')).toHaveCount(2);
  const userMessage = panel.locator('.worldbook-message.user').last();
  await expect(userMessage.locator('> p')).toHaveText('补充巡逻队结伴出港的例外\n**原样输入**');
  await expect(userMessage.locator('.markdown-content')).toHaveCount(0);
  await expect(userMessage.locator('> p')).toHaveCSS('white-space', 'pre-wrap');
  await panel.locator('.worldbook-change-detail summary').first().click();
  await expect(panel.locator('.worldbook-change').first()).toContainText('巡逻队可结伴出港');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.screenshot({ path: testInfo.outputPath('worldbook-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await panel.locator('.worldbook-messages').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('worldbook-mobile-conversation.png'), animations: 'disabled' });
  await panel.locator('.worldbook-changes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('worldbook-mobile.png') });
  await panel.getByRole('button', { name: '应用 2 项变更', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(0);
  const saved = await apiRequest(page, `/api/world-books/${book.id}`);
  expect(saved.entries).toHaveLength(80);
  for (let index = 0; index < 80; index += 1) {
    expect(saved.entries[index]).toEqual(index === 64 ? { ...book.entries[index], content: '夜间禁止独自出港；巡逻队可结伴出港。' } : book.entries[index]);
  }
  const books = await apiRequest(page, '/api/world-books');
  expect(books.filter(item => item.name === '远航手册')).toHaveLength(1);
  await panel.getByRole('textbox').fill('总结当前两本书');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].workspace.targets.every(item => item.bookId && item.upserts.length === 0)).toBe(true);
  await expect(panel.locator('.worldbook-messages')).toContainText('现有两本书均已保存');
});

test('automatic selection starts empty and remains usable on a narrow phone', async ({ page }, testInfo) => {
  await registerUser(page);
  const book = await seedBook(page, '雾港设定');
  const requests = [];
  await page.route('**/api/world-books/complete-draft', async route => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    const change = updateChange(book, book.entries[0], '按对话自主找到雾港并补充规则。');
    return reply(route, { workspace: { version: 1, activeRef: change.ref, selectedBookIds: [], targets: [{ ...target(book), upserts: change.upserts }] }, changes: [change], reply: '已找到雾港设定并整理修改。' });
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#/world-books');
  const panel = page.locator('.worldbook-ai-panel');
  await panel.getByRole('textbox').fill('找到雾港世界书，补充夜间规则');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(1);
  expect(requests[0].selectedBookIds).toEqual([]);
  expect(requests[0].automatic).toBe(true);
  await expect(panel.locator('.worldbook-discovered')).toContainText('雾港设定');
  await panel.getByRole('button', { name: '调整', exact: true }).click();
  await expect(panel.getByRole('button', { name: '新建世界书', exact: true })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await panel.locator('.worldbook-target-picker').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('worldbook-320.png') });
  await panel.locator('.worldbook-changes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('worldbook-320-results.png') });
  await panel.getByRole('button', { name: '应用 1 项变更', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(0);
  expect((await apiRequest(page, `/api/world-books/${book.id}`)).entries[0].content).toContain('自主找到');
});

test('character defaults to every bound book and applies new books before character linking', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
  });
  await registerUser(page);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  const a = await seedBook(page, '角色资料 A');
  const b = await seedBook(page, '角色资料 B');
  const character = await apiRequest(page, '/api/characters', { method: 'POST', body: { name: '雾港领航员', persona: '谨慎的领航员' } });
  for (const book of [a, b]) await apiRequest(page, `/api/characters/${character.id}/world-books`, { method: 'POST', body: { worldBookId: book.id } });
  const requests = [];
  await page.route('**/api/characters/complete-draft', async route => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    const change = { ...updateChange(b, b.entries[0], '仅更新角色资料 B。'), linkedCharacterCount: 1 };
    const workspace = { version: 1, activeRef: change.ref, selectedBookIds: [a.id, b.id], targets: [target(a), { ...target(b), upserts: change.upserts }, newTarget] };
    const current = await apiRequest(page, `/api/character-assistant/sessions/${payload.assistantSessionId}`);
    await apiRequest(page, `/api/character-assistant/sessions/${payload.assistantSessionId}`, {
      method: 'PATCH', body: {
        character: payload.character,
        state: { ...current.state, status: 'completed', worldBookWorkspace: workspace, worldBookChanges: [change, newChange] }
      }
    });
    await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: event('done', { character: { ...payload.character, worldBookWorkspace: workspace, worldBookChanges: [change, newChange] }, process: [], toolCalls: [], warnings: [] }) });
  });
  await page.goto(`/#/characters/${character.id}/assistant`);
  const panel = page.locator('.character-assistant-page');
  await panel.getByRole('button', { name: /对话设置与完善范围/ }).click();
  await expect(panel.locator('.worldbook-target-chip')).toHaveCount(2);
  await expect(panel.locator('.worldbook-target-source')).toContainText('来自角色关联');
  await panel.getByRole('button', { name: '新建世界书', exact: true }).click();
  await panel.getByRole('button', { name: '收起对话设置', exact: true }).click();
  await panel.getByRole('textbox', { name: '给角色助手发送消息' }).fill('只更新 B，并创建独立的远航手册');
  await panel.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(2);
  expect(requests[0].worldBookContext.selectedBookIds.sort()).toEqual([a.id, b.id].sort());
  await panel.locator('.worldbook-changes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('character-worldbooks-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.locator('.worldbook-change')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await panel.locator('.worldbook-changes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('character-worldbooks-mobile.png') });
  await expect(panel.getByRole('button', { name: '应用 2 项变更', exact: true })).toHaveCount(0);
  expect((await apiRequest(page, `/api/world-books/${a.id}`)).entries).toEqual(a.entries);
  expect((await apiRequest(page, `/api/world-books/${b.id}`)).entries).toEqual(b.entries);
  const linked = await apiRequest(page, `/api/characters/${character.id}/world-books`);
  expect(linked.map(book => book.id).sort()).toEqual([a.id, b.id].sort());
  expect((await apiRequest(page, '/api/world-books')).filter(book => book.name === '远航手册')).toHaveLength(0);
  await panel.getByRole('button', { name: '更多助手操作', exact: true }).click();
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(0);
  await panel.getByRole('button', { name: /对话设置与完善范围/ }).click();
  await expect(panel.locator('.worldbook-target-chip')).toHaveCount(3);
  await panel.getByRole('button', { name: '收起对话设置', exact: true }).click();
  expect((await apiRequest(page, `/api/world-books/${b.id}`)).entries[0].content).toBe('仅更新角色资料 B。');
  const newBooks = (await apiRequest(page, '/api/world-books')).filter(book => book.name === '远航手册');
  expect(newBooks).toHaveLength(1);
  await expect.poll(async () => (await apiRequest(page, `/api/characters/${character.id}/world-books`)).map(book => book.id).sort()).toEqual([a.id, b.id, newBooks[0].id].sort());
});

test('conflict recovery reloads only the original and can discard an unused new draft', async ({ page }) => {
  await registerUser(page);
  const book = await seedBook(page, '正在协作的设定');
  await page.route('**/api/world-books/complete-draft', async route => {
    const change = updateChange(book, book.entries[0], '助手草稿');
    return reply(route, { workspace: { version: 1, activeRef: change.ref, selectedBookIds: [book.id], targets: [{ ...target(book), upserts: change.upserts }, newTarget] }, changes: [change, newChange], reply: '两份变更待应用。' });
  });
  await page.goto(`/#/world-books/${book.id}`);
  const panel = page.locator('.worldbook-ai-panel');
  await panel.getByRole('textbox').fill('修改当前书，同时新建一本');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(2);
  await apiRequest(page, `/api/world-books/${book.id}/entries/${book.entries[0].id}`, { method: 'PUT', body: { content: '其他窗口保存的内容' } });
  await panel.getByRole('button', { name: '应用 2 项变更', exact: true }).click();
  await expect(page.locator('.message-toast')).toContainText(['已发生变化']);
  await expect(panel.locator('.worldbook-change')).toHaveCount(2);
  expect((await apiRequest(page, '/api/world-books')).filter(item => item.name === '远航手册')).toHaveLength(0);
  await panel.locator('.worldbook-change-detail summary').first().click();
  await panel.getByRole('button', { name: '重新读取原书', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(1);
  await expect(panel.locator('.worldbook-change')).toContainText('远航手册');
  await panel.locator('.worldbook-change-detail summary').click();
  await panel.getByRole('button', { name: '放弃此项', exact: true }).click();
  await expect(panel.locator('.worldbook-change')).toHaveCount(0);
  expect((await apiRequest(page, `/api/world-books/${book.id}`)).entries[0].content).toBe('其他窗口保存的内容');
});
