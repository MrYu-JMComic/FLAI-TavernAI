import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

const longPath = 'statusBarBlueprint.variables.' + 'characterStateAndEquipment'.repeat(5);
const notes = '\u7528\u6237\u6838\u5fc3\u8bc9\u6c42\u662f\u53d8\u91cf\u592a\u591a\uff0c\u9700\u8981\u7cbe\u7b80\u4f18\u5316\u3002\u5408\u5e76\u529f\u80fd\u91cd\u53e0\u7684\u53d8\u91cf\uff0c\u4fdd\u7559\u5bf9\u53d9\u4e8b\u6700\u6709\u5f71\u54cd\u529b\u7684\u6838\u5fc3\u72b6\u6001\u3002\u5408\u5e76\u540e\u7684\u6587\u672c\u53d8\u91cf\u80fd\u627f\u8f7d\u539f\u6709\u4fe1\u606f\uff0c\u51cf\u8f7b\u6bcf\u6b21\u66f4\u65b0\u7684\u8d1f\u62c5\u3002'.repeat(3);
const plan = {
  notes,
  risks: [
    `${longPath} \u5c06\u4ece26\u4e2a\u7f29\u51cf\u81f314\u4e2a\uff0c\u88ab\u5220\u9664\u548c\u5408\u5e76\u7684\u53d8\u91cf\u5c06\u4e22\u5931\u72ec\u7acb\u6570\u636e\u3002`,
    'statusBarPrompt \u5c06\u88ab\u91cd\u5199\u4ee5\u5339\u914d\u65b0\u53d8\u91cf\u7ed3\u6784\uff0c\u539f\u6709\u7684\u8be6\u7ec6\u6570\u503c\u5206\u6bb5\u8bf4\u660e\u4f1a\u88ab\u7cbe\u7b80\u3002',
    'statusBarBlueprint.template \u5c06\u88ab\u91cd\u5199\u4ee5\u9002\u914d\u65b0\u7684\u5361\u7247\u5e03\u5c40\uff0c\u539f\u6709\u7684\u5361\u7247\u7ed3\u6784\u548c\u5bf9\u5e94\u6837\u5f0f\u4f1a\u88ab\u66ff\u6362\u3002'
  ],
  steps: [
    {
      id: 'advanced-variables',
      section: 'advancedSettings',
      intent: '\u7cbe\u7b80\u72b6\u6001\u680f\u53d8\u91cf\uff0c\u5c0626\u4e2a\u53d8\u91cf\u5408\u5e76\u4e3a14\u4e2a\uff0c\u4fdd\u7559\u4f53\u529b\u3001\u75bc\u75db\u548c\u6b32\u671b\u3002',
      detail: `${longPath}\n\u4fdd\u7559\u539f\u6709\u53d9\u4e8b\u4fe1\u606f\uff0c\u4e0d\u4fee\u6539\u89d2\u8272\u80cc\u666f\u548c\u4eba\u8bbe\u3002`
    },
    {
      id: 'advanced-template',
      section: 'advancedSettings',
      intent: '\u8c03\u6574\u72b6\u6001\u680f\u6a21\u677f\u5e03\u5c40\u5e76\u4fdd\u6301\u624b\u673a\u7aef\u6587\u672c\u5b8c\u6574\u663e\u793a\u3002',
      detail: '\u4f7f\u7528\u65b0\u53d8\u91cf\u7ed3\u6784\uff0c\u68c0\u67e5\u6240\u6709\u5360\u4f4d\u7b26\u3002'
    }
  ]
};

const viewports = [
  { width: 320, height: 740 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 }
];

