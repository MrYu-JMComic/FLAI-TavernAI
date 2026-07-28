import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const {
  generateCompletion,
  runToolCompletion,
  streamCompletion,
  streamToolCompletion,
  summarizeUsageSnapshots
} = await import('../services/providers.js');
const { executeProviderTool } = await import('../services/providerToolResults.js');

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

test('streamToolCompletion keeps tool-round draft content out of the final stream', async () => {
  let requestCount = 0;
  const events = [];
  const executions = [];
  await withMockFetch(
    async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse([
          `data: ${JSON.stringify({
            choices: [{
              delta: {
                content: 'Draft before lookup.',
                tool_calls: [{
                  index: 0,
                  id: 'profile-call-stream',
                  function: {
                    name: 'get_npc_profile',
                    arguments: JSON.stringify({ npcName: 'Mira' })
                  }
                }]
              }
            }]
          })}`,
          'data: [DONE]'
        ]);
      }
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Mira is at the north gate."}}]}',
        'data: [DONE]'
      ]);
    },
    async () => {
      const result = await streamToolCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom',
          baseUrl: 'https://provider.test',
          model: 'custom-model',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'Where is Mira?' }],
        [{
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
        async (name, args) => {
          executions.push({ name, args });
          return { ok: true, currentLocation: 'north gate' };
        },
        (event, data) => events.push({ event, data }),
        undefined,
        { maxRounds: 3 }
      );

      assert.equal(result.content, 'Mira is at the north gate.');
      assert.equal(result.process[0].content, 'Draft before lookup.');
      assert.deepEqual(executions, [{ name: 'get_npc_profile', args: { npcName: 'Mira' } }]);
      assert.deepEqual(
        events.filter((event) => event.event === 'content').map((event) => event.data.text),
        ['Mira is at the north gate.']
      );
    }
  );
});

test('streamToolCompletion keeps retry-round draft content out of the final stream', async () => {
  const requests = [];
  const events = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      if (requests.length === 1) {
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"I can answer without the required tool."}}]}',
          'data: [DONE]'
        ]);
      }
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"The required update is complete."}}]}',
        'data: [DONE]'
      ]);
    },
    async () => {
      const result = await streamToolCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom',
          baseUrl: 'https://provider.test',
          model: 'custom-model',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'Apply the required update.' }],
        [{
          type: 'function',
          function: {
            name: 'apply_update',
            parameters: { type: 'object', properties: {} }
          }
        }],
        async () => ({ ok: true }),
        (event, data) => events.push({ event, data }),
        undefined,
        {
          maxRounds: 2,
          onNoToolCall: ({ round }) => round === 1 ? 'Use the required tool before answering.' : ''
        }
      );

      assert.equal(result.content, 'The required update is complete.');
      assert.equal(result.process[0].content, 'I can answer without the required tool.');
      assert.equal(requests[1].messages.at(-2).content, 'I can answer without the required tool.');
      assert.equal(requests[1].messages.at(-1).content, 'Use the required tool before answering.');
      assert.deepEqual(
        events.filter((event) => event.event === 'content').map((event) => event.data.text),
        ['The required update is complete.']
      );
      assert.deepEqual(
        events.filter((event) => event.event === 'nudge').map((event) => event.data.text),
        ['Use the required tool before answering.']
      );
    }
  );
});

test('chat tool completion reports an undefined tool result without dropping the tool message', async () => {
  const requests = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      if (requests.length === 1) {
        return jsonResponse({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'undefined-result-call',
                type: 'function',
                function: { name: 'read_value', arguments: '{}' }
              }]
            }
          }]
        });
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Handled the tool failure.' } }]
      });
    },
    async () => {
      const result = await runToolCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom',
          baseUrl: 'https://provider.test',
          model: 'custom-model',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'Read it.' }],
        [{
          type: 'function',
          function: {
            name: 'read_value',
            parameters: { type: 'object', properties: {} }
          }
        }],
        async () => undefined,
        { maxRounds: 2 }
      );

      const diagnostic = JSON.parse(requests[1].messages.at(-1).content);
      assert.deepEqual(diagnostic, {
        ok: false,
        error: 'TOOL_RESULT_SERIALIZATION_FAILED',
        valueType: 'undefined',
        cause: 'UNSUPPORTED_TOP_LEVEL_RESULT'
      });
      assert.deepEqual(result.toolCalls[0].result, diagnostic);
      assert.equal(result.content, 'Handled the tool failure.');
    }
  );
});

