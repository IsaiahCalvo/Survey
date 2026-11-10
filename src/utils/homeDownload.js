// Download from Home (Nightly 'home-download', Drawboard PDF Pro trial audit
// 2026-11-09: Drawboard downloads from its file list; Survey could not). Marks
// live beside the PDF, not in it, so Home asks AppShell with this event to
// open the document and run the viewer's own "Export annotated PDF" once the
// document is in front, the same path as Download in the tab menu.
export const HOME_DOWNLOAD_EVENT = 'survey-home-download';

export function requestHomeDownload(documentId, win = typeof window !== 'undefined' ? window : null) {
  if (!win || documentId == null) return;
  win.dispatchEvent(new CustomEvent(HOME_DOWNLOAD_EVENT, { detail: { documentId: String(documentId) } }));
}
