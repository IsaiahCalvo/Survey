# Branch Audit — Survey BetaSafeS2

**Date:** 2026-05-28
**Prepared for:** the project owner
**Scope:** every feature, fix, and documentation branch, with a focus on whether any work was abandoned or lost.
**Posture:** investigate-and-report only. Nothing in this audit changes a single line of code or a single branch. No action has been taken. The recommendations below are for *later*, when you decide to act.

---

## Plain-English summary

**Nothing is lost. Every branch worth caring about is pushed to the cloud (origin), so the work is safe and recoverable.** I checked each branch against the live repository, and the commits are all still there. The worst case for any branch is a bit of careful re-merging — not data loss.

The single most important thing to understand is the difference between two phrases that sound the same but mean very different things:

- **"Not merged"** = the work exists as commits on a branch, but those commits have not been folded into the `main` line yet. The work is 100% safe; it just lives on a side branch.
- **"Missing from the app"** = the *feature* is not visible when you run the app, because the branch that adds it was never merged into `main`. The code exists; the user-facing capability does not (yet).

Most of what looks "missing" is the second kind: the work is safely parked on a branch, it simply hasn't been brought into the running app.

### The one big prize

The headline is **`codex/reorder-ux-and-app-split`** — this is where your **drag-and-drop reorder feature** actually lives. It lets you grab a row by a little grip handle and physically drag it to a new spot, across several parts of the app at once: the Survey **Spaces** list, the **Bookmarks** tree, **Projects** and their files, and **template** modules/categories/entities/checklist items. All of it rides on one polished drag engine (smooth release, no flicker, rows that move under your finger). Right now the live app can only drag the document tabs — none of the rest of this is in the app. It is safely on the branch and recoverable. (See the next section for exactly how to bring it back.)

### Two scary-sounding branches that are already safe

Two branches have alarming names but are **already fully in `main` — nothing to do, nothing missing**:

- **`origin/windows-work`** — sounds like a whole platform's worth of work sitting outside the app. It isn't. I verified it is a *direct ancestor* of `main` (0 commits ahead, and `main` was literally built on top of it). 100% contained. Safe to ignore or delete.
- **`origin/fix/checklist-item-delete-orphan-cleanup`** — sounds like an unshipped data-safety fix. In fact `main` already has a *better* version of it (it archives in-use checklist items instead of deleting their answers). I confirmed `main`'s code contains every function this branch has, plus more. Fully superseded.

So: one big prize to recover carefully, a handful of small genuine fixes to pick up, a stack of useful planning docs, and a few stale branches you can let go.

---

## What must come back (high value, genuinely missing)

Ranked by value. These are the branches with real, working capability that the live app does not currently have.

### 1. `codex/reorder-ux-and-app-split` — the drag-and-drop reorder feature (TOP PRIORITY)

**What it is:** the whole drag-to-reorder experience described above, built on a shared, polished drag engine. It also did a large behind-the-scenes cleanup of the giant `App.jsx` file (sliced ~2,230 lines out into smaller modules) and carries a few standalone fixes.

**Why it's first:** it is the most valuable missing capability, it spans many surfaces at once, and the feature itself sits almost entirely in files your current work never touches — so the *feature* can come back relatively cleanly.

**Integration strategy (recommended — recover the feature, defer the cleanup):**

- **Bring the drag feature back first, on its own.** It lives almost entirely in files the current annotation branch never edits: `src/reorder/*`, `src/sidebar/SpacesPanel.jsx`, `src/sidebar/BookmarksPanel.jsx` (plus its draggable helpers and `bookmarkReorderUtils.js`), `src/home/ProjectsFolderTree.jsx`, `src/home/TemplatesEditor.jsx`, `src/home/TemplateReorderRows.jsx` (+ `templateReorderUtils.js`), `src/TabBar.jsx`, and the new tests. I confirmed the annotation branch makes **zero** edits to any of these — so these can land with **no conflict**. Only the small `App.jsx` wiring hooks (the `onReorderSpaces` handler, the template/entity reorder callbacks) need to be pulled in by hand.
- **Treat the `App.jsx` cleanup half as input to the larger refactor you already planned (Track-2), not as something to merge now.** Those extraction commits collide head-on with your current annotation work (see the honest warning below). Land them only *after* the annotation work is committed and stable, replaying them on top.
- **Take the planning docs from this branch wholesale** (zero runtime risk) — they double as the roadmap for the deferred cleanup.
- **Review the stroke-scaling fix (`c108347f`) by hand** before applying — it edits the same PDF stroke/zoom subsystem your annotation work touches, and an automatic merge will *not* reliably warn you if the two disagree (see below).

