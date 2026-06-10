# Plan: BL-22 — Survey marker name prompt: category-derived default snaps back on delete
_Round 1 — revised after Codex review_

## Goal

Fix the user-reported bug: in survey mode (security template), after placing a Survey Marker the Name Prompt Modal prefills the category-derived default (e.g. "camera 1"), and deleting the text fails — "the original word comes back on every delete." The user cannot clear the field to type a custom name like "C-1". Investigation (3-agent fan-out + adversarial verification, 2026-06-10) confirmed the root cause with high confidence and refuted competing hypotheses (rail inline-rename remount, TemplatesEditor reload-from-props).

## Root cause (verified in code)

`src/PDFViewer.jsx` Name Prompt Modal (block starts ~32005):

- Line 6867: `const [surveyMarkerNameInput, setSurveyMarkerNameInput] = useState('');`
- Line 32240: `value={surveyMarkerNameInput || defaultName}` — controlled input with a **falsy** fallback.
- Line 32241: `onChange={(e) => setSurveyMarkerNameInput(e.target.value)}`
- `defaultName = generateDefaultSurveyMarkerName(categoryName, existingSurveyMarkers)` (line 32012), derived from `category.name` — e.g. "camera 1".

State starts as `''` and every close path resets it to `''` (12 setter sites). Because the render fallback keys on falsiness, the keystroke that empties the field sets state to `''` and the very next render evaluates `'' || defaultName` → React writes the full default back into the DOM. Select-all+Delete does the same. The word can only be replaced by overtyping a selection in a single input event — never deleted. Affects every category (the default is always category-derived), matching "likely all category titles."

## Approach

Null-sentinel pattern — `null` = "untouched, show the default"; any string (including `''`) = "user's text, show it verbatim":

1. **Extract one pure commit resolver** into a new leaf util `src/utils/surveyMarkerNamePrompt.js` (zero internal imports, so `node:test` can import it directly — verified: `viewerShared.js` fails direct Node import on its extensionless internal imports, Codex round 3):
   `export const resolveSurveyMarkerPromptName = (input, defaultName) => (input ?? defaultName).trim() || defaultName;`
   Imported by `PDFViewer.jsx`. Single point of truth for commit semantics, directly behavior-testable (Codex round-1 findings 3/6).
2. Line 6867: `useState('')` → `useState(null)`; comment documents the sentinel (`null` = untouched → show category default).
3. All 12 reset sites `setSurveyMarkerNameInput('')` → `setSurveyMarkerNameInput(null)` (lines 17809, 23998, 31771, 31829, 31881, 31960, 32055, 32219, 32281, 32321, 32460, 32594). Resets double as initialization for the next modal open, so they must be `null`, not `''`.
4. Line 32240: `value={surveyMarkerNameInput || defaultName}` → `value={surveyMarkerNameInput ?? defaultName}` (display keeps the trivial inline `??`; only commit logic is extracted).
5. Lines 32244 and 32477 (Enter / Save commit): `(surveyMarkerNameInput || defaultName).trim() || defaultName` → `resolveSurveyMarkerPromptName(surveyMarkerNameInput, defaultName)` (new import line in PDFViewer.jsx from `./utils/surveyMarkerNamePrompt`).
6. **Select the prefilled default on open** (Codex finding 2): on the modal input, add
   `onFocus={(e) => { if (surveyMarkerNameInput === null) e.target.select(); }}` — with `autoFocus` this selects the untouched default once at open, so typing "C-1" replaces "camera 1" in one stroke; it never re-selects after the user has edited (state is a string then). This directly serves the reported intent (rename-dialog convention) without changing any commit semantics.
7. **Clear stale input when a pending-name marker is deleted** (Codex finding 5, shape revised in round 2): the deletion path at line 23801 nulls `pendingSurveyMarkerName` via a functional updater without resetting the input; stale typed text would resurface on the next modal open. Keep that updater pure and untouched; add a separate guarded clear before it:
   ```js
   if (pendingSurveyMarkerName?.surveyMarker?.id === annotationId) {
     setSurveyMarkerNameInput(null);
   }
   setPendingSurveyMarkerName(prev => (
     prev?.surveyMarker?.id === annotationId ? null : prev
   ));
   ```
   `pendingSurveyMarkerName` joins the useCallback deps. The churn cost is negligible: the deps already include `surveyMarkers`, so this callback re-creates on every marker change today — adding modal open/close to that set changes nothing material. (Round-1 plan nested the setter inside the updater; Codex correctly flagged that as an impure-updater footgun — render-phase update warnings/restarts — and it is dropped.)
