import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const tags = [
  { id: 'fantasy', name: 'Fantasy', usageCount: 9, color: '#f9e076' },
  { id: 'adventure', name: 'Adventure', usageCount: 4, color: '#42a5f5' },
  { id: 'daily', name: 'Daily', usageCount: 3, color: '#ff80ab' }
];

async function openLibrary(page, { characterTags = tags, onCharactersRequest, onReactionRequest } = {}) {
  const requests = [];
  const characters = Array.from({ length: 24 }, (_, index) => ({
    id: `library-${index}`,
    name: index === 1 ? 'ACharacterNameWithoutAnyWordBoundariesThatMustStillFit' : `Traveler ${String(index + 1).padStart(2, '0')}`,
    gender: 'Unknown',
    age: '24',
    persona: 'A thoughtful companion with a story to tell. This long description checks that the summary stays separate from tags and actions. '.repeat(3),
    visibility: index % 2 ? 'public' : 'private',
    canEdit: true,
    favoritedByMe: index === 0,
    likedByMe: index === 0,
    favoriteCount: index + 1,
    likeCount: index + 2,
    avatarUrl: index === 0 ? '/icons/icon-192.png' : '',
    characterTags: index % 2 ? characterTags.slice(0, 1) : characterTags
  }));

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ json: { user: { id: 'ui-test', username: 'Library reader with a long display name' } } });
    }
    if (url.pathname === '/api/settings/provider') {
      return route.fulfill({ json: { model: 'A-long-model-name-for-responsive-layout', gatewayName: 'Local' } });
    }
    if (url.pathname === '/api/tags') return route.fulfill({ json: tags });
    if (url.pathname === '/api/characters') {
      requests.push(Object.fromEntries(url.searchParams));
      let items = characters.filter((character) => (
        character.name.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase())
        && (!url.searchParams.get('tag') || character.characterTags.some((tag) => tag.name === url.searchParams.get('tag')))
      ));
      if (url.searchParams.get('sort') === 'name') items = items.toSorted((a, b) => a.name.localeCompare(b.name));
      if (onCharactersRequest && await onCharactersRequest(route, { url, items, characters })) return;
      return route.fulfill({ json: items });
    }
    const reactionMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/(favorite|like)$/);
    if (reactionMatch) {
      const [, characterId, reactionType] = reactionMatch;
      const character = characters.find((item) => item.id === characterId);
      const body = route.request().postDataJSON();
      const activeKey = reactionType === 'favorite' ? 'favoritedByMe' : 'likedByMe';
      const countKey = reactionType === 'favorite' ? 'favoriteCount' : 'likeCount';
      const nextActive = Boolean(body[reactionType === 'favorite' ? 'favorited' : 'liked']);
      const nextCharacter = {
        ...character,
        [activeKey]: nextActive,
        [countKey]: Math.max(0, character[countKey] + Number(nextActive) - Number(character[activeKey]))
      };
      if (onReactionRequest && await onReactionRequest(route, { url, character: nextCharacter })) return;
      return route.fulfill({ json: nextCharacter });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/');
  await expect(page.locator('.home-character-card').first()).toBeVisible();
  return requests;
}

test('library has no town entry and retired links return to the library', async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByRole('button', { name: 'AI 虚拟小镇' })).toHaveCount(0);
  await page.goto('/#/town');
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(page.locator('.home-character-card').first()).toBeVisible();
  await expect(page.locator('.app-navigation')).toBeVisible();
  await expect(page.locator('.topbar')).toHaveCount(0);
});

