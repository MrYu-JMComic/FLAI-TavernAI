import { expect, test } from '@playwright/test';

const initialValues = { HP0: 0, HP22: 22, HP80: 80, HP100: 100 };
const percentForms = [
  { name: 'numeric', token: (name) => `{{${name}.percentage}}%` },
  { name: 'formatted', token: (name) => `{{${name}.percent}}` },
  { name: 'legacy', token: (name) => `{{${name}.percent}}%` }
];
const scenarios = [
  { theme: 'dark', viewport: { width: 943, height: 930 }, track: 'rgb(41, 54, 73)', fill: 'rgb(117, 200, 192)' },
  { theme: 'light', viewport: { width: 390, height: 844 }, track: 'rgb(216, 224, 235)', fill: 'rgb(40, 138, 130)' }
];

function progressTemplate(theme, scripted) {
  const rows = percentForms.flatMap((form) => Object.keys(initialValues).map((name) => `
    <div class="progress-row ${name}-${form.name}">
      <div class="progress-label"><span>${name} ${form.name}</span><span class="progress-value">{{${name}}} / {{${name}.max}}</span></div>
      <div class="tr"><i style="width:${form.token(name)}"></i></div>
    </div>`)).join('');
  return `<style>
    .progress-fixture { box-sizing:border-box; padding:16px; border-radius:12px; font:14px/1.5 sans-serif; }
    .progress-theme-dark { color:#e4eaf3; background:#17253d; }
    .progress-theme-light { color:#17253d; background:#f7f9fc; }
    .progress-fixture summary { cursor:pointer; margin-bottom:12px; }
    .progress-row { margin:10px 0; }
    .progress-label { display:flex; justify-content:space-between; gap:12px; }
    .progress-fixture .tr { height:8px; overflow:hidden; border-radius:4px; }
    .progress-fixture .tr i { display:block; height:100%; border-radius:inherit; }
    .progress-theme-dark .tr { background:#293649; }
    .progress-theme-dark .tr i { background:#75c8c0; }
    .progress-theme-light .tr { background:#d8e0eb; }
    .progress-theme-light .tr i { background:#288a82; }
  </style>
  <section class="progress-fixture progress-theme-${theme}">
    <details open><summary>Meter details</summary><div class="progress-rows">${rows}</div></details>
    ${scripted ? '<span class="script-boot"></span>' : ''}
  </section>
  ${scripted ? `<script>
    document.querySelector('.script-boot').textContent = crypto.randomUUID();
  </script>` : ''}`;
}

async function mountProgressTemplate(page, scenario, scripted) {
  await page.setViewportSize(scenario.viewport);
  await page.goto('/#/login');
  await page.evaluate(async ({ source, values, theme }) => {
    const Vue = await import('/node_modules/.vite/deps/vue.js');
    const { default: StatusBar } = await import('/src/components/StatusBar.vue');
    const host = document.createElement('section');
    host.id = 'progress-template-harness';
    host.style.cssText = `position:fixed;inset:0;z-index:99999;overflow:auto;background:${theme === 'dark' ? '#17253d' : '#f7f9fc'}`;
    document.body.appendChild(host);
    const bar = Vue.reactive({
      id: 'progress-fixture', name: 'Progress fixture', template: source,
      variables: Object.entries(values).map(([name, value]) => ({ name, type: 'meter', value, max: 100 }))
    });
    const app = Vue.createApp({ render: () => Vue.h(StatusBar, { statusBar: bar, embedded: true }) });
    app.mount(host);
    window.__progressTemplateHarness = { bar, unmount: () => { app.unmount(); host.remove(); } };
  }, { source: progressTemplate(scenario.theme, scripted), values: initialValues, theme: scenario.theme });
  const host = page.locator('#progress-template-harness');
  const surface = scripted ? page.frameLocator('#progress-template-harness iframe') : host;
  await expect(surface.locator('.progress-row')).toHaveCount(12);
  await expect(host.locator('.runtime-loading')).toHaveCount(0);
  return { host, surface };
}

async function expectProportionalMeters(surface, values, scenario) {
  const expected = percentForms.flatMap((form) => Object.entries(values).map(([name, value]) => ({
    key: `${name}-${form.name}`, width: `${value}%`, ratio: value / 100, value: `${value} / 100`
  })));
  await expect.poll(() => surface.locator('.progress-row').evaluateAll((rows) => rows.map((row) => {
    const track = row.querySelector('.tr');
    const fill = track.querySelector('i');
    return {
      key: [...row.classList].find((name) => name !== 'progress-row'),
      width: fill.style.width,
      ratio: Math.round(fill.getBoundingClientRect().width / track.getBoundingClientRect().width * 1000) / 1000,
      value: row.querySelector('.progress-value').textContent
    };
  }))).toEqual(expected);

  const presentation = await surface.locator('.tr').evaluateAll((tracks) => tracks.map((track) => {
    const bounds = track.getBoundingClientRect();
    return {
      width: bounds.width, right: bounds.right, height: bounds.height,
      trackColor: getComputedStyle(track).backgroundColor,
      fillColor: getComputedStyle(track.querySelector('i')).backgroundColor
    };
  }));
  for (const meter of presentation) {
    expect(meter.width).toBeGreaterThan(200);
    expect(meter.right).toBeLessThanOrEqual(scenario.viewport.width);
    expect(meter.height).toBe(8);
    expect(meter.trackColor).toBe(scenario.track);
    expect(meter.fillColor).toBe(scenario.fill);
    expect(meter.fillColor).not.toBe(meter.trackColor);
  }
}

for (const scripted of [false, true]) {
  for (const scenario of scenarios) {
    test(`${scripted ? 'scripted iframe' : 'plain'} status meters keep legacy percent widths proportional at ${scenario.viewport.width}px in ${scenario.theme}`, async ({ page }) => {
      const { host, surface } = await mountProgressTemplate(page, scenario, scripted);
      await expectProportionalMeters(surface, initialValues, scenario);
      const bootId = scripted ? await surface.locator('.script-boot').textContent() : null;
      if (scripted) expect(bootId).toBeTruthy();

      await page.evaluate(() => {
        window.__progressTemplateHarness.bar.variables.find((variable) => variable.name === 'HP22').value = 55;
      });
      const updatedValues = { ...initialValues, HP22: 55 };
      await expectProportionalMeters(surface, updatedValues, scenario);
      if (scripted) await expect(surface.locator('.script-boot')).toHaveText(bootId);

      await surface.locator('summary').click();
      await expect(surface.locator('.progress-rows')).toBeHidden();
      await surface.locator('summary').click();
      await expect(surface.locator('.progress-rows')).toBeVisible();
      await expectProportionalMeters(surface, updatedValues, scenario);
      await expect(host.locator('.runtime-error')).toHaveCount(0);
      await page.evaluate(() => window.__progressTemplateHarness.unmount());
    });
  }
}
