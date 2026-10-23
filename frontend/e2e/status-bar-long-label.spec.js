import { expect, test } from '@playwright/test';

const variableName = '角色状态变量名称'.repeat(5);
const template = `<div class="sb-card"><div class="sb-row"><span class="sb-label">${variableName}</span><span class="sb-val">{{HP}} / {{HP.max}}</span></div></div>`;

async function mountStatusBar(page) {
  await page.goto('/#/login');
  await page.evaluate(async ({ source }) => {
    const Vue = await import('/node_modules/.vite/deps/vue.js');
    const { default: StatusBar } = await import('/src/components/StatusBar.vue');
    const host = document.createElement('section');
    host.id = 'long-label-harness';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#f7f9fc;padding:20px';
    document.body.appendChild(host);
    const bar = Vue.reactive({
      id: 'long-label-fixture',
      name: 'Long label fixture',
      template: source,
      variables: [{ name: 'HP', type: 'meter', value: 75, max: 100 }]
    });
    const app = Vue.createApp({ render: () => Vue.h(StatusBar, { statusBar: bar, embedded: true }) });
    app.mount(host);
    window.__longLabelHarness = { unmount: () => { app.unmount(); host.remove(); } };
  }, { source: template });

  const host = page.locator('#long-label-harness');
  await expect(host.locator('.sb-label')).toHaveText(variableName);
  await expect(host.locator('.sb-val')).toHaveText('75 / 100');
  return host;
}

test('long custom status labels wrap without clipping values on desktop and mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const host = await mountStatusBar(page);
  const row = host.locator('.sb-row');
  const label = host.locator('.sb-label');
  const value = host.locator('.sb-val');

  await expect.poll(() => row.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('status-bar-long-label-desktop.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await row.evaluate((element) => {
    const labelElement = element.querySelector('.sb-label');
    const valueElement = element.querySelector('.sb-val');
    const labelStyle = getComputedStyle(labelElement);
    const labelRect = labelElement.getBoundingClientRect();
    const valueRect = valueElement.getBoundingClientRect();
    return {
      rowWidth: element.clientWidth,
      rowScrollWidth: element.scrollWidth,
      labelHeight: labelRect.height,
      labelLineHeight: Number.parseFloat(labelStyle.lineHeight),
      valueLeft: valueRect.left,
      valueRight: valueRect.right,
      valueWidth: valueRect.width,
      viewportWidth: innerWidth
    };
  });

  expect(mobileLayout.rowScrollWidth - mobileLayout.rowWidth).toBeLessThanOrEqual(1);
  expect(mobileLayout.labelHeight).toBeGreaterThan(mobileLayout.labelLineHeight);
  expect(mobileLayout.valueWidth).toBeGreaterThan(0);
  expect(mobileLayout.valueRight).toBeLessThanOrEqual(mobileLayout.viewportWidth);
  await expect(value).toHaveText('75 / 100');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('status-bar-long-label-mobile.png'), animations: 'disabled' });

  await page.evaluate(() => window.__longLabelHarness.unmount());
});
