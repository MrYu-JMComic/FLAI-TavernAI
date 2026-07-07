export function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  try {
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}
