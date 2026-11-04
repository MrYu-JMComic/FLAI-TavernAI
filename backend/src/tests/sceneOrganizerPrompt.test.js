import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-scene-organizer-prompt';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { completeSceneOrganization } = await import('../services/sceneOrganizer.js');
const { newId, nowIso } = await import('../security.js');

const providerSettings = {
  providerType: 'custom',
  gatewayName: 'Scene Prompt Test',
  baseUrl: 'https://scene-prompt-provider.test/v1',
  model: 'test-model',
  apiKey: 'sk-test',
  extraBody: {}
};

test('scene organizer sends English instructions and tool descriptions to the model', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'scene-organizer-prompt-user';
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, 'scene-organizer-prompt-user', 'hash', timestamp);
  const character = createCharacter(database, userId, { name: 'Traveler' });
  const conversationId = newId();
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, character.id, 'Scene prompt test', timestamp, timestamp);

  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, request) => {
    requestBody = JSON.parse(request.body);
    return Response.json({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'finish-scene-review',
            type: 'function',
            function: {
              name: 'finish_scene_organization',
              arguments: JSON.stringify({ summary: '场景资料已检查' })
            }
          }]
        }
      }]
    });
  };

  try {
    const result = await completeSceneOrganization(providerSettings, {
      database,
      userId,
      conversationId,
      requirement: 'Review the recent scene.'
    });

    const systemPrompt = requestBody.messages.find((message) => message.role === 'system').content;
    assert.doesNotMatch(systemPrompt, /[\u3400-\u9fff]/);
    assert.match(systemPrompt, /Record only places, spatial relationships, and routes/);
    assert.match(systemPrompt, /Write its user-visible summary in concise Chinese/);
    for (const tool of requestBody.tools) {
      assert.doesNotMatch(tool.function.description, /[\u3400-\u9fff]/);
    }
    assert.equal(result.summary, '场景资料已检查');
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});
