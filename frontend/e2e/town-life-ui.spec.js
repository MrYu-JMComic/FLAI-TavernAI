import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateProceduralTownMap } from '../../backend/src/modules/townMapGenerator.js';
import { simulateTownLife } from '../../backend/src/modules/townLifeSimulation.js';
import { normalizeTownLifeState } from '../../shared/townLife.js';
import { townWithIntervention } from '../../backend/src/modules/townWorldConditions.js';

async function openTown(page) {
  const kinds = ['apartment', 'office', 'cafe', 'park', 'clinic', 'school'];
  const map = generateProceduralTownMap({ name: 'Riverside', environment: { architecture: 'modern', biome: 'temperate', atmosphere: 'Clear', water: 'river', settlementPattern: 'scattered' }, locations: kinds.map((kind, index) => ({ id: `location-${index}`, name: ['Riverside Apartments', 'Central Office', 'Corner Cafe', 'Riverside Park', 'Community Clinic', 'Local School'][index], kind, importance: 3, description: 'A neighborhood venue with its own services and opening hours.' })), rules: [] }, 'A walkable modern neighborhood');
  let town = { id: 'ui-town', name: 'Riverside', currentDay: 1, minuteOfDay: 600, simulationStatus: 'paused', settings: { tickMinutes: 15, realSecondsPerTick: 4 }, mapConfig: map };
  let residents = ['Lin', 'Maya', 'Alex'].map((name, index) => ({
    id: `resident-${index}`, name, role: ['Designer', 'Teacher', 'Cafe owner'][index],
    currentLocation: map.locations[index].name,
    profile: { summary: 'An independent resident with everyday needs and personal goals.', goal: 'Balance work and time with friends.', activities: ['Read', 'Practice'], simulation: { homeLocationId: 'location-0', workLocationId: index === 1 ? 'location-5' : 'location-1', startingMoney: 120, hourlyWage: 12 } },
    state: { mapX: map.locations[index].x, mapY: map.locations[index].y, currentActivity: 'Planning the day', life: normalizeTownLifeState() }
  }));
  const requests = [];
  const interventions = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'town-ui', username: 'Player' } } });
    if (url.pathname === '/api/settings/provider') return route.fulfill({ json: {} });
    if (url.pathname === '/api/towns') return route.fulfill({ json: [town] });
    if (url.pathname.endsWith('/snapshot')) return route.fulfill({ json: { town, residents, events: [] } });
    if (url.pathname.endsWith('/step')) {
      requests.push('step');
      if (interventions.length) town = townWithIntervention(town, interventions.shift());
      const result = simulateTownLife(town, residents, 15);
      residents = result.residents.map((resident) => ({ ...resident, state: { ...resident.state, currentActivity: resident.state.life.journey ? 'Traveling to work' : resident.state.life.action.kind } }));
      town = { ...town, minuteOfDay: town.minuteOfDay + 15 };
      return route.fulfill({ json: { advanced: true, tickMinutes: 15, snapshot: { town, residents, events: [] } } });
    }
    if (url.pathname.endsWith('/events') && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      const event = { id: 'intervention-1', ...payload };
      interventions.push(event);
      requests.push(payload);
      return route.fulfill({ json: event });
    }
    if (url.pathname.endsWith('/map/rebuild')) {
      const { architecture } = route.request().postDataJSON();
      const rebuilt = generateProceduralTownMap({ name: town.name, environment: { architecture, biome: 'temperate', atmosphere: 'Clear', water: 'river', settlementPattern: 'scattered' }, locations: town.mapConfig.locations, rules: [] }, 'Rebuilt neighborhood');
      town = { ...town, mapConfig: rebuilt };
      residents = residents.map((resident) => {
        const location = rebuilt.locations.find((item) => item.name === resident.currentLocation);
        return { ...resident, state: { ...resident.state, mapX: location.x, mapY: location.y } };
      });
      requests.push('rebuild');
      return route.fulfill({ json: { town, residents, events: [] } });
    }
    if (url.pathname.endsWith('/clock')) {
      const payload = route.request().postDataJSON();
      if (payload.realSecondsPerTick) town = { ...town, settings: { ...town.settings, realSecondsPerTick: payload.realSecondsPerTick } };
      if (payload.simulationStatus) town = { ...town, simulationStatus: payload.simulationStatus };
      requests.push(payload);
      return route.fulfill({ json: town });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/#/town');
  await expect(page.locator('.town-generated-map')).toBeVisible();
  await expect(page.locator('.town-sync-notice')).toHaveCount(0, { timeout: 6000 });
  return requests;
}

