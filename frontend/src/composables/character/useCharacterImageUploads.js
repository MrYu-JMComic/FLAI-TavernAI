import { reactive } from 'vue';
import { readFileAsDataUrl, validateImageDataUrl } from '../../utils/fileReaders';

const ADVANCED_BACKGROUND_FIELDS = new Set(['desktopBackgroundUrl', 'mobileBackgroundUrl']);

export function useCharacterImageUploads({
  canEdit,
  form,
  isDisposed = () => false,
  notify
} = {}) {
  const backgroundUploading = reactive({
    desktopBackgroundUrl: false,
    mobileBackgroundUrl: false
  });
  const backgroundUploadTokens = {};
  let avatarUploadToken = 0;

  async function handleAvatar(event) {
    if (isDisposed() || !canEdit?.value) {
      return;
    }

    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file) {
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify?.warning?.('头像仅支持 PNG、JPG 或 WebP');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      notify?.warning?.('头像不能超过 2MB');
      return;
    }

    const uploadToken = ++avatarUploadToken;
    try {
      const result = await readFileAsDataUrl(file, '头像读取失败');
      if (!isCurrentAvatarUpload(uploadToken)) {
        return;
      }
      const validatedResult = await validateImageDataUrl(
        result,
        '头像图片数据无效，请重新选择 PNG、JPG 或 WebP 图片'
      );
      if (!isCurrentAvatarUpload(uploadToken)) {
        return;
      }
      form.avatarUrl = validatedResult;
    } catch (err) {
      if (!isCurrentAvatarUpload(uploadToken)) {
        return;
      }
      notify?.warning?.(err.message || '头像读取失败');
    }
  }

  function isCurrentAvatarUpload(uploadToken) {
    return !isDisposed() && uploadToken === avatarUploadToken;
  }

  function clearAvatar() {
    if (isDisposed() || !canEdit?.value) {
      return;
    }
    avatarUploadToken += 1;
    form.avatarUrl = '';
  }

  async function handleAdvancedBackground(event, field) {
    if (isDisposed() || !canEdit?.value || !ADVANCED_BACKGROUND_FIELDS.has(field)) {
      return;
    }

    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file) {
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      notify?.warning?.('背景图片仅支持 PNG、JPG、WebP 或 GIF');
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      notify?.warning?.('背景图片不能超过 4MB');
      return;
    }

    backgroundUploading[field] = true;
    const uploadToken = nextBackgroundUploadToken(field);
    try {
      const result = await readFileAsDataUrl(file, '背景图片读取失败');
      if (!isCurrentBackgroundUpload(field, uploadToken)) {
        return;
      }
      form.authorAdvancedSettings[field] = result;
      notify?.success?.('背景图片已读取，保存角色后会生成短链');
    } catch (err) {
      if (!isCurrentBackgroundUpload(field, uploadToken)) {
        return;
      }
      notify?.warning?.(err.message || '背景图片读取失败');
    } finally {
      if (isCurrentBackgroundUpload(field, uploadToken)) {
        backgroundUploading[field] = false;
      }
    }
  }

  function clearAdvancedBackground(field) {
    if (isDisposed() || !canEdit?.value || !ADVANCED_BACKGROUND_FIELDS.has(field)) {
      return;
    }
    nextBackgroundUploadToken(field);
    backgroundUploading[field] = false;
    form.authorAdvancedSettings[field] = '';
  }

  function cancelCharacterImageUploads() {
    avatarUploadToken += 1;
    for (const field of ADVANCED_BACKGROUND_FIELDS) {
      nextBackgroundUploadToken(field);
      backgroundUploading[field] = false;
    }
  }

  function nextBackgroundUploadToken(field) {
    const key = String(field || '');
    const nextToken = (backgroundUploadTokens[key] || 0) + 1;
    backgroundUploadTokens[key] = nextToken;
    return nextToken;
  }

  function isCurrentBackgroundUpload(field, uploadToken) {
    return !isDisposed() && backgroundUploadTokens[String(field || '')] === uploadToken;
  }

  return {
    backgroundUploading,
    cancelCharacterImageUploads,
    clearAdvancedBackground,
    clearAvatar,
    handleAdvancedBackground,
    handleAvatar
  };
}
