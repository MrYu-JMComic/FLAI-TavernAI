import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix, waitForThemeTransition } from './helpers.js';

test('multi-role workspace uses stable cast participants across desktop and mobile', async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = uniqueSuffix();
  await registerUser(page, suffix);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: {
      name: `Multi Role Host ${suffix}`,
      background: 'Hosts a multi-role E2E conversation.',
      worldview: 'A compact operations room.',
      persona: 'Calm and observant.',
      openingMessage: 'The room is ready.',
      visibility: 'private',
    },
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId: character.id },
  });
  const first = await createCastMember(page, conversation.id, `Mira ${suffix}`, 'North Gate');
  const second = await createCastMember(page, conversation.id, `Noah ${suffix}`, 'Archive Hall');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.getByLabel('聊天消息输入')).toBeVisible();
  await page.getByRole('button', { name: '多角色模式' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chat/${conversation.id}/multi-role$`));

  const workspace = page.getByRole('main');
  await expect(workspace.getByRole('heading', { name: '多角色对话' })).toBeVisible();
  const firstParticipant = workspace.getByRole('button', { name: new RegExp(first.canonicalName) });
  const secondParticipant = workspace.getByRole('button', { name: new RegExp(second.canonicalName) });
  await expect(firstParticipant).toHaveAttribute('aria-pressed', 'true');
  await expect(secondParticipant).toHaveAttribute('aria-pressed', 'true');
  await firstParticipant.focus();
  await expect(firstParticipant).toBeFocused();

  const composer = workspace.getByLabel('本轮行动或对话');
  await composer.fill('Report your current position.');
  await workspace.getByRole('button', { name: '生成本轮' }).click();
  const transcript = workspace.getByLabel('多角色对话记录');
  await expect(transcript.locator('.multi-role-turn')).toHaveCount(3, { timeout: 20_000 });
  await expect(transcript.getByText(first.canonicalName, { exact: true })).toBeVisible();
  await expect(transcript.getByText(second.canonicalName, { exact: true })).toBeVisible();
  await expect(workspace.getByText('完成', { exact: true })).toHaveCount(2);
  await expect(composer).toBeEnabled();
  await expect(firstParticipant).toBeEnabled();
  await expect(workspace.getByRole('button', { name: '全选' })).toBeEnabled();

  const accessibility = await new AxeBuilder({ page }).include('.multi-role-page').analyze();
  const seriousViolations = accessibility.violations.filter(({ impact }) => (
    impact === 'serious' || impact === 'critical'
  ));
  expect(seriousViolations).toEqual([]);
  await expectNoDocumentOverflow(page);
  await expectWorkspaceFitsViewport(page);
  await page.screenshot({ path: '../.runtime-check/multi-role-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(firstParticipant).toBeVisible();
  await expect(composer).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expectWorkspaceFitsViewport(page);
  await page.screenshot({ path: '../.runtime-check/multi-role-mobile.png', fullPage: true });

  const scaleStyle = await page.addStyleTag({ content: 'html { font-size: 125% !important; }' });
  await expect(composer).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expectWorkspaceFitsViewport(page);
  await scaleStyle.evaluate((element) => element.remove());

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await waitForThemeTransition(page);
  const darkAccessibility = await new AxeBuilder({ page }).include('.multi-role-page').analyze();
  expect(darkAccessibility.violations.filter(({ impact }) => (
    impact === 'serious' || impact === 'critical'
  ))).toEqual([]);
  await page.screenshot({ path: '../.runtime-check/multi-role-dark.png', fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await waitForThemeTransition(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(firstParticipant).toBeVisible();
  await expect(composer).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expectWorkspaceFitsViewport(page);
  await page.screenshot({ path: '../.runtime-check/multi-role-landscape.png', fullPage: true });

  await workspace.getByRole('button', { name: '返回聊天' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chat/${conversation.id}$`));
  await expect(page.getByLabel('聊天消息输入')).toBeVisible();
});

function createCastMember(page, conversationId, canonicalName, currentLocationLabel) {
  return apiRequest(page, `/api/conversations/${encodeURIComponent(conversationId)}/cast`, {
    method: 'POST',
    body: {
      canonicalName,
      status: 'active',
      relationship: 'ally',
      currentLocationLabel,
    },
  });
}

async function expectNoDocumentOverflow(page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - window.innerWidth
  ));
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectWorkspaceFitsViewport(page) {
  const metrics = await page.evaluate(() => {
    const workspace = document.querySelector('.multi-role-page');
    const composer = document.querySelector('.multi-role-composer');
    const workspaceRect = workspace?.getBoundingClientRect();
    const composerRect = composer?.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      workspaceTop: workspaceRect?.top,
      workspaceBottom: workspaceRect?.bottom,
      composerBottom: composerRect?.bottom,
    };
  });
  expect(Math.abs(metrics.workspaceTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.viewportHeight - metrics.workspaceBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.workspaceBottom - metrics.composerBottom)).toBeLessThanOrEqual(1);
}
