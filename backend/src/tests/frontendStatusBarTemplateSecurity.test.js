import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const {
  STATUS_BAR_TEMPLATE_ALLOWED_TAGS,
  STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS,
  escapeStatusBarTemplateHtml,
  hasDangerousStatusBarCss,
  isSafeStatusBarCssValue,
  sanitizeStatusBarStyleBlock,
  sanitizeStatusBarStyleText
} = await import('../../../frontend/src/utils/statusBarTemplateSecurity.js');
const { validateStatusBarCustomTemplate } = await import('../../../frontend/src/composables/chat/useChatAccessory.js');

const securitySource = readRepoText('frontend/src/utils/statusBarTemplateSecurity.js');

test('status bar template tag allowlists stay aligned between validation and rendering', () => {
  assert.equal(STATUS_BAR_TEMPLATE_ALLOWED_TAGS.has('button'), true);
  assert.equal(STATUS_BAR_TEMPLATE_ALLOWED_TAGS.has('script'), false);
  assert.equal(STATUS_BAR_TEMPLATE_ALLOWED_TAGS.has('style'), false);
  assert.equal(STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS.has('style'), true);
});

test('status bar template CSS helpers reject unsafe CSS patterns consistently', () => {
  assert.equal(isSafeStatusBarCssValue('color: #fff'), true);
  assert.equal(hasDangerousStatusBarCss('background: url(javascript:alert(1))'), true);
  assert.equal(isSafeStatusBarCssValue('behavior: url(#x)'), false);

  assert.equal(
    sanitizeStatusBarStyleText('color: #fff; background: url(javascript:alert(1)); --sb-gap: 8px'),
    'color: #fff; --sb-gap: 8px'
  );

  const cleanedBlock = sanitizeStatusBarStyleBlock(`
    @import url("https://example.invalid/a.css");
    .x { background: url(javascript:alert(1)); color: #fff; }
    .y { behavior: url(#default#VML); box-shadow: 0 0 4px #fff; }
  `);
  assert.doesNotMatch(cleanedBlock, /@import|url\s*\(|javascript:|behavior\s*:/i);
  assert.match(cleanedBlock, /color: #fff/);
  assert.match(cleanedBlock, /box-shadow: 0 0 4px #fff/);
});

test('status bar inline style sanitizer scans declarations without split pipelines', () => {
  assert.equal(
    sanitizeStatusBarStyleText(' color: #fff ; ; --sb-label: "HP; MP"; background: url(javascript:alert(1)); border: 1px solid currentColor '),
    'color: #fff; --sb-label: "HP; MP"; border: 1px solid currentColor'
  );

  assert.match(
    securitySource,
    /function sanitizeStatusBarStyleText\(value\) \{[\s\S]*for \(let index = 0; index <= source\.length; index \+= 1\) \{[\s\S]*appendSafeStatusBarStylePart/
  );
  assert.doesNotMatch(securitySource, /\.split\(';'\)/);
  assert.doesNotMatch(securitySource, /\.map\(\(part\) => part\.trim\(\)\)/);
  assert.doesNotMatch(securitySource, /\.filter\(\(part\) => part && isSafeStatusBarCssValue\(part\)\)/);
});

test('status bar custom template validation uses the shared dangerous CSS detector', () => {
  assert.deepEqual(validateStatusBarCustomTemplate('<div><style>.x { color: #fff; }</style></div>'), []);
  assert.notEqual(
    validateStatusBarCustomTemplate('<div><style>.x { background: url(javascript:alert(1)); }</style></div>').length,
    0
  );
});

test('status bar template HTML escaping covers v-html fallback characters', () => {
  assert.equal(
    escapeStatusBarTemplateHtml(`<button title="x" data-v='1'>&</button>`),
    '&lt;button title=&quot;x&quot; data-v=&#39;1&#39;&gt;&amp;&lt;/button&gt;'
  );
});
