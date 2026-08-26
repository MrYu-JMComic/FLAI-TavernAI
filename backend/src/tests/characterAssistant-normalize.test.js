import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const { completeCharacterDraft, streamCharacterDraft } = await import('../services/characterAssistant.js');

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('character assistant treats null current tags as empty', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Done.' } }]
    });

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      {
        requirement: 'keep existing character',
        current: {
          name: 'Tag Guard',
          tags: null
        }
      }
    );

    assert.equal(result.character.name, 'Tag Guard');
    assert.deepEqual(result.character.tags, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant preserves generated content within character field limits', async () => {
  const originalFetch = globalThis.fetch;
  const background = '背'.repeat(9_000);
  const worldview = '界'.repeat(9_100);
  const persona = '人'.repeat(9_200);
  const openingMessage = '开'.repeat(4_500);
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'long-character-content',
                type: 'function',
                function: {
                  name: 'set_character_profile',
                  arguments: JSON.stringify({ background, worldview, persona, openingMessage })
                }
              }]
            }
          }]
        });
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Done.' } }]
      });
    };

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'generate long character content', current: {} }
    );

    assert.equal(calls, 2);
    assert.equal(result.character.background, background);
    assert.equal(result.character.worldview, worldview);
    assert.equal(result.character.persona, persona);
    assert.equal(result.character.openingMessage, openingMessage);
    assert.equal(result.toolCalls[0].result.applied.openingMessage, openingMessage);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant normalizes generation options with direct defaults loop', async () => {
  const originalFetch = globalThis.fetch;
  let enabledSections = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      const userMessage = body.messages.find((message) => message.role === 'user');
      enabledSections = JSON.parse(userMessage.content).enabledSections;
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Done.' } }]
      });
    };

    await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      {
        requirement: 'respect enabled sections',
        current: {},
        options: {
          profile: false,
          background: 0,
          worldview: '',
          persona: 'yes',
          openingMessage: null,
          tags: true,
          regexRules: false,
          renderPlugins: 1,
          worldBookSuggestion: undefined,
          advancedSettings: false,
          modSuggestions: '1'
        }
      }
    );

    assert.deepEqual(enabledSections, {
      profile: false,
      background: false,
      worldview: false,
      persona: true,
      openingMessage: false,
      tags: true,
      regexRules: false,
      renderPlugins: true,
      worldBookSuggestion: true,
      advancedSettings: false,
      modSuggestions: true
    });

    const source = fs.readFileSync(new URL('../services/characterAssistant.js', import.meta.url), 'utf8');
    const start = source.indexOf('function normalizeGenerationOptions(options = {}) {');
    const end = source.indexOf('\nfunction filterToolArgs', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const snippet = source.slice(start, end);
    assert.match(snippet, /for \(const key in defaults\)/);
    assert.doesNotMatch(snippet, /Object\.fromEntries/);
    assert.doesNotMatch(snippet, /Object\.entries\(defaults\)\.map/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant prompts include shared quality guidance', async () => {
  const originalFetch = globalThis.fetch;
  const prompts = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      prompts.push(body.messages[0].content);
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Done.' } }]
      });
    };

    await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'make a playable tavern character', current: {} }
    );

    await streamCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'make a playable tavern character', current: {} }
    );

    assert.equal(prompts.length, 2);
    for (const prompt of prompts) {
      assert.match(prompt, /人设字段是长期角色扮演契约/);
      assert.match(prompt, /开场白必须是可直接互动的第一幕/);
      assert.match(prompt, /扩展、状态变量、Mod 和渲染插件必须对应明确的实际用途/);
      assert.match(prompt, /currentCharacter 是现有表单数据/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant formats enabled sections without Object.entries pipelines', () => {
  const source = fs.readFileSync(new URL('../services/characterAssistant.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /function formatEnabledSectionList\(enabledSections = \{\}\) \{\s*let sections = '';\s*for \(const key in enabledSections\) \{[\s\S]*sections = sections \? `\$\{sections\}, \$\{key\}` : key;[\s\S]*return sections \|\| 'none';\s*\}/
  );
  assert.equal(
    source.match(/允许修改的部分仅限：\$\{formatEnabledSectionList\(enabledSections\)\}。/g)?.length,
    1
  );
  assert.doesNotMatch(source, /Object\.entries\(enabledSections\)\.filter\(\(\[, value\]\) => value\)\.map\(\(\[key\]\) => key\)\.join\(', '\)/);
});

test('character assistant normalizes generated extension arrays with direct list helpers', () => {
  const source = fs.readFileSync(new URL('../services/characterAssistant.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /function normalizeTags\(tags = \[\]\) \{[\s\S]*const sourceTags = Array\.isArray\(tags\) \? tags : \[\];[\s\S]*for \(const tag of sourceTags\) \{[\s\S]*normalized\.push\(value\);[\s\S]*return normalized;[\s\S]*\}/
  );
  assert.match(
    source,
    /function normalizeRegexRuleList\(rules = \[\]\) \{[\s\S]*const sourceRules = Array\.isArray\(rules\) \? rules : \[\];[\s\S]*for \(let index = 0; index < sourceRules\.length; index \+= 1\) \{[\s\S]*normalizeRegexRule\(sourceRules\[index\], index\);[\s\S]*normalized\.push\(rule\);[\s\S]*return normalized;[\s\S]*\}/
  );
  assert.match(
    source,
    /function normalizeRenderPluginList\(plugins = \[\], limit = Infinity\) \{[\s\S]*const sourcePlugins = Array\.isArray\(plugins\) \? plugins : \[\];[\s\S]*normalizeRenderPlugin\(sourcePlugins\[index\], index\);[\s\S]*normalized\.push\(plugin\);[\s\S]*if \(normalized\.length >= limit\) \{[\s\S]*return normalized;[\s\S]*\}/
  );
  assert.match(
    source,
    /function normalizeModSuggestionList\(mods = \[\], limit = Infinity\) \{[\s\S]*const sourceMods = Array\.isArray\(mods\) \? mods : \[\];[\s\S]*normalizeModSuggestion\(sourceMods\[index\], index\);[\s\S]*normalized\.push\(mod\);[\s\S]*if \(normalized\.length >= limit\) \{[\s\S]*return normalized;[\s\S]*\}/
  );
  assert.doesNotMatch(source, /tags\.map\(\(tag\) => String\(tag \|\| ''\)\.trim\(\)\)\.filter\(Boolean\)\.slice\(0, 8\)/);
  assert.doesNotMatch(source, /regexRules\.map\(\(rule, index\) => normalizeRegexRule\(rule, index\)\)\.filter/);
  assert.doesNotMatch(source, /renderPlugins[\s\S]{0,120}\.map\(\(plugin, index\) => normalizeRenderPlugin\(plugin, index\)\)[\s\S]{0,120}\.filter/);
  assert.doesNotMatch(source, /modSuggestions[\s\S]{0,120}\.map\(\(mod, index\) => normalizeModSuggestion\(mod, index\)\)[\s\S]{0,120}\.filter/);
});

test('character assistant collects process reasoning without array joins', () => {
  const source = fs.readFileSync(new URL('../services/characterAssistant.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /function collectReasoning\(process = \[\]\) \{\s*let merged = '';\s*for \(const step of Array\.isArray\(process\) \? process : \[\]\) \{/
  );
  assert.match(source, /if \(merged\.length >= 8000\) \{\s*return merged\.slice\(0, 8000\);/);
  assert.doesNotMatch(source, /\.map\(\(step\) => String\(step\.reasoning \|\| ''\)\.trim\(\)\)/);
  assert.doesNotMatch(source, /\.filter\(Boolean\)/);
  assert.doesNotMatch(source, /\.join\('\\n\\n'\)/);
});
