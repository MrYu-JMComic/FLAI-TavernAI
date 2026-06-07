import assert from 'node:assert/strict';
import test from 'node:test';

const { useChatMessageActions } = await import('../../../frontend/src/composables/chat/useChatMessageActions.js');

function refValue(value) {
  return { value };
}

function createMessageActions() {
  return useChatMessageActions({
    messages: refValue([{ id: 'msg-1', role: 'user', content: 'Original' }]),
    messageScroller: refValue(null),
    route: { params: { id: 'conv-1' } },
    user: refValue({ username: 'tester' }),
    activeCharacter: () => null,
    loadSidebarData: async () => {},
    showActionNotice() {},
    showError() {}
  });
}

test('message edit draft entry points ignore updates while a message action is busy', async () => {
  const actions = createMessageActions();
  actions.editingMessageId.value = 'msg-1';
  actions.editingMessageContent.value = 'Draft';
  actions.messageActionBusy.value = 'msg-1';

  actions.setEditingMessageContent('Changed while busy');
  await actions.cancelEditMessage({ id: 'msg-1' });

  assert.equal(actions.editingMessageId.value, 'msg-1');
  assert.equal(actions.editingMessageContent.value, 'Draft');

  actions.messageActionBusy.value = '';
  actions.setEditingMessageContent('Changed after busy');
  await actions.cancelEditMessage({ id: 'msg-1' });

  assert.equal(actions.editingMessageId.value, '');
  assert.equal(actions.editingMessageContent.value, '');
});