8. New test `tests/surveyMarkerNamePromptContract.test.mjs` — two layers:
   - **Behavior tests** on `resolveSurveyMarkerPromptName`: `(null, 'camera 1')` → `'camera 1'`; `('', 'camera 1')` → `'camera 1'`; `('   ', 'camera 1')` → `'camera 1'`; `('C-1', 'camera 1')` → `'C-1'`; `(' C-1 ', 'camera 1')` → `'C-1'`.
   - **Source-contract tripwires** (per `tests/excelStaleGuardContracts.test.mjs`), scoped and exact (Codex finding 4): slice the PDFViewer source to the Name Prompt Modal block (from the `{/* Name Prompt Modal` comment marker to the next modal block) and assert within it: exactly 1 occurrence of `value={surveyMarkerNameInput ?? defaultName}`, exactly 2 calls of `resolveSurveyMarkerPromptName(surveyMarkerNameInput, defaultName)`, the select-on-untouched `onFocus` guard present. Whole-file assertions: zero occurrences of `surveyMarkerNameInput || defaultName`, zero `setSurveyMarkerNameInput('')`, `useState(null)` on the declaration line, and the deletion-path guarded clear present (asserted as the guard expression `pendingSurveyMarkerName?.surveyMarker?.id === annotationId` followed by a `setSurveyMarkerNameInput(null)` — not any particular nesting shape).

Verification gates: `npx vite build` + `node scripts/run-node-tests.mjs` (baseline: 0 fail / 6 skipped).

## Key decisions & tradeoffs

- **Null sentinel over open-time initialization.** Alternative: seed state with `defaultName` when the modal opens. Rejected — `defaultName` is computed inside the render IIFE from `selectedTemplate`/`surveyMarkers`; seeding would require duplicating that derivation at each open call site or adding a new effect to the 34k-line high-risk file.
- **Empty commit still coerces to defaultName.** A marker with an empty name would break name-keyed flows (items map lookups, Excel sync match by name). The bug was about *visibility while editing*, not about allowing empty names.
- **Escape / overlay-click / X / Cancel keep their existing "save with default name" semantics**, even though they discard typed text. Changing cancel behavior is a product decision (queued separately), out of scope.
- **IME composition Enter guard (Codex finding 1) — REJECTED for this slice.** Enter-during-composition committing early is pre-existing behavior, orthogonal to the revert bug, and survey marker names here are short Latin identifiers; adding key-event semantics to the high-risk file expands the blast radius of a scoped bug fix. Logged as a follow-up candidate in the BL-22 issue file.
- **One extracted helper, not two.** The display expression (`input ?? defaultName`) is a single trivial use — extracting it adds indirection without test value; the commit resolver is used twice and carries the trim/fallback semantics, so it is the one worth extracting and behavior-testing.

## Risks / open questions

- `surveyMarkerNameInput` has exactly 4 readers (value, onChange, two commit lines) and 13 pre-existing setter sites (verified by grep; step 7 adds a 14th) — no other code can observe the `''`→`null` change.
- With `??`, after the user clears the field the input shows `''` and the placeholder ("Enter surveyMarker name") becomes visible — expected UX.
- `surveyMarkerNameInput ?? defaultName` never yields null/undefined (defaultName is always a non-empty string from `generateDefaultSurveyMarkerName`), so the input stays controlled at all times.
- `viewerShared.js` is untouched (resolver lives in the new leaf util); the only modified existing file is PDFViewer.jsx.

## Out of scope

- The rail inline-rename input's blur-time fallback (`SurveySpacesRail.jsx:1864`) — by-design empty→fallback on blur, not this bug.
- TemplatesEditor category-title reload-from-props data-loss (separate, event-driven bug; noted for backlog).
- Cancel-path semantics and IME-composition Enter handling — follow-up candidates, not this slice.
- Any broader refactor inside PDFViewer.jsx (high-risk file; minimum viable diff only).
