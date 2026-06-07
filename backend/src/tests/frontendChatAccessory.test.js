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

test('economy balance refresh preserves unchanged account references', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    {
      accounts: [
        { id: 'acct-gold', conversationId: 'conv-1', currencyType: 'gold', balance: 12 }
      ]
    },
    {
      accounts: [
        { id: 'acct-gold', conversationId: 'conv-1', currencyType: 'gold', balance: 12 }
      ]
    },
    {
      accounts: [
        { id: 'acct-gold', conversationId: 'conv-1', currencyType: 'gold', balance: 15 }
      ]
    }
  ];
  const requestedUrls = [];

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    const payload = responses.shift();
    assert.ok(payload, 'unexpected fetch call');
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const accessory = createAccessory();

    await accessory.loadEconomyBalance();
    const firstAccounts = accessory.economyAccounts.value;
    assert.deepEqual(firstAccounts, [
      { id: 'acct-gold', conversationId: 'conv-1', currencyType: 'gold', balance: 12 }
    ]);

    await accessory.loadEconomyBalance();
    assert.equal(accessory.economyAccounts.value, firstAccounts);

    await accessory.loadEconomyBalance();
    assert.notEqual(accessory.economyAccounts.value, firstAccounts);
    assert.equal(accessory.economyAccounts.value[0].balance, 15);

    assert.deepEqual(requestedUrls, [
      '/api/conversations/conv-1/economy?ensure=0',
      '/api/conversations/conv-1/economy?ensure=0',
      '/api/conversations/conv-1/economy?ensure=0'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('status bar refresh preserves unchanged object references and editor drafts', async () => {
  const originalFetch = globalThis.fetch;
  const baseStatusBar = {
    id: 'status-1',
    conversationId: 'conv-1',
    name: 'Vitals',
    template: '',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    variables: [
      { name: 'HP', value: 10, max: 10, color: '#ff0000' }
    ]
  };
  const responses = [
    baseStatusBar,
    { ...baseStatusBar, variables: [{ name: 'HP', value: 10, max: 10, color: '#ff0000' }] },
    {
      ...baseStatusBar,
      updatedAt: '2026-06-08T00:01:00.000Z',
      variables: [{ name: 'HP', value: 8, max: 10, color: '#ff0000' }]
    }
  ];
  const requestedUrls = [];

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    const payload = responses.shift();
    assert.ok(payload, 'unexpected fetch call');
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const accessory = createAccessory();

    await accessory.loadStatusBar();
    const firstStatusBar = accessory.statusBar.value;
    assert.equal(firstStatusBar.variables[0].value, 10);

    accessory.statusBarForm.name = 'Local Draft';
    accessory.statusBarForm.variables[0].value = 7;
    await accessory.loadStatusBar();
    assert.equal(accessory.statusBar.value, firstStatusBar);
    assert.equal(accessory.statusBarForm.name, 'Local Draft');
    assert.equal(accessory.statusBarForm.variables[0].value, 7);

    await accessory.loadStatusBar();
    assert.notEqual(accessory.statusBar.value, firstStatusBar);
    assert.equal(accessory.statusBar.value.variables[0].value, 8);
    assert.equal(accessory.statusBarForm.name, 'Vitals');
    assert.equal(accessory.statusBarForm.variables[0].value, 8);

    assert.deepEqual(requestedUrls, [
      '/api/conversations/conv-1/status-bar',
      '/api/conversations/conv-1/status-bar',
      '/api/conversations/conv-1/status-bar'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('accessory skill sync preserves unchanged nested config references', () => {
  const accessory = createAccessory();
  const initialStatusBarAgent = accessory.accessorySkills.statusBarAgent;

  accessory.syncAccessorySkills({
    npcAgent: { enabled: true, modelOverride: 'model-a' },
    economyAgent: { enabled: 'true', model_override: 'model-b' }
  });

  const npcAgent = accessory.accessorySkills.npcAgent;
  const economyAgent = accessory.accessorySkills.economyAgent;
  assert.equal(accessory.accessorySkills.statusBarAgent, initialStatusBarAgent);
  assert.deepEqual(npcAgent, { enabled: true, modelOverride: 'model-a' });
  assert.deepEqual(economyAgent, { enabled: true, modelOverride: 'model-b' });

  accessory.syncAccessorySkills({
    npcAgent: { enabled: true, modelOverride: 'model-a' },
    economyAgent: { enabled: true, modelOverride: 'model-b' }
  });
  assert.equal(accessory.accessorySkills.npcAgent, npcAgent);
  assert.equal(accessory.accessorySkills.economyAgent, economyAgent);

  accessory.syncAccessorySkills({
    npcAgent: { enabled: true, modelOverride: 'model-c' },
    economyAgent: { enabled: true, modelOverride: 'model-b' }
  });
  assert.notEqual(accessory.accessorySkills.npcAgent, npcAgent);
  assert.equal(accessory.accessorySkills.economyAgent, economyAgent);
  assert.deepEqual(accessory.accessorySkills.npcAgent, { enabled: true, modelOverride: 'model-c' });
});