**The honest conflict warning vs the current working branch:**

The two branches move `App.jsx` in **opposite directions**, and I verified this against the live repo:
- The reorder branch *shrinks* `App.jsx` by extraction: **+822 / −2,230 lines**.
- Your current annotation branch *grows* `App.jsx` with new toolbar/selection code: **+3,019 / −299 lines**.

A true 3-way merge of `App.jsx` produces **38 separate conflict spots** (verified). That is a multi-hour, error-prone reconciliation if attempted as one big merge — which is exactly why the recommendation is to **recover the feature now and defer the `App.jsx` cleanup** rather than doing a plain whole-branch merge.

There is also a quieter risk: `src/utils/svgAnnotationRenderers.jsx`. Both branches independently rewrite stroke-scaling behavior. Even where the automatic tools report few or no conflicts, a clean-looking merge here can produce code that *compiles but renders strokes wrong*. This file needs human eyes regardless of what the tooling says.

**Good news that bounds the risk:** the conflict is *high in effort but narrow in surface*. None of the files that carry the actual drag-and-drop feature are touched by your current work. The pain is concentrated in `App.jsx` (the cleanup half) and one stroke-rendering file — not the feature itself.

### 2. `origin/isaiahcalvo123/kal-24-fix-document-open-hydrate…catch-up-race` — collaboration visibility fix (high importance, merge)

**What it is:** a real bug fix. When one person opened a document, Survey Markers another person created during the brief loading window would silently fail to appear until a manual refresh (the "Mac marks invisible on Windows until refresh" report). After this fix, once the live-sync connection is up the app automatically re-checks the cloud and pulls in anything it missed — collaborators see each other's markers without refreshing.

**Why high:** it fixes a confirmed collaboration data-visibility bug, it's small and carefully scoped (insert-only, won't stomp local edits), and it ships with a regression test. I verified `main` has **not** re-implemented this any other way (the key `onSubscribed` hook is absent from `main`'s sync service — count 0).

**Recommendation:** **merge the whole branch.** Conflict risk is low; the addition is additive and doesn't overlap the areas `main` has churned. A bundled second commit also corrects stale comments that still wrongly say cloud sync is paid-only (it's now available to all signed-in tiers).

---

## Nice-to-have (smaller missing fixes)

Genuine but smaller fixes. Worth picking up when convenient; none block anything.

### `origin/isaiahcalvo123/kal-23-add-inline-loading-and-error-states…` — UX polish (medium, cherry-pick)
Replaces the last few jarring system pop-up boxes ("Please sign in to upload", "Please enter a project name") with the app's modern in-page banner, matching a pattern `main` already uses everywhere else. Verified those exact pop-ups still exist in `main`. **Cherry-pick the code change; drop the two screenshot PNGs and the dev-only test hook** so they don't clutter the repo.

### `origin/isaiahcalvo123/kal-27-fix-save-log-duplicate-github-pushes…` — diagnostics fix (medium, cherry-pick)
Fixes a bug where one Save Log action could upload the same diagnostic log to GitHub twice (countdown firing at the same moment you press Submit, or a double keypress). Adds an "already sending" guard. Real fix, but only in a developer-facing diagnostics tool, so medium-low value. **Cherry-pick the focused commit; skip the unrelated planning doc it carries.**

### `origin/isaiahcalvo123/kal-20-verify-unsupported-pdf-annotation-warning…` — test coverage only (low, cherry-pick the test)
This was a *verification* task, not a feature — it confirms an already-shipped warning behaves correctly. It changed no app behavior. The one durable thing worth keeping is the **regression test** (and its two small sample PDFs) proving the warning fires for unsupported annotations while still importing supported ones. **Cherry-pick just the test + fixtures; leave the screenshots, harness, and throwaway scripts on the branch as evidence.**

---

## Docs & already-safe (archive or ignore)