for (const viewport of viewports) {
  test(`AI plan review stays readable and editable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await registerUser(page, uniqueSuffix());
    const character = await apiRequest(page, '/api/characters', {
      method: 'POST',
      body: { name: `Plan layout ${uniqueSuffix()}`, persona: '\u51b7\u9759\u3001\u5c0a\u91cd\u4e8b\u5b9e\u3002' }
    });
    const requests = [];
    await page.route('**/api/characters/complete-draft', async (route) => {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      const result = payload.plan?.approved
        ? {
          character: payload.character,
          process: [],
          toolCalls: [],
          warnings: [],
          planProgress: { steps: payload.plan.steps.map((step) => ({ ...step, status: 'completed' })) }
        }
        : { phase: 'plan', plan, process: [], toolCalls: [], reasoning: '' };
      const current = await apiRequest(page, `/api/character-assistant/sessions/${payload.assistantSessionId}`);
      await apiRequest(page, `/api/character-assistant/sessions/${payload.assistantSessionId}`, {
        method: 'PATCH',
        body: {
          character: result.character || payload.character,
          state: { ...current.state, ...result, plan: payload.plan?.approved ? null : plan,
            planPhase: payload.plan?.approved ? 'done' : 'review',
            status: payload.plan?.approved ? 'completed' : 'review' }
        }
      });
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: [
          ...(!payload.plan?.approved ? [sseEvent('plan', plan)] : []),
          sseEvent('done', result)
        ].join('')
      });
    });

    await page.setViewportSize(viewport);
    await page.goto(`/#/characters/${character.id}/assistant`);
    const panel = page.locator('.character-assistant-page');
    await panel.getByRole('textbox', { name: '给角色助手发送消息' }).fill('\u7cbe\u7b80\u72b6\u6001\u680f\u53d8\u91cf\u5e76\u4fdd\u7559\u6838\u5fc3\u4fe1\u606f');
    await panel.locator('.assistant-plan-toggle').click();
    await expect(panel.locator('.assistant-plan-toggle')).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: '发送消息', exact: true }).click();

    const card = panel.locator('.ai-plan-review');
    await expect(card.locator('.ai-plan-title')).toContainText('\u8ba1\u5212\u5f85\u5ba1\u6279');
    await expect(card.locator('.ai-plan-risks li')).toHaveCount(3);
    await expect(card.locator('.ai-plan-step')).toHaveCount(2);
    await expect(card.locator('.ai-plan-step-section').first()).toHaveText('\u9ad8\u9636\u8bbe\u7f6e');
    for (const close of await page.locator('.message-toast-close').all()) await close.click();
    await expect(page.locator('.message-toast')).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('plan-review-collapsed.png') });
    await card.screenshot({ path: testInfo.outputPath('plan-review-card.png') });
    await card.locator('.ai-plan-head').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('plan-review-header.png') });
    await expectPlanInsideViewport(card);

    for (const details of await card.locator('.ai-plan-step-detail').all()) {
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
    }
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('plan-review-expanded.png') });
    await expectPlanInsideViewport(card);
    for (const name of ['\u6309\u8ba1\u5212\u6267\u884c', '\u91cd\u65b0\u89c4\u5212', '\u653e\u5f03']) {
      const action = card.getByRole('button', { name, exact: true });
      await expect(action).toBeEnabled();
      await action.click({ trial: true });
    }

    await card.getByRole('button', { name: '\u91cd\u65b0\u89c4\u5212', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(card.locator('.ai-plan-title')).toContainText('\u8ba1\u5212\u5f85\u5ba1\u6279');
    await card.getByRole('button', { name: '\u653e\u5f03', exact: true }).click();
    await expect(card).toHaveCount(0);
    await panel.getByRole('textbox', { name: '给角色助手发送消息' }).fill('精简状态栏变量并保留核心信息');
    await panel.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect.poll(() => requests.length).toBe(3);
    await expect(card.locator('.ai-plan-step')).toHaveCount(2);

    const firstStep = card.locator('.ai-plan-step').first();
    const editedIntent = '\u4fdd\u7559\u4f53\u529b\u5e76\u5408\u5e76\u91cd\u590d\u53d8\u91cf';
    const editedDetail = '\u4e0d\u5220\u9664\u73b0\u6709\u53d9\u4e8b\u8bb0\u5fc6';
    const extraRequirement = '\u4fdd\u7559\u539f\u6709\u89d2\u8272\u8bbe\u5b9a';
    await firstStep.getByRole('textbox', { name: '\u6b65\u9aa4\u8bf4\u660e' }).fill(editedIntent);
    await firstStep.locator('summary').click();
    await firstStep.locator('textarea').fill(editedDetail);
    await card.locator('.ai-plan-step').nth(1).getByRole('checkbox').uncheck();
    await expect(card.locator('.ai-plan-title small')).toContainText('1 / 2');
    await card.getByLabel('\u8865\u5145\u8981\u6c42').fill(extraRequirement);
    await card.getByRole('button', { name: '\u6309\u8ba1\u5212\u6267\u884c', exact: true }).click();
    await expect.poll(() => requests.length).toBe(4);
    expect(requests[3].plan).toMatchObject({
      approved: true,
      steps: [{ id: 'advanced-variables', section: 'advancedSettings', intent: editedIntent, detail: editedDetail }],
      extraRequirement
    });
    expect(requests[3].plan.steps).toHaveLength(1);
    await expect(panel.getByRole('textbox', { name: '给角色助手发送消息' })).toHaveValue('');
    await expect(card).toHaveCount(0);
  });
}

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function expectPlanInsideViewport(card) {
  const layout = await card.evaluate((element) => {
    const cardBounds = element.getBoundingClientRect();
    const descendants = Array.from(element.querySelectorAll('*')).filter((node) => node.getClientRects().length > 0);
    const bounds = [element, ...descendants].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        selector: node.className?.baseVal ?? node.className ?? node.tagName,
        left: rect.left,
        right: rect.right,
        overflow: node.scrollWidth - node.clientWidth,
        textControl: node.matches('input, textarea')
      };
    });
    return {
      cardLeft: cardBounds.left,
      cardRight: cardBounds.right,
      viewportWidth: window.innerWidth,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      outsideCard: bounds.filter((node) => node.left < cardBounds.left - 1 || node.right > cardBounds.right + 1),
      overflowingContainers: bounds.filter((node) => !node.textControl && node.overflow > 1)
    };
  });
  expect(layout.cardLeft, JSON.stringify(layout)).toBeGreaterThanOrEqual(0);
  expect(layout.cardRight, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.outsideCard, JSON.stringify(layout)).toEqual([]);
  // Inputs intentionally scroll their value; layout containers must not clip content.
  expect(layout.overflowingContainers, JSON.stringify(layout)).toEqual([]);
  expect(layout.documentOverflow, JSON.stringify(layout)).toBeLessThanOrEqual(1);
}
