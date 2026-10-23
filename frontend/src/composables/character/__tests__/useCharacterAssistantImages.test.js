import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { readFileAsDataUrl } from '../../../utils/fileReaders.js';
import { assistantImageUrl, useCharacterAssistantImages } from '../useCharacterAssistantImages.js';

vi.mock('../../../utils/fileReaders.js', () => ({ readFileAsDataUrl: vi.fn() }));
const wrappers = [];
const file = (name = '参考.png', extra = {}) => ({ name, type: 'image/png', size: 100, ...extra });

function fixture() {
  const attachments = ref([]);
  const sessionId = ref('session-a');
  const disabled = ref(false);
  let images;
  wrappers.push(mount(defineComponent({ setup() {
    images = useCharacterAssistantImages({ attachments, sessionId, isDisabled: () => disabled.value });
    return () => h('div');
  } })));
  return { images, attachments, sessionId, disabled };
}

beforeEach(() => {
  vi.clearAllMocks();
  readFileAsDataUrl.mockResolvedValue('data:image/png;base64,YWJj');
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });

describe('character assistant image drafts', () => {
  it('reads supported images into removable previews and rejects unsupported or oversized files visibly', async () => {
    const { images, attachments } = fixture();
    await images.addFiles([file(), file('portrait.jpg', { type: 'image/jpeg' }), file('bad.svg', { type: 'image/svg+xml' }), file('large.png', { size: 4 * 1024 * 1024 + 1 })]);
    expect(attachments.value.map((image) => image.name)).toEqual(['参考.png', 'portrait.jpg']);
    expect(readFileAsDataUrl).toHaveBeenCalledTimes(2);
    expect(images.error.value).toContain('仅支持 PNG、JPG 和 WebP');
    expect(images.error.value).toContain('不能超过 4 MB');
    expect(assistantImageUrl(attachments.value[0])).toBe('data:image/png;base64,YWJj');
    images.removeImage(attachments.value[0].id);
    expect(attachments.value.map((image) => image.name)).toEqual(['portrait.jpg']);
    expect(images.error.value).toBe('');
  });

  it('allows exactly 4 MB and limits combined additions to four images', async () => {
    const { images, attachments } = fixture();
    await images.addFiles([file('one.png', { size: 4 * 1024 * 1024 }), file('two.webp', { type: 'image/webp' })]);
    await images.addFiles([file('three.png'), file('four.png'), file('five.png')]);
    expect(attachments.value).toHaveLength(4);
    expect(new Set(attachments.value.map((image) => image.id)).size).toBe(4);
    expect(images.error.value).toContain('最多添加 4 张图片');
  });

  it('fits long file names into the existing asset and message metadata limits', async () => {
    const { images, attachments } = fixture();
    await images.addFiles([file(`${'图'.repeat(240)}.png`)]);
    expect(attachments.value[0].name).toHaveLength(120);
    expect(attachments.value[0].alt).toHaveLength(200);
  });

  it('keeps the successfully read images when a later file cannot be read', async () => {
    const { images, attachments } = fixture();
    readFileAsDataUrl.mockResolvedValueOnce('data:image/png;base64,YWJj').mockRejectedValueOnce(new Error('磁盘读取失败'));
    await images.addFiles([file('first.png'), file('unreadable.png')]);
    expect(attachments.value.map((image) => image.name)).toEqual(['first.png']);
    expect(images.error.value).toBe('磁盘读取失败');
  });

  it('cancels stale reads and clears draft images when changing sessions', async () => {
    const { images, attachments, sessionId } = fixture();
    await images.addFiles([file('old.png')]);
    let finish;
    readFileAsDataUrl.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const read = images.addFiles([file('slow.png')]);
    expect(images.busy.value).toBe(true);
    sessionId.value = 'session-b';
    await nextTick();
    expect(attachments.value).toEqual([]);
    finish('data:image/png;base64,YWJj');
    await read;
    expect(attachments.value).toEqual([]);
    expect(images.busy.value).toBe(false);
  });

  it('handles paste and file drops without blocking mixed clipboard plain text', async () => {
    const { images, attachments } = fixture();
    const preventDefault = vi.fn();
    images.pasteImages({ clipboardData: { files: [file('paste.png')], getData: () => '' }, preventDefault });
    await flushPromises();
    expect(preventDefault).toHaveBeenCalledOnce();
    preventDefault.mockClear();
    images.pasteImages({ clipboardData: { files: [file('mixed.png')], getData: () => '描述图片' }, preventDefault });
    await flushPromises();
    expect(preventDefault).not.toHaveBeenCalled();
    const transfer = { types: ['Files'], files: [file('drop.png')] };
    images.dragImages({ dataTransfer: transfer, preventDefault });
    expect(transfer.dropEffect).toBe('copy');
    images.dropImages({ dataTransfer: transfer, preventDefault });
    await flushPromises();
    expect(attachments.value.map((image) => image.name)).toEqual(['paste.png', 'mixed.png', 'drop.png']);
  });

  it('blocks modifications during requests and rejects unsafe preview URLs', async () => {
    const { images, attachments, disabled } = fixture();
    await images.addFiles([file()]);
    disabled.value = true;
    images.removeImage(attachments.value[0].id);
    expect(await images.addFiles([file('extra.png')])).toBe(false);
    expect(attachments.value).toHaveLength(1);
    expect(assistantImageUrl({ url: 'javascript:alert(1)' })).toBe('');
    expect(assistantImageUrl({ url: '/api/assets/saved-reference' })).toBe('/api/assets/saved-reference');
  });
});
