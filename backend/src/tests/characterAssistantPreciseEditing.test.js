import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { completeCharacterDraft, streamCharacterDraft } from '../services/characterAssistant.js';
import { parseStatusBarRuntime, serializeStatusBarRuntime } from '../../../shared/statusBarRuntime.js';

const settings = {
  providerType: 'custom', gatewayName: 'Precise editing test', baseUrl: 'https://assistant-editing.test',
  apiKey: 'test-key', model: 'test-model', extraBody: {}
};

const runtime = {
  renderer: 'runtime', framework: 'vue', html: '<p>{{ values.HP }}</p>',
  css: 'p { color: red; }', javascript: 'return { expanded: true };'
};

function currentCharacter() {
  return {
    name: 'Harbor guide', background: 'Raised beside the harbor.', worldview: 'The north road is closed.',
    persona: 'Quiet and careful. Keeps a brass compass. Protects every traveler.',
    openingMessage: 'Welcome to the harbor.', tags: ['guide', 'harbor'],
    regexRules: [
      { label: 'First rule', pattern: 'harbour', replacement: 'harbor', flags: 'g', scope: 'output', enabled: true },
      { label: 'Second rule', pattern: 'traveller', replacement: 'traveler', flags: 'g', scope: 'input', enabled: true }
    ],
    renderPlugins: [
      { label: 'Notes', type: 'fold', pattern: '\\[note\\](.*?)\\[/note\\]', flags: 'u', titleTemplate: 'Notes', enabled: true },
      { label: 'Aside', type: 'fold', pattern: '\\[aside\\](.*?)\\[/aside\\]', flags: 'u', titleTemplate: 'Aside', enabled: true }
    ],
    modSuggestions: [
      { name: 'Travel tone', description: 'A measured tone.', type: 'prompt_inject', content: 'Speak clearly.', enabled: true },
      { name: 'Harbor style', description: 'Use harbor imagery.', type: 'style_enhance', content: 'Mention the sea.', enabled: false }
    ],
    authorAdvancedSettings: normalizeAdvancedSettings({
      statusBarPrompt: 'Update HP after each scene. Keep the other values stable.',
      statusBarBlueprint: {
        name: 'Travel status', template: serializeStatusBarRuntime(runtime), variables: [
          { name: 'HP', value: 80, type: 'meter', min: 0, max: 100, color: '#abcdef', unit: 'points' },
          { name: 'Mood', value: 'calm', type: 'text', color: '#123456' }
        ]
      },
      accessorySkills: {
        statusBarAgent: { enabled: true, modelOverride: 'status-model' },
        memoryAgent: { enabled: true, modelOverride: 'memory-model' }
      },
      customCss: '.card { color: blue; }', customJs: 'window.cardReady = true;'
    })
  };
}

function tool(name, args) {
  return { name, args };
}