test('chat tool completion reports thrown tool errors and continues to a final reply', async () => {
  const requests = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      if (requests.length === 1) {
        return jsonResponse({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'thrown-error-call',
                type: 'function',
                function: { name: 'read_value', arguments: '{}' }
              }]
            }
          }]
        });
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Recovered from the tool failure.' } }]
      });
    },
    async () => {
      const result = await runToolCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom',
          baseUrl: 'https://provider.test',
          model: 'custom-model',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'Read it.' }],
        [{
          type: 'function',
          function: {
            name: 'read_value',
            parameters: { type: 'object', properties: {} }
          }
        }],
        async () => {
          throw new RangeError(`bounded diagnostic ${'x'.repeat(1000)}`);
        },
        { maxRounds: 2 }
      );

      const diagnostic = JSON.parse(requests[1].messages.at(-1).content);
      assert.equal(diagnostic.ok, false);
      assert.equal(diagnostic.error, 'TOOL_EXECUTION_FAILED');
      assert.equal(diagnostic.errorName, 'RangeError');
      assert.equal(diagnostic.message.length, 500);
      assert.deepEqual(result.toolCalls[0].result, diagnostic);
      assert.equal(result.content, 'Recovered from the tool failure.');
    }
  );
});

test('tool cancellation errors are rethrown instead of becoming provider tool results', async () => {
  let requestCount = 0;
  const abortError = new Error('cancelled');
  abortError.name = 'AbortError';

  await withMockFetch(
    async () => {
      requestCount += 1;
      return jsonResponse({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'aborted-tool-call',
              type: 'function',
              function: { name: 'read_value', arguments: '{}' }
            }]
          }
        }]
      });
    },
    async () => {
      await assert.rejects(
        () => runToolCompletion(
          {
            providerType: 'custom',
            gatewayName: 'Custom',
            baseUrl: 'https://provider.test',
            model: 'custom-model',
            apiKey: 'sk-test',
            extraBody: {}
          },
          [{ role: 'user', content: 'Read it.' }],
          [],
          async () => { throw abortError; },
          { maxRounds: 2 }
        ),
        (error) => error === abortError
      );
      assert.equal(requestCount, 1);
    }
  );
});

test('an already-aborted tool signal rethrows its reason without invoking the executor', async () => {
  const controller = new AbortController();
  const reason = new Error('request stopped');
  let executionCount = 0;
  controller.abort(reason);

  await assert.rejects(
    () => executeProviderTool(
      async () => {
        executionCount += 1;
        return { ok: true };
      },
      'read_value',
      {},
      {},
      controller.signal
    ),
    (error) => error === reason
  );
  assert.equal(executionCount, 0);
});

test('tool error diagnostics tolerate primitive throws and hostile error getters', async () => {
  const primitive = await executeProviderTool(async () => { throw 'plain failure'; }, 'read_value', {}, {});
  assert.deepEqual(primitive.result, {
    ok: false,
    error: 'TOOL_EXECUTION_FAILED',
    errorName: 'Error',
    message: 'plain failure'
  });

  const hostile = {};
  Object.defineProperties(hostile, {
    name: { get() { throw new Error('name getter failed'); } },
    message: { get() { throw new Error('message getter failed'); } }
  });
  const guarded = await executeProviderTool(async () => { throw hostile; }, 'read_value', {}, {});
  assert.deepEqual(guarded.result, {
    ok: false,
    error: 'TOOL_EXECUTION_FAILED',
    errorName: 'Error',
    message: 'Tool execution failed'
  });
});

