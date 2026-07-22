import assert from 'node:assert/strict';
import test from 'node:test';

const { generateCompletion, streamCompletion, streamToolCompletion, summarizeUsageSnapshots } = await import('../services/providers.js');

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sseResponse(blocks) {
  return new Response(`${blocks.join('\n\n')}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

async function withMockFetch(fetchHandler, callback) {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fetchHandler;
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('summarizeUsageSnapshots treats null usages as empty', () => {
  assert.deepEqual(summarizeUsageSnapshots(null), {
    totalTokens: 0,
    totalCostCny: null,
    currency: 'CNY'
  });
});

test('Anthropic completion treats null messages as empty', async () => {
  const requests = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      return jsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 }
      });
    },
    async () => {
      const result = await generateCompletion(
        {
          providerType: 'anthropic',
          gatewayName: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-test',
          apiKey: 'sk-ant-test',
          extraBody: {}
        },
        null
      );

      assert.equal(result.content, 'ok');
      assert.deepEqual(requests[0].messages, [{ role: 'user', content: '' }]);
    }
  );
});

test('Anthropic streaming reports a friendly error when the response body is missing', async () => {
  await withMockFetch(
    async () => new Response(null, { status: 200 }),
    async () => {
      await assert.rejects(
        () => streamCompletion(
          {
            providerType: 'anthropic',
            gatewayName: 'Anthropic',
            baseUrl: 'https://api.anthropic.com/v1',
            model: 'claude-test',
            apiKey: 'sk-ant-test',
            extraBody: {}
          },
          [{ role: 'user', content: 'hello' }],
          () => {}
        ),
        /AI \u6d41\u5f0f\u54cd\u5e94\u4e0d\u53ef\u7528/
      );
    }
  );
});

test('generateCompletion runs attached tools before returning the final chat reply', async () => {
  const requests = [];
  const executions = [];
  await withMockFetch(
    async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'profile-call-1',
                type: 'function',
                function: {
                  name: 'get_npc_profile',
                  arguments: JSON.stringify({ npcName: 'Mira' })
                }
              }]
            }
          }]
        });
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Mira is waiting at the north gate.' } }]
      });
    },
    async () => {
      const result = await generateCompletion(
        {
          providerType: 'openai',
          gatewayName: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-test',
          apiKey: 'sk-test',
          supportsReasoning: false,
          extraBody: {}
        },
        [{ role: 'user', content: 'Where is Mira?' }],
        {
          tools: [{
            type: 'function',
            function: {
              name: 'get_npc_profile',
              description: 'Get one NPC profile.',
              parameters: {
                type: 'object',
                properties: { npcName: { type: 'string' } },
                required: ['npcName']
              }
            }
          }],
          executeTool: async (name, args) => {
            executions.push({ name, args });
            return { ok: true, currentLocation: 'north gate' };
          },
          maxRounds: 3
        }
      );

      assert.equal(result.content, 'Mira is waiting at the north gate.');
      assert.deepEqual(executions, [{ name: 'get_npc_profile', args: { npcName: 'Mira' } }]);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].tools[0].function.name, 'get_npc_profile');
      assert.equal(requests[1].messages.at(-1).role, 'tool');
      assert.match(requests[1].messages.at(-1).content, /north gate/);
    }
  );
});

test('generateCompletion keeps Responses API models on native function calls', async () => {
  const requests = [];
  const urls = [];
  await withMockFetch(
    async (url, request = {}) => {
      urls.push(String(url));
      const body = JSON.parse(request.body);
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse({
          id: 'resp_tool_round_1',
          model: 'gpt-5-test',
          output: [{
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'get_npc_profile',
            arguments: JSON.stringify({ npcName: 'Mira' })
          }],
          usage: { total_tokens: 5 }
        });
      }
      return jsonResponse({
        id: 'resp_tool_round_2',
        model: 'gpt-5-test',
        output_text: 'Mira is at the north gate.',
        output: [],
        usage: { total_tokens: 8 }
      });
    },
    async () => {
      const result = await generateCompletion(
        {
          providerType: 'openai',
          gatewayName: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5-test',
          apiKey: 'sk-test',
          supportsReasoning: true,
          extraBody: {}
        },
        [{ role: 'user', content: 'Where is Mira?' }],
        {
          tools: [{
            type: 'function',
            function: {
              name: 'get_npc_profile',
              parameters: {
                type: 'object',
                properties: { npcName: { type: 'string' } },
                required: ['npcName']
              }
            }
          }],
          executeTool: async () => ({ ok: true, currentLocation: 'north gate' }),
          maxRounds: 3
        }
      );

      assert.equal(result.content, 'Mira is at the north gate.');
      assert.equal(urls.every((url) => url.endsWith('/responses')), true);
      assert.deepEqual(requests[0].tools[0], {
        type: 'function',
        name: 'get_npc_profile',
        description: '',
        parameters: {
          type: 'object',
          properties: { npcName: { type: 'string' } },
          required: ['npcName']
        }
      });
      assert.equal(requests[1].previous_response_id, 'resp_tool_round_1');
      assert.equal(requests[1].input[0].type, 'function_call_output');
      assert.match(requests[1].input[0].output, /north gate/);
    }
  );
});

test('Gemini compatible completion reads native candidates parts', async () => {
  await withMockFetch(
    async () => jsonResponse({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'internal reasoning' },
              { text: '正常响应' }
            ]
          }
        }
      ],
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 3,
        totalTokenCount: 5
      }
    }),
    async () => {
      const result = await generateCompletion(
        {
          providerType: 'gemini',
          gatewayName: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-pro-agent',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'hello' }]
      );

      assert.equal(result.content, '正常响应');
      assert.equal(result.reasoning, 'internal reasoning');
      assert.equal(result.usage.total_tokens, 5);
    }
  );
});

test('streamCompletion reads Responses-style output text deltas from compatible chat streams', async () => {
  await withMockFetch(
    async () => sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"agent text"}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"total_tokens":4}}}',
      'data: [DONE]'
    ]),
    async () => {
      const events = [];
      const result = await streamCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom Gateway',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'gemini-pro-agent',
          apiKey: '',
          extraBody: {}
        },
        [{ role: 'user', content: 'hello' }],
        (event, data) => events.push({ event, data })
      );

      assert.equal(result.content, 'agent text');
      assert.equal(events[0].event, 'content');
      assert.equal(events[0].data.text, 'agent text');
      assert.equal(result.usage.total_tokens, 4);
      assert.equal(result.diagnostics.transport, 'sse');
      assert.equal(result.diagnostics.samples[0].type, 'response.output_text.delta');
    }
  );
});

test('streamCompletion skips role-only deltas and reads message content fallback', async () => {
  await withMockFetch(
    async () => sseResponse([
      'data: {"choices":[{"delta":{"role":"assistant"},"message":{"content":"message fallback"}}]}',
      'data: [DONE]'
    ]),
    async () => {
      const events = [];
      const result = await streamCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom Gateway',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'gemini-pro-agent',
          apiKey: '',
          extraBody: {}
        },
        [{ role: 'user', content: 'hello' }],
        (event, data) => events.push({ event, data })
      );

      assert.equal(result.content, 'message fallback');
      assert.deepEqual(events, [{ event: 'content', data: { text: 'message fallback' } }]);
    }
  );
});

test('streamCompletion accepts JSON chat responses when gateways ignore stream mode', async () => {
  const requests = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'stream fallback reply'
            }
          }
        ],
        usage: { total_tokens: 7 }
      });
    },
    async () => {
      const events = [];
      const result = await streamCompletion(
        {
          providerType: 'gemini',
          gatewayName: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-pro-agent',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'hello' }],
        (event, data) => events.push({ event, data })
      );

      assert.equal(requests[0].stream, true);
      assert.equal(result.content, 'stream fallback reply');
      assert.equal(result.usage.total_tokens, 7);
      assert.deepEqual(events, [{ event: 'content', data: { text: 'stream fallback reply' } }]);
    }
  );
});

test('streamCompletion reads wrapped Gemini native candidate arrays', async () => {
  await withMockFetch(
    async () => sseResponse([
      'data: {"data":[{"candidates":[{"content":{"parts":[{"text":"wrapped "}]}}]}]}',
      'data: {"payload":"{\\"candidates\\":[{\\"content\\":{\\"parts\\":[{\\"text\\":\\"gemini\\"}]}}],\\"usageMetadata\\":{\\"totalTokenCount\\":6}}"}',
      'data: [DONE]'
    ]),
    async () => {
      const events = [];
      const result = await streamCompletion(
        {
          providerType: 'gemini',
          gatewayName: 'Gemini Proxy',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'gemini-pro-agent',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'hello' }],
        (event, data) => events.push({ event, data })
      );

      assert.equal(result.content, 'wrapped gemini');
      assert.equal(result.usage.total_tokens, 6);
      assert.deepEqual(
        events,
        [
          { event: 'content', data: { text: 'wrapped ' } },
          { event: 'content', data: { text: 'gemini' } }
        ]
      );
    }
  );
});

test('streamCompletion reads object delta text from compatible streams', async () => {
  await withMockFetch(
    async () => sseResponse([
      'data: {"delta":{"type":"text_delta","text":"delta text"}}',
      'data: [DONE]'
    ]),
    async () => {
      const result = await streamCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom Gateway',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'gemini-pro-agent',
          apiKey: '',
          extraBody: {}
        },
        [{ role: 'user', content: 'hello' }],
        () => {}
      );

      assert.equal(result.content, 'delta text');
    }
  );
});

test('streamToolCompletion accepts Gemini native JSON tool calls when gateways ignore stream mode', async () => {
  let requestCount = 0;
  const executed = [];
  await withMockFetch(
    async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'set_value',
                      args: { value: 'ok' }
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'tool complete' }]
            }
          }
        ]
      });
    },
    async () => {
      const result = await streamToolCompletion(
        {
          providerType: 'gemini',
          gatewayName: 'Gemini Proxy',
          baseUrl: 'http://127.0.0.1:8317/v1',
          model: 'gemini-pro-agent',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'set it' }],
        [
          {
            type: 'function',
            function: {
              name: 'set_value',
              parameters: { type: 'object', properties: { value: { type: 'string' } } }
            }
          }
        ],
        (name, args) => {
          executed.push({ name, args });
          return { ok: true };
        },
        () => {}
      );

      assert.deepEqual(executed, [{ name: 'set_value', args: { value: 'ok' } }]);
      assert.equal(result.content, 'tool complete');
      assert.equal(result.toolCalls.length, 1);
    }
  );
});
