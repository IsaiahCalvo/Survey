# Planning Archives

Things saved here are not active project state — they are kept for "just in case" recovery.

## 2026-01-13 Layer-Revamp stash

**What it was:** A git stash from a Layer-Revamp branch session, saved at 2026-01-13 23:04:08, that
sat unfinished in the working tree until Phase 29 (2026-04-28).

**What it was working on:** Layered visibility for survey highlights, region annotations, and
regular annotations on each PDF page. Two distinct fixes were in flight:

1. Per-page region overlay toggle for the visibility logic (control whether region-scoped
   survey annotations show based on the per-page region toggle in addition to active space).
2. Identity-based highlight matching when the ball-in-court color of a highlight changes
   (match by `moduleId + regionId` instead of bounds-only, so two highlights at the same spot
   don't conflate when one is a background and one is region-scoped).

**Why it was dropped (2026-04-28):** Investigation during Phase 29 close found that fix #1 had
already landed in the current code through later commits (region overlay toggle and survey-vs-
regular visibility were tested manually and behaving correctly). Fix #2 was a hypothetical bug
that the user could not reproduce — overlapping highlights with low opacity blended correctly
in manual testing. With nothing left to recover, the stash was dropped from the git stash list
and saved here in patch form for emergency recovery.

**Files in this archive:**
- `2026-01-13-layer-revamp-CODE-ONLY.patch` — the App.jsx and PageAnnotationLayer.jsx diff
  sections from the stash, with the ~190K-line debug log noise stripped out. This is the
  useful piece if you ever need to revisit what Layer-Revamp was doing.
- `2026-01-13-layer-revamp-stash.summary.txt` — the original stash file-stat summary line.

**To restore (only if a regression points back to this work):**

```bash
git apply .planning/archives/2026-01-13-layer-revamp-CODE-ONLY.patch
```

The patch was made against `src/App.jsx` and `src/PageAnnotationLayer.jsx` as they existed
in HEAD at commit 6e8d31c (the Layer-Revamp branch tip). If those files have moved or
diverged significantly, expect 3-way merge conflicts — read the patch carefully and apply
the relevant hunks by hand instead of `git apply`.

**Related entries:**
- `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-deferred-items.md` — phase-close
  review item for this stash.
- `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-RECONCILIATION.md` — phase-close
  review section #1.
