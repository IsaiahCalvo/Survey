# Area 3 — Dashboard + upload + open · **FIXED + CHILD-FILED (KAL-55)**

## KAL-45 regression — Documents-tab Upload was a silent no-op

On `origin/main` the Documents-tab Upload button calls `handleUploadClick → fileInputRef.current?.click()`, but the `<input ref={fileInputRef}>` only lived inside `legacyHomeUI` (no longer rendered, only referenced via `void legacyHomeUI`). DOM probe (`scripts/playwright-probe-upload.mjs`) confirmed `fileInputs: []`. The KAL-45 fix branch (`isaiahcalvo123/kal-45-...`) already had this exact fix but **was never merged into main** — surfaced as the KAL-55 master merge-debt issue.

Inline carbon-copy of the KAL-45 fix landed in commit `3edd5e87`: mount `fileInputRef` + `projectFileInputRef` siblings of `<SurveyHub>`. Verified:

- `scripts/playwright-upload.mjs` → file chooser opens (`filechooser: true`)
- `normal-test.pdf` lands in viewer (`screenshots/upload-01-after-pdf-open.png` shows Audit Test page 1 rendered)
- New cloud upload row visible in Documents list (Pro user dashboard)

## KAL-21 / KAL-46 regression — corrupted PDF alerts + hangs

The corrupted PDF fixture (`artifacts/corrupted.pdf`, 41 bytes invalid PDF) triggers:

1. A native browser `alert("Error loading PDF: Invalid PDF structure.. Please try uploading the file again.")` (`logs/playwright-upload.json:alert`)
2. The viewer then hangs on "Loading PDF…" indefinitely (`screenshots/upload-02-corrupted-result.png`)

KAL-21 explicitly required: "no browser alert, clean in-app failure panel, retry + back-to-dashboard". The KAL-21 fix added a `pdfLoadError` state + retry token to App.jsx — `grep` against `origin/main` finds zero references to `pdfLoadError`, confirming the fix branch was never merged. KAL-46 (same-doc reopen reset) is in the same boat. Tracked under **KAL-55**.

## Same-document reopen

Could not exercise without KAL-46's `__rewrittenForParse` reset on main — would hit the same hang. Covered under KAL-55.
