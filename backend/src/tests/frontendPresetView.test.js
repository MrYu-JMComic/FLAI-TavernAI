import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: presetViewScript,
  template: presetViewTemplate,
  style: presetViewStyle
} = readVueBlocks('frontend/src/views/PresetView.vue', ['script', 'template', 'style']);

test('PresetView retry action ignores events while presets are loading', () => {
  assert.match(presetViewScript, /const loading = ref\(true\);/);
  assert.match(presetViewScript, /let presetLoadInFlight = false;/);
  assert.match(
    presetViewScript,
    /async function loadPresets\(\)\s*{\s*if \(presetViewDisposed \|\| presetLoadInFlight\) return;[\s\S]*presetLoadInFlight = true;[\s\S]*presetLoadInFlight = false;/
  );
  assert.match(
    presetViewTemplate,
    /<button class="ghost-button" :disabled="loading" :aria-busy="loading" @click="loadPresets">/
  );
});

test('PresetView freezes list entry actions while preset work is busy', () => {
  assert.match(
    presetViewScript,
    /const presetListActionBusy = computed\(\(\) => \([\s\S]*loading\.value[\s\S]*saving\.value[\s\S]*Boolean\(deletingPresetId\.value\)[\s\S]*Boolean\(defaultingPresetId\.value\)[\s\S]*\)\);/
  );
  assert.match(
    presetViewScript,
    /function startCreate\(\)\s*{\s*if \(presetListActionBusy\.value\) return;/
  );
  assert.match(
    presetViewScript,
    /function startEdit\(preset\)\s*{\s*if \(presetListActionBusy\.value\) return;/
  );
  assert.match(
    presetViewScript,
    /async function handleDelete\(preset\)\s*{\s*if \(presetViewDisposed \|\| presetListActionBusy\.value \|\| !preset\?\.id\)/
  );
  assert.match(
    presetViewScript,
    /async function handleSetDefault\(preset\)\s*{\s*if \(presetViewDisposed \|\| presetListActionBusy\.value \|\| !preset\?\.id\)/
  );

  assert.equal(countMatches(presetViewTemplate, /:disabled="presetListActionBusy"/g), 4);
  assert.equal(countMatches(presetViewTemplate, /:aria-busy="presetListActionBusy"/g), 2);
  assert.match(presetViewTemplate, /'is-busy': presetListActionBusy/);
  assert.match(presetViewTemplate, /:aria-disabled="presetListActionBusy"/);
  assert.match(presetViewTemplate, /:aria-busy="defaultingPresetId === preset\.id"/);
  assert.match(presetViewTemplate, /:aria-busy="deletingPresetId === preset\.id"/);
  assert.match(presetViewStyle, /\.preset-card\.is-busy/);
  assert.match(presetViewStyle, /\.preset-card\.is-busy:hover/);
});
