# Eraser timing budget — diagnose only (2026-08-21)

**Worktree:** `nifty-elion-773074`  
**Does not mark the audit goal complete.** No commit. Did not loosen `INTERACTIVE_BUDGET`. Did not touch the eraser engine. Did not retry the 18 host leftovers. Did not apply prod SQL.

## Verdict

**Host noise / flake, not a product or eraser-engine regression.**

`tests/partialEraserComplexity.test.mjs` times `erasePageAnnotations` in a bounded child (`debug/benchmarks/partial-eraser-complexity-child.mjs`). That path does **not** go through `FabricEraserCanvas.jsx`, `PageAnnotationLayer.jsx`, or `eraserPolicy.js`. Recent policy / Fabric preview / PAL skip work cannot move these numbers.

`src/utils/pageSpaceEraser.js` has **no working-tree diff** vs HEAD (last engine commit still `a881a658` normalize transformed polygon cuts).

Wall-clock `maxCommitMs` blew the 250 ms ceiling while CPU stayed far under budget — the process was descheduled, not doing more eraser work. Budget left as-is. Official `npm test` stays red on this host for this budget only.

## Thresholds (unchanged)

From `tests/partialEraserComplexity.test.mjs` `INTERACTIVE_BUDGET`:

| Guard | Ceiling |
|---|---|
| `p95CommitMs` | **75** |
| `maxCommitMs` | **250** |
| `p95CommitCpuMs` | 75 |
| `maxCommitCpuMs` | 500 |

Wall-clock asserts have no measured-value message (unlike memory). Numbers below are from the child JSON.

## Measurements

Host load this pass: **39.49 / 22.41 / 26.64** at first sample, then 19 → 15 as other work drained.

| Run | Scenario | p95 wall | max wall | p95 CPU | max CPU | vs 75 / 250 |
|---|---|---|---|---|---|---|
| Child 1 (load ~39) | shallow 500 | **49.64** | **534.21** | 47.11 | 80.21 | max **FAIL** (CPU fine) |
| Child 2 (load ~19) | crossing 500 | 20.40 | 62.14 | 25.55 | 35.81 | pass |
| Child 3 (load ~16) | shallow 500 | 35.29 | 125.64 | 37.63 | 75.51 | pass |

Child 1 is the leftover: `maxCommitMs` 534 > 250 while `maxCommitCpuMs` 80 ≪ 500. Same 500-commit geometry (`verts` 6538, `comp` 1). A 6–7× wall/CPU gap on one commit is scheduler delay, not a slower subtract.

Last worker official `npm test` **exit 1** on this file after the main suite (host already hot). Receipt: `fix-logs/completion-audit-current.md` (that folder was deleted mid-session by another worker; this file recreates `fix-logs/`).

## Isolated retries (this pass)

```
node --test tests/partialEraserComplexity.test.mjs
```

| Attempt | Exit | Result |
|---|---|---|
| 1 (after load 39) | **0** | 10 / 10 |
| 2 (load ~19) | **0** | 10 / 10 |
| 3 (load ~16) | **0** | 10 / 10 |

Isolated-alone can pass. Official `npm test` runs this file **after** the full main suite (`scripts/run-node-tests.mjs` isolated list). That is when wall `max` flakes. Did **not** re-run the official suite this pass (would likely flake; would not greenwash).

## What was not done

- No budget loosen (`p95CommitMs` / `maxCommitMs` still 75 / 250).
- No eraser-engine / Fabric / PAL edit.
- No KB-1 intended/break/edge re-run (no product fix).
- No official `node scripts/run-node-tests.mjs` this pass.
- 18 host leftovers unchanged (not retried): `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.
- `COMPLETION-AUDIT.md` was gone from disk when this note was written; the “official suite red on this host for this budget only” note lives here.

## Goal

Stays **open**. Honest leftover: official `npm test` **exit 1** on `partialEraserComplexity` wall-clock under host load.
