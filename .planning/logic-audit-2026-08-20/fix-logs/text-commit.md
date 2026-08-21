# text-commit — fix log

Date: 2026-08-20
Allowlist: `src/utils/textEditCommit.js`, `tests/textEditCommit.test.mjs`.
Did not edit TextEditOverlay.jsx / PDFViewer.jsx.

## P1-28 — Clearing all text leaves an invisible ghost annotation

- Status: **closed**
- Files changed: `src/utils/textEditCommit.js` (`isBlankTextEdit`; `buildExistingTextCommitJSON` returns null on blank/whitespace, matching `buildNewTextCommitJSON`)
- Intended behavior confirmed: empty, whitespace-only, and callout-blank existing commits return `null`. A non-blank edit still commits and preserves id/scope.
- Break / adversarial attempts: `''`, `'   '`, `'\n'`, `null`, `'still here'`.
- Edges covered: callout `isCallout: true` uses the same blank rule (no special ghost box).
- Test command + result: `node --test tests/textEditCommit.test.mjs` → pass
- Remaining risk: `TextEditOverlay` already treats a null existing-text commit as **cancel** (`onEditCancel`), not delete. The ghost cannot persist, but the previous text is restored instead of the annotation being removed. A follow-up in the overlay should filter the object out when `!isNewText && json == null`.
