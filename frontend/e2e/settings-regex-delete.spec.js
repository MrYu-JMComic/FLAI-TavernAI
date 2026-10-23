import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

for (const viewport of [{ width: 959, height: 930 }, { width: 390, height: 844 }]) {
  test(`regex deletion can be cancelled and persists after confirmation at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await registerUser(page);
    const character = await apiRequest(page, '/api/characters', { method: 'POST', body: {
      name: `正则删除验证 ${uniqueSuffix()}`,
      persona: '用于验证正则管理的独立测试角色。',
      openingMessage: '欢迎来到测试世界。',
      regexRules: [
        { label: '保留输出替换', pattern: 'user', replacement: 'traveler', flags: 'g', scope: 'output', enabled: true, groupName: '保留分组' },
        { label: '待删除禁用规则', pattern: '指甲|血丝', replacement: '', flags: 'g', scope: 'output', enabled: false, groupName: '删除分组' }
      ]
    } });
    const [keepRule, deleteRule] = character.regexRules;
    const deleteRequests = [];
    const deleteStatuses = [];
    page.on('request', request => {
      if (request.method() === 'DELETE' && request.url().includes('/api/regex-rules/')) {
        deleteRequests.push(request.url());
      }
    });
    page.on('response', response => {
      if (response.request().method() === 'DELETE' && response.url().includes('/api/regex-rules/')) {
        deleteStatuses.push(response.status());
      }
    });
    await page.goto('/#/extensions');
    await page.getByRole('button', { name: '正则规则', exact: true }).click();
    const panel = page.locator('#extension-section-regex');
    const cards = panel.locator('.regex-rule-card');
    const deleteButton = panel.getByRole('button', { name: `删除正则规则：${deleteRule.label}`, exact: true });
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: deleteRule.label })).toHaveClass(/disabled/);
    await expect(deleteButton).toBeEnabled();

    const cancelledDialog = page.waitForEvent('dialog');
    const cancelledClick = deleteButton.click();
    const cancellation = await cancelledDialog;
    expect(cancellation.type()).toBe('confirm');
    expect(cancellation.message()).toContain(deleteRule.label);
    await cancellation.dismiss();
    await cancelledClick;
    await expect(cards).toHaveCount(2);
    expect(deleteRequests).toHaveLength(0);
    expect((await apiRequest(page, `/api/characters/${character.id}`)).regexRules).toEqual(character.regexRules);

    const confirmedDialog = page.waitForEvent('dialog');
    const confirmedClick = deleteButton.click();
    await (await confirmedDialog).accept();
    await confirmedClick;
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(keepRule.label);
    await expect(deleteButton).toHaveCount(0);
    // The API client may refresh an expired CSRF token before retrying.
    expect([[200], [403, 200], [419, 200]]).toContainEqual(deleteStatuses);
    expect(new URL(deleteRequests[0]).pathname).toBe(`/api/regex-rules/${deleteRule.id}`);
    await expect(panel.getByRole('combobox').getByRole('option')).toHaveText(['全部分组', '保留分组']);

    await page.reload();
    await page.getByRole('button', { name: '正则规则', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(keepRule.label);
    await expect(panel.getByRole('button', { name: `禁用正则规则：${keepRule.label}`, exact: true })).toBeEnabled();
    expect((await apiRequest(page, `/api/characters/${character.id}`)).regexRules).toEqual([keepRule]);
    expect(await apiRequest(page, '/api/regex-rules')).toEqual([
      expect.objectContaining({ id: keepRule.id, label: keepRule.label, enabled: true })
    ]);
    await panel.screenshot({ path: testInfo.outputPath(`regex-delete-${viewport.width}.png`), animations: 'disabled' });
  });
}
