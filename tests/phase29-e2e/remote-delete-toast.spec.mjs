import { test, expect } from '@playwright/test';

// Phase 29 e2e scaffold — Plan 29-01 Wave 0
// Maps to: UI-SPEC §1 toast contract (annotation_remote_deleted)
// 29-CONTEXT.md acceptance criterion:
//   "Given a remote collaborator deletes annotation X while the local user is
//    interacting with X, when the deletion arrives, then a sticky 'Removed by
//    [name] — Restore?' toast surfaces with the user's name + a Restore action."
//
// Five interaction states that MUST trigger the toast:
//   (a) selected, (b) dragging, (c) scaling, (d) edit-canvas open, (e) right-click menu open
// One state that must NOT trigger the toast:
//   (f) NOT-interacting (silent re-render via SVGAnnotationLayer)
//
// Unfixme target: Plan 29-06 (toast wiring + interaction-state detection)

test.fixme('remote deletion during local interaction surfaces sticky Restore? toast', async ({ page }) => {
  // TODO: Plan 29-06 implements this scenario
  // Sub-scenarios — each spawns the toast:
  // (a) Local user has annoX SELECTED; remote deletes annoX → "Removed by [name] — Restore?" toast
  // (b) Local user is DRAGGING annoX; remote deletes → toast (drag also auto-cancels)
  // (c) Local user is SCALING annoX (handle drag); remote deletes → toast
  // (d) Local user has annoX EDIT-CANVAS open; remote deletes → toast (edit canvas closes)
  // (e) Local user has RIGHT-CLICK menu open on annoX; remote deletes → toast (menu closes)
  // (f) Local user is NOT interacting with annoX; remote deletes → NO toast (silent re-render)
  //
  // Each sub-scenario asserts:
  //   - toast renders with text "Removed by " + collaborator name
  //   - toast contains a "Restore" inline action link (per UI-SPEC §1)
  //   - toast 4px left border stripe is var(--accent-red) #DC3545
  //   - clicking Restore re-creates the annotation with original meta
  //   - clicking Dismiss removes the toast without re-creating
  //   - toast is sticky (does not auto-dismiss)
  // Expected: per UI-SPEC §1 the toast extends StorageFailureBanner with the
  // 'annotation_remote_deleted' code variant.
});
