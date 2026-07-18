import assert from 'node:assert/strict';
import test from 'node:test';
import { PIXEL_ICON_CATALOG, PIXEL_ICON_KEYS, findPixelIcon } from '../../../shared/pixelIconCatalog.js';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script, template, style } = readVueBlocks('frontend/src/components/PixelIcon.vue', ['script', 'template', 'style']);

test('pixel icon catalog uses complete 12x12 five-tone original glyphs', () => {
  assert.equal(PIXEL_ICON_CATALOG.length, 26);
  assert.equal(new Set(PIXEL_ICON_KEYS).size, PIXEL_ICON_KEYS.length);
  for (const icon of PIXEL_ICON_CATALOG) {
    assert.equal(icon.gridSize, 12, icon.key);
    assert.equal(icon.pixels.length, 12, icon.key);
    assert.equal(icon.palette.length, 6, icon.key);
    let painted = 0;
    for (const row of icon.pixels) {
      assert.equal(row.length, 12, icon.key);
      assert.match(row, /^[0-5]+$/, icon.key);
      painted += row.replace(/0/g, '').length;
    }
    assert.ok(painted >= 20, `${icon.key} needs a readable silhouette`);
  }
  assert.equal(findPixelIcon('map.world')?.label, '世界');
});

test('PixelIcon derives its SVG viewport from the redesigned glyph grid', () => {
  assert.match(script, /const gridSize = computed\(\(\) => Number\(icon\.value\?\.gridSize \|\| 12\)\)/);
  assert.match(template, /:viewBox="`0 0 \$\{gridSize\} \$\{gridSize\}`"/);
  assert.match(template, /shape-rendering="crispEdges"/);
  assert.match(style, /image-rendering: pixelated/);
});
