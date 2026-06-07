import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const presetViewSource = readRepoText('frontend/src/views/PresetView.vue');

test('PresetView retry action ignores events while presets are loading', () => {
  const scriptSetup = readVueBlock(presetViewSource, 'script');
  const template = readVueBlock(presetViewSource, 'template');

  assert.match(scriptSetup, /const loading = ref\(true\);/);
  assert.match(scriptSetup, /let presetLoadInFlight = false;/);
  assert.match(
    scriptSetup,
    /async function loadPresets\(\)\s*{\s*if \(presetViewDisposed \|\| presetLoadInFlight\) return;[\s\S]*presetLoadInFlight = true;[\s\S]*presetLoadInFlight = false;/
  );
  assert.match(
    template,
    /<button class="ghost-button" :disabled="loading" :aria-busy="loading" @click="loadPresets">/
  );
});

test('PresetView freezes list entry actions while preset work is busy', () => {
  const scriptSetup = readVueBlock(presetViewSource, 'script');
  const template = readVueBlock(presetViewSource, 'template');
  const style = readVueBlock(presetViewSource, 'style');

  assert.match(
    scriptSetup,
    /const presetListActionBusy = computed\(\(\) => \([\s\S]*loading\.value[\s\S]*saving\.value[\s\S]*Boolean\(deletingPresetId\.value\)[\s\S]*Boolean\(defaultingPresetId\.value\)[\s\S]*\)\);/
  );
  assert.match(
    scriptSetup,
    /function startCreate\(\)\s*{\s*if \(presetListActionBusy\.value\) return;/
  );
  assert.match(
    scriptSetup,
    /function startEdit\(preset\)\s*{\s*if \(presetListActionBusy\.value\) return;/
  );
  assert.match(
    scriptSetup,
    /async function handleDelete\(preset\)\s*{\s*if \(presetViewDisposed \|\| presetListActionBusy\.value \|\| !preset\?\.id\)/
  );
  assert.match(
    scriptSetup,
    /async function handleSetDefault\(preset\)\s*{\s*if \(presetViewDisposed \|\| presetListActionBusy\.value \|\| !preset\?\.id\)/
  );

  assert.equal(countMatches(template, /:disabled="presetListActionBusy"/g), 4);
  assert.equal(countMatches(template, /:aria-busy="presetListActionBusy"/g), 2);
  assert.match(template, /'is-busy': presetListActionBusy/);
  assert.match(template, /:aria-disabled="presetListActionBusy"/);
  assert.match(template, /:aria-busy="defaultingPresetId === preset\.id"/);
  assert.match(template, /:aria-busy="deletingPresetId === preset\.id"/);
  assert.match(style, /\.preset-card\.is-busy/);
  assert.match(style, /\.preset-card\.is-busy:hover/);
});
