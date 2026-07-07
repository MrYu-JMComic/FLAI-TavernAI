import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { branchConversation } = await import('../modules/branches.js');
const { createEntry, createWorldBook, linkWorldBookToCharacter } = await import('../modules/worldBooks.js');
const { publicUser, getUserProfile } = await import('../modules/users.js');
const { providerWithSecret } = await import('../services/providers.js');
const { createUpgradeRouter } = await import('../routes/upgrade.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('upgrade bootstrap and provider capabilities expose non-secret app state', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-bootstrap-user';
  insertUser(database, userId, { displayName: 'Upgrade' });
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const bootstrapResponse = await fetch(`${baseUrl}/api/app/bootstrap`);
    assert.equal(bootstrapResponse.status, 200);
    const bootstrap = await bootstrapResponse.json();
    assert.equal(bootstrap.user.id, userId);
    assert.equal(bootstrap.features.promptPipelinePreview, true);
    assert.equal(bootstrap.provider, null);

    const capabilitiesResponse = await fetch(`${baseUrl}/api/providers/capabilities`);
    assert.equal(capabilitiesResponse.status, 200);
    const capabilities = await capabilitiesResponse.json();
    const deepseek = capabilities.providers.find((provider) => provider.providerType === 'deepseek');
    assert.ok(deepseek);
    assert.equal(deepseek.capabilities.streaming, true);
    assert.equal(deepseek.modelCapabilities.streaming, true);
    assert.equal(deepseek.modelCapabilities.imageGeneration, false);
    assert.ok(capabilities.providers.some((provider) => provider.modelCapabilities && provider.capabilities.streaming));
  });
});

test('upgrade asset routes store list serve and delete user assets', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-asset-user';
  insertUser(database, userId);
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'chat-image',
        name: 'tiny.png',
        dataUrl: tinyPngDataUrl
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.kind, 'chat-image');
    assert.equal(created.mimeType, 'image/png');
    assert.equal(created.url, `/api/assets/${created.id}`);
    assert.equal(Object.hasOwn(created, 'base64Data'), false);

    const listResponse = await fetch(`${baseUrl}/api/assets?kind=chat-image`);
    const list = await listResponse.json();
    assert.equal(list.assets.length, 1);
    assert.equal(list.assets[0].id, created.id);

    const mediaResponse = await fetch(`${baseUrl}/api/assets/${created.id}`);
    assert.equal(mediaResponse.status, 200);
    assert.equal(mediaResponse.headers.get('content-type'), 'image/png');
    assert.ok((await mediaResponse.arrayBuffer()).byteLength > 0);

    const deleteResponse = await fetch(`${baseUrl}/api/assets/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual((await fetch(`${baseUrl}/api/assets?kind=chat-image`).then((res) => res.json())).assets, []);
  });
});

test('upgrade asset media route allows public character assets but not private ones', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'upgrade-public-asset-owner';
  const viewerId = 'upgrade-public-asset-viewer';
  insertUser(database, ownerId);
  insertUser(database, viewerId);

  const publicCharacter = createCharacter(database, ownerId, {
    name: 'Public Asset Character',
    avatarUrl: tinyPngDataUrl,
    visibility: 'public'
  });
  const privateCharacter = createCharacter(database, ownerId, {
    name: 'Private Asset Character',
    avatarUrl: tinyPngDataUrl,
    visibility: 'private'
  });
  const app = createUpgradeRoutesApp(database, viewerId);

  await withServer(app, async (baseUrl) => {
    const publicResponse = await fetch(`${baseUrl}${publicCharacter.avatarUrl}`);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('content-type'), 'image/png');

    const privateResponse = await fetch(`${baseUrl}${privateCharacter.avatarUrl}`);
    assert.equal(privateResponse.status, 404);
  });
});

test('upgrade asset schema and image validation reject empty or spoofed uploads', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-asset-validation-user';
  insertUser(database, userId);
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const emptyResponse = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'chat-image' })
    });
    assert.equal(emptyResponse.status, 400);

    const spoofedResponse = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'chat-image',
        dataUrl: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`
      })
    });
    assert.equal(spoofedResponse.status, 400);
    const spoofedBody = await spoofedResponse.json();
    assert.match(spoofedBody.error, /资产图片数据无效/);

    const mislabeledResponse = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'chat-image',
        dataUrl: tinyPngDataUrl.replace('image/png', 'image/jpeg')
      })
    });
    assert.equal(mislabeledResponse.status, 400);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  });
});

