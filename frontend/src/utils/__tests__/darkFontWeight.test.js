import { afterEach, describe, expect, it } from 'vitest';
import { installDarkFontWeightAdaptation } from '../darkFontWeight.js';

let stopAdaptation = null;
let frame = null;

afterEach(() => {
  stopAdaptation?.();
  stopAdaptation = null;
  frame?.remove();
  frame = null;
});

describe('dark-theme font weights', () => {
  it('reduces authored weights, adapts inserted content, and restores light styles', async () => {
    frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument;
    const style = doc.createElement('style');
    style.textContent = 'body { font-weight: 400; } .headline { font-weight: 700; } strong { font-weight: 800; }';
    doc.head.append(style);
    doc.body.innerHTML = '<main><h1 class="headline">Title <strong>Bold</strong></h1></main>';

    stopAdaptation = installDarkFontWeightAdaptation(doc);
    doc.documentElement.dataset.theme = 'dark';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const headline = doc.querySelector('.headline');
    const strong = doc.querySelector('strong');
    expect(doc.documentElement.style.getPropertyValue('font-weight')).toBe('300');
    expect(headline.style.getPropertyValue('font-weight')).toBe('600');
    expect(strong.style.getPropertyValue('font-weight')).toBe('700');

    const inserted = doc.createElement('span');
    inserted.style.fontWeight = '600';
    inserted.textContent = 'New';
    doc.querySelector('main').append(inserted);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inserted.style.getPropertyValue('font-weight')).toBe('500');

    doc.documentElement.dataset.theme = 'light';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(doc.documentElement.style.getPropertyValue('font-weight')).toBe('');
    expect(headline.style.getPropertyValue('font-weight')).toBe('');
    expect(strong.style.getPropertyValue('font-weight')).toBe('');
    expect(inserted.style.getPropertyValue('font-weight')).toBe('600');
  });
});
