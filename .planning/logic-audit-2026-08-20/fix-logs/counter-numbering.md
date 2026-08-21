# counter-numbering — fix log

Date: 2026-08-20
Allowlist: `src/utils/counterNumbering.js`, matching tests.
Did not edit PDFViewer.jsx.

## P1-14 — Cross-page counter renumber never saves or syncs

- Status: **closed**
- Files changed: `src/utils/counterNumbering.js` (`renumberCounters`)
- Intended behavior confirmed: when pin #1 of a multi-page series is gone, remaining pins are renumbered 1, 2, … and **page 2’s bucket is a new object** (plus cloned counter objects). Unchanged pages (no counters, or already-correct numbers) keep the same bucket reference so the sync diff can skip them.
- Break / adversarial attempts: original page-2 objects are not mutated in place; `null` / `{}` / `objects: null` / sparse `null` entries do not throw; already-correct series is a no-op.
- Edges covered: cross-page series; non-counter sibling objects stay the same ref inside a replaced page; seriesStart mirrored from the earliest remaining pin.
- Test command + result: `node --test tests/counterNumberingPageRefs.test.mjs tests/counterRenumberSavePolicy.test.mjs` → pass
- Remaining risk: callers that ignore the return value still see replacements because the input map’s keys are updated. Live PDFViewer save/sync was not exercised this wave — only the page-ref contract the inventory named.