test('upgrade asset schema is repeatably initialized with owner and metadata columns', () => {
  const database = createAppDatabase(':memory:');
  const columns = new Set(database.prepare('PRAGMA table_info(assets)').all().map((column) => column.name));
  for (const column of ['owner_type', 'owner_id', 'kind', 'mime_type', 'base64_data', 'byte_size', 'metadata_json']) {
    assert.equal(columns.has(column), true);
  }

  const indexes = new Set(database.prepare("PRAGMA index_list('assets')").all().map((index) => index.name));
  assert.equal(indexes.has('idx_assets_user_kind_created'), true);
  assert.equal(indexes.has('idx_assets_owner'), true);
});

test('upgrade conversation memories support editable long-term context', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-memory-user';
  insertUser(database, userId);
  const { conversationId } = createConversationFixture(database, userId);
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memoryType: 'relationship',
        subject: 'Mira',
        content: 'Mira trusts the player after the rescue.',
        confidence: 0.8
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.memoryType, 'relationship');
    assert.equal(created.enabled, true);
    assert.equal(created.sourceKind, 'manual');

    const updateResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Mira trusts the player and follows their lead.',
        enabled: false
      })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.enabled, false);
    assert.match(updated.content, /follows/);

    const confirmResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories/${created.id}/confirm`, {
      method: 'POST'
    });
    assert.equal(confirmResponse.status, 200);
    assert.equal((await confirmResponse.json()).enabled, true);

    const disableResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories/${created.id}/disable`, {
      method: 'POST'
    });
    assert.equal(disableResponse.status, 200);
    assert.equal((await disableResponse.json()).enabled, false);

    const listResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories`);
    const list = await listResponse.json();
    assert.equal(list.memories.length, 1);

    const rollbackResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories/${created.id}/rollback`, {
      method: 'POST'
    });
    assert.equal(rollbackResponse.status, 200);
    const rolledBack = await rollbackResponse.json();
    assert.equal(rolledBack.archived, true);
    assert.equal(rolledBack.enabled, false);

    const visibleAfterRollback = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories`).then((res) => res.json());
    assert.equal(visibleAfterRollback.memories.length, 0);
    const archivedList = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories?includeArchived=1`).then((res) => res.json());
    assert.equal(archivedList.memories.length, 1);

    const deleteResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/memories/${created.id}`, {
      method: 'DELETE'
    });
    assert.equal(deleteResponse.status, 200);
  });
});

test('upgrade context preview includes world book matches memory and token estimate', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-context-user';
  insertUser(database, userId);
  const { conversationId, characterId } = createConversationFixture(database, userId);
  const book = createWorldBook(database, userId, { name: 'Forest Lore' });
  const moonGateEntry = createEntry(database, userId, book.id, {
    name: 'Moon Gate',
    triggerKeys: 'moon gate',
    group: 'gate-conflict',
    groupWeight: 9,
    content: 'The moon gate opens only at midnight.'
  });
  createEntry(database, userId, book.id, {
    name: 'Moon Gate Echo',
    triggerKeys: 'moon gate',
    group: 'gate-conflict',
    groupWeight: 1,
    content: 'The moon gate hums when the old road is near.'
  });
  createEntry(database, userId, book.id, {
    name: 'Sealed Gate',
    triggerKeys: 'sealed gate',
    selective: true,
    selectiveLogic: 0,
    keysSecondary: 'silver key',
    content: 'The sealed gate opens for a silver key.'
  });
  linkWorldBookToCharacter(database, book.id, characterId, 0, userId);
  database
    .prepare(
      `INSERT INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model,
        encrypted_api_key, api_key_hint, supports_reasoning, extra_body, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      'openai',
      'OpenAI Preview',
      'https://api.openai.test/v1',
      'gpt-4.1-mini',
      null,
      'sk-...test',
      1,
      '{}',
      new Date().toISOString()
    );
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const assetResponse = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'chat-image',
        name: 'moon-gate.png',
        dataUrl: tinyPngDataUrl
      })
    });
    assert.equal(assetResponse.status, 201);
    const asset = await assetResponse.json();
    database
      .prepare(
        `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'context-preview-image-message',
        userId,
        conversationId,
        'user',
        'I sketch the moon gate.',
        JSON.stringify([{ type: 'image', url: asset.url, mimeType: 'image/png', name: 'moon-gate.png' }]),
        '',
        null,
        new Date().toISOString()
      );

    await fetch(`${baseUrl}/api/conversations/${conversationId}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memoryType: 'event',
        content: 'The player found a silver key.'
      })
    });

    const previewResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/context/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'We approach the moon gate. The sealed gate waits.',
        attachments: [{ type: 'image', url: asset.url, mimeType: 'image/png', name: 'moon-gate.png' }]
      })
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.character.id, characterId);
    assert.equal(preview.sections.worldBook.entries.length, 1);
    assert.equal(preview.sections.worldBook.diagnostics.bookCount, 1);
    assert.equal(preview.sections.worldBook.diagnostics.conflictCount, 1);
    assert.equal(preview.sections.worldBook.diagnostics.groups[0].name, 'gate-conflict');
    assert.equal(preview.sections.worldBook.diagnostics.groups[0].previewWinnerId, moonGateEntry.id);
    assert.equal(
      preview.sections.worldBook.diagnostics.explanations.some((entry) => entry.status === 'selective_blocked'),
      true
    );
    assert.equal(preview.sections.worldBook.entries[0].matchedKeys.includes('moon gate'), true);
    assert.ok(preview.sections.worldBook.entries[0].status);
    assert.match(preview.sections.memory.context, /silver key/);
    assert.equal(preview.priority.activeContext.includes('long_term_memory'), true);
    assert.match(JSON.stringify(preview.messages), /silver key/);
    assert.equal(preview.diagnostics.imagePartCount, 2);
    assert.equal(preview.budget.imageParts, 2);
    assert.match(JSON.stringify(preview.messages), /data:image\/png;base64,\[redacted\]/);
    assert.equal(JSON.stringify(preview.messages).includes(asset.url), false);
    assert.match(preview.diagnostics.providerDiagnosticId, /^context-/);
    assert.equal(preview.diagnostics.providerConfigured, true);
    assert.equal(preview.providerDiagnostics.provider.providerType, 'openai');
    assert.equal(preview.providerDiagnostics.provider.gatewayName, 'OpenAI Preview');
    assert.equal(preview.providerDiagnostics.provider.baseUrlHost, 'api.openai.test');
    assert.equal(preview.providerDiagnostics.provider.apiKeySet, true);
    assert.equal(preview.providerDiagnostics.capability.modelCapabilities.model, 'gpt-4.1-mini');
    assert.equal(preview.providerDiagnostics.capability.modelCapabilities.vision, true);
    assert.equal(JSON.stringify(preview).includes('sk-...test'), false);
    assert.ok(preview.budget.estimatedTokens > 0);
  });
});

