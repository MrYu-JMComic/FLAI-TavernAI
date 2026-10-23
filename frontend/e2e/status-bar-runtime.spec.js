import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

function runtimeTemplate(config) {
  return JSON.stringify({ renderer: 'runtime', framework: 'vue', html: '', css: '', javascript: '', ...config });
}

test('chat runtime saves variable interactions and updates Vue without restarting its script', async ({ page }) => {
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Runtime ${uniqueSuffix()}`, openingMessage: 'The runtime test begins here.' }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  const template = runtimeTemplate({
    html: `<section><output id="hp">{{ values.HP }}</output>
      <output id="boot">{{ bootId }}</output>
      <button @click="api.setVariable('HP', values.HP + 1)">Add HP</button>
      <button @click="api.quickReply('Runtime quick reply')">Quick reply</button></section>`,
    javascript: 'const bootId = crypto.randomUUID(); return { bootId };'
  });
  await apiRequest(page, `/api/conversations/${conversation.id}/status-bar`, {
    method: 'PUT', body: { name: 'Runtime status', variables: [{ name: 'HP', type: 'number', value: 5 }], template }
  });
  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.getByText('The runtime test begins here.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开完整角色状态', exact: true }).click();
  const runtime = page.frameLocator('.chat-status-details iframe[title="自定义状态栏"]');
  await expect(runtime.locator('#hp')).toHaveText('5');
  const bootId = await runtime.locator('#boot').textContent();
  const saved = page.waitForResponse((response) => response.url().endsWith(`/conversations/${conversation.id}/status-bar`)
    && response.request().method() === 'PUT' && response.ok());
  await runtime.getByRole('button', { name: 'Add HP', exact: true }).click();
  await saved;
  await expect(runtime.locator('#hp')).toHaveText('6');
  await expect(runtime.locator('#boot')).toHaveText(bootId);
  const persisted = await apiRequest(page, `/api/conversations/${conversation.id}/status-bar`);
  expect(persisted.variables.find((variable) => variable.name === 'HP').value).toBe(6);
  expect(persisted.template).toBe(template);
  await runtime.getByRole('button', { name: 'Quick reply', exact: true }).click();
  await expect(page.locator('.deep-composer textarea')).toHaveValue('Runtime quick reply');
  await expect(page.locator('.runtime-error')).toHaveCount(0);

  await page.reload();
  const expand = page.getByRole('button', { name: '展开完整角色状态', exact: true });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(runtime.locator('#hp')).toHaveText('6');
});

test('custom display templates execute scripts once and keep DOM listeners through saved variable updates', async ({ page }) => {
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Custom script ${uniqueSuffix()}`, openingMessage: 'The custom template test begins here.' }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  const template = `<section id="custom-panel">
    <p>HP: <span id="custom-hp">{{HP}}</span></p>
    <output id="custom-boot"></output>
    <output id="custom-dom-ready"></output>
    <output id="custom-observed-hp"></output>
    {{#if HP > 6}}<p id="custom-condition">HP condition updated</p>{{/if}}
    <button id="custom-add" type="button">Add custom HP</button>
    <button id="custom-reply" type="button">Custom quick reply</button>
    <button data-sb-action="adjust" data-sb-var="HP" data-sb-delta="3">Add declared HP</button>
    <button data-sb-action="quick-reply" data-sb-text="Declared template reply">Declared quick reply</button>
    <button data-sb-action="toggle" data-sb-target=".custom-details">Toggle custom details</button>
    <p class="custom-details sb-hidden">Custom details remain open</p>
  </section>
  <script type="application/json" id="custom-data">{"reply":"Custom template reply"}</script>
  <script>
    window.customTemplateBootId = crypto.randomUUID();
    document.getElementById('custom-boot').textContent = window.customTemplateBootId;
    const addButton = document.getElementById('custom-add');
    window.customTemplateAddButton = addButton;
    addButton.addEventListener('click', () => api.setVariable('HP', values.HP + 1));
    const templateData = JSON.parse(document.getElementById('custom-data').textContent);
    document.getElementById('custom-reply').addEventListener('click', () => api.quickReply(templateData.reply));
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('custom-dom-ready').textContent = 'DOMContentLoaded ready';
    });
    const renderObservedHp = () => {
      document.getElementById('custom-observed-hp').textContent = String(values.HP);
    };
    renderObservedHp();
    api.onUpdate(renderObservedHp);
    const sibling = document.createElement('small');
    sibling.id = 'custom-inserted-sibling';
    sibling.textContent = 'Script-owned sibling';
    document.getElementById('custom-hp').before(sibling);
  </script>`;
  await apiRequest(page, `/api/conversations/${conversation.id}/status-bar`, {
    method: 'PUT', body: { name: 'Custom scripted status', variables: [{ name: 'HP', type: 'number', value: 5 }], template }
  });
  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.getByText('The custom template test begins here.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开完整角色状态', exact: true }).click();
  const runtime = page.frameLocator('.chat-status-details iframe[title="自定义状态栏"]');
  await expect(runtime.locator('#custom-hp')).toHaveText('5');
  await expect(runtime.locator('#custom-boot')).not.toBeEmpty();
  await expect(runtime.locator('#custom-dom-ready')).toHaveText('DOMContentLoaded ready');
  await expect(runtime.locator('#custom-observed-hp')).toHaveText('5');
  await expect(runtime.locator('#custom-condition')).toHaveCount(0);
  await expect(runtime.locator('#custom-inserted-sibling + #custom-hp')).toHaveText('5');
  const bootId = await runtime.locator('#custom-boot').textContent();
  const visibleText = await runtime.locator('body').innerText();
  expect(visibleText).not.toContain('window.customTemplateBootId');
  expect(visibleText).not.toContain('{"reply":"Custom template reply"}');
  await expect(runtime.locator('#custom-data')).toHaveAttribute('type', 'application/json');
  await expect(runtime.locator('.custom-details')).toBeHidden();
  await runtime.getByRole('button', { name: 'Toggle custom details', exact: true }).click();
  await expect(runtime.locator('.custom-details')).toBeVisible();

  for (const value of [6, 7]) {
    const saved = page.waitForResponse((response) => response.url().endsWith(`/conversations/${conversation.id}/status-bar`)
      && response.request().method() === 'PUT' && response.ok());
    await runtime.getByRole('button', { name: 'Add custom HP', exact: true }).click();
    await saved;
    await expect(runtime.locator('#custom-hp')).toHaveText(String(value));
    await expect(runtime.locator('#custom-observed-hp')).toHaveText(String(value));
    await expect(runtime.locator('#custom-inserted-sibling + #custom-hp')).toHaveText(String(value));
    await expect(runtime.locator('#custom-boot')).toHaveText(bootId);
    await expect(runtime.locator('.custom-details')).toBeVisible();
    expect(await runtime.locator('#custom-add').evaluate((button) => button === window.customTemplateAddButton)).toBe(true);
  }
  const declaredSaved = page.waitForResponse((response) => response.url().endsWith(`/conversations/${conversation.id}/status-bar`)
    && response.request().method() === 'PUT' && response.ok());
  await runtime.getByRole('button', { name: 'Add declared HP', exact: true }).click();
  await declaredSaved;
  await expect(runtime.locator('#custom-hp')).toHaveText('10');
  await expect(runtime.locator('#custom-condition')).toHaveText('HP condition updated');
  await expect(runtime.locator('#custom-observed-hp')).toHaveText('10');
  await expect(runtime.locator('#custom-inserted-sibling + #custom-hp')).toHaveText('10');
  await expect(runtime.locator('#custom-boot')).toHaveText(bootId);
  await runtime.getByRole('button', { name: 'Declared quick reply', exact: true }).click();
  await expect(page.locator('.deep-composer textarea')).toHaveValue('Declared template reply');
  await runtime.getByRole('button', { name: 'Custom quick reply', exact: true }).click();
  await expect(page.locator('.deep-composer textarea')).toHaveValue('Declared template reply\nCustom template reply');
  await runtime.getByRole('button', { name: 'Toggle custom details', exact: true }).click();
  await expect(runtime.locator('.custom-details')).toBeHidden();
  await expect(page.locator('.runtime-error')).toHaveCount(0);
  const persisted = await apiRequest(page, `/api/conversations/${conversation.id}/status-bar`);
  expect(persisted.variables.find((variable) => variable.name === 'HP').value).toBe(10);
  expect(persisted.template).toBe(template);
});

