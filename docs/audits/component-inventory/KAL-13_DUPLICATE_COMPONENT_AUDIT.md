# KAL-13 — Duplicate-looking PDF page / text / layer component audit

_Run: 2026-05-19. Branch: `isaiahcalvo123/kal-13-audit-duplicate-looking-pdf-pagetextlayer-components`._

This is an audit deliverable. No deletions or merges are made in this branch. Each row below records the file's size, who imports it today, what it does, and a recommendation. Anything marked DELETE-CANDIDATE is proven unused by static grep; the actual deletion should land as a narrow follow-up issue with a green build + test run as evidence.

---

## Method

For each candidate file:
1. Confirm the file exists and capture line count.
2. Grep `src/` and `tests/` for `from '…/<name>'`, `import <name>`, named imports, and `import('…/<name>')` (dynamic).
3. Inspect the file's top-level export to understand its actual responsibility.
4. Classify as KEEP, DELETE-CANDIDATE, NEEDS-DECISION, or DEDUPED.

The grep used to find dynamic/lazy references covered `import(`, `React.lazy(`, and named imports — zero dynamic/lazy references exist for any of the candidate names.

---

## Inventory and verdicts

| File | Lines | Imported by | Verdict | Why |
|------|------:|-------------|---------|-----|
| `src/PageAnnotationLayer.jsx` | 10,092 | `src/App.jsx` (production) | **KEEP** | The real per-page Fabric overlay. Always-Protected per `CLAUDE.md`. |
| `src/components/PageAnnotationLayer.jsx` | 41 | `src/components/PDFPageItem.jsx` only — and `PDFPageItem` itself is unused | **DELETE-CANDIDATE** | A small region-polygon renderer that shares a name with the production layer. Not in the live tree. |
| `src/TextLayer.jsx` | 192 | `src/App.jsx` (production) | **KEEP** | The production text layer wired into the live viewer. |
| `src/components/TextLayer.jsx` | 67 | `src/components/PDFPageItem.jsx` only — `PDFPageItem` is unused | **DELETE-CANDIDATE** | A simpler text-layer variant. Not in the live tree. |
| `src/components/PDFPageCanvas.jsx` | 260 | `src/App.jsx` (production) and `src/components/PDFPageItem.jsx` (unused) | **KEEP** | Still used directly by App; only the secondary import via the unused `PDFPageItem` would go away. |
| `src/components/OptimizedPDFPage.jsx` | 135 | nobody | **DELETE-CANDIDATE** | Zero imports. |
| `src/components/OptimizedPDFPageCanvas.jsx` | 276 | nobody | **DELETE-CANDIDATE** | Zero imports. |
| `src/components/PDFPageItem.jsx` | 67 | nobody | **DELETE-CANDIDATE** | Zero imports. The root of the dead subtree — deleting this unblocks the two duplicate-name deletions above without losing anything live. |
| `src/components/PDFPageList.jsx` | 70 | nobody | **DELETE-CANDIDATE** | Zero imports. |
| `src/components/PDFPageTiles.jsx` | 141 | nobody | **DELETE-CANDIDATE** | Zero imports. |
| `src/components/SVGAnnotationLayer.jsx` | 5,227 | `src/App.jsx` (production) | **KEEP** | The SVG annotation layer; Always-Protected. The `useSVGInteraction` hook and one test file mention it but don't import the component. |
| `src/components/LightweightAnnotationOverlay.jsx` | 613 | `src/App.jsx` (production) | **KEEP** | Live overlay path. |
| `src/components/SearchHighlightLayer.jsx` | 330 | `src/App.jsx` (production) | **KEEP** | Live search highlight overlay. |

---

## What is actually duplicated (and what isn't)

Two pairs of files share a name with a production component:

- `src/PageAnnotationLayer.jsx` (live, 10k lines) vs `src/components/PageAnnotationLayer.jsx` (dead, 41-line region renderer)
- `src/TextLayer.jsx` (live, 192 lines) vs `src/components/TextLayer.jsx` (dead, 67-line pdf.js wrapper)

These are **NOT** rendering-equivalent. The live versions are the real components; the `components/` copies look like an earlier prototype that was kept around when the live versions migrated to the root path. They are unused today (only `PDFPageItem.jsx` imports them, and `PDFPageItem` itself has zero callers).

The other "duplicate-looking" files (`OptimizedPDFPage`, `OptimizedPDFPageCanvas`, `PDFPageItem`, `PDFPageList`, `PDFPageTiles`) all have zero imports anywhere in `src/` or `tests/`. They look like an older PDF rendering architecture that was replaced by the current Syncfusion-based path; nothing in the live tree references them.

---

## Recommendation

Open a single small follow-up (suggested label: KAL-13a) to delete the seven DELETE-CANDIDATE files as one atomic commit:

- `src/components/PageAnnotationLayer.jsx`
- `src/components/TextLayer.jsx`
- `src/components/OptimizedPDFPage.jsx`
- `src/components/OptimizedPDFPageCanvas.jsx`
- `src/components/PDFPageItem.jsx`
- `src/components/PDFPageList.jsx`
- `src/components/PDFPageTiles.jsx`

Verification for that follow-up: `npm test` and `npm run build` both green; the live PDF viewer still renders pages, text selection works, annotations render, search highlights work, and thumbnails (if those are part of the live tree — none of the unused components touch thumbnails, but worth a manual smoke).

Total lines removed if deleted: 956. None are protected files per `CLAUDE.md`.

---

## Done definition

- Audit covers page, text-layer, annotation-layer, and overlay/rendering components listed in the issue ✓
- Every candidate has an import-count, runtime-use, and recommendation ✓
- No deletions or behavior changes in this branch ✓
- A single follow-up deletion issue is recommended ✓