test('upgrade context preview reports prompt budget truncation', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-context-budget-user';
  insertUser(database, userId);
  const { conversationId } = createConversationFixture(database, userId);
  database
    .prepare(
      `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'ancient-budget-message',
      userId,
      conversationId,
      'assistant',
      `ANCIENT_CONTEXT_SHOULD_BE_OMITTED ${'old scene detail '.repeat(220)}`,
      '[]',
      '',
      null,
      '2000-01-01T00:00:00.000Z'
    );
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const previewResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/context/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Continue from the current doorway.',
        contextBudgetCharacters: 1800
      })
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.budget.limitCharacters, 1800);
    assert.equal(preview.budget.truncated, true);
    assert.equal(preview.budget.truncation.some((item) => item.reason === 'history_omitted'), true);
    assert.equal(JSON.stringify(preview.messages).includes('ANCIENT_CONTEXT_SHOULD_BE_OMITTED'), false);
    assert.match(JSON.stringify(preview.messages), /current doorway/);
  });
});

test('upgrade branch tree returns full branch structure and comparison data', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-branch-tree-user';
  const otherUserId = 'upgrade-branch-tree-other-user';
  insertUser(database, userId);
  insertUser(database, otherUserId);
  const { conversationId } = createConversationFixture(database, userId);
  const { conversationId: otherConversationId } = createConversationFixture(database, otherUserId);
  branchConversation(database, otherUserId, otherConversationId, `message-${otherUserId}`);

  const child = branchConversation(database, userId, conversationId, `message-${userId}`);
  assert.ok(child);
  const childMessageId = 'branch-tree-child-message';
  const childMessageAt = new Date(Date.now() + 1000).toISOString();
  database
    .prepare(
      `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(childMessageId, userId, child.id, 'assistant', 'Child path answer.', '[]', '', null, childMessageAt);
  const grandchild = branchConversation(database, userId, child.id, childMessageId);
  assert.ok(grandchild);
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/conversations/${child.id}/branches/tree`);
    assert.equal(response.status, 200);
    const tree = await response.json();
    assert.equal(tree.rootId, conversationId);
    assert.equal(tree.activeConversationId, child.id);
    assert.equal(tree.tree.id, conversationId);
    assert.equal(tree.tree.children.length, 1);
    assert.equal(tree.tree.children[0].id, child.id);
    assert.equal(tree.tree.children[0].children[0].id, grandchild.id);
    assert.equal(tree.nodes.length, 3);
    assert.equal(tree.branches.length, 1);
    assert.equal(tree.branches[0].id, grandchild.id);
    assert.equal(tree.comparison.totalConversations, 3);
    assert.equal(tree.comparison.activeDepth, 1);
    assert.equal(tree.comparison.ancestorCount, 1);
    assert.equal(tree.comparison.descendantCount, 1);
    const grandchildNode = tree.nodes.find((node) => node.id === grandchild.id);
    assert.equal(grandchildNode.branchPoint.messageId, childMessageId);
    assert.equal(grandchildNode.branchPoint.preview, 'Child path answer.');
    assert.equal(JSON.stringify(tree).includes(otherUserId), false);
  });
});

test('upgrade world book match preview and diagnostics export are scoped to the user', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-preview-user';
  insertUser(database, userId);
  createConversationFixture(database, userId);
  const book = createWorldBook(database, userId, { name: 'Preview Book' });
  const signalEntry = createEntry(database, userId, book.id, {
    name: 'Signal Fire',
    triggerKeys: 'signal fire',
    content: 'A signal fire means allies are nearby.'
  });
  const regexEntry = createEntry(database, userId, book.id, {
    name: 'Moon Gate Regex',
    triggerKeys: 'moon\\s+gate',
    regexMode: true,
    content: 'The moon gate opens under a clean sky.'
  });
  const selectiveEntry = createEntry(database, userId, book.id, {
    name: 'Sealed Door',
    triggerKeys: 'sealed door',
    selective: true,
    selectiveLogic: 0,
    keysSecondary: 'silver key',
    content: 'The sealed door opens only for the silver key.'
  });
  const stormHigh = createEntry(database, userId, book.id, {
    name: 'Storm High',
    triggerKeys: 'storm',
    group: 'weather',
    groupWeight: 10,
    content: 'The storm dominates the scene.'
  });
  const stormLow = createEntry(database, userId, book.id, {
    name: 'Storm Low',
    triggerKeys: 'storm',
    group: 'weather',
    groupWeight: 5,
    content: 'The storm is a background detail.'
  });
  const omenEntry = createEntry(database, userId, book.id, {
    name: 'Omen Roll',
    triggerKeys: 'omen',
    useProbability: true,
    probability: 30,
    sticky: 2,
    cooldown: 4,
    delay: 1,
    content: 'The omen may or may not appear at runtime.'
  });
  const invalidRegexEntry = createEntry(database, userId, book.id, {
    name: 'Broken Regex',
    triggerKeys: '[',
    regexMode: true,
    content: 'This trigger is malformed.'
  });
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const matchResponse = await fetch(`${baseUrl}/api/world-books/${book.id}/match-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'The signal fire is lit. A moon gate opens. The sealed door stays shut as the storm omen rises.' })
    });
    assert.equal(matchResponse.status, 200);
    const matchPreview = await matchResponse.json();
    assert.equal(matchPreview.scannedTextLength > 0, true);
    assert.equal(matchPreview.matchCount, 5);
    assert.equal(matchPreview.effectiveMatchCount, 4);
    assert.equal(matchPreview.matches.some((match) => match.id === signalEntry.id && match.matchedKeys[0] === 'signal fire'), true);
    assert.equal(matchPreview.matches.some((match) => match.id === regexEntry.id && match.status === 'regex_match'), true);
    assert.equal(matchPreview.matches.some((match) => match.id === omenEntry.id && match.status === 'probability_preview'), true);
    const omenExplanation = matchPreview.explanations.find((entry) => entry.id === omenEntry.id);
    assert.deepEqual(omenExplanation.statefulRules.map((rule) => rule.kind), ['sticky', 'cooldown', 'delay']);
    const selectiveExplanation = matchPreview.explanations.find((entry) => entry.id === selectiveEntry.id);
    assert.equal(selectiveExplanation.matched, false);
    assert.equal(selectiveExplanation.status, 'selective_blocked');
    const invalidExplanation = matchPreview.explanations.find((entry) => entry.id === invalidRegexEntry.id);
    assert.equal(invalidExplanation.status, 'invalid_regex');
    assert.deepEqual(invalidExplanation.invalidRegexKeys, ['[']);
    const weatherGroup = matchPreview.groups.find((group) => group.name === 'weather');
    assert.equal(weatherGroup.conflict, true);
    assert.equal(weatherGroup.totalWeight, 15);
    assert.equal(weatherGroup.previewWinnerId, stormHigh.id);
    assert.equal(weatherGroup.entries.find((entry) => entry.id === stormLow.id).previewWinner, false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM world_book_entry_state').get().count, 0);

    const diagnosticsResponse = await fetch(`${baseUrl}/api/diagnostics/export`);
    assert.equal(diagnosticsResponse.status, 200);
    const diagnostics = await diagnosticsResponse.json();
    assert.equal(diagnostics.version, 1);
    assert.equal(diagnostics.counts.characters, 1);
    assert.equal(diagnostics.counts.conversations, 1);
  });
});

