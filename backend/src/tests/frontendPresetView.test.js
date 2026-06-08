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

test('PresetView preserves unchanged preset list references during refreshes', () => {
  assert.match(
    presetViewScript,
    /const nextPresets = await fetchPresets\(\);[\s\S]*setPresetsIfChanged\(nextPresets\);/
  );
  assert.match(
    presetViewScript,
    /function setPresetsIfChanged\(nextPresets\) \{[\s\S]*samePresetList\(presets\.value, normalizedNextPresets\)[\s\S]*presets\.value = normalizedNextPresets;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    presetViewScript,
    /function samePresetList\(currentPresets, nextPresets\) \{[\s\S]*if \(!Array\.isArray\(currentPresets\) \|\| !Array\.isArray\(nextPresets\)\) \{[\s\S]*return false;[\s\S]*for \(let index = 0; index < currentPresets\.length; index \+= 1\) \{[\s\S]*if \(!samePresetSummary\(currentPresets\[index\], nextPresets\[index\]\)\) \{[\s\S]*return false;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    presetViewScript,
    /function samePresetSummary\(currentPreset, nextPreset\) \{[\s\S]*currentPreset\?\.id === nextPreset\?\.id[\s\S]*currentPreset\?\.systemPrompt === nextPreset\?\.systemPrompt[\s\S]*Boolean\(currentPreset\?\.isDefault\) === Boolean\(nextPreset\?\.isDefault\);[\s\S]*\}/
  );
  assert.doesNotMatch(presetViewScript, /currentPresets\.every/);
  assert.doesNotMatch(
    presetViewScript.replace(/function setPresetsIfChanged\(nextPresets\) \{[\s\S]*?\n\}/, ''),
    /presets\.value\s*=/
  );
});

test('PresetView ignores stale preset row actions after list refreshes', () => {
  assert.match(
    presetViewScript,
    /function getCurrentPreset\(presetId\) \{[\s\S]*if \(!presetId\) \{[\s\S]*return null;[\s\S]*for \(const preset of presets\.value\) \{[\s\S]*if \(preset\?\.id === presetId\) \{[\s\S]*return preset;[\s\S]*return null;[\s\S]*\}/
  );
  assert.match(
    presetViewScript,
    /function startEdit\(preset\) \{[\s\S]*const currentPreset = getCurrentPreset\(preset\?\.id\);[\s\S]*if \(!currentPreset\) return;[\s\S]*editing\.value = \{ id: currentPreset\.id \};[\s\S]*name: currentPreset\.name \|\| '',[\s\S]*isDefault: Boolean\(currentPreset\.isDefault\)/
  );
  assert.match(
    presetViewScript,
    /async function handleDelete\(preset\) \{[\s\S]*const currentPreset = getCurrentPreset\(preset\?\.id\);[\s\S]*if \(!currentPreset\) return;[\s\S]*const presetId = currentPreset\.id;[\s\S]*await deletePreset\(presetId\);/
  );
  assert.match(
    presetViewScript,
    /async function handleSetDefault\(preset\) \{[\s\S]*const currentPreset = getCurrentPreset\(preset\?\.id\);[\s\S]*if \(!currentPreset\) return;[\s\S]*const presetId = currentPreset\.id;[\s\S]*await setDefaultPreset\(presetId\);[\s\S]*currentPreset\.name/
  );
  assert.doesNotMatch(presetViewScript, /editing\.value = \{ id: preset\.id \};/);
  assert.doesNotMatch(presetViewScript, /const presetId = preset\.id;/);
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
    /async function handleDelete\(preset\)\s*{\s*if \(presetViewDisposed \|\| presetListActionBusy\.value\)/
  );
  assert.match(
    presetViewScript,
    /async function handleSetDefault\(preset\)\s*{\s*if \(presetViewDisposed \|\| presetListActionBusy\.value\)/
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
