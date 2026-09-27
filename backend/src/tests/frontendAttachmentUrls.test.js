import assert from 'node:assert/strict';
import test from 'node:test';

const { isSafeAttachmentUrl, normalizeSafeAttachmentUrl } = await import(
  '../../../frontend/src/utils/attachmentUrls.js'
);

test('attachment URL policy rejects executable browser schemes', () => {
  assert.equal(isSafeAttachmentUrl('javascript:alert(1)'), false);
  assert.equal(isSafeAttachmentUrl('vbscript:msgbox(1)'), false);
  assert.equal(isSafeAttachmentUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isSafeAttachmentUrl('//attacker.example/payload'), false);
  assert.equal(normalizeSafeAttachmentUrl('/api/assets/image-1'), '/api/assets/image-1');
  assert.equal(isSafeAttachmentUrl('https://cdn.example/image.webp'), true);
  assert.equal(isSafeAttachmentUrl('data:image/png;base64,AA=='), true);
});
