import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownContent from '../MarkdownContent.vue';

const wrappers = [];

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe('streamed Markdown reveal', () => {
  it('animates only newly appended visible graphemes in order', async () => {
    const wrapper = mount(MarkdownContent, {
      props: { text: '墨', deferUpdates: true }
    });
    wrappers.push(wrapper);
    await wrapper.setProps({ text: '墨色雲' });

    const glyphs = wrapper.findAll('.stream-ink-glyph');
    expect(wrapper.text()).toBe('墨色雲');
    expect(glyphs.map((glyph) => glyph.text())).toEqual(['色', '雲']);
    expect(glyphs.map((glyph) => glyph.element.style.getPropertyValue('--stream-glyph-index'))).toEqual(['0', '1']);

    const previousGlyph = glyphs[0].element;
    await wrapper.setProps({ text: '墨色雲起' });
    expect(wrapper.text()).toBe('墨色雲起');
    const updatedGlyphs = wrapper.findAll('.stream-ink-glyph');
    expect(updatedGlyphs.at(-1).text()).toBe('起');
    expect(updatedGlyphs.at(-1).element.style.getPropertyValue('--stream-glyph-index')).toBe('0');
    expect(updatedGlyphs.some((glyph) => glyph.element === previousGlyph)).toBe(true);

    updatedGlyphs.at(-1).element.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(wrapper.findAll('.stream-ink-glyph').map((glyph) => glyph.text())).toEqual(['色', '雲']);
  });
});
