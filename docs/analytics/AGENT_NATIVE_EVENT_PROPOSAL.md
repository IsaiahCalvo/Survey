# Agent-Native Analytics: Survey event proposal

Status: the standalone collector runs at `http://127.0.0.1:8095`, uses local
SQLite (`/Users/isaiahcalvo/Documents/Projects/Active/survey-analytics/data/app.db`),
and accepted a smoke event. **Survey is not wired to it. Approval is required
before adding transport code, env keys, or packages to Survey.**

## First event set

| Event | Proposed Survey boundary | Safe properties |
| --- | --- | --- |
| `app_session_started` | `src/main.jsx`, once after app boot/runtime detection | runtime, app version, authenticated boolean |
| `document_opened` | `src/AppShell.jsx` `handleDocumentSelect`, after tab/view selection | document ID hash, source, size bucket; never filename |
| `document_ready` | `src/PDFViewer.jsx`, beside existing `pdf_loaded` debug mark | page-count bucket, load duration, runtime |
| `annotation_tool_selected` | `src/PDFViewer.jsx` `setActiveToolLogged` | tool, prior tool, mobile/desktop, viewer gated boolean |
| `annotation_committed` | `src/PDFViewer.jsx` `handleSaveAnnotations`, only after a non-noop transition | tool/source, page bucket, created/changed/deleted counts |
| `annotation_sync_completed` / `annotation_sync_failed` | `src/hooks/useAnnotationCloudSync.js`, at final batch result | operation, count, duration bucket, normalized error class |
| `pdf_export_started` / `pdf_export_completed` / `pdf_export_failed` | `src/PDFViewer.jsx` `handleExportAnnotatedPDF` | runtime, annotation-count bucket, duration, normalized failure |
| `excel_sync_completed` / `excel_sync_failed` | existing Excel completion/failure branches in `src/PDFViewer.jsx` | direction, row-count bucket, duration, normalized failure |
| `app_error_boundary` | `src/components/ErrorBoundary.jsx` `componentDidCatch` | release, route/surface, normalized error name/fingerprint |

Start with completion/failure and adoption events. Do not emit pointer moves,
zoom frames, every object modification, raw console logs, or high-volume canvas
events into product analytics; those belong in opt-in debugging captures.

## Privacy and identity contract

- Never send PDF bytes/text, annotation text, filenames/paths, email addresses,
  access tokens, request bodies, or customer/project names.
- Use a stable pseudonymous user ID and random session ID. Hash document IDs
  before transport; do not use a hash of a filename.
- Prefer enums, booleans, counts, coarse buckets, and normalized error classes.
- Batch and retry without blocking Survey interactions. Collector failure must
  never break annotation, save, sync, or export flows.
- Keep localhost collection off by default in Survey development unless a
  developer explicitly enables it.

When approved, use the collector's `POST /api/analytics/track` contract and the
public write key from Analytics **Data Sources → First-party Analytics**. A small
Survey-owned transport module is preferable to adding the Analytics app as a
dependency.
