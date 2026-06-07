import assert from 'node:assert/strict';
import test from 'node:test';

const { useChatSubmit } = await import('../../../frontend/src/composables/chat/useChatSubmit.js');

function refValue(value) {
  return { value };
}

function createSubmitState() {
  const selectedPresetId = refValue('preset-initial');
  const submit = useChatSubmit({
    route: { params: { id: 'conv-1' } },
    messages: refValue([]),
    provider: refValue({ supportsReasoning: true }),
    selectedPresetId,
    statusBar: refValue(null),
    syncStatusBarForm() {},
    handleSkillResult() {},
    loadStatusBar: async () => {},
    loadSidebarData: async () => {},
    loadEconomyBalance: async () => {},
    stickToBottomIfNeeded() {},
    expandReasoning() {},
    showError() {}
  });

  return { selectedPresetId, submit };
}

test('chat submit preset selection ignores updates while sending', () => {
  const { selectedPresetId, submit } = createSubmitState();

  submit.sending.value = true;
  submit.setSelectedPresetId('preset-during-send');
  assert.equal(selectedPresetId.value, 'preset-initial');

  submit.sending.value = false;
  submit.setSelectedPresetId('preset-after-send');
  assert.equal(selectedPresetId.value, 'preset-after-send');

  submit.setSelectedPresetId('');
  assert.equal(selectedPresetId.value, '');
});
