import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const { completeCharacterDraft } = await import('../services/characterAssistant.js');

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
