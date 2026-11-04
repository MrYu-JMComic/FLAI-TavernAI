import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`failed opening recovery stays actionable at ${viewport.width}px without provider calls`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await registerUser(page);
    const character = await apiRequest(page, '/api/characters', { method: 'POST', body: { name: `恢复检查 ${uniqueSuffix()}`, openingMessage: '小雪在旧港捡起了黄铜钥匙。' } });
    const conversation = await apiRequest(page, '/api/conversations', { method: 'POST', body: { characterId: character.id } });
    const base = `/api/conversations/${conversation.id}/processing`;
    const failed = { id: 'opening-failed', stage: 'core', status: 'failed', payload: { requiredStages: ['memory'] }, error: { code: 'ERR_SQLITE_ERROR', message: 'table conversation_memories has no column named visibility' } };
    let processing = {
      conversationId: conversation.id, stateStatus: 'needs_review', coreReady: false, corePendingCount: 0, coreFailedCount: 1,
      stages: { core: [{ id: 'older-success', status: 'succeeded' }, failed], summary: [], index: [] },
      job: { ...failed, canRetry: true, coreReady: false, pendingCount: 0, failedCount: 1 }
    };
    let turnCount = 1;
    let confirmations = 0;
    let previews = 0;
    const retriedJobs = [];
    await page.route(`**${base}`, (route) => route.fulfill({ json: processing }));
    await page.route(`**${base}/rebuild`, async (route) => {
      const body = route.request().postDataJSON();
      if (body.confirmed !== true) {
        previews += 1;
        await route.fulfill({ json: { confirmationRequired: true, turnCount } });
        return;
      }
      confirmations += 1;
      expect(body.expectedTurnCount).toBe(turnCount);
      if (confirmations === 1) {
        await route.fulfill({ status: 409, json: { error: '服务端仍在完成数据升级，请稍后重试。', accepted: false } });
        return;
      }
      processing = {
        ...processing, stateStatus: 'ready', coreReady: true, coreFailedCount: 0,
        stages: { core: [{ ...failed, status: 'succeeded', error: null }],
          summary: [{ id: 'summary-done', status: 'succeeded' }, { id: 'summary-working', status: 'running' }],
          index: [{ id: 'index-a', status: 'failed', error: { message: '向量供应商连接超时，可单独重试。' } }, { id: 'index-b', status: 'failed', error: { message: '另一批检索索引尚未完成。' } }] },
        job: { ...failed, status: 'succeeded', error: null, coreReady: true, failedCount: 0 }
      };
      await route.fulfill({ json: { stateStatus: 'ready', jobs: [] } });
    });
    await page.route('**/api/jobs/*/retry', async (route) => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      retriedJobs.push(id);
      processing.stages.index = processing.stages.index.map((job) => job.id === id ? { ...job, status: 'running', error: null } : job);
      await route.fulfill({ status: 202, json: { id, status: 'queued' } });
    });
    await page.goto(`/#/chat/${conversation.id}`);
    await expect(page.getByRole('region', { name: '剧情同步状态' })).toContainText('部分剧情记忆待恢复');
    await expect(page.getByRole('region', { name: '剧情同步状态' })).not.toContainText('visibility');
    await page.screenshot({ path: testInfo.outputPath(`recovery-entry-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    const openRecovery = async () => {
      await page.getByRole('button', { name: '查看记忆', exact: true }).click();
      const inspector = page.getByRole('dialog', { name: '记忆工作台' });
      await inspector.getByText('同步与恢复', { exact: true }).click();
      return inspector.getByRole('region', { name: '剧情同步状态' });
    };
    let panel = await openRecovery();
    await expect(panel.getByRole('alert')).toContainText('请重启后端完成升级');
    await expect(panel.getByRole('button', { name: '重试同步', exact: true })).toBeVisible();
    await assertPanelFits(page, panel);
    await page.screenshot({ path: testInfo.outputPath(`recovery-failed-${viewport.width}.png`), fullPage: true, animations: 'disabled' });

    await panel.getByRole('button', { name: '重建状态', exact: true }).click();
    let confirmation = panel.getByRole('group', { name: '确认剧情状态操作' });
    await expect(confirmation).toContainText('重建 1 轮剧情状态');
    await expect(confirmation).toContainText('可能产生模型调用费用');
    expect(confirmations).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`recovery-confirm-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    await confirmation.getByRole('button', { name: '确认', exact: true }).click();
    await expect(panel.getByRole('alert').filter({ hasText: '操作未完成' })).toContainText('服务端仍在完成数据升级');
    await expect(confirmation).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`recovery-action-error-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    await expect(page.getByRole('button', { name: '关闭通知', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('alert').filter({ hasText: '操作未完成' })).toContainText('服务端仍在完成数据升级');
    await confirmation.getByRole('button', { name: '确认', exact: true }).click();
    await expect(panel).toContainText('可继续对话');
    await expect(panel.getByRole('button', { name: '重试检索索引', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '重试检索索引 2', exact: true })).toBeVisible();
    await assertPanelFits(page, panel);
    await page.screenshot({ path: testInfo.outputPath(`recovery-derived-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    await panel.getByRole('button', { name: '重试检索索引 2', exact: true }).click();
    await expect.poll(() => retriedJobs).toEqual(['index-b']);
    expect(confirmations).toBe(2);

    processing = { conversationId: conversation.id, stateStatus: 'needs_rebuild', coreReady: false, stages: { core: [], summary: [], index: [] }, job: null };
    turnCount = 0;
    await page.reload();
    panel = await openRecovery();
    confirmation = panel.getByRole('group', { name: '确认剧情状态操作' });
    await panel.getByRole('button', { name: '重建状态', exact: true }).click();
    await expect(confirmation).toContainText('本次不发起剧情重建模型调用');
    await expect(confirmation).not.toContainText('可能产生模型调用费用');
    expect(previews).toBe(2);
    expect(confirmations).toBe(2);
    await assertPanelFits(page, panel);
    await page.screenshot({ path: testInfo.outputPath(`recovery-zero-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
  });
}

async function assertPanelFits(page, panel) {
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}
