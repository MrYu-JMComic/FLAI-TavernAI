import assert from 'node:assert/strict';
import test from 'node:test';
import { completeWorldBookDraft, streamWorldBookDraft } from '../services/worldBookAssistant.js';

const settings = { providerType: 'custom', gatewayName: 'Tool Test', baseUrl: 'https://world-tools.test/v1', model: 'test-model', apiKey: 'test-key', extraBody: {} };

for (const mode of [
  { streaming: false, providerType: 'custom' }, { streaming: true, providerType: 'custom' },
  { streaming: false, providerType: 'gemini' }, { streaming: true, providerType: 'gemini' }
]) {
  const { streaming, providerType } = mode;
  test(`world book ${providerType} ${streaming ? 'stream' : 'completion'} patches individual entries and previews the updated draft`, async () => {
    const originalFetch = globalThis.fetch;
    try {
      let round = 0;
      const requests = [];
      globalThis.fetch = async (_url, request) => {
        requests.push(JSON.parse(request.body));
        round += 1;
        const calls = round === 1 ? [
          ['upsert_world_book_entry', { entryId: 'gate-id', changes: { content: 'The gate opens at noon.', keysSecondary: 'noon', selective: true, selectiveLogic: 0 } }],
          ['upsert_world_book_entry', { changes: { name: 'Archive', triggerKeys: 'archive', content: 'A quiet archive.' } }],
          ['remove_world_book_entry', { entryId: 'obsolete-id' }]
        ] : round === 2 ? [['preview_world_book_entries', { text: 'The gate at noon.' }]] : [];
        return Response.json({ choices: [{ message: {
          role: 'assistant', content: calls.length ? null : 'Done.',
          tool_calls: calls.map(([name, args], index) => ({ id: `call-${round}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }))
        } }] });
      };
      const current = { name: 'Existing book', entries: [
        { id: 'gate-id', name: 'Gate', triggerKeys: 'gate', content: 'The gate opens at night.', sticky: 3, role: 2, position: 'at_depth' },
        { id: 'keep-id', name: 'Keep', triggerKeys: 'keep', content: 'Unchanged lore.', alwaysActive: true },
        { id: 'obsolete-id', name: 'Obsolete', triggerKeys: 'old', content: 'Old lore.' }
      ] };
      const providerSettings = { ...settings, providerType };
      const result = streaming
        ? await streamWorldBookDraft(providerSettings, { current, requirement: 'Update gate, add archive and remove obsolete lore.' })
        : await completeWorldBookDraft(providerSettings, { current, requirement: 'Update gate, add archive and remove obsolete lore.' });
      assert.equal(round, 3);
      assert.ok(requests[0].tools.some((tool) => tool.function.name === 'upsert_world_book_entry'));
      const roleSchema = requests[0].tools.find((tool) => tool.function.name === 'upsert_world_book_entry')
        .function.parameters.properties.changes.properties.role;
      assert.ok(roleSchema.anyOf.some((variant) => variant.type === 'integer'));
      assert.ok(roleSchema.anyOf.some((variant) => variant.type === 'string'));
      assert.ok(result.toolCalls.every((call) => call.result.ok), JSON.stringify(result.toolCalls));
      const gate = result.worldBook.entries.find((entry) => entry.id === 'gate-id');
      assert.equal(gate.content, 'The gate opens at noon.');
      assert.equal(gate.sticky, 3);
      assert.equal(gate.role, 2);
      assert.equal(gate.keysSecondary, 'noon');
      const kept = result.worldBook.entries.find((entry) => entry.id === 'keep-id');
      assert.equal(kept.content, 'Unchanged lore.');
      assert.equal(kept.triggerKeys, 'keep');
      assert.ok(result.worldBook.entries.some((entry) => entry.name === 'Archive' && entry.id));
      assert.ok(!result.worldBook.entries.some((entry) => entry.id === 'obsolete-id'));
      const preview = result.toolCalls.at(-1).result;
      assert.ok(preview.matches.some((entry) => entry.id === 'gate-id'));
      assert.equal(current.entries[0].content, 'The gate opens at night.');
      assert.equal(current.entries.length, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('world book profile and invalid patch calls cannot replace or clear unrelated entries', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let round = 0;
    globalThis.fetch = async () => {
      round += 1;
      const calls = round === 1 ? [
        ['set_world_book_profile', { name: 'Changed', entries: [] }],
        ['upsert_world_book_entry', { entryId: 'missing-id', changes: { content: 'Unknown' } }],
        ['upsert_world_book_entry', { entryId: 'known-id', changes: { content: '' } }]
      ] : [];
      return Response.json({ choices: [{ message: {
        role: 'assistant', content: calls.length ? null : 'No changes.',
        tool_calls: calls.map(([name, args], index) => ({ id: `invalid-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }))
      } }] });
    };
    const result = await completeWorldBookDraft(settings, { current: { name: 'Original', entries: [{ id: 'known-id', name: 'Lore', triggerKeys: 'lore', content: 'Preserve this.' }] } });
    assert.equal(result.worldBook.name, 'Original');
    assert.equal(result.worldBook.entries[0].content, 'Preserve this.');
    assert.ok(result.toolCalls.every((call) => call.result.ok === false));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
