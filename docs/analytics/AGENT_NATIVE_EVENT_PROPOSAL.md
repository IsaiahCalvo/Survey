# Agent-Native Analytics: Survey event proposal

Status: Survey is wired through its existing Vercel function at
`/api/analytics/track` to Builder's hosted Agent Native collector. Local,
Tailscale, Capacitor, and Expo shells use the same production proxy; the write
key remains server-only. The retired Netlify collector and second Supabase
project are not used.

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
- Delivery never blocks Survey interactions. Collector failure is exposed as a
  bounded diagnostic status and never breaks annotation, save, sync, or export.
- Do not retry analytics automatically: that avoids retry storms and surprise
  usage. The browser is capped at 30 events/minute and 300/session; the proxy is
  capped at 60 requests/minute/IP. Session replay remains disabled.
- Local and Tailscale collection routes through the production proxy so Expo
  testing is observable without running another collector or exposing a key.

The collector's public write key lives only in Vercel as
`AGENT_NATIVE_ANALYTICS_PUBLIC_KEY`. Never add it to `VITE_*`, `EXPO_PUBLIC_*`,
the mobile bundle, logs, tests, or client-side storage.
