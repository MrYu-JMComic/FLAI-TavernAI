import assert from 'node:assert/strict';
import test from 'node:test';

const { useChatAccessory } = await import('../../../frontend/src/composables/chat/useChatAccessory.js');

function createAccessory() {
  return useChatAccessory({
    conversation: { value: { id: 'conv-1', character: { name: 'Hero' } } },
    showActionNotice() {},
    showError() {}
  });
}

function snapshotStatusBarEditor(accessory) {
  return JSON.stringify({
    editorOpen: accessory.statusBarEditorOpen.value,
    mode: accessory.statusBarTemplateMode.value,
    variables: accessory.statusBarForm.variables,
    characters: accessory.statusBarTemplateCfg.characters,
    quickReplies: accessory.statusBarTemplateCfg.quickReplies
  });
}

test('status bar editor entry points ignore edits while status bar saving is pending', () => {
  const accessory = createAccessory();
  accessory.statusBarEditorOpen.value = true;
  accessory.statusBarForm.variables = [
    { name: 'HP', value: 10, max: 10, color: '#ff0000' }
  ];
  accessory.statusBarTemplateMode.value = 'builtin';
  accessory.statusBarTemplateCfg.characters = [
    {
      id: 'char-1',
      name: 'Hero',
      role: 'lead',
      status: 'active',
      note: '',
      accentColor: '#00ff00',
      customCss: '',
      variables: [{ name: 'Mood', value: 1, max: 5, color: '#0000ff' }]
    }
  ];
  accessory.statusBarTemplateCfg.quickReplies = [
    { label: 'Wave', text: 'Hello' }
  ];

  const before = snapshotStatusBarEditor(accessory);
  accessory.statusBarSaving.value = true;

  accessory.openStatusBarEditor();
  accessory.closeStatusBarEditor();
  accessory.setStatusBarTemplateMode('custom');
  accessory.addStatusBarVariable();
  accessory.removeStatusBarVariable(0);
  accessory.addStatusCharacter();
  accessory.removeStatusCharacter(0);
  accessory.addCharacterVariable(0);
  accessory.removeCharacterVariable(0, 0);
  accessory.addQuickReply();
  accessory.removeQuickReply(0);

  assert.equal(snapshotStatusBarEditor(accessory), before);

  accessory.statusBarSaving.value = false;
  accessory.addStatusBarVariable();
  assert.equal(accessory.statusBarForm.variables.length, 2);
});
