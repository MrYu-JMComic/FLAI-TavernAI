import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownContent from '../MarkdownContent.vue';
import { md } from '../../utils/markdownRenderer.js';
import { highlightDialogueQuotes } from '../../utils/dialogueQuotes.js';

const wrappers = [];
function render(text, props = {}) {
  const wrapper = mount(MarkdownContent, { props: { text, highlightDialogue: true, ...props } });
  wrappers.push(wrapper);
  return wrapper;
}
function quotes(wrapper) {
  return wrapper.findAll('.chat-dialogue-quote').map((span) => span.element.textContent).join('');
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
});

describe('dialogue quote presentation', () => {
  it('highlights curly quotes across CRLF, blank lines, emphasis and links', () => {
    const text = 'Narration. \u201cFirst **bold**\r\nsecond *italic*\r\n\r\nThird [link](https://example.test/path?q=1&b=2)\u201d End.';
    const wrapper = render(text);
    expect(quotes(wrapper)).toBe('\u201cFirst bold\nsecond italicThird link\u201d');
    expect(wrapper.find('strong .chat-dialogue-quote').text()).toBe('bold');
    expect(wrapper.find('em .chat-dialogue-quote').text()).toBe('italic');
    expect(wrapper.find('a .chat-dialogue-quote').text()).toBe('link');
    expect(wrapper.find('a').attributes('href')).toBe('https://example.test/path?q=1&b=2');
    expect(wrapper.findAll('p')).toHaveLength(2);
    expect(wrapper.findAll('br')).toHaveLength(1);
    expect(wrapper.text()).toContain('Narration.');
    expect(quotes(wrapper)).not.toContain('Narration');
    expect(quotes(wrapper)).not.toContain('End.');
  });

  it('supports nested, adjacent and other Tavern-style quote delimiters', () => {
    const wrapper = render('\u201cOuter \u300cnested\u300d end\u201d\u201cNext\u201d "English" \uff02Fullwidth\uff02 \u00abFrench\u00bb \u300eCorner\u300f');
    expect(wrapper.findAll('.chat-dialogue-quote')).toHaveLength(6);
    expect(quotes(wrapper)).toContain('\u201cOuter \u300cnested\u300d end\u201d\u201cNext\u201d');
    expect(quotes(wrapper)).toContain('\uff02Fullwidth\uff02');
    expect(quotes(wrapper)).toContain('\u00abFrench\u00bb');
    expect(quotes(wrapper)).toContain('\u300eCorner\u300f');
    expect(wrapper.find('.chat-dialogue-quote .chat-dialogue-quote').exists()).toBe(false);
  });

  it('preserves symbols, entities, Unicode and escaped Markdown without HTML injection', () => {
    const wrapper = render('\u201c<&> \u4f60\u597d\uff01\u2026\u2026 \u2014 \ud83d\ude42 \\*literal\\* &amp; <img src=x onerror=alert(1)>\u201d');
    expect(quotes(wrapper)).toContain('<&> \u4f60\u597d\uff01');
    expect(quotes(wrapper)).toContain('\ud83d\ude42');
    expect(quotes(wrapper)).toContain('*literal* &');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('[onerror]').exists()).toBe(false);
    expect(wrapper.find('em').exists()).toBe(false);
  });

  it('allows unmatched nested symbols without breaking the outer quote pair', () => {
    expect(quotes(render('\u201cA 6" screen and \u300can unfinished inner quote.\u201d After')))
      .toBe('\u201cA 6" screen and \u300can unfinished inner quote.\u201d');
  });

  it('does not match quote delimiters in code, math or link attributes', () => {
    const text = '\u201cBefore `\u201dcode\u201c` $\\text{\u201dmath\u201c}$ after\u201d\n\n```text\n\u201cCode only\u201d\n```\n\nOutside [link](https://example.test "\u201cTitle\u201d")';
    const wrapper = render(text);
    expect(quotes(wrapper)).toBe('\u201cBefore  after\u201d');
    expect(wrapper.find('code .chat-dialogue-quote').exists()).toBe(false);
    expect(wrapper.find('.katex .chat-dialogue-quote').exists()).toBe(false);
    expect(wrapper.find('a .chat-dialogue-quote').exists()).toBe(false);
    expect(wrapper.find('a').attributes('title')).toBe('\u201cTitle\u201d');
  });

  it('keeps incomplete streamed quotes plain and isolates each message', async () => {
    const wrapper = render('Narration \u201cFirst\nnext', { deferUpdates: true });
    expect(quotes(wrapper)).toBe('');
    expect(quotes(render('other message\u201d'))).toBe('');
    await wrapper.setProps({ text: 'Narration \u201cFirst\nnext\u201d after' });
    expect(quotes(wrapper)).toBe('\u201cFirst\nnext\u201d');
    await wrapper.setProps({ deferUpdates: false });
    expect(quotes(wrapper)).toBe('\u201cFirst\nnext\u201d');
  });

  it('toggles without Markdown reparsing, cache contamination or lost fold state', async () => {
    const text = '# Details\n\u201cCache toggle quote\u201d';
    const wrapper = render(text, { renderPlugins: [{ pattern: '^# (.+)$', titleTemplate: '$1' }] });
    const details = wrapper.find('details').element;
    details.open = true;
    const spy = vi.spyOn(md, 'render');
    await wrapper.setProps({ highlightDialogue: false });
    expect(quotes(wrapper)).toBe('');
    expect(wrapper.find('details').element).toBe(details);
    expect(details.open).toBe(true);
    await wrapper.setProps({ highlightDialogue: true });
    expect(quotes(wrapper)).toBe('\u201cCache toggle quote\u201d');
    expect(spy).not.toHaveBeenCalled();
    expect(quotes(render(text, { highlightDialogue: false }))).toBe('');
  });

  it('does not enable highlighting in generic Markdown surfaces by default', () => {
    expect(quotes(render('\u201cGeneric markdown\u201d', { highlightDialogue: false }))).toBe('');
  });

  it('preserves list/table structure and handles long multiline dialogue', () => {
    const wrapper = render('\u201cStart\n\n- first\n- second\n\n| A | B |\n| - | - |\n| left | right |\n\nEnd\u201d');
    expect(wrapper.find('ul > span').exists()).toBe(false);
    expect(wrapper.find('table > span').exists()).toBe(false);
    expect(wrapper.find('li .chat-dialogue-quote').text()).toBe('first');
    expect(wrapper.find('td .chat-dialogue-quote').text()).toBe('left');
    const root = document.createElement('div');
    root.textContent = '\u201c' + 'line\n'.repeat(20000) + '\u201d';
    const original = root.textContent;
    highlightDialogueQuotes(root);
    expect(root.textContent).toBe(original);
    expect(root.querySelectorAll('.chat-dialogue-quote')).toHaveLength(1);
  });
});
