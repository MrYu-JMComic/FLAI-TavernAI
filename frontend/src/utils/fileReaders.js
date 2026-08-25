export function readFileAsDataUrl(file, errorMessage = '文件读取失败') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(errorMessage));
    try {
      reader.readAsDataURL(file);
    } catch {
      reader.onerror?.();
    }
  });
}

export function validateImageDataUrl(dataUrl, errorMessage = '图片数据无效') {
  const source = String(dataUrl || '');
  return new Promise((resolve, reject) => {
    const ImageConstructor = globalThis.Image;
    if (!hasMatchingImageSignature(source) || typeof ImageConstructor !== 'function') {
      reject(new Error(errorMessage));
      return;
    }

    const image = new ImageConstructor();
    let settled = false;
    const settle = (isValid) => {
      if (settled) {
        return;
      }
      settled = true;
      image.onload = null;
      image.onerror = null;
      if (isValid && Number(image.naturalWidth) > 0 && Number(image.naturalHeight) > 0) {
        resolve(source);
        return;
      }
      reject(new Error(errorMessage));
    };

    image.onload = () => settle(true);
    image.onerror = () => settle(false);
    try {
      image.src = source;
    } catch {
      settle(false);
    }
  });
}

function hasMatchingImageSignature(dataUrl) {
  const match = String(dataUrl || '').match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i
  );
  if (!match || match[2].length % 4 !== 0 || typeof globalThis.atob !== 'function') {
    return false;
  }

  let binary;
  try {
    binary = globalThis.atob(match[2]);
  } catch {
    return false;
  }

  const mimeType = match[1].toLowerCase();
  if (mimeType === 'image/png') {
    return startsWithBytes(binary, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === 'image/jpeg') {
    return startsWithBytes(binary, [0xff, 0xd8, 0xff]);
  }
  return startsWithBytes(binary, [0x52, 0x49, 0x46, 0x46])
    && binary.length >= 12
    && binary.slice(8, 12) === 'WEBP';
}

function startsWithBytes(binary, bytes) {
  if (binary.length < bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => binary.charCodeAt(index) === byte);
}