test('all provider tool loops use the shared execution wrapper', () => {
  const files = [
    '../services/providerToolCompletions.js',
    '../services/providerOpenAiResponses.js',
    '../services/providerAnthropic.js'
  ];
  const sources = files.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'));

  assert.equal(sources.reduce(
    (total, source) => total + (source.match(/await executeProviderTool\(/g)?.length || 0),
    0
  ), 4);
  assert.equal(sources.some((source) => source.includes('prepareProviderToolResult(await executeTool')), false);
});

test('Responses tool completion reports BigInt tool results as safe diagnostics', async () => {
  const requests = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      if (requests.length === 1) {
        return jsonResponse({
          id: 'bigint-response-1',
          output: [{
            type: 'function_call',
            id: 'bigint-function-call',
            call_id: 'bigint-call',
            name: 'read_counter',
            arguments: '{}'
          }]
        });
      }
      return jsonResponse({
        id: 'bigint-response-2',
        output_text: 'Handled the counter failure.',
        output: []
      });
    },
    async () => {
      const result = await runToolCompletion(
        {
          providerType: 'openai',
          gatewayName: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5-test',
          apiKey: 'sk-test',
          supportsReasoning: true,
          extraBody: {}
        },
        [{ role: 'user', content: 'Read the counter.' }],
        [{
          type: 'function',
          function: {
            name: 'read_counter',
            parameters: { type: 'object', properties: {} }
          }
        }],
        async () => 12n,
        { maxRounds: 2 }
      );

      const diagnostic = JSON.parse(requests[1].input[0].output);
      assert.equal(diagnostic.error, 'TOOL_RESULT_SERIALIZATION_FAILED');
      assert.equal(diagnostic.valueType, 'bigint');
      assert.equal(diagnostic.cause, 'TypeError');
      assert.deepEqual(result.toolCalls[0].result, diagnostic);
      assert.equal(result.content, 'Handled the counter failure.');
    }
  );
});

test('Anthropic tool completion reports cyclic tool results as safe diagnostics', async () => {
  const requests = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      if (requests.length === 1) {
        return jsonResponse({
          content: [{ type: 'tool_use', id: 'cyclic-tool-use', name: 'read_graph', input: {} }]
        });
      }
      return jsonResponse({
        content: [{ type: 'text', text: 'Handled the graph failure.' }]
      });
    },
    async () => {
      const cyclic = { ok: true };
      cyclic.self = cyclic;
      const result = await runToolCompletion(
        {
          providerType: 'anthropic',
          gatewayName: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-test',
          apiKey: 'sk-ant-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'Read the graph.' }],
        [{
          type: 'function',
          function: {
            name: 'read_graph',
            parameters: { type: 'object', properties: {} }
          }
        }],
        async () => cyclic,
        { maxRounds: 2 }
      );

      const toolResult = requests[1].messages.at(-1).content[0];
      const diagnostic = JSON.parse(toolResult.content);
      assert.equal(toolResult.type, 'tool_result');
      assert.equal(diagnostic.error, 'TOOL_RESULT_SERIALIZATION_FAILED');
      assert.equal(diagnostic.valueType, 'object');
      assert.equal(diagnostic.cause, 'TypeError');
      assert.deepEqual(result.toolCalls[0].result, diagnostic);
      assert.equal(result.content, 'Handled the graph failure.');
    }
  );
});

test('streaming chat preserves stop while sanitizing an unserializable tool result', async () => {
  let requestCount = 0;
  const events = [];
  await withMockFetch(
    async () => {
      requestCount += 1;
      assert.equal(requestCount, 1, 'stop tool result should prevent another provider request');
      return sseResponse([
        `data: ${JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'stream-stop-call',
                function: { name: 'finish_work', arguments: '{}' }
              }]
            }
          }]
        })}`,
        'data: [DONE]'
      ]);
    },
    async () => {
      const cyclic = { stop: true };
      cyclic.self = cyclic;
      const result = await streamToolCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom',
          baseUrl: 'https://provider.test',
          model: 'custom-model',
          apiKey: 'sk-test',
          extraBody: {}
        },
        [{ role: 'user', content: 'Finish the work.' }],
        [{
          type: 'function',
          function: {
            name: 'finish_work',
            parameters: { type: 'object', properties: {} }
          }
        }],
        async () => cyclic,
        (event, data) => events.push({ event, data }),
        undefined,
        { maxRounds: 3 }
      );

      assert.equal(requestCount, 1);
      assert.equal(result.toolCalls.length, 1);
      assert.deepEqual(result.toolCalls[0].result, {
        ok: false,
        error: 'TOOL_RESULT_SERIALIZATION_FAILED',
        valueType: 'object',
        cause: 'TypeError',
        stop: true
      });
      assert.doesNotThrow(() => JSON.stringify(events));
      assert.equal(events.filter((event) => event.event === 'tool').length, 1);
    }
  );
});
