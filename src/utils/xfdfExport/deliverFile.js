// Save a generated file the way the other exports do (KAL-393): the Electron
// Save As bridge on desktop, a Blob + anchor download in the browser build.

export async function deliverGeneratedFile({
  data,
  fileName,
  mimeType,
  title,
  filterName,
  extensions,
}) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.saveFile) {
    const result = await api.saveFile({
      title,
      defaultPath: fileName,
      filters: [{ name: filterName, extensions }],
      data: Array.from(bytes),
    });
    if (result?.canceled) return { canceled: true };
    if (result?.error) throw new Error(result.error);
    return { canceled: false, filePath: result?.filePath || fileName };
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { canceled: false, filePath: fileName };
}
