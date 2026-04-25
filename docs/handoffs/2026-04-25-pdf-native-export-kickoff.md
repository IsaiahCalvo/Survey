# HANDOFF — PDF-Native Annotation Export Milestone (start of work)

_Created 2026-04-25, end of planning session. Implementation begins next session._

## What this milestone does (one paragraph)

Today, when a user prints or downloads a PDF from this app, every page is rasterized one by one with annotations burned in as pixels. That path is slow on long documents and produces files that Adobe Acrobat treats as flat images instead of editable annotations. This milestone replaces the print/export/download path with a "bake on demand" pipeline: the original PDF bytes are read, annotations are pulled from the database, each annotation is converted into a real PDF annotation dictionary (with appearance streams where needed), and a fresh PDF blob is handed to the OS print dialog or download stream. The result is instant printing and Adobe-editable exports.

## What is NOT changing (cloud-first invariant)

The Supabase annotation database remains the **live source of truth** for every phase of this work, including GA. Today's edit pipeline (Fabric.js editing on the canvas, database persistence, SVG render layer, multi-device sync, sign-in flow, future real-time collaboration potential) is preserved end-to-end. The new code only runs at print/export/download time. A failed bake silently falls back to today's rasterized print path — no user data is ever at risk.

This was a deliberate reframe from an earlier draft of the plan that made the PDF the source of truth. That draft would have broken multi-device sign-in and blocked real-time collaboration. The reframe is captured in today's session moments file.

## The plan

The full executable plan with task-level detail for Phase A and acceptance criteria for every phase is at:

**`docs/superpowers/plans/2026-04-25-pdf-native-annotations.md`**

Read it in full before starting any work. The plan supersedes the earlier high-level plan at `.planning/research/PDF-NATIVE-ANNOTATIONS-PLAN.md` (that older file's architecture choice was rejected — keep it for historical context only).

## Where to start

Begin with Task A.1 in the plan: install the new `annotpdf` library and verify the build still passes. Each task in Phase A follows a strict TDD pattern: failing test → minimal implementation → passing test → commit. Phase A is foundations only — no user-visible change should be observable when the flag is OFF or ON at the end of Phase A.

## Phases at a glance

- **Phase A — Foundations.** Add the library, scaffold the feature flag, build coordinate-space helpers, scaffold the public API surface, reconcile.
- **Phase B — Type adapters.** One adapter per annotation type (highlight, ink, free text, square, circle, line, arrow, polygon, polyline, stamp, sticky note, text-markup variants).
- **Phase C — Custom shape adapters.** Counter chains and knee-handle callouts.
- **Phase D — Bake pipeline.** The pure function that ties the adapters together and produces a PDF blob.
- **Phase E — Print pipeline.** Replace the per-page rasterization with the new instant blob-to-iframe path. Wire download and export to the same bake step. Re-enable the custom Print Panel on top.
- **Phase F — UAT + beta rollout.** Soak window, telemetry, iterate.
- **Phase G — Cleanup + GA.** Remove the feature flag. Today's edit/render/database paths remain canonical.

## Critical project rules to honor

The project's `CLAUDE.md` lists DO NOT CHANGE files (App.jsx, PageAnnotationLayer.jsx, the Fabric canvas trio, SVGAnnotationLayer.jsx, package.json, vite.config.js) and several enforced gotchas (zoomGeneration signal contract, container-aware canvas sizing, single-name fonts only). All of these stay in force throughout this milestone. The plan's per-phase DO NOT CHANGE lists narrow scope further.

The project also enforces the GSD phase discipline pattern: every phase context document needs Given/When/Then acceptance criteria and a DO NOT CHANGE allowlist, and every phase closes with a RECONCILIATION.md. The plan already contains both for Phase A; later phases land their detail when their predecessor reconciles.

## Reference test fixtures

- 99-page mixed-orientation PDF: `~/Desktop/Package 2 - Rev 4 -- IC.pdf` (primary print + bake target)
- Mixed Adobe + Drawboard saves PDF: `~/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf` (cross-viewer verification)

Open in the dev app at `http://localhost:5173/` (auto-login is configured).

## End-of-Phase-A acceptance recap

Under both flag states (ON and OFF), opening any test document and editing every annotation type behaves identically to today, multi-device sync still propagates within 1 second, and all new unit tests for the feature flag, coordinate helpers, and public API surface pass. No user-visible change. Then write the Phase A reconciliation document and update the roadmap.
