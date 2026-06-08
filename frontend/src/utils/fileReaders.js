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