test('upgrade project snapshot exports scoped envelope without secrets or binary assets', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-snapshot-user';
  const otherUserId = 'upgrade-snapshot-other-user';
  insertUser(database, userId);
  insertUser(database, otherUserId);
  const { conversationId, characterId } = createConversationFixture(database, userId);
  createConversationFixture(database, otherUserId);
  const timestamp = new Date().toISOString();
  const book = createWorldBook(database, userId, { name: 'Snapshot Lore' });
  createEntry(database, userId, book.id, {
    name: 'Hidden Door',
    triggerKeys: 'hidden door',
    content: 'The hidden door opens inward.'
  });
  linkWorldBookToCharacter(database, book.id, characterId, 0, userId);
  database
    .prepare(
      `INSERT INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
        api_key_hint, supports_reasoning, extra_body, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      'openai_compatible',
      'Local Gateway',
      'https://example.invalid/v1',
      'roleplay-large',
      'sk-project-secret-plainly-forbidden',
      'sk-...test',
      1,
      '{"temperature":0.7}',
      timestamp
    );
  database
    .prepare(
      `INSERT INTO presets (
        id, user_id, name, system_prompt, temperature, max_tokens,
        top_p, frequency_penalty, presence_penalty, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('snapshot-preset', userId, 'Snapshot Preset', 'Stay in character.', 0.8, 2048, 1, 0, 0, 1, timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO mods (id, user_id, name, description, type, content, enabled, scope, character_ids, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('snapshot-mod', userId, 'Snapshot Mod', 'Adds tone', 'style_enhance', 'Use vivid sensory detail.', 1, 'characters', JSON.stringify([characterId]), 0, timestamp);
  database
    .prepare(
      `INSERT INTO status_bars (id, conversation_id, name, variables, template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run('snapshot-status', conversationId, 'Vitals', '[{"key":"hp","value":"10"}]', '{{hp}}', timestamp, timestamp);
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const assetResponse = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'character-gallery',
        ownerType: 'character',
        ownerId: characterId,
        name: 'tiny.png',
        dataUrl: tinyPngDataUrl
      })
    });
    assert.equal(assetResponse.status, 201);

    const snapshotResponse = await fetch(`${baseUrl}/api/project/snapshot`);
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.kind, 'project_snapshot');
    assert.equal(snapshot.items.characters.length, 1);
    assert.equal(snapshot.items.characters[0].id, characterId);
    assert.equal(snapshot.items.conversations.length, 1);
    assert.equal(snapshot.items.conversations[0].messageCount, 1);
    assert.equal(snapshot.items.worldBooks.length, 1);
    assert.equal(snapshot.items.worldBooks[0].entries.length, 1);
    assert.equal(snapshot.items.presets[0].name, 'Snapshot Preset');
    assert.equal(snapshot.items.mods[0].characterIds[0], characterId);
    assert.equal(snapshot.items.statusBars[0].conversationId, conversationId);
    assert.equal(snapshot.dependencies.assets.length, 1);
    assert.equal(snapshot.dependencies.assets[0].url.startsWith('/api/assets/'), true);
    assert.equal(snapshot.dependencies.provider.apiKeySet, true);
    assert.equal(snapshot.dependencies.provider.apiKeyHint, 'sk-...test');
    assert.ok(snapshot.dependencies.providerCapabilities.length > 0);

    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes(otherUserId), false);
    assert.equal(serialized.includes('sk-project-secret-plainly-forbidden'), false);
    assert.equal(serialized.includes('encrypted_api_key'), false);
    assert.equal(serialized.includes('base64Data'), false);
    assert.equal(serialized.includes('base64_data'), false);
    assert.equal(serialized.includes(tinyPngDataUrl), false);
  });
});

test('upgrade envelope routes import and export supported project domains', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'upgrade-envelope-user';
  const otherUserId = 'upgrade-envelope-other-user';
  insertUser(database, userId);
  insertUser(database, otherUserId);
  const { characterId } = createConversationFixture(database, userId);
  const other = createCharacter(database, otherUserId, { name: 'Other Owner' });
  const app = createUpgradeRoutesApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const characterImport = await postJson(baseUrl, '/api/envelopes/characters/import', {
      version: 1,
      kind: 'characters',
      createdAt: new Date().toISOString(),
      items: [{
        name: 'Envelope Hero',
        avatarUrl: tinyPngDataUrl,
        persona: 'Carries imported structure.',
        tags: ['Envelope'],
        regexRules: [{
          label: 'Trim brackets',
          pattern: '\\[(.*?)\\]',
          replacement: '$1',
          scope: 'input'
        }]
      }],
      dependencies: {}
    });
    assert.equal(characterImport.status, 201);
    const characterImportBody = await characterImport.json();
    assert.equal(characterImportBody.imported, 1);
    assert.equal(characterImportBody.version, 1);
    assert.equal(characterImportBody.kind, 'characters');
    assert.equal(typeof characterImportBody.createdAt, 'string');
    assert.equal(Object.hasOwn(characterImportBody, 'dependencies'), true);

    const presetImport = await postJson(baseUrl, '/api/envelopes/presets/import', {
      kind: 'presets',
      items: [{
        name: 'Envelope Preset',
        systemPrompt: 'Stay vivid.',
        temperature: 0.7,
        maxTokens: 1024,
        topP: 0.9
      }]
    });
    assert.equal(presetImport.status, 201);

    const modImport = await postJson(baseUrl, '/api/envelopes/mods/import', {
      kind: 'mods',
      items: [{
        name: 'Envelope Mod',
        type: 'style_enhance',
        content: 'Use crisp sensory detail.',
        scope: 'characters',
        characterIds: [characterId]
      }]
    });
    assert.equal(modImport.status, 201);

    const worldBookImport = await postJson(baseUrl, '/api/envelopes/world-books/import', {
      kind: 'world_books',
      items: [{
        name: 'Envelope Lore',
        description: 'Imported through the unified envelope route.',
        linkedCharacters: [{ characterId, orderIndex: 2 }],
        entries: [{
          name: 'Silver Bell',
          triggerKeys: 'silver bell',
          content: 'The silver bell marks a hidden path.',
          position: 'before_char',
          enabled: true
        }]
      }]
    });
    assert.equal(worldBookImport.status, 201);

    const regexImport = await postJson(baseUrl, '/api/envelopes/regex-rules/import', {
      kind: 'regex_rules',
      items: [{
        characterId,
        label: 'Owned rule',
        pattern: 'owned',
        replacement: 'safe'
      }, {
        characterId: other.id,
        label: 'Foreign rule',
        pattern: 'foreign',
        replacement: 'blocked'
      }]
    });
    assert.equal(regexImport.status, 201);
    const regexResult = await regexImport.json();
    assert.equal(regexResult.imported, 1);
    assert.equal(regexResult.skipped.length, 1);

    const templateImport = await postJson(baseUrl, '/api/envelopes/status-bar-templates/import', {
      kind: 'status_bar_templates',
      items: [{
        name: 'Envelope HUD',
        variables: [{ name: 'HP', value: 10, max: 20 }],
        template: '{{HP}}'
      }]
    });
    assert.equal(templateImport.status, 201);

    const unsupportedVersionImport = await postJson(baseUrl, '/api/envelopes/presets/import', {
      version: 999,
      kind: 'presets',
      items: [{ name: 'Wrong Version' }]
    });
    assert.equal(unsupportedVersionImport.status, 400);
    assert.match((await unsupportedVersionImport.json()).error, /unsupported envelope version/);

    const characters = await fetch(`${baseUrl}/api/envelopes/characters`).then((response) => response.json());
    assertEnvelopeShape(characters, 'characters');
    const envelopeHero = characters.items.find((item) => item.name === 'Envelope Hero');
    assert.ok(envelopeHero);
    assert.match(envelopeHero.avatarUrl, /^\/api\/assets\//);
    assert.equal(characters.dependencies.assets.some((item) => item.url === envelopeHero.avatarUrl), true);
    const linkedCharacterEnvelope = characters.items.find((item) => item.id === characterId);
    assert.ok(linkedCharacterEnvelope.worldBooks.some((book) => book.id && book.linkOrder === 2));

    const singleCharacterEnvelope = await fetch(`${baseUrl}/api/envelopes/characters?ids=${encodeURIComponent(characterId)}`)
      .then((response) => response.json());
    assertEnvelopeShape(singleCharacterEnvelope, 'characters');
    assert.equal(singleCharacterEnvelope.items.length, 1);
    assert.equal(singleCharacterEnvelope.items[0].id, characterId);
    assert.equal(singleCharacterEnvelope.items.some((item) => item.name === 'Envelope Hero'), false);

    const presets = await fetch(`${baseUrl}/api/envelopes/presets`).then((response) => response.json());
    assertEnvelopeShape(presets, 'presets');
    assert.equal(presets.items.some((item) => item.name === 'Envelope Preset'), true);

    const mods = await fetch(`${baseUrl}/api/envelopes/mods`).then((response) => response.json());
    assertEnvelopeShape(mods, 'mods');
    assert.equal(mods.items.some((item) => item.name === 'Envelope Mod' && item.characterIds[0] === characterId), true);
    assert.equal(mods.dependencies.characters.some((item) => item.id === characterId), true);

    const worldBooks = await fetch(`${baseUrl}/api/envelopes/world-books`).then((response) => response.json());
    assertEnvelopeShape(worldBooks, 'world_books');
    const envelopeLore = worldBooks.items.find((item) => item.name === 'Envelope Lore');
    assert.equal(Boolean(envelopeLore && envelopeLore.entries.length === 1), true);
    assert.equal(envelopeLore.linkedCharacters[0].characterId, characterId);
    assert.equal(envelopeLore.linkedCharacters[0].orderIndex, 2);
    assert.equal(worldBooks.dependencies.characters.some((item) => item.id === characterId), true);

    const regexRules = await fetch(`${baseUrl}/api/envelopes/regex-rules`).then((response) => response.json());
    assertEnvelopeShape(regexRules, 'regex_rules');
    assert.equal(regexRules.items.some((item) => item.label === 'Owned rule'), true);
    assert.equal(regexRules.items.some((item) => item.label === 'Foreign rule'), false);
    assert.equal(regexRules.dependencies.characters.some((item) => item.id === characterId), true);

    const templates = await fetch(`${baseUrl}/api/envelopes/status-bar-templates`).then((response) => response.json());
    assertEnvelopeShape(templates, 'status_bar_templates');
    assert.equal(templates.items.some((item) => item.name === 'Envelope HUD' && item.source === 'library'), true);
  });
});

function assertEnvelopeShape(envelope, kind) {
  assert.equal(envelope.version, 1);
  assert.equal(envelope.kind, kind);
  assert.equal(typeof envelope.createdAt, 'string');
  assert.equal(Array.isArray(envelope.items), true);
  assert.equal(Boolean(envelope.dependencies && typeof envelope.dependencies === 'object'), true);
}

function createUpgradeRoutesApp(database, userId) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', createUpgradeRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: getUser(database, userId) };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    getUserProfile: (targetUserId) => getUserProfile(database, targetUserId),
    publicUser: (row) => publicUser(database, row),
    getProviderRow: (targetUserId) => database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(targetUserId),
    providerWithSecret
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  return app;
}

function getUser(database, userId) {
  const row = database.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return publicUser(database, row);
}

function createConversationFixture(database, userId) {
  const character = createCharacter(database, userId, {
    name: 'Mira',
    gender: 'female',
    persona: 'Calm scout with careful speech.'
  });
  const conversationId = `conversation-${userId}`;
  const timestamp = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(conversationId, userId, character.id, 'Mira Story', timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(`message-${userId}`, userId, conversationId, 'user', 'We enter the forest.', '[]', '', null, timestamp);
  return {
    conversationId,
    characterId: character.id
  };
}

function postJson(baseUrl, path, payload) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
