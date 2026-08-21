# Official npm test after twelve FIX-LOG stomps — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**  
Did **not** replay P1-12/38/53, the nine live specs, wave7, or leftover 18.  
Did **not** apply prod SQL. Did **not** read `.bot-credentials.json` / `.env*`.  
Did **not** loosen `crossing500.maxAllocatedBytes` **8448 MiB** or `INTERACTIVE_BUDGET` **75 / 250**.

## Official command

```
node scripts/run-node-tests.mjs
```

(`npm test` is the same script.)

| Run | Exit | What failed |
|---|---|---|
| First official (pre-contract fix) | **1** | **new** — `tests/kal31InviteContract.test.mjs` still expected pre-restore `manage: !!single && !!user?.id && single.user_id === user.id` |
| Second official (after contract fix `c897c79b`) | **1** | **cap leftover only** — `tests/partialEraserComplexity.test.mjs` `500 crossing cuts` **11960.45 MiB > 8448.00 MiB** |

## Fail list

| Kind | File / test | Detail | Action |
|---|---|---|---|
| **New (fixed)** | `tests/kal31InviteContract.test.mjs` — document owners always reach Manage Access from Share | Stale source contract vs restored P2-07 `userCanManageDocumentAccess` | Min-diff: restore `00fda232` asserts. Re-ran file **14 / 14** + `rolesTeamManageGate` **11 / 11**. Pushed `c897c79b`. |
| **Cap leftover (left)** | `tests/partialEraserComplexity.test.mjs:604` — 500 crossing cuts preserve every component inside bounded memory and release time | `total allocation 11960.45 MiB exceeded 8448.00 MiB` | **Left.** Same leftover as `fix-logs/eraser-memory-cap.md`. Cap unchanged. |
| Timing 75 / 250 | — | Held on this official run (crossing fail is allocation, after wall/CPU asserts) | **Not loosened.** |

No other official-suite fails. Main files **0 fail**. Isolated `annotationDocConcurrency` **103 / 103**. Isolated `partialEraseCurveLocality` **15 / 15**. Isolated `partialEraserComplexity` **9 / 10**. Runner stopped before `svgPathTransformFidelity` (first isolated fail).

## Extra fix

`tests/kal31InviteContract.test.mjs` only:

```
-  match(src, /manage:\s*!!single\s*&&\s*!!user\?\.id\s*&&\s*single\.user_id\s*===\s*user\.id/);
+  match(src, /userCanManageDocumentAccess\(single,\s*user/);
+  match(src, /userCanManageDocumentAccess\(single,\s*user,\s*res\?\.data\)/);
```

Product already correct from `22985061`. High-risk files not edited. Invariants held: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Twelve IDs — current restore + live (not pre-stomp snapshot)

| IDs | Restore | Live receipt |
|---|---|---|
| P1-12 / P1-38 / P1-53 | `8efdbb4e` | `fix-logs/e2e-p1-12-38-53-live.md` **3 / 3** |
| P1-02 / 42 / 43 / 54 / 44 / 47 / 55 + P2-06 / 07 | `22985061` | `fix-logs/e2e-stomp-nine-live.md` **9 / 9** |

`COMPLETION-AUDIT.md` §1 proofs for those twelve now cite the restore + live receipts.

## Leftover 18 (unchanged — not retried)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Goal

Stays **open**.