### Planning & audit docs — pure documentation, zero risk, worth landing (merge)

These are net-new documentation files. None conflict with anything (the file paths don't exist on `main`). They are the analysis trail and roadmap for future work. Each is a clean `merge` with no risk.

| Branch | What it documents |
|---|---|
| `origin/isaiahcalvo123/kal-11-plan-safe-staged-split-of-oversized-appjsx` | The staged plan for safely splitting the giant `App.jsx` (still accurate — App.jsx is ~46.8k lines on main). This is the roadmap for the deferred reorder-branch cleanup. |
| `origin/isaiahcalvo123/kal-12-plan-utility-folder-organization…` | Plan to tidy the flat `utils/` folder into named subfolders (import-only, no behavior change). |
| `origin/isaiahcalvo123/kal-13-audit-duplicate-looking-pdf-pagetextlayer-components` | Audit proving 7 PDF component files are dead code. Verified all 7 still exist on `main` — the cleanup it unblocks is still actionable. |
| `origin/isaiahcalvo123/kal-14-investigate-vite-bundle-size…` | Bundle-size investigation. Verified still accurate (main still statically imports the heavy libs; no vendor split in vite config). |
| `origin/isaiahcalvo123/kal-15-map-end-to-end-survey-annotation-workflow…` | **The most strategically valuable doc** — the canonical end-to-end product spec tying tickets to real workflow steps and recording locked product decisions. (high) |
| `origin/isaiahcalvo123/kal-26-gate-cloud-sync-by-paid-plan-feature-flag` | Comment/copy cleanup correcting stale "Free = no cloud sync" wording. The only doc branch touching source (comment text only). Note it touches `App.jsx` near your current edits — apply when convenient; trivial to resolve. |

### Confirmed already in main — archive or ignore (nothing missing)

| Branch | Status |
|---|---|
| `origin/windows-work` | **Fully contained** in `main` (verified: 0 ahead, and it is a direct ancestor of `main`). Zero risk. Archive/delete. |
| `origin/fix/checklist-item-delete-orphan-cleanup` | **Superseded** by a better same-day commit on `main` (`11fa6f42`, archive-instead-of-delete). Verified main's code is a strict superset. Merging it would *regress* the feature. Archive. |
| `codex/search-survey-jump-fixes` (local only, no origin) | **Already in main** — its one commit is byte-for-byte identical to a commit on `main`, and `main` has 9 newer search fixes on top. Merging it would regress newer work. Safe to delete locally. |
| `origin/isaiahcalvo123/kal-53-fix-supabase…created_by-schema-drift…` | **Problem already solved in main** via the KAL-49 migration (later timestamp, same fix). Landing this has no net effect and risks a migration timestamp collision. Archive. |
| `origin/isaiahcalvo123/kal-40-convert-expanded-rail-controls…` | Genuinely absent, but **stale and high-conflict** — `main` has moved heavily in the exact areas it rewrites, and your current rail/survey work likely supersedes its design. Archive as a design reference; re-author fresh on current `main` if you still want this layout. |

> **Note on the many `worktree-agent-*` branches and other local-only branches:** the repo also contains ~30 `worktree-agent-*` scratch branches and several other local-only branches (e.g. `home-redesign`, `survey-marker-rename`, `kal-31-phases-cdef`, `test-all-fixes-2026-05-21`). These are agent/working scratch refs, not the deliverables this audit was scoped to. They were not individually analyzed here. None of them put anything at risk; they can be reviewed and pruned in a separate housekeeping pass.

---

## Full branch-by-branch table

| Branch | What it is | Missing from app? | Importance | Conflict risk | Recommendation |
|---|---|---|---|---|---|
| `codex/reorder-ux-and-app-split` | Drag-and-drop reorder feature + App.jsx cleanup + standalone fixes | Yes (feature) | **High** | **High** (App.jsx 38 spots; feature files 0) | **Recover feature now (cherry-pick), defer cleanup** |
| `…/kal-24-fix…hydrate-catch-up-race` | Collaboration marker-visibility fix | Yes | **High** | Low | **Merge (whole branch)** |
| `…/kal-23-add-inline-loading-error-states` | Pop-up → in-page banner polish | Yes | Medium | Low | Cherry-pick code; drop PNGs/test hook |
| `…/kal-27-fix-save-log-duplicate-pushes` | One-action-one-upload guard (diagnostics) | Yes | Medium | Low | Cherry-pick commit; skip planning doc |
| `…/kal-20-verify-unsupported-annotation-warning` | Verification + regression test (no behavior change) | Yes (test only) | Low | Low | Cherry-pick test + fixtures only |
| `…/kal-15-map-end-to-end-survey-workflow` | Canonical product spec doc | Yes | **High** | Low | Merge |
| `…/kal-11-plan-app-split` | App.jsx split plan (doc) | Yes | Medium | Low | Merge |
| `…/kal-12-plan-utility-folder` | utils/ reorg plan (doc) | Yes | Medium | Low | Merge |
| `…/kal-13-audit-duplicate-components` | Dead-code audit (doc) | Yes | Medium | Low | Merge |
| `…/kal-14-investigate-bundle-size` | Bundle audit (doc) | Yes | Medium | Low | Merge |
| `…/kal-26-gate-cloud-sync-by-plan` | Stale-comment cleanup (source, comments only) | Yes | Medium | Low | Merge (apply when convenient) |
| `…/kal-40-convert-rail-to-labeled-tabs` | Right-rail IA redesign | Yes | Low | **High** (stale) | Archive (re-author fresh if wanted) |
| `…/kal-53-fix-supabase-created_by-drift` | DB migration repair | No (fix already in main) | Low | Medium (timestamp clash) | Archive |
| `origin/fix/checklist-item-delete-orphan-cleanup` | Checklist orphan cleanup | No (superseded by main) | Low | High | Archive |
| `origin/windows-work` | Old work branch | No (ancestor of main) | Low | Low | Archive/ignore |
| `codex/search-survey-jump-fixes` (local only) | Search/jump fix | No (already in main, +9 newer) | Low | High | Archive/delete local |

---

## Recommended order of operations

This is the order to integrate things *when you decide to act* — nothing here should be executed yet.

1. **First, settle your current uncommitted work.** Your working tree right now has live changes (notably `src/App.jsx`, plus `package.json`, `vite.config.js`, deletions under `audit/kal-54/`, and a couple of dead component files). Commit or stash that — your call — so any later recovery starts from a clean tree. Do this before touching any other branch.

2. **Recover the drag-and-drop feature from `codex/reorder-ux-and-app-split` — cherry-pick the feature files only.** The reorder, Spaces, Bookmarks, Projects, and Templates files are untouched by your current work and land with zero conflict. Pull the small `App.jsx` reorder wirings in by hand. This gets your most valuable missing feature back fast, with the conflict surface kept tiny.

3. **Then merge `kal-24` (the collaboration marker fix).** Small, additive, conflict-free, ships with a test, and fixes a confirmed bug — high value for near-zero effort.

4. **Then pick up the nice-to-have fixes** (`kal-23`, `kal-27`, the `kal-20` test) and **land the doc branches** (`kal-11`–`kal-15`, `kal-26`). All low-risk, can be batched.

5. **Crucial sequencing point — handle the `App.jsx` cleanup LAST, and as one coordinated effort with your refactor plan, not in parallel.** The reorder branch already executed roughly the first six `App.jsx` extractions that your planned Track-2 decomposition wants to do. If Track-2 proceeds independently, it will **re-do or collide with the same extractions this branch already shipped**. So: finish and stabilize your current annotation work in `App.jsx` first, *then* replay the reorder branch's extractions on top of it, using the `kal-11` plan and the reorder branch's own extraction-queue docs as the single roadmap. Reconcile the reorder cleanup against the current annotation work **before** any further `App.jsx` splitting — that is how you avoid redoing or fighting the extraction work the reorder branch already did.

6. **Review the stroke-scaling fix (`c108347f`) by hand** against your annotation branch's stroke-rendering changes before applying it — the tooling will not reliably warn you if the two disagree.

7. **Archive/ignore the already-safe and stale branches** (`windows-work`, `fix/checklist…`, `search-survey-jump-fixes`, `kal-53`, `kal-40`) once you're satisfied nothing is missing from them. This is housekeeping, not recovery.

---

*This audit changed nothing. All findings above were verified read-only against the live repository on 2026-05-28.*