test('desktop sidebar gives the workspace full height and keeps account controls accessible when collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('flai-theme', 'light'));
  await openLibrary(page);
  const navigation = page.locator('.app-navigation');
  const workspace = page.locator('.page-shell');
  const toggle = page.getByRole('button', { name: '收起主导航', exact: true });
  const expandedNavigation = await navigation.boundingBox();
  const expandedWorkspace = await workspace.boundingBox();
  expect(expandedNavigation.x + expandedNavigation.width).toBeLessThanOrEqual(expandedWorkspace.x + 1);
  expect(expandedWorkspace.y).toBeLessThanOrEqual(10);
  expect(expandedWorkspace.y + expandedWorkspace.height).toBeGreaterThanOrEqual(890);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.topbar')).toHaveCount(0);

  await toggle.click();
  const expand = page.getByRole('button', { name: '展开主导航', exact: true });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await navigation.boundingBox()).width).toBeLessThan(expandedNavigation.width - 100);
  await expect.poll(async () => (await workspace.boundingBox()).width).toBeGreaterThan(expandedWorkspace.width + 100);

  const theme = page.getByRole('button', { name: '切换到夜间模式', exact: true });
  const user = page.getByRole('button', { name: '用户菜单', exact: true });
  for (const control of [theme, user]) {
    await expect(control).toBeInViewport();
    const box = await control.boundingBox();
    expect(box.y).toBeGreaterThan(expandedNavigation.y + expandedNavigation.height * 0.75);
  }
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '切换到日间模式', exact: true })).toBeVisible();

  await user.click();
  await expect(user).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu');
  await expect(menu).toBeInViewport();
  const menuBox = await menu.boundingBox();
  const userBox = await user.boundingBox();
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(userBox.y + 1);
  await page.getByRole('menuitem', { name: '个人中心', exact: true }).click();
  await expect(page).toHaveURL(/\/#\/settings$/);
  await expect(page.getByRole('navigation', { name: '个人设置' })).toBeVisible();
  await expect(menu).toHaveCount(0);
  await navigation.locator('.topnav').getByRole('button', { name: '首页', exact: true }).click();
  await expect(page.locator('.home-character-card').first()).toBeVisible();
  await expand.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await workspace.boundingBox()).width).toBeLessThan(expandedWorkspace.width + 1);
});

test('mobile navigation and its open menu fit the viewport without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  for (const width of [900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.app-navigation')).toBeVisible();
    await expect(page.getByRole('button', { name: '收起主导航', exact: true })).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.locator('.page-shell').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (width <= 620) {
      const bottomNavigation = page.locator('.mobile-bottom-nav');
      await expect(bottomNavigation).toBeInViewport();
      await expect(bottomNavigation.getByRole('button', { name: '首页', exact: true })).toHaveAttribute('aria-current', 'page');
      const user = page.getByRole('button', { name: '用户菜单', exact: true });
      await user.click();
      await expect(user).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('menu')).toBeInViewport();
      await expect(page.getByRole('menuitem', { name: '个人中心', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(user).toHaveAttribute('aria-expanded', 'false');
    }
  }
});

test('library shows a complete first row on desktop and keeps the toolbar pinned', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLibrary(page);
  const firstCard = page.locator('.home-character-card').first();
  expect((await firstCard.boundingBox()).y).toBeLessThan(500);
  await expect(firstCard.locator('.home-card-actions')).toBeInViewport();
  await expect(page.locator('.home-header-actions button')).toHaveCount(1);
  await page.locator('.page-shell').evaluate((element) => { element.scrollTop = 900; });
  await expect(page.locator('.home-control-panel')).toHaveAttribute('data-sticky-state', 'pinned');
  const toolbar = await page.locator('.home-control-panel').boundingBox();
  const scroller = await page.locator('.page-shell').boundingBox();
  expect(Math.abs(toolbar.y - scroller.y)).toBeLessThan(2);
});

test('wide libraries fill the page and reflow complete virtual rows on resize', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openLibrary(page);
  for (const width of [1920, 2560, 1746, 1750, 1400, 1404, 1405, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    const scroller = await page.locator('.page-shell').boundingBox();
    const gutters = await page.locator('.page-shell').evaluate((element) => {
      const style = getComputedStyle(element);
      const paddingLeft = parseFloat(style.paddingLeft);
      const paddingRight = parseFloat(style.paddingRight);
      const borderLeft = parseFloat(style.borderLeftWidth);
      return {
        paddingLeft,
        paddingRight,
        left: paddingLeft + borderLeft,
        right: paddingRight + element.getBoundingClientRect().width - element.clientWidth - borderLeft
      };
    });
    const workbench = await page.locator('.home-workbench').boundingBox();
    expect(gutters.paddingLeft).toBeLessThanOrEqual(32);
    expect(gutters.paddingRight).toBeLessThanOrEqual(32);
    expect(Math.abs(workbench.x - scroller.x - gutters.left)).toBeLessThan(1);
    expect(Math.abs(scroller.x + scroller.width - workbench.x - workbench.width - gutters.right)).toBeLessThan(1);
    const gridColumns = await page.locator('.home-character-row').first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(gridColumns).toBeGreaterThan(1);
    await expect.poll(async () => {
      const rows = page.locator('.home-character-row');
      const columns = await rows.first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      const firstRowCount = await rows.first().locator('.home-character-card').count();
      const secondRowName = await rows.nth(1).locator('.home-character-card').first().textContent();
      return firstRowCount === columns && secondRowName.includes(`Traveler ${String(columns + 1).padStart(2, '0')}`);
    }).toBe(true);
    const firstRow = await page.locator('.home-character-row').first().locator('.home-character-card').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top));
    expect(Math.max(...firstRow) - Math.min(...firstRow)).toBeLessThan(1);
    await expect.poll(() => page.locator('.page-shell').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});

