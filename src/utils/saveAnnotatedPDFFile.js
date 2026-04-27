// UX 2026-04-27 (Phase 27 follow-up):
// Routes the "save a PDF copy with annotations baked in" download through the
// best save mechanism available, in this order:
//
//   1. Electron native Save As dialog (when the desktop bridge is present).
//      Always cancellable, returns the chosen file path.
//   2. Browser File System Access API (Chrome / Edge / Brave).
//      Always cancellable, returns the chosen file name.
//   3. Legacy <a download> click (Safari / Firefox / older browsers).
//      Not cancellable from JavaScript — the file just lands in the user's
//      default downloads folder. The caller surfaces this as
//      "auto-downloaded" so the success toast can phrase it accurately.
//
// Result shape (always the same regardless of path taken):
//   { canceled: boolean, filePath?: string, fileName?: string,
//     autoDownloaded?: boolean, error?: string }

import { savePDFWithAnnotationsPdfLib } from './pdfAnnotationsPdfLib';

export async function saveAnnotatedPDFFile({
  pdfFile,
  annotationsByPage,
  pageSizes,
  defaultName,
}) {
  let bytes;
  try {
    bytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      annotationsByPage,
      pageSizes,
      null,
      { returnBytes: true }
    );
  } catch (err) {
    return { canceled: false, error: err?.message || String(err) };
  }
  if (!bytes) {
    return { canceled: false, error: 'No PDF bytes generated' };
  }

  const suggestedName = defaultName || pdfFile?.name || 'annotated.pdf';

  // Path 1: Electron native dialog (works in app builds where there's no
  // local file path — e.g. PDF was opened from cloud storage)
  if (typeof window !== 'undefined' && window.electronAPI?.saveFile) {
    try {
      const result = await window.electronAPI.saveFile({
        title: 'Save Annotated PDF',
        defaultPath: suggestedName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        data: Array.from(new Uint8Array(bytes)),
      });
      if (result?.canceled) return { canceled: true };
      if (result?.error) return { canceled: false, error: result.error };
      return { canceled: false, filePath: result?.filePath };
    } catch (err) {
      return { canceled: false, error: err?.message || String(err) };
    }
  }

  // Path 2: File System Access API (Chrome / Edge / Brave). The picker is
  // a real OS-native Save As dialog and gives us proper cancellation.
  if (
    typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function'
  ) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'PDF Files',
            accept: { 'application/pdf': ['.pdf'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return { canceled: false, fileName: handle.name };
    } catch (err) {
      // User cancelled the picker — surface as canceled, not an error
      if (err?.name === 'AbortError') return { canceled: true };
      return { canceled: false, error: err?.message || String(err) };
    }
  }

  // Path 3: Legacy download link. Safari / Firefox have no programmatic
  // picker, so the file goes to the user's default downloads folder.
  // We can't detect cancellation here, so the caller treats this as
  // an automatic download and phrases the toast accordingly.
  try {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { canceled: false, fileName: suggestedName, autoDownloaded: true };
  } catch (err) {
    return { canceled: false, error: err?.message || String(err) };
  }
}
