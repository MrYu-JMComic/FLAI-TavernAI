import { appConfig } from '../config.js';
import { assetIdFromUrl, assetKinds, createAsset, getAsset } from '../modules/assets.js';
import { parseImageDataUrl } from './imageDataUrls.js';

const CHAT_IMAGE_LIMIT = 4;
const CHAT_IMAGE_MAX_BYTES = appConfig.upload.chatImageMaxBytes;
const CHAT_IMAGE_MAX_PIXELS = appConfig.upload.imageMaxPixels;
const supportedChatImageTypes = new Map([
  ['png', 'image/png'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp']
]);

export function normalizeChatAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const normalized = [];
  for (const attachment of source) {
    const normalizedAttachment = normalizeChatImageAttachment(attachment);
    if (!normalizedAttachment) {
      continue;
    }
    normalized.push(normalizedAttachment);
    if (normalized.length >= CHAT_IMAGE_LIMIT) {
      break;
    }
  }
  return normalized;
}

export function prepareChatAttachmentsForStorage(database, userId, conversationId, attachments = []) {
  const candidates = normalizeChatAttachments(attachments);
  const storedAttachments = [];
  const modelAttachments = [];
  for (const attachment of candidates) {
    const prepared = prepareChatAttachmentForStorage(database, userId, conversationId, attachment);
    if (!prepared) {
      continue;
    }
    storedAttachments.push(prepared.stored);
    modelAttachments.push(prepared.model);
    if (storedAttachments.length >= CHAT_IMAGE_LIMIT) {
      break;
    }
  }
  return { storedAttachments, modelAttachments };
}

export function prepareUserChatAttachmentsForStorage(database, userId, conversationId, attachments = []) {
  validateChatAttachmentsForUpload(attachments);
  const candidates = normalizeChatAttachments(attachments);
  const prepared = prepareChatAttachmentsForStorage(database, userId, conversationId, candidates);
  if (prepared.storedAttachments.length !== candidates.length) {
    throw new Error('聊天图片附件无效或不可访问');
  }
  return prepared;
}

export function validateChatAttachmentsForUpload(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  if (source.length > CHAT_IMAGE_LIMIT) {
    throw new Error(`聊天图片最多 ${CHAT_IMAGE_LIMIT} 张`);
  }
  for (const attachment of source) {
    validateChatImageAttachmentForUpload(attachment);
  }
}

export function resolveChatAttachmentsForModel(database, userId, attachments = []) {
  const source = normalizeChatAttachments(attachments);
  const resolved = [];
  for (const attachment of source) {
    if (attachment.dataUrl) {
      resolved.push(attachment);
    } else if (attachment.url) {
      const prepared = prepareStoredAssetChatAttachment(database, userId, attachment);
      if (prepared?.model) {
        resolved.push(prepared.model);
      }
    }
    if (resolved.length >= CHAT_IMAGE_LIMIT) {
      break;
    }
  }
  return resolved;
}

function normalizeChatImageAttachment(attachment = {}) {
  const rawUrl = String(attachment.url || '').trim();
  const dataUrl = String(attachment.dataUrl || (isImageDataUrl(rawUrl) ? rawUrl : '')).trim();
  if (dataUrl) {
    const parsed = parseChatImageDataUrl(dataUrl);
    if (!parsed) {
      return null;
    }
    return {
      type: 'image',
      dataUrl,
      mimeType: parsed.mimeType,
      name: String(attachment.name || '').trim().slice(0, 120),
      alt: String(attachment.alt || attachment.name || '').trim().slice(0, 200),
      size: parsed.byteSize
    };
  }

  if (!assetIdFromUrl(rawUrl)) {
    return null;
  }
  return {
    type: 'image',
    url: rawUrl,
    mimeType: normalizeChatImageMimeType(attachment.mimeType),
    name: String(attachment.name || '').trim().slice(0, 120),
    alt: String(attachment.alt || attachment.name || '').trim().slice(0, 200),
    size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0
  };
}

function validateChatImageAttachmentForUpload(attachment = {}) {
  const source = attachment && typeof attachment === 'object' ? attachment : {};
  const rawUrl = String(source.url || '').trim();
  const dataUrl = String(source.dataUrl || (isImageDataUrl(rawUrl) ? rawUrl : '')).trim();
  if (dataUrl) {
    parseChatImageDataUrl(dataUrl, { throwOnError: true });
    return;
  }
  if (!assetIdFromUrl(rawUrl)) {
    throw new Error('聊天图片附件无效');
  }
}

function prepareChatAttachmentForStorage(database, userId, conversationId, attachment = {}) {
  if (attachment.dataUrl) {
    const parsed = parseChatImageDataUrl(attachment.dataUrl);
    if (!parsed) {
      return null;
    }
    const asset = createAsset(database, userId, {
      dataUrl: attachment.dataUrl,
      ownerType: 'conversation',
      ownerId: conversationId,
      kind: assetKinds.chatImage,
      name: attachment.name,
      alt: attachment.alt,
      metadata: {
        source: 'chat-message'
      }
    });
    const stored = chatAttachmentFromAsset(asset, attachment);
    return {
      stored,
      model: {
        ...stored,
        dataUrl: asset.dataUrl
      }
    };
  }

  if (attachment.url) {
    return prepareStoredAssetChatAttachment(database, userId, attachment);
  }

  return null;
}

function prepareStoredAssetChatAttachment(database, userId, attachment = {}) {
  const assetId = assetIdFromUrl(attachment.url);
  if (!assetId) {
    return null;
  }
  const asset = getAsset(database, userId, assetId);
  if (!asset || !isSupportedChatImageMimeType(asset.mimeType) || asset.byteSize > CHAT_IMAGE_MAX_BYTES) {
    return null;
  }
  const stored = chatAttachmentFromAsset(asset, attachment);
  return {
    stored,
    model: {
      ...stored,
      dataUrl: asset.dataUrl
    }
  };
}

function chatAttachmentFromAsset(asset = {}, fallback = {}) {
  const name = String(fallback.name || asset.name || '').trim().slice(0, 120);
  const alt = String(fallback.alt || asset.alt || fallback.name || asset.name || '').trim().slice(0, 200);
  return {
    type: 'image',
    url: asset.url,
    mimeType: asset.mimeType,
    name,
    alt,
    size: asset.byteSize
  };
}

function normalizeChatImageMimeType(value) {
  const mimeType = String(value || '').trim().toLowerCase();
  return isSupportedChatImageMimeType(mimeType) ? mimeType : '';
}

function isSupportedChatImageMimeType(value) {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function isImageDataUrl(value) {
  return /^data:image\/(?:png|jpeg|webp);base64,/i.test(String(value || '').trim());
}

function parseChatImageDataUrl(value, options = {}) {
  try {
    return parseImageDataUrl(value, {
      maxBytes: CHAT_IMAGE_MAX_BYTES,
      maxPixels: CHAT_IMAGE_MAX_PIXELS,
      imageTypes: supportedChatImageTypes,
      unsupportedMessage: '聊天图片仅支持 PNG、JPG 或 WebP',
      tooLargeMessage: '聊天图片不能超过 4MB',
      tooManyPixelsMessage: '聊天图片像素过大',
      invalidMessage: '聊天图片数据无效'
    });
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }
    return null;
  }
}