async function runReplies(request, replies, { stream = false } = {}) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const round = requests.length;
      requests.push(body);
      assert.ok(round < replies.length, 'the assistant requested an unexpected extra provider round');
      const response = typeof replies[round] === 'function' ? await replies[round](body) : replies[round];
      const calls = Array.isArray(response) ? response : [];
      return Response.json({ choices: [{ message: {
        role: 'assistant', content: typeof response === 'string' ? response : null,
        tool_calls: calls.map(({ name, args }, index) => ({
          id: `editing-${round}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) }
        }))
      } }] });
    };
    const input = { conversationMode: true, current: currentCharacter(), requirement: 'Apply only the requested change.', ...request };
    const result = stream
      ? await streamCharacterDraft(settings, { ...input, emit: (event, data) => events.push({ event, data }) })
      : await completeCharacterDraft(settings, input);
    assert.equal(requests.length, replies.length);
    return { result, requests, events };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function resultsSentToProvider(request) {
  return request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
}

function assertConciseWriteResult(result, excludedText) {
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'statusBar'), false);
  assert.equal(Object.hasOwn(result, 'character'), false);
  if (excludedText) assert.equal(containsString(result, excludedText), false);
}

function containsString(value, text) {
  if (typeof value === 'string') return value.includes(text);
  return value !== null && typeof value === 'object' && Object.values(value).some(item => containsString(item, text));
}

test('exact character edits replace one passage and return concise feedback to the next round', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({ current }, [
    [tool('edit_character_text', { edits: [{ path: 'persona', oldText: 'brass compass', newText: 'silver compass' }] })],
    'The compass detail has been updated.'
  ]);
  assert.equal(result.changed, true);
  assert.equal(result.character.persona, current.persona.replace('brass compass', 'silver compass'));
  assert.equal(result.character.background, current.background);
  assert.deepEqual(result.character.authorAdvancedSettings, current.authorAdvancedSettings);
  assertConciseWriteResult(resultsSentToProvider(requests[1])[0], result.character.persona);
  assert.equal(result.toolCalls[0].result.ok, true);
});

test('an unchanged first story update is skipped without marking the card changed or emitting a checkpoint', async () => {
  const current = currentCharacter();
  const { result, requests, events } = await runReplies({ current }, [
    [tool('update_character_story', { persona: current.persona })],
    'The existing persona already contains that description.'
  ], { stream: true });
  const feedback = resultsSentToProvider(requests[1])[0];
  assert.equal(feedback.ok, true);
  assert.equal(feedback.skipped, true);
  assert.equal(result.changed, false);
  assert.equal(result.character.persona, current.persona);
  assert.deepEqual(result.checkpoint.completedSections, []);
  assert.equal(events.some(({ event }) => event === 'checkpoint'), false);
});

test('ambiguous exact text edits preserve the draft and ask for a more specific match', async () => {
  const current = { ...currentCharacter(), persona: 'Careful at dawn. Careful at dusk.' };
  const { result, requests } = await runReplies({ current }, [
    [tool('edit_character_text', { edits: [{ path: 'persona', oldText: 'Careful', newText: 'Bold' }] })],
    'I need a longer exact passage to change only one occurrence.'
  ]);
  const failure = resultsSentToProvider(requests[1])[0];
  assert.equal(failure.ok, false);
  assert.equal(failure.recoverable, true);
  assert.equal(result.changed, false);
  assert.equal(result.character.persona, current.persona);
});

test('replaceAll explicitly updates repeated passages without changing other fields', async () => {
  const current = { ...currentCharacter(), persona: 'Careful at dawn. Careful at dusk.' };
  const { result } = await runReplies({ current }, [
    [tool('edit_character_text', { edits: [{ path: 'persona', oldText: 'Careful', newText: 'Bold', replaceAll: true }] })],
    'Both descriptions have been updated.'
  ]);
  assert.equal(result.character.persona, 'Bold at dawn. Bold at dusk.');
  assert.equal(result.character.background, current.background);
  assert.equal(result.changed, true);
});

test('a failed text edit makes its entire multi-field batch atomic', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({ current }, [
    [tool('edit_character_text', { edits: [
      { path: 'persona', oldText: 'brass compass', newText: 'silver compass' },
      { path: 'background', oldText: 'This passage is stale.', newText: 'Raised in the mountains.' }
    ] })],
    'The stale passage must be read again before editing.'
  ]);
  assert.equal(resultsSentToProvider(requests[1])[0].ok, false);
  assert.equal(result.character.persona, current.persona);
  assert.equal(result.character.background, current.background);
  assert.equal(result.changed, false);
});

test('status prompt and nested blueprint updates preserve each other and omitted variables', async () => {
  const current = currentCharacter();
  const nextPrompt = 'Update HP only when the scene changes.';
  const { result, requests } = await runReplies({ current }, [
    [tool('update_character_status_bar', { statusBarPrompt: nextPrompt })],
    [tool('update_character_status_bar', { statusBarBlueprint: { name: 'Compact travel status' } })],
    'The instructions and status title have been updated independently.'
  ]);
  const advanced = result.character.authorAdvancedSettings;
  assert.equal(advanced.statusBarPrompt, nextPrompt);
  assert.deepEqual(advanced.statusBarBlueprint, { ...current.authorAdvancedSettings.statusBarBlueprint, name: 'Compact travel status' });
  assert.equal(advanced.customCss, current.authorAdvancedSettings.customCss);
  for (const feedback of resultsSentToProvider(requests[2])) {
    assertConciseWriteResult(feedback, current.authorAdvancedSettings.statusBarBlueprint.template);
    assert.equal(JSON.stringify(feedback).includes(nextPrompt), false);
  }
});

test('a full custom-template replacement preserves its separate prompt and variable metadata', async () => {
  const current = currentCharacter();
  const template = '<section class="status"><output>{{HP}}</output></section>';
  const { result, requests } = await runReplies({ current }, [
    [tool('update_character_status_bar', { statusBarBlueprint: { template } })],
    'Only the custom template was replaced.'
  ]);
  const advanced = result.character.authorAdvancedSettings;
  assert.equal(advanced.statusBarPrompt, current.authorAdvancedSettings.statusBarPrompt);
  assert.equal(advanced.statusBarBlueprint.template, template);
  assert.equal(advanced.statusBarBlueprint.name, current.authorAdvancedSettings.statusBarBlueprint.name);
  assert.deepEqual(advanced.statusBarBlueprint.variables, current.authorAdvancedSettings.statusBarBlueprint.variables);
  assertConciseWriteResult(resultsSentToProvider(requests[1])[0], template);
});

test('runtime sections and individual status variables update without replacing their neighbors', async () => {
  const current = currentCharacter();
  const css = 'p { color: green; }';
  const { result, requests } = await runReplies({ current }, [
    [tool('update_status_bar_code', { css })],
    [tool('upsert_status_bar_variable', { name: 'HP', value: 45 })],
    [tool('remove_status_bar_variable', { name: 'Mood' })],
    'Only the status color, HP value, and unused Mood variable changed.'
  ]);
  const advanced = result.character.authorAdvancedSettings;
  const blueprint = advanced.statusBarBlueprint;
  assert.deepEqual(parseStatusBarRuntime(blueprint.template), { ...runtime, css });
  assert.deepEqual(blueprint.variables, [{ ...current.authorAdvancedSettings.statusBarBlueprint.variables[0], value: 45 }]);
  assert.equal(advanced.statusBarPrompt, current.authorAdvancedSettings.statusBarPrompt);
  for (const feedback of resultsSentToProvider(requests[3])) assertConciseWriteResult(feedback, blueprint.template);
  assert.equal(result.toolCalls.every(call => call.result.ok), true);
});

test('exact runtime CSS edits preserve HTML, JavaScript, and status instructions', async () => {
  const current = currentCharacter();
  const { result } = await runReplies({ current }, [
    [tool('edit_character_text', { edits: [{ path: 'statusBarBlueprint.css', oldText: 'color: red', newText: 'color: purple' }] })],
    'Only the matching CSS declaration changed.'
  ]);
  const advanced = result.character.authorAdvancedSettings;
  assert.deepEqual(parseStatusBarRuntime(advanced.statusBarBlueprint.template), { ...runtime, css: 'p { color: purple; }' });
  assert.equal(advanced.statusBarPrompt, current.authorAdvancedSettings.statusBarPrompt);
  assert.deepEqual(advanced.statusBarBlueprint.variables, current.authorAdvancedSettings.statusBarBlueprint.variables);
});

test('field reads and draft searches expose requested text without creating writes or checkpoints', async () => {
  const current = currentCharacter();
  const offset = current.persona.indexOf('brass compass');
  const { result, requests, events } = await runReplies({ current }, [
    [tool('read_character_field', { path: 'persona', offset, limit: 'brass compass'.length })],
    [tool('search_character_draft', { query: 'brass compass', path: 'persona', maxResults: 1 })],
    'The existing compass detail is consistent.'
  ], { stream: true });
  const read = resultsSentToProvider(requests[1])[0];
  const search = resultsSentToProvider(requests[2]).at(-1);
  assert.equal(read.ok, true);
  assert.equal(JSON.stringify(read).includes('brass compass'), true);
  assert.equal(JSON.stringify(read).includes(current.persona), false);
  assert.equal(search.ok, true);
  assert.equal(JSON.stringify(search).includes('brass compass'), true);
  assert.equal(result.changed, false);
  assert.equal(result.character.persona, current.persona);
  assert.deepEqual(result.checkpoint.completedSections, []);
  assert.equal(events.some(({ event }) => event === 'checkpoint'), false);
});

test('guessed edit paths cannot bypass disabled story, status, or structured-data scopes', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({
    current, options: { background: false, advancedSettings: false, regexRules: false }
  }, [
    [
      tool('edit_character_text', { edits: [{ path: 'background', oldText: 'harbor', newText: 'mountain' }] }),
      tool('edit_character_text', { edits: [{ path: 'statusBarPrompt', oldText: 'HP', newText: 'MP' }] }),
      tool('patch_character_data', { edits: [{ op: 'replace', path: '/regexRules/0/replacement', oldValue: 'harbor', value: 'port' }] }),
      tool('update_status_bar_code', { css: 'p { display: none; }' })
    ],
    'Those sections were excluded from the requested scope.'
  ]);
  assert.equal(resultsSentToProvider(requests[1]).every(feedback => feedback.ok === false), true);
  assert.equal(result.changed, false);
  assert.equal(result.character.background, current.background);
  assert.deepEqual(result.character.regexRules, current.regexRules);
  assert.deepEqual(result.character.authorAdvancedSettings, current.authorAdvancedSettings);
});

test('structured patches preserve unrelated rules, plugins, skills, and list entries', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({ current }, [
    [tool('patch_character_data', { edits: [
      { op: 'replace', path: '/regexRules/0/replacement', oldValue: 'harbor', value: 'port' },
      { op: 'replace', path: '/renderPlugins/0/titleTemplate', oldValue: 'Notes', value: 'Travel notes' },
      { op: 'replace', path: '/accessorySkills/statusBarAgent/modelOverride', oldValue: 'status-model', value: 'new-status-model' },
      { op: 'replace', path: '/tags/0', oldValue: 'guide', value: 'navigator' },
      { op: 'replace', path: '/modSuggestions/0/description', oldValue: 'A measured tone.', value: 'A patient tone.' }
    ] })],
    'The requested structured fields were updated.'
  ]);
  const edited = result.character;
  assert.equal(edited.regexRules[0].replacement, 'port');
  assert.deepEqual(edited.regexRules[1], current.regexRules[1]);
  assert.equal(edited.regexRules[0].pattern, current.regexRules[0].pattern);
  assert.equal(edited.renderPlugins[0].titleTemplate, 'Travel notes');
  assert.deepEqual(edited.renderPlugins[1], current.renderPlugins[1]);
  assert.equal(edited.authorAdvancedSettings.accessorySkills.statusBarAgent.modelOverride, 'new-status-model');
  assert.deepEqual(edited.authorAdvancedSettings.accessorySkills.memoryAgent, current.authorAdvancedSettings.accessorySkills.memoryAgent);
  assert.deepEqual(edited.tags, ['navigator', 'harbor']);
  assert.equal(edited.modSuggestions[0].description, 'A patient tone.');
  assert.deepEqual(edited.modSuggestions[1], current.modSuggestions[1]);
  assert.deepEqual(edited.authorAdvancedSettings.statusBarBlueprint, current.authorAdvancedSettings.statusBarBlueprint);
  assertConciseWriteResult(resultsSentToProvider(requests[1])[0], current.authorAdvancedSettings.statusBarBlueprint.template);
  assert.equal(result.changed, true);
});

test('a stale structured patch rolls back all earlier edits in the same batch', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({ current }, [
    [tool('patch_character_data', { edits: [
      { op: 'replace', path: '/regexRules/0/replacement', oldValue: 'harbor', value: 'port' },
      { op: 'replace', path: '/tags/1', oldValue: 'stale-tag', value: 'mountains' }
    ] })],
    'The stale tag needs to be read before retrying.'
  ]);
  assert.equal(resultsSentToProvider(requests[1])[0].ok, false);
  assert.deepEqual(result.character.regexRules, current.regexRules);
  assert.deepEqual(result.character.tags, current.tags);
  assert.equal(result.changed, false);
});

test('structured add and remove operations append one tag and preserve optional variable neighbors', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({ current }, [
    [tool('patch_character_data', { edits: [
      { op: 'add', path: '/tags/-', value: 'traveler' },
      { op: 'add', path: '/statusBarBlueprint/variables/1/unit', value: 'mood' }
    ] })],
    [tool('patch_character_data', { edits: [
      { op: 'remove', path: '/statusBarBlueprint/variables/0/unit', oldValue: 'points' },
      { op: 'add', path: '/accessorySkills/statusBarAgent/tools/update_status_bar_code', value: false }
    ] })],
    'The requested tag and optional status fields changed.'
  ]);
  const advanced = result.character.authorAdvancedSettings;
  assert.deepEqual(result.character.tags, [...current.tags, 'traveler']);
  const { unit: _unit, ...hp } = current.authorAdvancedSettings.statusBarBlueprint.variables[0];
  assert.deepEqual(advanced.statusBarBlueprint.variables, [
    hp, { ...current.authorAdvancedSettings.statusBarBlueprint.variables[1], unit: 'mood' }
  ]);
  assert.equal(advanced.accessorySkills.statusBarAgent.tools.update_status_bar_code, false);
  assert.equal(advanced.accessorySkills.statusBarAgent.modelOverride, 'status-model');
  assert.deepEqual(advanced.accessorySkills.memoryAgent, current.authorAdvancedSettings.accessorySkills.memoryAgent);
  assert.equal(advanced.statusBarBlueprint.template, current.authorAdvancedSettings.statusBarBlueprint.template);
  assert.equal(advanced.statusBarPrompt, current.authorAdvancedSettings.statusBarPrompt);
  assert.equal(resultsSentToProvider(requests[2]).every(feedback => feedback.ok), true);
  assert.equal(result.changed, true);
});

test('unknown and prototype data paths fail without changing any draft field', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({ current }, [
    [
      tool('patch_character_data', { edits: [{ op: 'add', path: '/regexRules/0/unknownSetting', value: true }] }),
      tool('patch_character_data', { edits: [{ op: 'add', path: '/accessorySkills/__proto__/polluted', value: true }] }),
      tool('patch_character_data', { edits: [{ op: 'add', path: '/unrelatedSetting', value: 'unexpected' }] })
    ],
    'Those paths are unsupported.'
  ]);
  assert.equal(resultsSentToProvider(requests[1]).every(feedback => feedback.ok === false), true);
  assert.deepEqual(result.character.regexRules, current.regexRules);
  assert.deepEqual(result.character.authorAdvancedSettings, current.authorAdvancedSettings);
  assert.equal(Object.hasOwn(result.character, 'unrelatedSetting'), false);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.equal(result.changed, false);
});

test('structured normalization cannot silently trim explicit values or recreate removed required fields', async () => {
  const current = currentCharacter();
  const { result, requests } = await runReplies({ current }, [
    [
      tool('patch_character_data', { edits: [{ op: 'add', path: '/tags/-', value: ' padded-tag ' }] }),
      tool('patch_character_data', { edits: [{ op: 'remove', path: '/regexRules/0/flags', oldValue: 'g' }] })
    ],
    'The proposed values need to satisfy the stored field constraints.'
  ]);
  assert.equal(resultsSentToProvider(requests[1]).every(feedback => feedback.ok === false), true);
  assert.deepEqual(result.character.tags, current.tags);
  assert.deepEqual(result.character.regexRules, current.regexRules);
  assert.equal(result.changed, false);
});

test('story and granular regex edits preserve canonical rule metadata, long replacements, and plugin identities', async () => {
  const current = currentCharacter();
  const initialReplacement = 'a'.repeat(750);
  const replacement = 'b'.repeat(1000);
  current.regexRules[0] = {
    ...current.regexRules[0], id: 'canonical-rule', groupName: 'Travel rules', priority: 7,
    scriptMode: true, jsScript: 'return text.replace(/harbour/g, "harbor");', replacement: initialReplacement
  };
  current.renderPlugins[0] = { ...current.renderPlugins[0], id: 'canonical-render-plugin' };
  const { result, requests } = await runReplies({ current }, [
    [tool('update_character_story', { background: 'Raised beside a quiet harbor.' })],
    [tool('patch_character_data', { edits: [
      { op: 'replace', path: '/regexRules/0/replacement', oldValue: initialReplacement, value: replacement }
    ] })],
    'The background and one rule replacement changed.'
  ]);
  assert.equal(result.character.background, 'Raised beside a quiet harbor.');
  assert.deepEqual(result.character.regexRules, [{ ...current.regexRules[0], replacement }, current.regexRules[1]]);
  assert.deepEqual(result.character.renderPlugins, current.renderPlugins);
  assert.equal(resultsSentToProvider(requests[2]).every(feedback => feedback.ok), true);
  assert.equal(result.changed, true);
});

test('editing persisted cards preserves fifty-character names and twenty-item tags and render plugins', async () => {
  const current = currentCharacter();
  current.name = 'N'.repeat(50);
  current.tags = Array.from({ length: 20 }, (_value, index) => `tag-${index + 1}`);
  current.renderPlugins = Array.from({ length: 20 }, (_value, index) => ({
    id: `persisted-plugin-${index + 1}`, label: `Panel ${index + 1}`, type: 'fold',
    pattern: `\\[panel-${index + 1}\\](.*?)\\[/panel-${index + 1}\\]`,
    flags: 'u', titleTemplate: `Panel ${index + 1}`, enabled: true
  }));
  const { result, requests } = await runReplies({ current }, [
    [tool('edit_character_text', { edits: [{ path: 'persona', oldText: 'brass compass', newText: 'silver compass' }] })],
    [tool('patch_character_data', { edits: [
      { op: 'replace', path: '/tags/19', oldValue: 'tag-20', value: 'final-tag' },
      { op: 'replace', path: '/renderPlugins/19/titleTemplate', oldValue: 'Panel 20', value: 'Final panel' }
    ] })],
    'The persona and the final items changed without reducing the persisted card.'
  ]);
  assert.equal(result.character.name, current.name);
  assert.equal(result.character.persona, current.persona.replace('brass compass', 'silver compass'));
  assert.deepEqual(result.character.tags, [...current.tags.slice(0, 19), 'final-tag']);
  assert.deepEqual(result.character.renderPlugins, [
    ...current.renderPlugins.slice(0, 19), { ...current.renderPlugins[19], titleTemplate: 'Final panel' }
  ]);
  assert.equal(resultsSentToProvider(requests[2]).every(feedback => feedback.ok), true);
  assert.equal(result.changed, true);
});

test('the planning phase offers field inspection and search while withholding mutations', async () => {
  const current = currentCharacter();
  const { result, requests, events } = await runReplies({ current, planMode: true, options: { worldBook: false } }, [
    [tool('read_character_field', { path: 'persona' }), tool('search_character_draft', { query: 'compass', path: 'persona' })],
    [tool('edit_character_text', { edits: [{ path: 'persona', oldText: 'brass', newText: 'silver' }] })],
    [tool('submit_character_plan', { steps: [{ section: 'persona', intent: 'Change the compass material while preserving the rest.' }] })]
  ], { stream: true });
  const names = requests[0].tools.map(definition => definition.function.name);
  assert.ok(names.includes('read_character_field'));
  assert.ok(names.includes('search_character_draft'));
  for (const name of ['edit_character_text', 'patch_character_data', 'update_character_story', 'update_status_bar_code', 'upsert_status_bar_variable']) {
    assert.equal(names.includes(name), false);
  }
  assert.equal(resultsSentToProvider(requests[1]).every(feedback => feedback.ok), true);
  assert.equal(resultsSentToProvider(requests[2]).at(-1).ok, false);
  assert.equal(result.phase, 'plan');
  assert.equal(Object.hasOwn(result, 'character'), false);
  assert.deepEqual(result.plan.steps.map(step => step.section), ['persona']);
  assert.equal(events.some(({ event }) => event === 'checkpoint'), false);
  assert.equal(current.persona.includes('brass compass'), true);
});
