import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const {
  getAllExtensions,
  registerExtension,
  unregisterExtension
} = await import('../../../frontend/src/services/extensions.js');
const { clearAllHooks } = await import('../../../frontend/src/services/extensionHooks.js');
const {
  MOD_EXTENSION_PREFIX,
  modAppliesToCharacter,
  syncModsToExtensions
} = await import('../../../frontend/src/services/modExtension.js');

const modExtensionSource = readRepoText('frontend/src/services/modExtension.js');

test('mod extension sync keeps only mods applicable to the active character', () => {
  clearExtensionsForTest();
  try {
    registerExtension({ name: 'manual-extension', hooks: [] }, {});

    syncModsToExtensions([
      createMod({ id: 'global', scope: 'global' }),
      createMod({ id: 'all', scope: 'all_characters' }),
      createMod({ id: 'match', scope: 'characters', characterIds: ['other-character', 'character-a'] }),
      createMod({ id: 'inferred', characterIds: ['character-a'] }),
      createMod({ id: 'other', scope: 'characters', characterIds: ['character-b'] })
    ], { characterId: 'character-a' });

    assert.deepEqual(extensionNames(), [
      `${MOD_EXTENSION_PREFIX}all`,
      `${MOD_EXTENSION_PREFIX}global`,
      `${MOD_EXTENSION_PREFIX}inferred`,
      `${MOD_EXTENSION_PREFIX}match`,
      'manual-extension'
    ]);

    syncModsToExtensions([
      createMod({ id: 'replacement', scope: 'global' })
    ], { characterId: 'character-a' });

    assert.deepEqual(extensionNames(), [
      `${MOD_EXTENSION_PREFIX}replacement`,
      'manual-extension'
    ]);
  } finally {
    clearExtensionsForTest();
  }
});

test('mod character scope checks scan ids directly', () => {
  assert.equal(modAppliesToCharacter(createMod({ scope: 'global' }), ''), true);
  assert.equal(modAppliesToCharacter(createMod({ scope: 'all_characters' }), ''), false);
  assert.equal(modAppliesToCharacter(createMod({ scope: 'all_characters' }), 'character-a'), true);
  assert.equal(
    modAppliesToCharacter(createMod({ scope: 'characters', characterIds: [' character-a '] }), 'character-a'),
    true
  );
  assert.equal(
    modAppliesToCharacter(createMod({ scope: 'characters', characterIds: ['character-b'] }), 'character-a'),
    false
  );
  assert.equal(modAppliesToCharacter(createMod({ characterIds: ['character-a'] }), 'character-a'), true);
});

test('mod extension loading registers applicable mods without filter pipelines', () => {
  assert.match(
    modExtensionSource,
    /export async function loadAndSyncMods\(options = \{\}\) \{[\s\S]*unregisterModExtensions\(\);[\s\S]*registerApplicableModExtensions\(mods, characterId, true\);[\s\S]*return mods;/
  );
  assert.match(
    modExtensionSource,
    /function registerApplicableModExtensions\(mods, characterId, enabledOnly = false\) \{[\s\S]*for \(const mod of mods\) \{[\s\S]*if \(enabledOnly && !mod\?\.enabled\) \{[\s\S]*continue;[\s\S]*if \(!modAppliesToCharacter\(mod, characterId\)\) \{[\s\S]*continue;[\s\S]*registerExtension\(manifest, module\);[\s\S]*\}/
  );
  assert.match(
    modExtensionSource,
    /function characterIdsInclude\(ids = \[\], characterId = ''\) \{[\s\S]*for \(const rawId of Array\.isArray\(ids\) \? ids : \[\]\) \{[\s\S]*String\(rawId \|\| ''\)\.trim\(\) === characterId/
  );
  assert.doesNotMatch(modExtensionSource, /\.filter\(/);
  assert.doesNotMatch(modExtensionSource, /normalizeCharacterIds/);
});

function createMod(overrides = {}) {
  return {
    id: 'mod-id',
    name: 'Mod Name',
    description: '',
    type: 'prompt_inject',
    content: 'mod content',
    enabled: true,
    scope: 'global',
    characterIds: [],
    ...overrides
  };
}

function extensionNames() {
  const names = [];
  for (const extension of getAllExtensions()) {
    names.push(extension.manifest.name);
  }
  names.sort();
  return names;
}

function clearExtensionsForTest() {
  for (const extension of getAllExtensions()) {
    unregisterExtension(extension.manifest.name);
  }
  clearAllHooks();
}
