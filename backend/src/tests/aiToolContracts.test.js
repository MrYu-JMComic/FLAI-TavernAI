import assert from 'node:assert/strict';
import test from 'node:test';
import { executeProviderTool } from '../services/providerToolResults.js';
import { optimizeTool, optimizeToolSchema } from '../services/toolSchemaOptimizer.js';
import { adaptToolsForProvider } from '../services/toolProviderAdapter.js';
import { runToolCompletion, streamToolCompletion } from '../services/providerToolCompletions.js';

const tools = [{
  type: 'function',
  function: {
    name: 'apply_update',
    description: 'Apply a validated update.',
    parameters: {
      type: 'object',
      properties: { amount: { type: 'integer', minimum: 1, maximum: 10 } },
      required: ['amount'],
      additionalProperties: false
    }
  }
}];

test('Gemini tool adaptation preserves union branches, required fields and closed objects', () => {
  const original = [{ type: 'function', function: { name: 'update', parameters: {
    type: 'object', required: ['value'], additionalProperties: false,
    properties: {
      value: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      closed: { type: 'object', additionalProperties: false },
      nested: { type: 'array', items: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }
    }
  } } }];
  for (const providerType of ['gemini', 'google', 'custom']) {
    const adapted = adaptToolsForProvider(original, providerType, 'gemini-test')[0].function.parameters;
    assert.deepEqual(adapted.required, ['value']);
    assert.equal(adapted.additionalProperties, false);
    assert.deepEqual(adapted.properties.value.anyOf, [{ type: 'number' }, { type: 'string' }]);
    assert.equal(adapted.properties.closed.additionalProperties, false);
    assert.deepEqual(adapted.properties.nested.items.anyOf, [{ type: 'integer' }, { type: 'null' }]);
  }
  assert.ok(original[0].function.parameters.properties.value.oneOf);
});

test('tool schemas retain exact bounds, strict mode, and closed objects', () => {
  assert.deepEqual(optimizeToolSchema({ type: 'integer', exclusiveMinimum: 0.5, exclusiveMaximum: 3.5 }), {
    type: 'integer', minimum: 1, maximum: 3
  });
  assert.deepEqual(optimizeToolSchema({ type: 'integer', minimum: 5, exclusiveMinimum: 0 }), { type: 'integer', minimum: 5 });
  const fractional = { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 0.00001 };
  assert.deepEqual(optimizeToolSchema(fractional), fractional);
  assert.equal(optimizeToolSchema({ type: 'object', additionalProperties: false }).additionalProperties, false);
  const tool = { ...tools[0], function: { ...tools[0].function, strict: true } };
  assert.equal(optimizeTool(tool).function.strict, true);
  assert.notEqual(optimizeTool(tool).function.parameters, tool.function.parameters);
});

test('tool execution rejects undeclared names and invalid arguments before mutation', async () => {
  const executed = [];
  const execute = async (name, args) => { executed.push({ name, args }); return { ok: true }; };
  const missing = await executeProviderTool(execute, 'unlisted', {}, {}, undefined, tools);
  assert.equal(missing.result.error, 'TOOL_NOT_AVAILABLE');
  for (const input of [null, [], 3, {}, { amount: '2' }, { amount: 0 }, { amount: 2, extra: true }]) {
    const result = await executeProviderTool(execute, 'apply_update', input, {}, undefined, tools);
    assert.equal(result.result.error, 'TOOL_ARGUMENTS_INVALID', JSON.stringify(input));
  }
  for (const raw of [{ function: { arguments: '{' } }, { arguments: '{' }, { input: null }]) {
    const result = await executeProviderTool(execute, 'apply_update', { amount: 2 }, { raw }, undefined, tools);
    assert.equal(result.result.error, 'TOOL_ARGUMENTS_INVALID');
  }
  assert.equal(executed.length, 0);
  const valid = await executeProviderTool(execute, 'apply_update', { amount: 2 }, {}, undefined, tools);
  assert.equal(valid.result.ok, true);
  assert.deepEqual(executed, [{ name: 'apply_update', args: { amount: 2 } }]);
});

test('tool validation follows withdrawn tools and updated schemas', async () => {
  const mutableTools = structuredClone(tools);
  let executions = 0;
  const execute = async () => { executions += 1; return { ok: true }; };
  await executeProviderTool(execute, 'apply_update', { amount: 2 }, {}, undefined, mutableTools);
  mutableTools[0].function.parameters.properties.amount.minimum = 3;
  const invalid = await executeProviderTool(execute, 'apply_update', { amount: 2 }, {}, undefined, mutableTools);
  assert.equal(invalid.result.error, 'TOOL_ARGUMENTS_INVALID');
  mutableTools.length = 0;
  const withdrawn = await executeProviderTool(execute, 'apply_update', { amount: 3 }, {}, undefined, mutableTools);
  assert.equal(withdrawn.result.error, 'TOOL_NOT_AVAILABLE');
  assert.equal(executions, 1);
});

for (const providerType of ['custom', 'openai', 'anthropic']) {
  for (const streaming of [false, true]) {
    test(`${providerType} ${streaming ? 'streaming' : 'completion'} returns validation errors for the model to repair`, async () => {
      const originalFetch = globalThis.fetch;
      try {
        const requests = [];
        const executed = [];
        globalThis.fetch = async (_url, request) => {
          requests.push(JSON.parse(request.body));
          const round = requests.length;
          const args = round === 1 ? { amount: 0 } : { amount: 2 };
          const item = { type: 'function_call', id: `fc-${round}`, call_id: `call-${round}`, name: 'apply_update', arguments: JSON.stringify(args) };
          const payload = providerType === 'anthropic'
            ? { id: `msg-${round}`, content: [{ type: 'tool_use', id: item.call_id, name: item.name, input: args }], stop_reason: 'tool_use' }
            : providerType === 'openai'
              ? { id: `response-${round}`, output: [item], status: 'completed' }
              : { choices: [{ message: { role: 'assistant', tool_calls: [{ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }] } }] };
          return Response.json(payload);
        };
        const settings = {
          providerType, gatewayName: 'Test', baseUrl: 'https://provider.test',
          model: providerType === 'openai' ? 'gpt-5' : 'test-model', apiKey: 'test-key',
          supportsReasoning: providerType === 'openai', extraBody: {}
        };
        const execute = async (_name, args) => { executed.push(args); return { ok: true, stop: true }; };
        const messages = [{ role: 'user', content: 'Apply an update.' }];
        const result = streaming
          ? await streamToolCompletion(settings, messages, tools, execute, () => {}, undefined, { maxRounds: 2 })
          : await runToolCompletion(settings, messages, tools, execute, { maxRounds: 2 });
        assert.equal(result.toolCalls[0].result.error, 'TOOL_ARGUMENTS_INVALID');
        assert.deepEqual(executed, [{ amount: 2 }]);
        assert.match(JSON.stringify(requests[1]), /TOOL_ARGUMENTS_INVALID/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}