test('card tags stay centered and truncate within their own badges on desktop and mobile', async ({ page }, testInfo) => {
  const characterTags = [
    { id: 'nsfw', name: 'NSFW' },
    { id: 'original', name: '\u539f\u521b' },
    { id: 'multi-role', name: '\u591a\u89d2\u8272' },
    { id: 'interactive', name: '\u4e92\u52a8\u6e38\u620f' },
    { id: 'long', name: 'LongCharacterTagWithoutWordBoundaries' },
    { id: 'extra-1', name: 'Adventure' },
    { id: 'extra-2', name: 'Daily' }
  ];
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openLibrary(page, { characterTags });
  for (const width of [1920, 1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const card = page.locator('.home-character-card').first();
    await expect(card.locator('.home-card-tag')).toHaveCount(6);
    await expect(card.locator('.home-card-tag.muted')).toHaveText('+2');
    const badges = await card.locator('.home-card-tag').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      const rail = element.parentElement.getBoundingClientRect();
      const label = element.querySelector('span');
      const range = document.createRange();
      range.selectNodeContents(label || element);
      const textBox = label ? label.getBoundingClientRect() : range.getBoundingClientRect();
      return {
        name: element.textContent.trim(),
        title: element.title,
        horizontalOffset: Math.abs(textBox.x + textBox.width / 2 - box.x - box.width / 2),
        verticalOffset: Math.abs(textBox.y + textBox.height / 2 - box.y - box.height / 2),
        contained: box.left >= rail.left - 1 && box.right <= rail.right + 1 && box.top >= rail.top - 1 && box.bottom <= rail.bottom + 1,
        ellipsis: label ? getComputedStyle(label).textOverflow : null,
        truncated: label ? label.scrollWidth > label.clientWidth : false
      };
    }));
    for (const badge of badges) {
      expect(badge.horizontalOffset, `${width}px ${badge.name}`).toBeLessThan(1);
      expect(badge.verticalOffset, `${width}px ${badge.name}`).toBeLessThan(2);
      expect(badge.contained, `${width}px ${badge.name}`).toBe(true);
      if (badge.ellipsis) {
        expect(badge.ellipsis).toBe('ellipsis');
        expect(badge.title).toBe(badge.name);
      }
    }
    if (width === 1920) {
      expect(badges.slice(0, 3).every(({ truncated }) => !truncated)).toBe(true);
    }
    expect(badges.find(({ name }) => name === characterTags[4].name).truncated).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`centered-tags-${width}.png`) });
  }
});

test('search clearing preserves the tag and sorting is selectable and remembered on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await openLibrary(page);
  const search = page.getByRole('searchbox');
  const sort = page.getByRole('combobox');
  await sort.selectOption('name');
  await expect.poll(() => requests.at(-1)?.sort).toBe('name');
  await page.locator('.home-tag-chip').filter({ hasText: 'Adventure' }).click();
  await expect.poll(() => requests.at(-1)?.tag).toBe('Adventure');
  await search.fill('Traveler 01');
  await expect(page.locator('.home-character-card')).toHaveCount(1);
  await page.locator('.home-search-clear').click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect.poll(() => requests.at(-1)?.search).toBe('');
  expect(requests.at(-1).tag).toBe('Adventure');
  await search.fill('not-present-in-the-library');
  await expect(page.locator('.home-empty-panel')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await page.reload();
  await expect(sort).toHaveValue('name');
});

