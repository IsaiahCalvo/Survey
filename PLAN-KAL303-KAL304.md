# PLAN — KAL-303 + KAL-304: RevisionsPanel bug fixes (one slice, two commits)
_Round 2 — Codex r1 (3 findings) incorporated._

Both bugs were found and fail-closed-gated by the KAL-74 harness (68c7180c). Fixes are
small, same file (src/components/revisions/RevisionsPanel.jsx — NOT a protected file),
and share one verification story: the harness's KNOWN-BUG ledger flips to hard PASS
asserts when the bugs are gone (KNOWN_BUG_ALLOWLIST labels stop firing). Expected
post-fix harness outcome: 0 KNOWN-BUG entries, all alignment/banner gates hard-green.

## KAL-304 — embedded read-only view: no banner, no exit (smaller; commit 1)

Verified mechanics: `if (embedded) return panel;` (RevisionsPanel.jsx:955) returns
before the read-only banner + Return-to-current JSX (:984–1024). PDFSidebar mounts the
panel embedded — the only post-lift entry point. The banner is `position:fixed` top
overlay, so it renders correctly regardless of mount point.

Fix: hoist the banner JSX into a `readOnlyBanner` variable (verbatim move, zero style
changes) and render it from BOTH branches:
- embedded: `return <>{readOnlyBanner}{panel}</>;`
- standalone: unchanged behavior (`{readOnlyBanner}` replaces the inline block).

Out of scope: any banner redesign; the standalone launcher; the conditional-hook hazard
at :648 (observation #3 — separate concern, not touched).

## KAL-303 — spotlight glow pixel-viewBox misalignment (commit 2)

Verified mechanics: `resolveSpotlightHost(pageElement)` (:302–318) finds the annotation
SVG only via `pageElement.querySelector('svg[data-svg-annotation-layer]')`. The overlay
tree is portalled OUTSIDE `.e-pv-page-div` (proven by diag-kal74-glow.mjs and the
KAL-75 paste bug), so the lookup always misses → hostElement = page div, no native
viewBox → spotlight viewBox minted from PIXEL rect while glow path coords are PAGE
units. SVGAnnotationLayer renders `data-svg-annotation-layer={pageNumber}` (the page
number IS the attribute value, SVGAnnotationLayer.jsx:4170) — same keying that
FabricEraserCanvas.jsx:526 and AnnotationPropertiesPanel.jsx:54 already use for
cross-tree lookups.

Fix (the established sibling pattern):
1. `resolveSpotlightHost(pageElement, pageNumber = null)` — after the descendant
   lookup misses and a finite pageNumber is provided, resolve in tightening order
   (Codex r1 #2 — multiple mount sites can carry same-page layers):
   a. `[data-diag-svg-wrapper="${pageNumber}"] svg[data-svg-annotation-layer="${pageNumber}"]`
   b. `svg[data-svg-annotation-layer="${pageNumber}"]`
   each candidate accepted only if `isConnected` AND nonzero getBoundingClientRect;
   page-div fallback retained last (pages with no annotation layer keep current
   behavior).
2. Callers pass the page number: `createPageSpotlightSvg(pageElement, pageNumber)`
   normalizes pageNumber BEFORE resolving (currently normalizes at :412, after the
   :390 resolve — reorder) and passes it; `syncSpotlightOverlay` passes
   `active.pageNumber` (already tracked).
3. DOM fallback path (Codex r1 #1 — `renderDomPathFallbackSpotlight`, :521–542):
   the target IS inside the portalled overlay, so BOTH its page resolution and its
   spotlight minting are broken/pixel-based today. Fix: derive pageNumber from the
   target's overlay ancestry — `target.closest('svg[data-svg-annotation-layer]')`
   attribute value, else `target.closest('[data-diag-svg-wrapper], [data-pal-root]')`
   attribute value — resolve pageElement via the existing findPageElement(pageNumber)
   when the current closest() misses, and call
   `createPageSpotlightSvg(pageElement, pageNumber)`.
4. No other behavior changes: rAF tracking, sizing-from-hostElement, removal paths
   untouched. When the scoped fallback hits, overlayParent becomes the annotation
   SVG's parent (the portalled overlay wrapper) — exactly where sibling overlays live.

Risk: none of the three e2e harnesses asserts the spotlight lives under the page div;
KAL-74's alignment gates assert the opposite (glow tracks the annotation). Zoom/scroll
tracking still works because syncSpotlightOverlay re-resolves every frame and copies
the host SVG's own left/top/width/height.

## Verification (both commits)

1. `node agent-cli/version-history-e2e.mjs` strict ×2 — expect 0 KNOWN-BUG; the 7
   alignment gates + banner gate flip to hard PASS (alignment |Δcenter| ≤ 3px at 100%,
   through scroll/zoom/pan; banner + return-to-current present in embedded mount,
   return-to-current exits read-only with state intact).
1b. NEW harness case S3b (Codex r1 #3, DOM-fallback coverage): seed one synthetic
   history row through the mock store with NO payload.previewAnnotation and
   annotation_id = a fixture rect id (kal75-fab-01) → click the row → spotlight
   renders via the DOM fallback path, aligned to that rect (same ≤3px center metric),
   wrapper-scoped host. Case gets its own write-expectation entry (the seeded row is
   store-side, zero new POSTs).
2. `node agent-cli/lock-document-e2e.mjs` + `node agent-cli/regress-idle-disappearance.mjs`
   green (no cross-harness disturbance).
3. `npx vite build` clean; `node scripts/run-node-tests.mjs` (baseline 1438/1432/0/6 —
   restate observed).
4. Codex result review until converged.

Scope dispositions (Codex r1 #3):
- Standalone non-embedded banner: RevisionsPanel is mounted ONLY by PDFSidebar:430
  (embedded) — the standalone launcher/drawer is unreachable in the live app. The
  banner hoist keeps standalone rendering identical by construction (verbatim JSX
  move used in both branches); no new assert. Recorded as code-inspection note.
- Multi-page spotlight probe: fixture doc is page_count 1; a real page-2 probe needs
  a new multi-page fixture + open/scroll machinery — disproportionate for this slice.
  Per-page keying is structural (attribute VALUE = page number; pattern already
  shipped in FabricEraserCanvas + AnnotationPropertiesPanel). Recorded as residual on
  KAL-303.

Commit order: KAL-304 first (independent, smaller), then KAL-303 (+ harness S3b with
it). Cap: 3/6 → 5/6.
