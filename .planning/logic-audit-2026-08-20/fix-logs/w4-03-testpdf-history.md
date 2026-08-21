# W4-03 — History on `?testPdf=` (local activity, not cloud)

- Date: 2026-08-21
- Status: **closed**
- ID: **E2E-W4-03** / A-07
- Worktree: `nifty-elion-773074`
- No commit

## Why a mock `file.id` would lie

`RevisionsPanel` + `listRevisions` / ownership select talk to Supabase. `PDFViewer` treats `pdfFile.id` as a cloud document (hydration, presence, sync). Stamping a fake cloud id on `?testPdf=` would either hit live Supabase or fail a remote fetch. That is not a passing History proof.

## What landed

DEV / `?testPdf=` only: the fixture File gets `__localHistoryDocumentId = dev-testpdf:<name>`. `file.id` stays unset.

`getHistoryDocumentId(pdfFile)` returns `file.id` when present, else the local key **only** when `isDevTestPdfRoute()` (`import.meta.env.DEV` + `?testPdf=`). Production guest / null-id still hides History (`{documentId && <HistoryButton>}`).

History services skip live Supabase when `!isSupabaseAvailable()` (already false on this route). Activity uses the existing localStorage store. Cloud Save/Restore stay owner-gated off. No fake named revisions.

## Files

- `src/DevTestRoute.jsx` — stamp `__localHistoryDocumentId`; still `tier: 'developer'`, `isAuthenticated: false`
- `src/supabaseClient.js` — export `isDevTestPdfRoute`; Node-safe `import.meta.env` guard
- `src/services/documentHistoryService.js` — `getHistoryDocumentId`; record/list skip remote when offline
- `src/services/documentRevisionService.js` — `listRevisions` → `[]` offline; create/get/restore throw without RPC
- `src/components/revisions/RevisionsPanel.jsx` — skip `documents` ownership select when offline
- `src/PDFViewer.jsx` — History record + left-rail `documentId` use `getHistoryDocumentId` (not a forged `file.id`)
- `tests/w403TestPdfHistory.test.mjs`
- `tests/documentHistoryService.test.mjs`
- `tests/eraserPresentation.test.mjs`

Did not enable History for production guest. Did not talk to live Supabase.

## Tests

```
node --test tests/w403TestPdfHistory.test.mjs tests/documentHistoryService.test.mjs tests/eraserPresentation.test.mjs
```

**58 pass / 0 fail.**

```
npm test
```

**exit 0** (full `scripts/run-node-tests.mjs`, including isolated suites). Baseline after touching `PDFViewer.jsx`.

## Live proof

Existing Vite `http://localhost:5173/` (`npm run dev:ui`, not killed). Playwright against `?testPdf=clickable-link-test.pdf`.

| Check | Result |
|---|---|
| Intended — History button | `[aria-label="Version history"]` present and visible |
| Edge — empty | Panel: "No history yet. Edit the document or save a named version to start the timeline." |
| Intended — after edit | Pen drag on `.survey-pdfjs-page-div` 20→21 annotations. Panel: "Dev Test User drew a pen stroke on page 1" + "made an edit on page 1" |
| Local key | `localStorage.survey_document_history_events_v1` → `dev-testpdf:clickable-link-test.pdf` (2 rows) |
| Break — no cloud History | 0 requests matching supabase / `kal48_` / `document_history_events`. Footer: "Only the document owner can save or restore versions." |
| Break — production guest | Sidebar still `{documentId && <HistoryButton>}`. Local key ignored unless DEV + `?testPdf=` |

## Remaining risk

- Named cloud revisions / Restore version are **not** exercised here and must not be claimed. They still need a real saved document.
- Delete-restore / jump-to-page on this fixture were not re-proven beyond the activity list appearing.
- `file.id` must stay unset on this route. If a later change stamps it, cloud hydration will run.