test('a list response started before a saved favorite does not revert it', async ({ page }) => {
  let holdFavoriteResponse = false;
  let releaseFavoriteResponse;
  let signalFavoriteStarted;
  const favoriteRequestStarted = new Promise((resolve) => { signalFavoriteStarted = resolve; });
  let holdCharacterListResponse = false;
  let releaseCharacterListResponse;
  let signalCharacterListStarted;
  const characterListStarted = new Promise((resolve) => { signalCharacterListStarted = resolve; });

  await openLibrary(page, {
    onReactionRequest: async (route, { url, character }) => {
      if (!holdFavoriteResponse || !url.pathname.endsWith('/favorite')) return false;
      holdFavoriteResponse = false;
      signalFavoriteStarted();
      await new Promise((resolve) => { releaseFavoriteResponse = resolve; });
      await route.fulfill({ json: character });
      return true;
    },
    onCharactersRequest: async (route, { url, items }) => {
      if (!holdCharacterListResponse || url.searchParams.get('sort') !== 'name') return false;
      holdCharacterListResponse = false;
      signalCharacterListStarted();
      await new Promise((resolve) => { releaseCharacterListResponse = resolve; });
      await route.fulfill({ json: items });
      return true;
    }
  });

  const favoriteButton = page.locator('.home-character-card').filter({
    has: page.getByRole('heading', { name: 'Traveler 01', exact: true })
  }).getByRole('button', { name: '取消收藏', exact: true });
  holdFavoriteResponse = true;
  await favoriteButton.click();
  await favoriteRequestStarted;

  holdCharacterListResponse = true;
  await page.getByRole('combobox').selectOption('name');
  await characterListStarted;

  const favoriteSaved = page.waitForResponse((response) => (
    response.url().includes('/api/characters/library-0/favorite')
    && response.request().method() === 'PUT'
  ));
  releaseFavoriteResponse();
  await favoriteSaved;
  await page.waitForTimeout(50);
  releaseCharacterListResponse();

  const updatedCharacterCard = page.locator('.home-character-card').filter({
    has: page.getByRole('heading', { name: 'Traveler 01', exact: true })
  });
  await expect(updatedCharacterCard.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(updatedCharacterCard.getByRole('button', { name: '收藏', exact: true })).toContainText('0');
});

test('keyboard users can skip navigation and see file-input focus', async ({ page }) => {
  await openLibrary(page);
  const originalUrl = page.url();
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page).toHaveURL(originalUrl);
  await page.locator('.home-header-actions input[type="file"]').focus();
  await expect(page.locator('.home-header-actions .home-file-action')).toHaveCSS('outline-style', 'solid');
});

for (const theme of ['light', 'dark']) {
  test(`library stays readable across viewports in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('flai-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openLibrary(page);
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
      { width: 320, height: 740 },
      { width: 844, height: 390 }
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.home-character-card').first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect.poll(() => page.locator('.page-shell, .home-workbench').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
      const collisions = await page.locator('.home-character-card').evaluateAll((cards) => cards.slice(0, 4).flatMap((card) => {
        const box = card.getBoundingClientRect();
        return [...card.children].flatMap((child) => {
          const rect = child.getBoundingClientRect();
          return rect.right > box.right + 1 || rect.bottom > box.bottom + 1 ? [child.className] : [];
        });
      }));
      expect(collisions).toEqual([]);
      if (theme === 'dark' && viewport.width === 1440) {
        const contrast = await page.locator('.home-primary-action').first().evaluate((button) => {
          const luminance = (color) => {
            const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => channel / 255);
            const linear = channels.map((channel) => (
              channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
            ));
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
          };
          const style = getComputedStyle(button);
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
      if (viewport.width < 620) {
        const sizes = await page.locator('.home-control-panel button, .home-control-panel select, .home-character-card button').evaluateAll((elements) => elements.slice(0, 8).map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }));
        expect(sizes.every(({ width, height }) => width >= 44 && height >= 44), JSON.stringify(sizes)).toBe(true);
        if (viewport.width === 375) {
          const actions = await page.locator('.home-character-card .home-card-actions').first().boundingBox();
          const navigation = await page.locator('.mobile-bottom-nav').boundingBox();
          expect(actions.y + actions.height).toBeLessThanOrEqual(navigation.y);
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`library-${theme}-${viewport.width}.png`) });
    }
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const violations = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    }
  });
}
