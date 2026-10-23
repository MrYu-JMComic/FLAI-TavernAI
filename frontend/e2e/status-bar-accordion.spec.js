import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectStatusTemplateReferences } from '../../shared/statusTemplateRenderer.js';

const accordionTemplate = readFileSync(new URL('../../docs/examples/status-bar-accordion-template.html', import.meta.url), 'utf8');

function buildTemplateVariables(template) {
  const references = collectStatusTemplateReferences(template);
  const meterNames = new Set(references.filter((reference) => (
    ['max', 'min', 'percent', 'percentage', 'color'].includes(reference.rawProperty)
  )).map((reference) => reference.rawName));
  return [...new Set(references.map((reference) => reference.rawName))].map((name) => (
    meterNames.has(name)
      ? { name, type: 'meter', value: 40, max: 100, color: '#d67b52' }
      : { name, type: 'text', value: 'Sample' }
  ));
}

async function mountAccordionTemplate(page, template = accordionTemplate) {
  await page.goto('/#/login');
  await page.evaluate(async ({ source, variables }) => {
    const Vue = await import('/node_modules/.vite/deps/vue.js');
    const { default: StatusBar } = await import('/src/components/StatusBar.vue');
    const host = document.createElement('section');
    host.id = 'accordion-template-harness';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#17253d;overflow:auto';
    document.body.appendChild(host);
    const bar = Vue.reactive({ id: 'accordion-example', name: 'Accordion example', template: source, variables });
    const app = Vue.createApp({ render: () => Vue.h(StatusBar, {
      statusBar: bar, context: { char: 'Example character' }
    }) });
    app.mount(host);
    window.__accordionTemplateHarness = { bar, unmount: () => app.unmount() };
  }, { source: template, variables: buildTemplateVariables(template) });
  const host = page.locator('#accordion-template-harness');
  const runtime = page.frameLocator('#accordion-template-harness iframe');
  await expect(runtime.locator('.sb-accordion')).toHaveCount(9);
  await expect(host.locator('.runtime-loading')).toHaveCount(0);
  return { host, runtime };
}

test('accordion example keeps sections independent and updates authored meter colors and widths', async ({ page }) => {
  const { host, runtime } = await mountAccordionTemplate(page);
  const panels = runtime.locator('.sb-accordion-content');
  const titles = runtime.locator('.sb-accordion-title');
  const fill = runtime.locator('.sb-fill').first();
  await expect(panels.nth(0)).toBeVisible();
  await expect(panels.nth(1)).toBeVisible();
  await expect(panels.nth(7)).toBeHidden();
  expect(await fill.evaluate((element) => element.style.width)).toBe('40%');
  await expect(fill).toHaveCSS('background-color', 'rgb(214, 123, 82)');
  await expect.poll(() => fill.evaluate((element) => (
    element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width
  ))).toBeCloseTo(0.4, 2);

  await titles.nth(0).click();
  await expect(panels.nth(0)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
  await expect(panels.nth(2)).toBeVisible();
  await titles.nth(7).click();
  await expect(panels.nth(7)).toBeVisible();
  await expect(panels.nth(8)).toBeHidden();
  await expect(host.locator('.flai-statusbar-collapsed-card')).toHaveCount(0);

  await page.evaluate(() => {
    const variable = window.__accordionTemplateHarness.bar.variables.find((item) => item.type === 'meter');
    variable.value = 75;
    variable.color = '#4a93c7';
  });
  await expect.poll(() => fill.evaluate((element) => element.style.width)).toBe('75%');
  await expect(fill).toHaveCSS('background-color', 'rgb(74, 147, 199)');
  await expect.poll(() => fill.evaluate((element) => (
    element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width
  ))).toBeCloseTo(0.75, 2);
  await expect(panels.nth(0)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
  await expect(panels.nth(7)).toBeVisible();
  await expect(panels.nth(8)).toBeHidden();

  await titles.nth(0).click();
  await expect(panels.nth(0)).toBeVisible();
  await titles.nth(7).click();
  await expect(panels.nth(7)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
  await expect(host.locator('.runtime-error')).toHaveCount(0);
  await page.evaluate(() => window.__accordionTemplateHarness.unmount());
});

test('targeted legacy collapse attributes do not collapse the entire scripted status bar', async ({ page }) => {
  const legacyActions = accordionTemplate.replaceAll('class="sb-accordion-title"', 'class="sb-accordion-title" data-sb-action="collapse"');
  const { host, runtime } = await mountAccordionTemplate(page, legacyActions);
  const panels = runtime.locator('.sb-accordion-content');
  const titles = runtime.locator('.sb-accordion-title');
  await titles.nth(0).click();
  await expect(panels.nth(0)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
  await expect(host.locator('iframe')).toBeVisible();
  await expect(host.locator('.flai-statusbar-collapsed-card')).toHaveCount(0);
  await titles.nth(1).click();
  await expect(panels.nth(1)).toBeHidden();
  await expect(panels.nth(2)).toBeVisible();
  await titles.nth(0).click();
  await expect(panels.nth(0)).toBeVisible();
  await expect(panels.nth(1)).toBeHidden();
  await expect(host.locator('.runtime-error')).toHaveCount(0);
  await page.evaluate(() => window.__accordionTemplateHarness.unmount());
});