test('custom display template errors can rerun and source changes dispose the old script', async ({ page }) => {
  await registerUser(page);
  const healthyTemplate = `<output id="custom-lifecycle-ready">Custom lifecycle ready</output>
    <script>
      parent.__customTemplateLifecycleEvents.push('healthy-run');
      api.onCleanup(() => parent.__customTemplateLifecycleEvents.push('healthy-cleanup'));
    </script>`;
  await page.evaluate(async (template) => {
    const Vue = await import('/node_modules/.vite/deps/vue.js');
    const { default: StatusBar } = await import('/src/components/StatusBar.vue');
    const host = document.createElement('section');
    host.id = 'custom-template-lifecycle-harness';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#17253d;overflow:auto';
    document.body.appendChild(host);
    window.__customTemplateLifecycleEvents = [];
    const bar = Vue.reactive({ id: 'custom-lifecycle', name: 'Custom lifecycle', template, variables: [] });
    const app = Vue.createApp({ render: () => Vue.h(StatusBar, { statusBar: bar, embedded: true }) });
    app.mount(host);
    window.__customTemplateLifecycleHarness = { bar, unmount: () => app.unmount() };
  }, healthyTemplate);
  const host = page.locator('#custom-template-lifecycle-harness');
  const runtime = page.frameLocator('#custom-template-lifecycle-harness iframe');
  await expect(runtime.locator('#custom-lifecycle-ready')).toHaveText('Custom lifecycle ready');
  await expect.poll(() => page.evaluate(() => window.__customTemplateLifecycleEvents)).toEqual(['healthy-run']);

  const failingTemplate = `<p>Custom template error</p><script>
    parent.__customTemplateLifecycleEvents.push('failing-run');
    api.onCleanup(() => parent.__customTemplateLifecycleEvents.push('failing-cleanup'));
    throw new Error('custom template failure');
  </script>`;
  await page.evaluate((template) => { window.__customTemplateLifecycleHarness.bar.template = template; }, failingTemplate);
  const errorPanel = host.locator('.runtime-error');
  await expect(errorPanel).toContainText('custom template failure');
  await expect.poll(() => page.evaluate(() => window.__customTemplateLifecycleEvents)).toEqual([
    'healthy-run', 'healthy-cleanup', 'failing-run'
  ]);
  await errorPanel.getByRole('button', { name: '重新运行', exact: true }).click();
  await expect(errorPanel).toContainText('custom template failure');
  await expect.poll(() => page.evaluate(() => window.__customTemplateLifecycleEvents)).toEqual([
    'healthy-run', 'healthy-cleanup', 'failing-run', 'failing-cleanup', 'failing-run'
  ]);
  await page.evaluate((template) => { window.__customTemplateLifecycleHarness.bar.template = template; }, healthyTemplate);
  await expect(runtime.locator('#custom-lifecycle-ready')).toHaveText('Custom lifecycle ready');
  await expect(errorPanel).toHaveCount(0);
  await expect(host.locator('.runtime-loading')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__customTemplateLifecycleEvents)).toEqual([
    'healthy-run', 'healthy-cleanup', 'failing-run', 'failing-cleanup', 'failing-run', 'failing-cleanup', 'healthy-run'
  ]);
  await page.evaluate(() => window.__customTemplateLifecycleHarness.unmount());
  await expect(host.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__customTemplateLifecycleEvents.at(-1))).toBe('healthy-cleanup');
});

