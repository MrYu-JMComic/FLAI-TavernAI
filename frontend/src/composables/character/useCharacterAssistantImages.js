import { onBeforeUnmount, ref, watch } from 'vue';
import { readFileAsDataUrl } from '../../utils/fileReaders.js';
import { normalizeSafeAttachmentUrl } from '../../utils/attachmentUrls.js';

export const ASSISTANT_IMAGE_LIMIT = 4;
export const ASSISTANT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function assistantImageUrl(attachment = {}) {
  return normalizeSafeAttachmentUrl(attachment.dataUrl || attachment.url);
}

export function useCharacterAssistantImages({ attachments, sessionId, isDisabled = () => false }) {
  const busy = ref(false);
  const error = ref('');
  let selection = 0;
  let disposed = false;

  watch(sessionId, () => {
    selection += 1;
    attachments.value = [];
    error.value = '';
    busy.value = false;
  });

  async function addFiles(files) {
    if (disposed || busy.value || isDisabled()) return false;
    const source = Array.from(files || []);
    if (!source.length) return false;
    const token = ++selection;
    busy.value = true;
    error.value = '';
    const next = [...attachments.value];
    const previousCount = next.length;
    const errors = new Set();
    try {
      for (const file of source) {
        if (!IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
          errors.add('仅支持 PNG、JPG 和 WebP 图片');
          continue;
        }
        if (file.size > ASSISTANT_IMAGE_MAX_BYTES) {
          errors.add('每张图片不能超过 4 MB');
          continue;
        }
        if (next.length >= ASSISTANT_IMAGE_LIMIT) {
          errors.add('每条消息最多添加 4 张图片');
          break;
        }
        const dataUrl = await readFileAsDataUrl(file, '图片读取失败，请重新添加');
        if (disposed || token !== selection) return false;
        if (!assistantImageUrl({ dataUrl })) {
          errors.add('图片数据无效，请重新选择 PNG、JPG 或 WebP 图片');
          continue;
        }
        next.push({
          id: `assistant-image-${token}-${next.length}`,
          type: 'image', dataUrl, mimeType: String(file.type).toLowerCase(),
          name: String(file.name || '图片').trim().slice(0, 120),
          alt: String(file.name || '图片').trim().slice(0, 200), size: file.size || 0
        });
      }
      if (disposed || token !== selection) return false;
      attachments.value = next;
      error.value = [...errors].join('；');
      return next.length > previousCount;
    } catch (err) {
      if (!disposed && token === selection) {
        attachments.value = next;
        error.value = err?.message || '图片读取失败，请重试';
      }
      return false;
    } finally {
      if (!disposed && token === selection) busy.value = false;
    }
  }

  function removeImage(id) {
    if (busy.value || isDisabled()) return;
    attachments.value = attachments.value.filter((image) => image.id !== id);
    error.value = '';
  }

  function pasteImages(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    // Let the textarea receive a mixed clipboard's plain text normally.
    if (!event.clipboardData?.getData?.('text/plain')) event.preventDefault();
    void addFiles(files);
  }

  function dragImages(event) {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = isDisabled() || busy.value ? 'none' : 'copy';
  }

  function dropImages(event) {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  }

  onBeforeUnmount(() => { disposed = true; selection += 1; });
  return { busy, error, addFiles, removeImage, pasteImages, dragImages, dropImages };
}
