# Official npm test after thirteen leftover 00fda232 drops — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**  
Did **not** replay the thirteen live specs, the prior 12, wave7, or leftover 18.  
Did **not** apply prod SQL. Did **not** read `.bot-credentials.json` / `.env*`.  
Did **not** loosen `crossing500.maxAllocatedBytes` **8448 MiB** or `INTERACTIVE_BUDGET` **75 / 250**.

## Official command

```
node scripts/run-node-tests.mjs
```

(`npm test` is the same script.)

| Run | Exit | What failed |
|---|---|---|
| First official (pre-contract fix) | **1** | **new** — `tests/accountSettingsLogic.test.mjs` still expected `isCapacitorMicrosoftConnectHidden()` inside `MSGraphContext` |
| Second official (after contract fix `b90cdae7`) | **1** | **cap leftover only** — `tests/partialEraserComplexity.test.mjs` `500 crossing cuts` **11961.28 MiB > 8448.00 MiB** |

## Fail list

| Kind | File / test | Detail | Action |
|---|---|---|---|
| **New (fixed)** | `tests/accountSettingsLogic.test.mjs` — P2-13: Capacitor hides Microsoft Connect/Reconnect | Stale source contract vs restored P2-13 `isMicrosoftConnectAvailable` / `shouldStartFullPageMicrosoftOAuth` | Min-diff: restore `00fda232` asserts. Re-ran file **15 / 15**. Pushed `b90cdae7`. |
| **Cap leftover (left)** | `tests/partialEraserComplexity.test.mjs:604` — 500 crossing cuts preserve every component inside bounded memory and release time | `total allocation 11961.28 MiB exceeded 8448.00 MiB` | **Left.** Same leftover as `fix-logs/eraser-memory-cap.md`. Cap unchanged. |
| Timing 75 / 250 | — | Held on this official run (crossing fail is allocation, after wall/CPU asserts) | **Not loosened.** |

No other official-suite fails. Main files **0 fail**. Isolated `annotationDocConcurrency` **103 / 103**. Isolated `partialEraseCurveLocality` **15 / 15**. Isolated `partialEraserComplexity` **9 / 10**. Runner stopped before `svgPathTransformFidelity` (first isolated fail).

## Extra fix

`tests/accountSettingsLogic.test.mjs` only:

```
-  assert.match(graph, /isCapacitorMicrosoftConnectHidden\(\)/);
+  assert.match(graph, /isMicrosoftConnectAvailable\(\)/);
+  assert.match(graph, /shouldStartFullPageMicrosoftOAuth\(\)/);
```

Product already correct from `84f21370`. High-risk files not edited. Invariants held: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Thirteen IDs — current restore + live/Node (not pre-restore snapshot)

| IDs | Restore | Live / Node receipt |
|---|---|---|
| P1-14 | `84f21370` | `fix-logs/e2e-00fda232-thirteen-live.md` Playwright cluster 1 |
| P1-01 / 03 / 04 | `84f21370` | same receipt, cluster 2 |
| P1-05 / 06 / 08 / 29 | `84f21370` | same receipt, cluster 3 |
| P2-13 | `84f21370` | same receipt, cluster 4 |
| P2-14 / 24 / 25 / 26 | `84f21370` | Node-only (same receipt cluster 5 + `fix-logs/diff-00fda232-leftover-drops.md` **55 / 55**) |

`COMPLETION-AUDIT.md` §1 proofs for those thirteen now cite the restore + live/Node receipts.

## Leftover 18 (unchanged — not retried)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Goal

Stays **open**.
