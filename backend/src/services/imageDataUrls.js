export const defaultImageTypes = new Map([
  ['png', 'image/png'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp']
]);

export const defaultImageTypesWithGif = new Map([
  ...defaultImageTypes,
  ['gif', 'image/gif']
]);

const DEFAULT_MAX_PIXELS = 25_000_000;
const INVALID_IMAGE_DATA_MESSAGE = 'Invalid image data';

export function parseImageDataUrl(dataUrl, options = {}) {
  const {
    maxBytes = Number.POSITIVE_INFINITY,
    maxPixels = DEFAULT_MAX_PIXELS,
    imageTypes = defaultImageTypes,
    unsupportedMessage = 'Unsupported image type',
    tooLargeMessage = 'Image is too large',
    tooManyPixelsMessage = 'Image dimensions are too large',
    invalidMessage = INVALID_IMAGE_DATA_MESSAGE
  } = options;
  const match = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || '').trim());
  if (!match) {
    throw new Error(unsupportedMessage);
  }

  const extension = match[1].toLowerCase();
  const mimeType = imageTypes.get(extension);
  if (!mimeType) {
    throw new Error(unsupportedMessage);
  }

  const base64Data = match[2];
  if (!isValidBase64Payload(base64Data)) {
    throw new Error(invalidMessage);
  }

  const buffer = Buffer.from(base64Data, 'base64');
  return parseImageBuffer(buffer, {
    base64Data,
    expectedMimeType: mimeType,
    maxBytes,
    maxPixels,
    tooLargeMessage,
    tooManyPixelsMessage,
    invalidMessage
  });
}

export function parseImageBuffer(buffer, options = {}) {
  const {
    base64Data = buffer.toString('base64'),
    expectedMimeType = '',
    maxBytes = Number.POSITIVE_INFINITY,
    maxPixels = DEFAULT_MAX_PIXELS,
    tooLargeMessage = 'Image is too large',
    tooManyPixelsMessage = 'Image dimensions are too large',
    invalidMessage = INVALID_IMAGE_DATA_MESSAGE
  } = options;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error(invalidMessage);
  }
  if (buffer.length > maxBytes) {
    throw new Error(tooLargeMessage);
  }

  const metadata = readImageMetadata(buffer);
  if (!metadata || (expectedMimeType && metadata.mimeType !== expectedMimeType)) {
    throw new Error(invalidMessage);
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
    throw new Error(tooManyPixelsMessage);
  }

  return {
    mimeType: metadata.mimeType,
    base64Data,
    byteSize: buffer.length,
    width: metadata.width,
    height: metadata.height
  };
}

function isValidBase64Payload(value) {
  if (!value || value.length % 4 === 1) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  return !value.includes('=') || value.length % 4 === 0;
}

function readImageMetadata(buffer) {
  return readPngMetadata(buffer)
    || readGifMetadata(buffer)
    || readWebpMetadata(buffer)
    || readJpegMetadata(buffer);
}

function readPngMetadata(buffer) {
  if (
    buffer.length < 24
    || buffer[0] !== 0x89
    || buffer[1] !== 0x50
    || buffer[2] !== 0x4e
    || buffer[3] !== 0x47
    || buffer[4] !== 0x0d
    || buffer[5] !== 0x0a
    || buffer[6] !== 0x1a
    || buffer[7] !== 0x0a
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { mimeType: 'image/png', width, height };
}

function readGifMetadata(buffer) {
  if (buffer.length < 10) {
    return null;
  }
  const signature = buffer.toString('ascii', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    return null;
  }
  return {
    mimeType: 'image/gif',
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8)
  };
}

function readWebpMetadata(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkSize > buffer.length) {
      return null;
    }
    const metadata = readWebpChunkMetadata(buffer, chunkType, payloadOffset, chunkSize);
    if (metadata) {
      return metadata;
    }
    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function readWebpChunkMetadata(buffer, chunkType, payloadOffset, chunkSize) {
  if (chunkType === 'VP8X' && chunkSize >= 10) {
    return {
      mimeType: 'image/webp',
      width: 1 + buffer.readUIntLE(payloadOffset + 4, 3),
      height: 1 + buffer.readUIntLE(payloadOffset + 7, 3)
    };
  }
  if (chunkType === 'VP8L' && chunkSize >= 5 && buffer[payloadOffset] === 0x2f) {
    const b1 = buffer[payloadOffset + 1];
    const b2 = buffer[payloadOffset + 2];
    const b3 = buffer[payloadOffset + 3];
    const b4 = buffer[payloadOffset + 4];
    return {
      mimeType: 'image/webp',
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    };
  }
  if (
    chunkType === 'VP8 '
    && chunkSize >= 10
    && buffer[payloadOffset + 3] === 0x9d
    && buffer[payloadOffset + 4] === 0x01
    && buffer[payloadOffset + 5] === 0x2a
  ) {
    return {
      mimeType: 'image/webp',
      width: buffer.readUInt16LE(payloadOffset + 6) & 0x3fff,
      height: buffer.readUInt16LE(payloadOffset + 8) & 0x3fff
    };
  }
  return null;
}

function readJpegMetadata(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (offset + 2 > buffer.length) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return {
        mimeType: 'image/jpeg',
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += segmentLength;
  }
  return null;
}

function isJpegStartOfFrame(marker) {
  return (
    marker >= 0xc0
    && marker <= 0xcf
    && marker !== 0xc4
    && marker !== 0xc8
    && marker !== 0xcc
  );
}
