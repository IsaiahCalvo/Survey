# Master Open Items — v2 Rebuild (running list)

_Last updated: 2026-06-07. The single source of truth for "what's left." Keep current as items land._

The north star: ONE unified app. One save system, one renderer, one consistent way to
model every kind of mark. No needless special-cases scattered around the codebase. Some
genuine one-offs will remain — but only when the data truly differs, never by accident of
history.

---

## A. Unify everything to the fullest extent (cross-cutting principle)

Go through the codebase and find every place where something is treated specially/uniquely
without a real reason, and fold it back into the standard path. Reduce surface area; fewer
distinct mechanisms = fewer bugs, less complexity.

- **Callouts** (flagship example) — currently stored as their own separate document-level
  blob, NOT as ordinary annotations the way pen/shapes are. They should be regular
  annotations in the standard per-page annotation store and travel the same save / hydrate /
  undo / render path as everything else. (Annotation contract already flags the callout as
  the historical "odd one out"; this is its dedicated unification.)
- **Survey markers** — now on their own keyed store. Revisit whether they can share the
  standard annotation path or whether their extra fields (checklist answers, entity links)
  justify staying distinct. Likely a legitimate partial one-off, but confirm.
- **Two save brains / two collaboration docs** — the old hidden collaboration layer and the
  new engine are still two separate systems. Collapse to one (see section C).
- **Two render engines** — pdf.js (default) + Syncfusion (fallback) both bundled. Collapse to
  one (see section B).
- **TODO: full inventory.** Do a systematic sweep to list EVERY special-case (render paths,
  state shapes, save paths, localStorage caches, event handling, per-feature forks). Decide
  for each: unify or keep as a justified one-off. This audit comes first so we know scope.

---

## B. Performance & the renderer (match the demos)

- **Glued zoom / pan / scroll parity** — make the real app feel like the proven demo. Headline
  gap: marks must stay glued to the page DURING a live zoom gesture, not snap into place only
  after the gesture ends. Everything below rides this fix.
- **Clickable links** — currently broken on the new renderer.
- **Selectable / searchable text layer** — not present yet on the new renderer.
- **Form fields** — drift away from the page during a live zoom.
- **Bookmarks** — a redundant fallback timer double-loads the outline.
- **Physically remove Syncfusion** — the new renderer is the default, but Syncfusion is still
  bundled as a fallback. The changeover isn't done until it's gone.

## C. Persistence / database (one save system)

- **Excel sync redesign** (NEW) — stop the silent overwrite that eats un-exported Survey
  Markers on reload; replace timestamp-wins auto-import with a real compare-against-last-synced
  + merge prompt; never let a flat sheet delete a placed marker. DECISION NEEDED: Excel syncs
  checklist answers only, or also adds/removes markers?
- **Verify the Survey Marker move live** — blocked by the Excel fix (that's what eats new ones).
- **Undo / redo** — move onto the new engine (currently on the old separate collaboration doc).
- **Live cursors (presence)** — move onto the new engine.
- **Retire the old hidden collaboration layer** — after undo/redo moves.
- **Delete the leftover old save code + dead database tables** — the cleanup that makes the
  database actually "100% / professional," not just functional.
- **Later: live teammate / multi-device editing** — the second half of the rebuild; not started.

---

## Done (not open)

- Callouts and spaces moved onto the new save system (callouts still need the unification in
  section A — moved, but still modeled as a special blob).
- New renderer (pdf.js) is the default.
- Single-user durability rebuilt and proven against the real backend.