test('town life controls operate on persisted simulation state', async ({ page }) => {
  await page.setViewportSize({ width: 451, height: 958 });
  const requests = await openTown(page);
  await expect(page.locator('.town-needs-grid meter')).toHaveCount(5);
  const before = Number(await page.locator('.town-needs-grid meter').first().getAttribute('value'));
  await page.getByRole('button', { name: '\u5355\u6b65\u63a8\u8fdb\u751f\u6d3b\u6a21\u62df' }).click();
  await expect.poll(() => requests.includes('step')).toBe(true);
  await expect.poll(async () => Number(await page.locator('.town-needs-grid meter').first().getAttribute('value'))).toBeLessThan(before);
  await page.locator('.town-speed-control select').selectOption('1');
  await expect.poll(() => requests.some((request) => request.realSecondsPerTick === 1)).toBe(true);
  await page.getByRole('tab').nth(1).click();
  await expect(page.locator('.town-relationship-list button')).toHaveCount(2);
  await page.locator('.town-relationship-list button').first().click();
  await expect(page.locator('.town-needs-grid meter')).toHaveCount(5);
});

test('map camera, venues and reusable asset previews remain interactive', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 451, height: 958 });
  await openTown(page);
  const map = page.locator('.town-map-viewport');
  const stage = page.locator('.town-map-stage');
  await page.locator('.town-map-tools button').nth(1).click();
  await page.locator('.town-map-tools button').nth(1).click();
  await map.focus();
  const transform = await stage.getAttribute('style');
  await map.press('ArrowLeft');
  await expect(stage).not.toHaveAttribute('style', transform);
  await page.locator('.town-map-tools button').nth(2).click();
  await page.locator('.town-location-marker').first().click();
  await expect(page.locator('.town-location-detail')).toBeVisible();
  await expect(page.locator('.town-venue-services')).not.toBeEmpty();
  await page.locator('.town-location-detail header button').click();
  await page.locator('[data-town-assets-trigger]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.town-asset-preview')).toHaveCount(15);
  await expect(page.locator('.town-asset-grid h3').first()).toBeInViewport();
  const clipped = await page.locator('.town-asset-grid article').evaluateAll((cards) => cards.some((card) => [...card.children].some((child) => child.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom + 1)));
  expect(clipped).toBe(false);
  const preview = page.locator('.town-asset-preview').first();
  const original = await preview.evaluate((canvas) => canvas.toDataURL());
  await page.locator('.town-asset-library select').selectOption('traditional');
  await expect.poll(() => preview.evaluate((canvas) => canvas.toDataURL())).not.toBe(original);
  await page.screenshot({ path: testInfo.outputPath('town-assets-mobile.png') });
  await page.locator('.town-asset-library select').press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-town-assets-trigger]')).toBeFocused();
});

test('structured events and confirmed map rebuilding reach the matching APIs', async ({ page }) => {
  await page.setViewportSize({ width: 451, height: 958 });
  const requests = await openTown(page);
  await page.locator('.town-control-button.intervention').click();
  await page.locator('.town-event-fields select').first().selectOption('rain');
  await page.locator('.town-event-dialog button[type="submit"]').click();
  await expect.poll(() => requests.some((request) => request.payload?.effect === 'rain')).toBe(true);
  await page.getByRole('button', { name: '\u5355\u6b65\u63a8\u8fdb\u751f\u6d3b\u6a21\u62df' }).click();
  await expect(page.locator('.town-world-conditions span')).toHaveCount(1);
  await page.locator('[data-town-assets-trigger]').click();
  await page.locator('.town-asset-library select').selectOption('traditional');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.town-asset-library footer button').click();
  expect(requests.includes('rebuild')).toBe(false);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.town-asset-library footer button').click();
  await expect(page.locator('.town-generated-map')).toHaveAttribute('data-architecture', 'traditional');
  await expect(page.locator('.town-agent-row')).toHaveCount(3);
});

test('town renders a nonblank map and fits desktop, phone and landscape screens', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTown(page);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 451, height: 958 }, { width: 375, height: 812 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator('.town-play-shell').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const coloredPixels = await page.locator('.town-generated-map').evaluate((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let index = 0; index < data.length; index += 160) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
      return colors.size;
    });
    expect(coloredPixels).toBeGreaterThan(30);
    await page.screenshot({ path: testInfo.outputPath(`town-life-${viewport.width}.png`) });
  }
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 451, height: 958 });
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const violations = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});
