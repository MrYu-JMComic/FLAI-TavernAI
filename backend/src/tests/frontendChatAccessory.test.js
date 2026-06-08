import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { useChatConversation } = await import('../../../frontend/src/composables/chat/useChatConversation.js');
const { parseTemplateConfig, useChatAccessory, validateStatusBarCustomTemplate } = await import('../../../frontend/src/composables/chat/useChatAccessory.js');
const chatAccessorySource = readRepoText('frontend/src/composables/chat/useChatAccessory.js');
const { script: chatViewScript } = readVueBlocks('frontend/src/views/ChatView.vue');

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createAccessory(options = {}) {
  return useChatAccessory({
    conversation: options.conversation || { value: { id: 'conv-1', character: { name: 'Hero' } } },
    setActiveConversationIfChanged: options.setActiveConversationIfChanged,
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

test('status bar save preserves unchanged object references', async () => {
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
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    requests.push([requestUrl, method]);

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'status-save-token' });
    }

    if (requestUrl === '/api/conversations/conv-1/status-bar' && method === 'PUT') {
      return jsonResponse({
        ...baseStatusBar,
        variables: [
          { name: 'HP', value: 10, max: 10, color: '#ff0000' }
        ]
      });
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const accessory = createAccessory();

    accessory.applyStatusBarUpdate(baseStatusBar);
    const firstStatusBar = accessory.statusBar.value;

    await accessory.saveStatusBarChanges();

    assert.equal(accessory.statusBar.value, firstStatusBar);
    assert.equal(accessory.statusBarSaving.value, false);
    assert.deepEqual(
      requests.filter(([url]) => url === '/api/conversations/conv-1/status-bar'),
      [['/api/conversations/conv-1/status-bar', 'PUT']]
    );
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

test('status bar template config parsing keeps valid items while skipping malformed rows', () => {
  const parsed = parseTemplateConfig(JSON.stringify({
    variant: 'neon',
    density: 'compact',
    effects: ['glow', 'invalid', 'pulse', 'glow'],
    characters: [
      null,
      {
        name: 'Hero',
        variables: [
          null,
          { name: '', value: 10, max: 10, color: '#111111' },
          { name: 'HP', value: '7', max: '12', color: '#ff0000' }
        ]
      }
    ],
    quickReplies: [
      null,
      { label: ' ', text: 'Ignored' },
      { label: 'Wave', text: 'Hello' }
    ]
  }));

  assert.deepEqual(parsed, {
    variant: 'neon',
    density: 'compact',
    effects: ['glow', 'pulse', 'glow'],
    characters: [
      {
        name: 'Hero',
        variables: [
          { name: 'HP', value: 7, max: 12, color: '#ff0000' }
        ]
      }
    ],
    quickReplies: [
      { label: 'Wave', text: 'Hello' }
    ]
  });
});

test('useChatAccessory parses and clones status bar template config with direct loops', () => {
  assert.match(
    chatAccessorySource,
    /function parseCharacter\(raw\) \{[\s\S]*const variables = \[\];[\s\S]*for \(let index = 0; index < raw\.variables\.length; index \+= 1\) \{[\s\S]*variables\.push\(\{[\s\S]*name,[\s\S]*color: String\(variable\.color \|\| '#6c757d'\)[\s\S]*\}\);[\s\S]*ch\.variables = variables;[\s\S]*\}/
  );
  assert.match(
    chatAccessorySource,
    /function parseTemplateConfig\(raw\) \{[\s\S]*const effects = \[\];[\s\S]*for \(let index = 0; index < parsed\.effects\.length; index \+= 1\) \{[\s\S]*effects\.push\(effect\);[\s\S]*const chars = \[\];[\s\S]*for \(let index = 0; index < parsed\.characters\.length; index \+= 1\) \{[\s\S]*chars\.push\(character\);[\s\S]*const qrs = \[\];[\s\S]*for \(let index = 0; index < parsed\.quickReplies\.length; index \+= 1\) \{[\s\S]*qrs\.push\(quickReply\);[\s\S]*\}/
  );
  assert.match(
    chatAccessorySource,
    /function cloneTemplateConfig\(cfg = \{\}\) \{[\s\S]*effects: cloneTemplateEffects\(cfg\.effects\),[\s\S]*characters: cloneTemplateCharacters\(cfg\.characters\),[\s\S]*quickReplies: cloneTemplateQuickReplies\(cfg\.quickReplies\)[\s\S]*\}/
  );
  assert.match(
    chatAccessorySource,
    /const statusBarTemplateConfig = computed\(\(\) => cloneTemplateConfig\(statusBarTemplateCfg\)\);/
  );
  assert.match(
    chatAccessorySource,
    /function normalizeStatusVariablesForPayload\(variables = \[\]\) \{[\s\S]*const normalized = \[\];[\s\S]*for \(let index = 0; index < variables\.length && normalized\.length < STATUS_BAR_VARIABLE_LIMIT; index \+= 1\) \{[\s\S]*normalized\.push\(row\);[\s\S]*return normalized;[\s\S]*\}/
  );
  assert.match(
    chatAccessorySource,
    /function prependAccessorySkillResult\(result, currentResults = \[\]\) \{[\s\S]*const nextResults = \[result\];[\s\S]*for \(\s*let index = 0;[\s\S]*nextResults\.length < ACCESSORY_SKILL_RESULT_LIMIT;[\s\S]*nextResults\.push\(sourceResults\[index\]\);[\s\S]*return nextResults;[\s\S]*\}/
  );
  assert.match(
    chatAccessorySource,
    /function parseStatusPlaceholderToken\(token = ''\) \{[\s\S]*const separatorIndex = text\.indexOf\('\.'\);[\s\S]*const nextSeparatorIndex = text\.indexOf\('\.', separatorIndex \+ 1\);[\s\S]*rawName: text\.slice\(0, separatorIndex\)\.trim\(\),[\s\S]*rawProperty: text\.slice\([\s\S]*\)\.trim\(\)[\s\S]*\}/
  );
  assert.doesNotMatch(chatAccessorySource, /raw\.variables\s*\.\s*filter/);
  assert.doesNotMatch(chatAccessorySource, /parsed\.effects\.filter/);
  assert.doesNotMatch(chatAccessorySource, /parsed\.characters\.map\(parseCharacter\)\.filter/);
  assert.doesNotMatch(chatAccessorySource, /parsed\.quickReplies\.map\(parseQuickReply\)\.filter/);
  assert.doesNotMatch(chatAccessorySource, /statusBarTemplateCfg\.characters\.map/);
  assert.doesNotMatch(chatAccessorySource, /data\.variables\.map/);
  assert.doesNotMatch(chatAccessorySource, /return variables\s*\.\s*map/);
  assert.doesNotMatch(chatAccessorySource, /token\.split\('\.'\)\.map/);
});

test('status bar custom template issues dedupe and cap with direct loops', () => {
  const issues = validateStatusBarCustomTemplate(
    '<iframe></iframe><iframe></iframe><object></object><embed></embed><link><meta><base><form></form><input>{{}}'
  );

  assert.equal(issues.length, 5);
  let iframeIssueCount = 0;
  for (const issue of issues) {
    if (String(issue).includes('<iframe>')) {
      iframeIssueCount += 1;
    }
  }
  assert.equal(iframeIssueCount, 1);
  assert.match(
    chatAccessorySource,
    /function collectStatusBarTemplateIssues\(issues\) \{\s*const collected = \[\];\s*const sourceIssues = Array\.isArray\(issues\) \? issues : \[\];\s*for \(let index = 0; index < sourceIssues\.length && collected\.length < STATUS_BAR_TEMPLATE_ISSUE_LIMIT; index \+= 1\) \{[\s\S]*hasStatusBarTemplateIssue\(collected, issue\)[\s\S]*collected\.push\(issue\);[\s\S]*return collected;[\s\S]*\}/
  );
  assert.match(
    chatAccessorySource,
    /function hasStatusBarTemplateIssue\(issues, issue\) \{\s*for \(let index = 0; index < issues\.length; index \+= 1\) \{[\s\S]*if \(issues\[index\] === issue\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
  assert.doesNotMatch(chatAccessorySource, /\[\.\.\.new Set\(issues\)\]\.slice\(0, 5\)/);
});

test('accessory skill save preserves active conversation references for unchanged settings', async () => {
  const originalFetch = globalThis.fetch;
  const savedSkills = {
    npcAgent: { enabled: false, modelOverride: '' },
    statusBarAgent: { enabled: 'auto', modelOverride: '' },
    economyAgent: { enabled: false, modelOverride: '' },
    talentPrompt: { enabled: false, modelOverride: '' },
    cgScene: { enabled: false, modelOverride: '' }
  };
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    requests.push([requestUrl, method]);

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'accessory-save-token' });
    }

    if (requestUrl === '/api/conversations/conv-1/accessory-skills' && method === 'PUT') {
      return jsonResponse({ skills: savedSkills, active: {}, source: {} });
    }

    if (requestUrl === '/api/conversations/conv-1/economy?ensure=0') {
      return jsonResponse({ accounts: [] });
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-1' } },
      emit() {},
      showError() {}
    });
    chat.setActiveConversationIfChanged({
      id: 'conv-1',
      character: { name: 'Hero' },
      settings: { accessorySkills: savedSkills },
      userSettings: { accessorySkills: savedSkills }
    });
    const conversationReference = chat.conversation.value;
    const accessory = createAccessory({
      conversation: chat.conversation,
      setActiveConversationIfChanged: chat.setActiveConversationIfChanged
    });

    accessory.syncAccessorySkills(savedSkills);
    await accessory.saveAccessorySkillChanges();

    assert.equal(chat.conversation.value, conversationReference);
    assert.equal(accessory.accessorySaving.value, false);
    assert.deepEqual(requests.filter(([url]) => url !== '/api/csrf-token'), [
      ['/api/conversations/conv-1/accessory-skills', 'PUT'],
      ['/api/conversations/conv-1/economy?ensure=0', 'GET']
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('accessory skill results require the current conversation id', () => {
  const conversation = { value: { id: 'conv-2', character: { name: 'Hero' } } };
  const accessory = createAccessory({ conversation });
  const missingIdStatusBar = {
    id: 'status-missing-id',
    conversationId: '',
    name: 'Missing id',
    template: '',
    variables: [{ name: 'HP', value: 5, max: 10, color: '#ff0000' }]
  };
  const staleStatusBar = {
    id: 'status-stale',
    conversationId: 'conv-1',
    name: 'Stale',
    template: '',
    variables: [{ name: 'HP', value: 1, max: 10, color: '#ff0000' }]
  };
  const currentStatusBar = {
    id: 'status-current',
    conversationId: 'conv-2',
    name: 'Current',
    template: '',
    variables: [{ name: 'HP', value: 9, max: 10, color: '#ff0000' }]
  };

  accessory.handleSkillResult({
    skill: 'statusBarAgent',
    ok: true,
    result: { statusBar: missingIdStatusBar, updates: ['HP'] }
  });

  accessory.handleSkillResult({
    conversationId: 'conv-1',
    skill: 'statusBarAgent',
    ok: true,
    result: { statusBar: staleStatusBar, updates: ['HP'] }
  });

  assert.equal(accessory.accessorySkillResults.value.length, 0);
  assert.equal(accessory.statusBar.value, null);

  accessory.handleSkillResult({
    conversationId: 'conv-2',
    skill: 'statusBarAgent',
    ok: true,
    result: { statusBar: currentStatusBar, updates: ['HP'] }
  });

  assert.equal(accessory.accessorySkillResults.value.length, 1);
  assert.equal(accessory.accessorySkillResults.value[0].conversationId, 'conv-2');
  assert.equal(accessory.statusBar.value.id, currentStatusBar.id);
  assert.equal(accessory.statusBar.value.variables[0].value, 9);
});

test('accessory skill results keep a bounded newest-first list', () => {
  const accessory = createAccessory();

  for (let index = 0; index < 10; index += 1) {
    accessory.handleSkillResult({
      conversationId: 'conv-1',
      skill: 'statusBarAgent',
      ok: false,
      result: { index }
    });
  }

  assert.equal(accessory.accessorySkillResults.value.length, 8);
  assert.deepEqual(
    accessory.accessorySkillResults.value.map((item) => item.result.index),
    [9, 8, 7, 6, 5, 4, 3, 2]
  );
});

test('chat accessory summary comparisons use direct loops', () => {
  assert.match(
    chatAccessorySource,
    /function sameStatusVariableList\(currentVariables, nextVariables\) \{[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*!sameStatusVariableSummary\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    chatAccessorySource,
    /function sameEconomyAccountList\(currentAccounts, nextAccounts\) \{[\s\S]*for \(let index = 0; index < currentAccounts\.length; index \+= 1\) \{[\s\S]*!sameEconomyAccountSummary\(currentAccounts\[index\], nextAccounts\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(chatAccessorySource, /sameStatusVariableList[\s\S]*currentList\.every/);
  assert.doesNotMatch(chatAccessorySource, /sameEconomyAccountList[\s\S]*currentAccounts\.every/);
});

test('ChatView routes chat accessory saves through the active conversation stable setter', () => {
  assert.match(
    chatViewScript,
    /useChatAccessory\(\{ conversation, setActiveConversationIfChanged, showActionNotice, showError \}\)/
  );
});

test('ChatView ignores stale accessory skill results before status badges update', () => {
  assert.match(
    chatViewScript,
    /function handleAccessorySkillResult\(data = \{\}\) \{[\s\S]*const eventConversationId = String\(data\?\.conversationId \|\| ''\)\.trim\(\);[\s\S]*if \(!eventConversationId \|\| eventConversationId !== conversation\.value\?\.id\) \{\s*return;\s*\}[\s\S]*const result = data\.result \|\| \{\};/
  );
});

test('ChatView serializes accessory refresh snapshots with direct loops', () => {
  assert.match(
    chatViewScript,
    /function serializeStatusBarSnapshot\(value = null\) \{[\s\S]*let snapshot = '';[\s\S]*snapshot = appendSnapshotField\(snapshot, value\.id \|\| ''\);[\s\S]*const sourceVariables = Array\.isArray\(value\.variables\) \? value\.variables : \[\];[\s\S]*snapshot = appendSnapshotField\(snapshot, sourceVariables\.length\);[\s\S]*for \(let index = 0; index < sourceVariables\.length; index \+= 1\) \{[\s\S]*snapshot = appendSnapshotField\(snapshot, item\?\.name \|\| ''\);[\s\S]*snapshot = appendSnapshotField\(snapshot, item\?\.color \|\| ''\);[\s\S]*return snapshot;[\s\S]*\}/
  );
  assert.match(
    chatViewScript,
    /function serializeNpcSnapshot\(value = \[\]\) \{[\s\S]*const items = \[\];[\s\S]*const sourceNpcs = Array\.isArray\(value\) \? value : \[\];[\s\S]*for \(let index = 0; index < sourceNpcs\.length; index \+= 1\) \{[\s\S]*const name = String\(npc\?\.name \|\| ''\);[\s\S]*snapshot = appendSnapshotField\(snapshot, Number\(npc\?\.memoryCount \|\| 0\)\);[\s\S]*items\.push\(\{ name, snapshot \}\);[\s\S]*items\.sort\(\(a, b\) => a\.name\.localeCompare\(b\.name\)\);[\s\S]*for \(let index = 0; index < items\.length; index \+= 1\) \{[\s\S]*serialized \+= items\[index\]\.snapshot;[\s\S]*return serialized;[\s\S]*\}/
  );
  assert.match(
    chatViewScript,
    /function appendSnapshotField\(snapshot, value\) \{\s*const text = String\(value \?\? ''\);[\s\S]*return `\$\{snapshot\}\$\{text\.length\}:\$\{text\};`;[\s\S]*\}/
  );
  assert.doesNotMatch(chatViewScript, /value\.variables\.map\(/);
  assert.doesNotMatch(chatViewScript, /\.map\(\(npc\) =>/);
  assert.doesNotMatch(chatViewScript, /return JSON\.stringify\(\{[\s\S]*variables/);
  assert.doesNotMatch(chatViewScript, /return JSON\.stringify\(items\.sort/);
});

test('ChatView clears route status bar state through the stable accessory helper', () => {
  assert.match(chatViewScript, /applyStatusBarUpdate\(null, \{ syncForm: false \}\);/);
  assert.doesNotMatch(chatViewScript, /statusBar\.value\s*=\s*null/);
});

test('ChatView stops redundant NPC accessory polling after the refresh fingerprint is synced', () => {
  assert.match(
    chatViewScript,
    /let accessoryRefreshSnapshot = \{[\s\S]*npcSynced: true[\s\S]*\};/
  );
  assert.match(
    chatViewScript,
    /function beginAccessoryRefreshStatus\(\) \{[\s\S]*accessoryRefreshSnapshot = \{[\s\S]*npc: latestNpcFingerprint,[\s\S]*npcSynced: false[\s\S]*\};/
  );
  assert.match(
    chatViewScript,
    /if \(npcUpdateStatus\.value !== ACCESSORY_UPDATING && accessoryRefreshSnapshot\.npcSynced\) \{\s*return false;\s*\}/
  );
  assert.match(
    chatViewScript,
    /latestNpcFingerprint = nextFingerprint;\s*accessoryRefreshSnapshot\.npcSynced = true;/
  );
  assert.match(
    chatViewScript,
    /function resetAccessoryUpdateStatus\(options = \{\}\) \{[\s\S]*accessoryRefreshSnapshot = \{[\s\S]*npc: latestNpcFingerprint,[\s\S]*npcSynced: true[\s\S]*\};/
  );
});

test('ChatView exposes pending accessory refresh status to the submit scheduler', () => {
  assert.match(
    chatViewScript,
    /function beginAccessoryRefreshStatus\(\) \{[\s\S]*return hasPendingAccessoryRefresh\(\);\s*\}/
  );
  assert.match(
    chatViewScript,
    /async function refreshAccessoryPanels\(payload = \{\}\) \{[\s\S]*return hasPendingAccessoryRefresh\(\);\s*\}/
  );
  assert.match(
    chatViewScript,
    /function hasPendingAccessoryRefresh\(\) \{\s*return statusBarUpdateStatus\.value === ACCESSORY_UPDATING \|\|\s*npcUpdateStatus\.value === ACCESSORY_UPDATING;\s*\}/
  );
});

test('ChatView refreshes the NPC panel only after NPC refresh work changes the fingerprint', () => {
  assert.match(
    chatViewScript,
    /const shouldRefreshNpcPanel = await refreshNpcUpdateStatus\(Boolean\(payload\?\.isFinal\)\);[\s\S]*if \(npcPanelOpen\.value && shouldRefreshNpcPanel\) \{\s*npcRefreshKey\.value \+= 1;\s*\}/
  );
  assert.match(
    chatViewScript,
    /const npcChanged = nextFingerprint !== accessoryRefreshSnapshot\.npc;[\s\S]*if \(npcUpdateStatus\.value === ACCESSORY_UPDATING && npcChanged\) \{[\s\S]*return npcChanged;/
  );
  assert.match(
    chatViewScript,
    /if \(!showNpcFeature\.value\) \{[\s\S]*return false;[\s\S]*if \(!conversationId \|\| accessoryRefreshSnapshot\.conversationId !== conversationId\) \{[\s\S]*return false;/
  );
});

test('ChatView keeps final NPC accessory cleanup scoped to the active conversation', () => {
  assert.match(
    chatViewScript,
    /if \(\s*isFinal &&\s*npcUpdateStatus\.value === ACCESSORY_UPDATING &&\s*conversation\.value\?\.id === conversationId &&\s*accessoryRefreshSnapshot\.conversationId === conversationId\s*\) \{\s*npcUpdateStatus\.value = ACCESSORY_NOT_UPDATED;\s*\}/
  );
});

test('ChatView keeps failed NPC fingerprint sync scoped to the active conversation', () => {
  assert.match(
    chatViewScript,
    /async function syncNpcFingerprint\(conversationId = conversation\.value\?\.id\) \{[\s\S]*\} catch \{\s*if \(conversation\.value\?\.id === conversationId\) \{\s*latestNpcFingerprint = '';\s*\}\s*\}[\s\S]*return latestNpcFingerprint;/
  );
});

test('ChatView finds the latest assistant message without cloning the message list', () => {
  assert.match(
    chatViewScript,
    /const latestAssistantMessage = computed\(\(\) => \{\s*for \(let index = messages\.value\.length - 1; index >= 0; index -= 1\) \{[\s\S]*if \(message\?\.role === 'assistant'\) \{\s*return message;\s*\}[\s\S]*return null;\s*\}\);/
  );
  assert.doesNotMatch(chatViewScript, /\[\.\.\.messages\.value\]\.reverse\(\)\.find/);
});

test('ChatView accepts NPC panel loaded events only for the active conversation', () => {
  assert.match(
    chatViewScript,
    /function handleNpcPanelLoaded\(payload = \{\}\) \{[\s\S]*const eventConversationId = payload\?\.conversationId \|\| '';[\s\S]*if \(!eventConversationId \|\| eventConversationId !== conversation\.value\?\.id\) \{\s*return;\s*\}[\s\S]*const npcs = Array\.isArray\(payload\?\.npcs\) \? payload\.npcs : \[\];[\s\S]*latestNpcFingerprint = serializeNpcSnapshot\(npcs\);/
  );
});
