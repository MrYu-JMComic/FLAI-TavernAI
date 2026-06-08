import test from 'node:test';
import assert from 'node:assert/strict';

import { readRepoText } from './frontendSfcTestUtils.js';

const { callEventMethod } = await import('../../../frontend/src/utils/eventMethods.js');
const eventMethodsSource = readRepoText('frontend/src/utils/eventMethods.js');

test('callEventMethod invokes callable event methods with the event receiver', () => {
  const event = {
    called: false,
    preventDefault() {
      this.called = true;
    }
  };

  assert.equal(callEventMethod(event, 'preventDefault'), true);
  assert.equal(event.called, true);
});

test('callEventMethod ignores missing or non-callable event methods', () => {
  assert.equal(callEventMethod(null, 'preventDefault'), false);
  assert.equal(callEventMethod({ preventDefault: true }, 'preventDefault'), false);
  assert.equal(callEventMethod({ stopPropagation: 'nope' }, 'stopPropagation'), false);
});

test('callEventMethod checks method callability before invoking', () => {
  assert.match(
    eventMethodsSource,
    /const method = event\?\.\[methodName\];[\s\S]*if \(typeof method !== 'function'\) {[\s\S]*return false;[\s\S]*}[\s\S]*method\.call\(event\);/
  );
});
