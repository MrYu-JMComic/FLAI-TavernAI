import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: baseLayoutScript, template: baseLayoutTemplate } = readVueBlocks(
  'frontend/src/components/BaseLayout.vue',
  ['script', 'template']
);
const stylesSource = readFrontendStyles();

test('BaseLayout document click handler tolerates missing event targets', () => {
  assert.match(
    baseLayoutScript,
    /function handleDocumentClick\(event\) {\s*const target = event\?\.target;\s*if \(!isDomEventTarget\(target\) \|\| !userMenuRef\.value\?\.contains\(target\)\) {\s*userMenuOpen\.value = false;\s*}\s*}/
  );
  assert.match(
    baseLayoutScript,
    /function isDomEventTarget\(target\) {\s*return Boolean\(target && typeof target === 'object' && typeof target\.nodeType === 'number'\);\s*}/
  );
  assert.doesNotMatch(baseLayoutScript, /contains\(event\.target\)/);
});

test('Global scrollbars share theme-aware styling without overriding hidden scrollers', () => {
  assert.match(
    stylesSource,
    /:root\s*\{[\s\S]*--scrollbar-size:\s*10px;[\s\S]*--scrollbar-track:[\s\S]*--scrollbar-thumb:[\s\S]*--scrollbar-thumb-hover-end:[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="dark"\]\s*\{[\s\S]*--scrollbar-track:[\s\S]*--scrollbar-thumb:[\s\S]*--scrollbar-thumb-hover-end:[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\*\s*\{[\s\S]*scrollbar-color:\s*var\(--scrollbar-thumb\) var\(--scrollbar-track\);[\s\S]*scrollbar-width:\s*thin;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\*::-webkit-scrollbar\s*\{[\s\S]*width:\s*var\(--scrollbar-size\);[\s\S]*height:\s*var\(--scrollbar-size\);[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\*::-webkit-scrollbar-thumb\s*\{[\s\S]*linear-gradient\(180deg, var\(--scrollbar-thumb\), var\(--scrollbar-thumb-end\)\)[\s\S]*padding-box;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-layout-shell \.page-shell\s*\{[\s\S]*scrollbar-color:\s*var\(--scrollbar-thumb\) var\(--scrollbar-track\);[\s\S]*\}/
  );
  assert.match(stylesSource, /\.form-section-nav\s*\{[\s\S]*scrollbar-width:\s*none;[\s\S]*\}/);
  assert.match(stylesSource, /\.form-section-nav::-webkit-scrollbar\s*\{[\s\S]*display:\s*none;[\s\S]*\}/);
  assert.match(stylesSource, /\.tag-cloud-bar\s*\{[\s\S]*scrollbar-width:\s*none;[\s\S]*\}/);
  assert.match(stylesSource, /\.tag-cloud-bar::-webkit-scrollbar\s*\{[\s\S]*display:\s*none;[\s\S]*\}/);
});

test('BaseLayout keeps the home route scroll inside a fixed app shell', () => {
  assert.match(baseLayoutScript, /const isHomeRoute = computed\(\(\) => props\.currentRoute === 'home'\);/);
  assert.match(
    baseLayoutTemplate,
    /:class="\{ 'chat-layout-shell': isConversationRoute, 'home-layout-shell': isHomeRoute, 'workspace-layout-shell': isWorkspaceRoute \}"/
  );
  assert.match(
    stylesSource,
    /\.home-layout-shell\s*\{[\s\S]*height:\s*100vh;[\s\S]*height:\s*100svh;[\s\S]*height:\s*100dvh;[\s\S]*overflow:\s*hidden;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-layout-shell \.page-shell\s*\{[\s\S]*padding-top:\s*0;[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*none;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-layout-shell \.page-shell\s*\{[\s\S]*scrollbar-width:\s*thin;[\s\S]*scrollbar-color:[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-layout-shell \.page-shell::-webkit-scrollbar\s*\{[\s\S]*width:\s*10px;[\s\S]*height:\s*10px;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-layout-shell \.page-shell::-webkit-scrollbar-thumb\s*\{[\s\S]*min-height:\s*56px;[\s\S]*border-radius:\s*999px;[\s\S]*padding-box;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-layout-shell \.home-workbench\s*\{[\s\S]*padding-top:\s*28px;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 620px\) \{[\s\S]*\.home-layout-shell \.home-workbench\s*\{[\s\S]*padding-top:\s*18px;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 620px\) \{[\s\S]*\.home-layout-shell \.page-shell\s*\{[\s\S]*scrollbar-gutter:\s*auto;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 620px\) \{[\s\S]*\.home-layout-shell \.page-shell::-webkit-scrollbar\s*\{[\s\S]*width:\s*6px;[\s\S]*height:\s*6px;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 760px\) \{[\s\S]*\.home-layout-shell\s*\{[\s\S]*min-height:\s*100svh;[\s\S]*height:\s*100svh;[\s\S]*\}/
  );
});

test('BaseLayout gives workspace routes a full-width single scroll shell', () => {
  assert.match(
    baseLayoutScript,
    /const isWorkspaceRoute = computed\(\(\) => \(\s*props\.currentRoute === 'characterNew'\s*\|\| props\.currentRoute === 'characterEdit'\s*\|\| isWorldBookRoute\.value\s*\|\| isExtensionsRoute\.value\s*\|\| isPresetsRoute\.value\s*\|\| props\.currentRoute === 'settings'\s*\)\);/
  );
  assert.match(
    baseLayoutTemplate,
    /:class="\{ 'chat-layout-shell': isConversationRoute, 'home-layout-shell': isHomeRoute, 'workspace-layout-shell': isWorkspaceRoute \}"/
  );
  assert.match(
    stylesSource,
    /\.workspace-layout-shell\s*\{[\s\S]*height:\s*100vh;[\s\S]*height:\s*100svh;[\s\S]*height:\s*100dvh;[\s\S]*overflow:\s*hidden;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.workspace-layout-shell \.page-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin:\s*0;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*none;[^}]*\}/
  );
  assert.match(
    stylesSource,
    /\.workspace-layout-shell \.narrow-page,\s*\.workspace-layout-shell \.extensions-page,\s*\.workspace-layout-shell \.preset-page\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin:\s*0;[^}]*\}/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 620px\) \{[\s\S]*\.workspace-layout-shell \.page-shell\s*\{[\s\S]*scrollbar-gutter:\s*auto;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.workspace-layout-shell \.settings-section-nav\s*\{[\s\S]*top:\s*calc\(-1 \* var\(--workspace-page-padding-top, 28px\)\);[\s\S]*\}/
  );
});

test('BaseLayout gives chat and multi-role routes the same unobstructed conversation shell', () => {
  assert.match(
    baseLayoutScript,
    /function usesConversationLayout\(routeName\) \{\s*return routeName === 'chat' \|\| routeName === 'multiAgentChat';\s*\}/
  );
  assert.match(
    baseLayoutTemplate,
    /<header v-if="!isConversationRoute && !isTownRoute" class="topbar">/
  );
  assert.match(
    baseLayoutTemplate,
    /<nav v-if="!isConversationRoute && !isTownRoute" class="mobile-bottom-nav"/
  );
});