test('custom display templates without scripts retain their host rendering and declarative actions', async ({ page }) => {
  await registerUser(page);
  await page.evaluate(async () => {
    const Vue = await import('/node_modules/.vite/deps/vue.js');
    const { default: StatusBar } = await import('/src/components/StatusBar.vue');
    const host = document.createElement('section');
    host.id = 'plain-status-template-harness';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#17253d;overflow:auto';
    document.body.appendChild(host);
    const bar = Vue.reactive({
      id: 'plain-template', name: 'Plain template', variables: [{ name: 'HP', type: 'number', value: 5 }],
      template: `<section class="plain-template-panel"><strong>{{HP}}</strong>
        {{#if HP > 5}}<p>HP increased</p>{{else}}<p>Original HP</p>{{/if}}
        <button data-sb-action="adjust" data-sb-var="HP" data-sb-delta="1">Add plain HP</button>
        <button data-sb-action="quick-reply" data-sb-text="Plain template reply">Plain quick reply</button></section>`
    });
    window.__plainTemplateReplies = [];
    const app = Vue.createApp({ render: () => Vue.h(StatusBar, {
      statusBar: bar, embedded: true,
      onUpdateVariables: (updates) => {
        for (const update of updates) Object.assign(bar.variables.find((variable) => variable.name === update.name), update);
      },
      onQuickReply: (text) => window.__plainTemplateReplies.push(text)
    }) });
    app.mount(host);
  });
  const host = page.locator('#plain-status-template-harness');
  await expect(host.locator('iframe')).toHaveCount(0);
  await expect(host.locator('.plain-template-panel strong')).toHaveText('5');
  await expect(host.getByText('Original HP', { exact: true })).toBeVisible();
  await host.getByRole('button', { name: 'Add plain HP', exact: true }).click();
  await expect(host.locator('.plain-template-panel strong')).toHaveText('6');
  await expect(host.getByText('HP increased', { exact: true })).toBeVisible();
  await host.getByRole('button', { name: 'Plain quick reply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__plainTemplateReplies)).toEqual(['Plain template reply']);
  await expect(host.locator('iframe')).toHaveCount(0);
});

test('custom template external scripts, DOM ready handlers and import maps follow browser loading order', async ({ page }) => {
  await registerUser(page);
  await page.context().route('**/status-template-library.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ contentType: 'text/javascript', body: "window.libraryLabel = 'External ready';" });
  });
  await page.context().route('**/status-template-module.js', (route) => route.fulfill({
    contentType: 'text/javascript', body: "export const label = 'Module ready';"
  }));
  const template = `<output id="external-ready">Waiting</output><output id="module-ready">Waiting</output>
    <script src="/status-template-library.js"></script>
    <script>document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('external-ready').textContent = window.libraryLabel;
    });</script>
    <script type="importmap">{"imports":{"status-probe":"/status-template-module.js"}}</script>
    <script type="module">import {label} from 'status-probe';
      document.getElementById('module-ready').textContent = label;</script>`;
  await page.evaluate(async (template) => {
    const Vue = await import('/node_modules/.vite/deps/vue.js');
    const { default: StatusBar } = await import('/src/components/StatusBar.vue');
    const host = document.createElement('section');
    host.id = 'external-script-template-harness';
    document.body.appendChild(host);
    Vue.createApp({ render: () => Vue.h(StatusBar, { embedded: true,
      statusBar: { id: 'external-script-template', template, variables: [] }
    }) }).mount(host);
  }, template);
  const runtime = page.frameLocator('#external-script-template-harness iframe');
  await expect(runtime.locator('#external-ready')).toHaveText('External ready');
  await expect(runtime.locator('#module-ready')).toHaveText('Module ready');
  await expect(page.locator('#external-script-template-harness .runtime-error')).toHaveCount(0);
  await expect(page.locator('#external-script-template-harness .runtime-loading')).toHaveCount(0);
});

test('runtime lifecycles clean up across code changes and content height can shrink', async ({ page }) => {
  await registerUser(page);
  const vueTemplate = runtimeTemplate({
    html: `<section :style="{ height: expanded ? '640px' : '64px' }">
      <button @click="expanded = false">Shrink panel</button><span id="vue-ready">Vue ready</span></section>`,
    javascript: `Vue.onMounted(() => parent.__statusRuntimeEvents.push('vue-mounted'));
Vue.onUnmounted(() => parent.__statusRuntimeEvents.push('vue-unmounted'));
api.onCleanup(() => parent.__statusRuntimeEvents.push('vue-cleanup'));
const expanded = Vue.ref(true); return { expanded };`
  });
  await page.evaluate(async (template) => {
    const Vue = await import('/node_modules/.vite/deps/vue.js');
    const { default: StatusBarRuntime } = await import('/src/components/StatusBarRuntime.vue');
    const host = document.createElement('section');
    host.id = 'status-runtime-harness';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#17253d;overflow:auto';
    document.body.appendChild(host);
    window.__statusRuntimeEvents = [];
    const bar = Vue.reactive({ id: 'lifecycle-runtime', name: 'Lifecycle', template, variables: [] });
    const app = Vue.createApp({ render: () => Vue.h(StatusBarRuntime, {
      statusBar: bar,
      onQuickReply: (text) => window.__statusRuntimeEvents.push(`reply:${text}`)
    }) });
    app.mount(host);
    window.__statusRuntimeHarness = { bar, unmount: () => app.unmount() };
  }, vueTemplate);
  const frame = page.locator('#status-runtime-harness iframe');
  const runtime = page.frameLocator('#status-runtime-harness iframe');
  await expect(runtime.locator('#vue-ready')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__statusRuntimeEvents)).toEqual(['vue-mounted']);
  await expect.poll(() => frame.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(640);
  await runtime.getByRole('button', { name: 'Shrink panel', exact: true }).click();
  await expect.poll(() => frame.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(150);

  const htmlTemplate = runtimeTemplate({
    framework: 'html',
    html: `<script>parent.__statusRuntimeEvents.push('html-script');</script>
      <output id="html-value">HTML ready</output>
      <button onclick="document.getElementById('html-value').textContent = 'HTML clicked'; api.quickReply('from HTML')">HTML event</button>`,
    javascript: "api.onCleanup(() => parent.__statusRuntimeEvents.push('html-cleanup'));"
  });
  await page.evaluate((template) => { window.__statusRuntimeHarness.bar.template = template; }, htmlTemplate);
  await expect(runtime.locator('#html-value')).toHaveText('HTML ready');
  await expect.poll(() => page.evaluate(() => window.__statusRuntimeEvents)).toEqual([
    'vue-mounted', 'vue-unmounted', 'vue-cleanup', 'html-script'
  ]);
  await runtime.getByRole('button', { name: 'HTML event', exact: true }).click();
  await expect(runtime.locator('#html-value')).toHaveText('HTML clicked');
  await expect.poll(() => page.evaluate(() => window.__statusRuntimeEvents.at(-1))).toBe('reply:from HTML');

  const failingTemplate = runtimeTemplate({
    framework: 'html',
    javascript: "parent.__statusRuntimeEvents.push('failing-run'); throw new Error('runtime failure');"
  });
  await page.evaluate((template) => { window.__statusRuntimeHarness.bar.template = template; }, failingTemplate);
  const errorPanel = page.locator('#status-runtime-harness .runtime-error');
  await expect(errorPanel).toContainText('runtime failure');
  await expect.poll(() => page.evaluate(() => window.__statusRuntimeEvents.filter((event) => event === 'failing-run').length)).toBe(1);
  await errorPanel.getByRole('button', { name: '重新运行', exact: true }).click();
  await expect(errorPanel).toContainText('runtime failure');
  await expect.poll(() => page.evaluate(() => window.__statusRuntimeEvents.filter((event) => event === 'failing-run').length)).toBe(2);
  await page.evaluate((template) => { window.__statusRuntimeHarness.bar.template = template; }, htmlTemplate);
  await expect(runtime.locator('#html-value')).toHaveText('HTML ready');
  await expect(errorPanel).toHaveCount(0);
  await expect(page.locator('#status-runtime-harness .runtime-loading')).toHaveCount(0);

  const eventCount = await page.evaluate(() => window.__statusRuntimeEvents.length);
  await page.evaluate(() => { window.__statusRuntimeHarness.bar.id = 'next-bar'; });
  await expect.poll(() => page.evaluate((count) => window.__statusRuntimeEvents.slice(count), eventCount))
    .toEqual(['html-cleanup', 'html-script']);
  await expect(runtime.locator('#html-value')).toHaveText('HTML ready');
  await expect(page.locator('#status-runtime-harness .runtime-loading')).toHaveCount(0);

  await page.evaluate(() => window.__statusRuntimeHarness.unmount());
  await expect(frame).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__statusRuntimeEvents.at(-1))).toBe('html-cleanup');
});
