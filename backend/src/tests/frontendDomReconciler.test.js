import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { reconcileDomChildren } from '../../../frontend/src/utils/domReconciler.js';

test('Markdown DOM reconciliation preserves stable media, code, and details nodes', () => {
  const dom = new JSDOM('<div id="root"></div>');
  const document = dom.window.document;
  const root = document.querySelector('#root');
  root.innerHTML = [
    '<p>before</p>',
    '<img src="/stable.png" alt="stable">',
    '<details><summary>More</summary><div>old</div></details>',
    '<pre class="markdown-code"><code>const a = 1;</code></pre>'
  ].join('');

  const image = root.querySelector('img');
  const details = root.querySelector('details');
  const code = root.querySelector('pre');
  details.open = true;

  const template = document.createElement('template');
  template.innerHTML = [
    '<h2>after</h2>',
    '<img src="/stable.png" alt="stable">',
    '<details><summary>More</summary><div>new</div></details>',
    '<pre class="markdown-code"><code>const a = 2;</code></pre>',
    '<p>tail</p>'
  ].join('');
  reconcileDomChildren(root, template.content);

  assert.equal(root.querySelector('img'), image);
  assert.equal(root.querySelector('details'), details);
  assert.equal(root.querySelector('pre'), code);
  assert.equal(details.open, true);
  assert.equal(details.querySelector('div').textContent, 'new');
  assert.equal(code.textContent, 'const a = 2;');
  assert.equal(root.querySelector('h2').textContent, 'after');
  assert.equal(root.querySelector('p').textContent, 'tail');
});

test('Markdown DOM reconciliation does not reuse adjacent media for a different source', () => {
  const dom = new JSDOM('<div id="root"><img src="/a.png"><img src="/b.png"></div>');
  const document = dom.window.document;
  const root = document.querySelector('#root');
  const imageB = root.querySelectorAll('img')[1];
  const template = document.createElement('template');
  template.innerHTML = '<img src="/new.png"><img src="/b.png">';

  reconcileDomChildren(root, template.content);

  assert.equal(root.querySelectorAll('img')[1], imageB);
  assert.equal(root.querySelectorAll('img')[0].getAttribute('src'), '/new.png');
});
