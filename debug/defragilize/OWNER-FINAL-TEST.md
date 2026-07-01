# Owner Final-Test Checklist — Engine Extraction

_The ONE hands-on pass. Everything below was extracted and committed autonomously and
passes the automated gate (build + node tests + full e2e). The items here are the few
behaviors automated tests genuinely cannot prove — mainly zoom **feel** (cursor-anchored
pinch/scroll smoothness), which synthetic wheel events can't drive (see memory:
"Playwright zoom limitation"). Walk through each; if one is wrong, revert the named commit._

How to run the app for this test: the dev server is already up at http://localhost:5186
(or start your own: `npx vite` from the worktree). Open any document from the dashboard.

---

## Items to verify by hand

### [ ] Survey Marker UI create → rename → delete (needs a survey template)
- Why hands-on: creating a Survey Marker through the UI requires a survey template
  (module + categories) applied to the document. No document in the test account has one,
  and creating a template is a heavy multi-step flow that can't be reliably auto-driven.
  The survey-marker DATA engine (serialize → save → reload mapper) IS auto-guarded by
  `agent-cli/survey-marker-roundtrip-e2e.mjs` (green); only the on-screen UI CRUD is hands-on.
- Steps: open a document that has a survey template applied → click Survey → pick a module →
  click a category (the pen turns into the Survey Marker tool) → drag on the page to drop a
  Survey Marker → rename it in the side panel → delete it.
- Good looks like: the marker appears on the page and in the side-panel list; the rename shows
  in both places; delete removes it from both; after close+reopen the surviving markers are intact.
- Guards extraction: B2 survey-marker CRUD handlers (commit named at B2 close).

_(zoom/overlay feel entries appended when B7 lands)_

<!-- TEMPLATE per item:
### [ ] <behavior name>
- Steps: <exact clicks/gestures>
- Good looks like: <observable result>
- Guards extraction: <which commit(s)>
- If wrong, revert: <commit sha>
-->

---

## Automated coverage summary (no hands-on needed — listed for confidence)
_(filled in at the end: which engines are behind which passing e2e/unit guards)_
