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

### [ ] Zoom FEEL sanity check (cursor-anchored smoothness)
- Why hands-on: synthetic wheel/pinch events can't drive the real cursor-zoom path, so zoom
  FEEL is the one behavior no automated test can prove (see memory: "Playwright zoom limitation").
  NOTE: this run made NO changes to any zoom code — the zoom/scale lifecycle and the
  container-sizing overlay loop were deliberately left untouched (they're protected correctness
  invariants). This is a belt-and-suspenders confirmation that the run's other changes didn't
  disturb zoom indirectly.
- Steps: open a document → pinch-zoom in and out on a trackpad → scroll around while zoomed →
  use the zoom-in / zoom-out buttons and the fit-page control → draw a shape, then zoom, and
  confirm the shape stays anchored to the page.
- Good looks like: zoom tracks the cursor smoothly with no lag, jump, or drift; annotations and
  survey markers stay locked to their page positions at every zoom level; no flicker or blank
  overlay during the zoom.
- Guards: no zoom code changed this run; if anything feels off, the whole engine-extraction run
  is the commit range from the sidebar-persistence extraction through the CSV-export extraction
  (revert that range to rule the run out).

---

## Automated coverage summary (no hands-on needed — listed for confidence)

Every extraction below was a VERBATIM move behind the green net; the full suite (build + node
tests + 14-test e2e) passed after each. Engines whose pure logic was already modular by prior
work were verified and left intact (moving their residual stateful/invariant-coupled wiring would
be an unsafe restructure, forbidden by the verbatim + invariant rules).

- Bookmarks / spaces — extracted the sidebar migration helper; guarded by the spaces CRUD e2e
  (create/rename/persist-across-reopen/delete) + the reorder unit test + a helper unit test.
- Survey markers — extracted the entity-color resolver; DATA path guarded by the survey-marker
  roundtrip e2e (write → read → map → rename → delete) + a resolver unit test. (UI create/rename/
  delete is the hands-on item above.)
- Undo / redo — extracted the key-guard; guarded by the undo/redo e2e (all four redo chords) + a
  guard unit test. Rest of the engine was already in dedicated modules.
- Save / export — extracted the space-CSV builder; save path guarded by the save-reopen roundtrip,
  re-upload survival, version-history revision checks, and the CSV builder unit test + source guard.
- Excel sync/import/export — already fully modular (four dedicated modules + unit tests); guarded
  by the Excel corruption + import-once e2e.
- Cloud realtime sync — already fully modular (dedicated hooks + collab library); guarded by the
  durable-sync roundtrip e2e.
- Overlay / zoom-scale lifecycle — pure zoom math already extracted; the rest is invariant-protected
  and left intact; guarded by render-smoke + zoom-while-locked + zoom-math unit tests + a source
  tripwire. Zoom FEEL is the hands-on item above.

Also verified green throughout: viewer renders real pixels, callouts (draw + interaction),
document lock contract, form-field persistence across reopen, sleep/wake recovery.
