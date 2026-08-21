# Eraser crossing-500 allocation vs 8448 MiB — diagnose only (2026-08-21)

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**HEAD:** `ea10b6ca`  
**`main`:** `9a5260c3`  
**Does not mark the audit goal complete.**  
**Did not loosen** `crossing500.maxAllocatedBytes` **8448 MiB** or `INTERACTIVE_BUDGET` **75 / 250**.  
**Did not edit** product eraser / policy / high-risk files.  
**Did not retry** the 18 host leftovers.  
**Did not apply** prod SQL.  
**No commit** (no product or test-contract fix).

## Verdict

**Pre-existing environment, not a restore regression, not a leak.**

`totalAllocatedBytes` for `500 crossing cuts` is **stable ~11960 MiB** on this Node 22.14 / V8 12.4 host — **always above 8448**. The same child, same flags, same geometry on **`main` `9a5260c3` eraser files** is **the same number**. Retained heap stays ~7 MiB (ceiling 12). Wall/CPU stay inside 75 / 250.

The 8448 ceiling was set from mac 5.89–5.91 GiB and CI bimodal 6.39–7.34 GiB (`c7d6a383`, 2026-08-18). This VM is a higher allocation mode than those hosts. Cap left as-is. Official `npm test` stays red honestly.

| Hypothesis | Result |
|---|---|
| Host/V8 **run-to-run noise** | **No** for crossing — spread < 0.1% across 10 samples. Not a flake. |
| Real leak / restore regression | **No** — retained ~7 MiB; geometry 501 / 2038 / 70760 B; HEAD ≡ `main`. |
| Cap assumed a different Node/allocator | **Yes** — this Node 22.14.0 / V8 12.4.254.21-node.22 / 4-core 15 GiB Linux allocates ~12 GiB of short-lived young-gen for the same JS. `main` also exceeds 8448 here, so the leftover is **pre-existing**. |

## What was compared

Restore vs `main` on the erase path is **only** KB-1 skip-policy:

- `eraserPolicy.js` — non-ink partial → `'skip'` (was `'entire'`)
- `pageSpaceEraser.js` — skip those paths; non-path whole-delete only when `mode` is full/entire

`tests/partialEraserComplexity.test.mjs` and `debug/benchmarks/partial-eraser-complexity-child.mjs` are **identical** to `main`.  
`paperAnnotationGeometry.js` / `paperInkEraser.js` / `productionPaperInk.js` have **no** diff vs `main`.

The crossing child uses highlighter ink (`partial`) plus a collaborator rect that `canErase` already rejects (`authorId === 'author-2'`). The skip-policy restore **cannot** change this scenario’s allocation. Swapping in `9a5260c3` copies of the two policy files proved it.

## How allocation is counted

Child spawn (same as the test):

```
node --expose-gc --max-old-space-size=128 \
  debug/benchmarks/partial-eraser-complexity-child.mjs \
  crossing 500 highlighter 20 4 64
```

`totalAllocatedBytes` = Σ(usedHeapSize reclaimed by each GC) + (endHeap − startHeap).  
In-process GC mix on this host: **838 Scavenge / 11598.5 MiB** + **8 MarkSweepCompact / 317.3 MiB** + 8 IncrementalMarking / 0. That is young-gen garbage, not a retained leak.

Nursery / heap-limit flags **do not** move the crossing total (so this is not the CI nursery-bimodal accounting the test comment already documents):

| Flags | allocated MiB |
|---|---|
| test flags (`--max-old-space-size=128` only) | 11957–11966 |
| `--max-semi-space-size=16` | 11961 |
| `--max-semi-space-size=2` | 12057 |
| `--max-old-space-size=320` | 11963 |
| `--max-old-space-size=512` | 11962 |

## Measurements (this host)

Host: Linux 6.12.94+, **4** CPUs, **15 GiB** RAM, load 0.07–1.07 during samples. Node **v22.14.0**, V8 **12.4.254.21-node.22**. Child heap limit with `--max-old-space-size=128`: **176 MiB**.

Ceiling: **8448.00 MiB**. Official leftover: **11966.34 MiB**.

### Crossing 500 (the fail)

| Sample | Tree | allocated MiB | retained MiB | final heap | comps | verts | ser B | p95 / max wall | p95 / max CPU |
|---|---|---|---|---|---|---|---|---|---|
| Official `npm test` | HEAD | **11966.34** | (passed) | (passed) | 501 | (passed) | (passed) | passed / passed | passed |
| Child 1 | HEAD | 11964.63 | 6.95 | 5.73 | 501 | 2038 | 70760 | 21.4 / 34.2 | 35.3 / 76.7 |
| Child 2 | HEAD | 11957.63 | 6.97 | 5.72 | 501 | 2038 | 70760 | 21.5 / 31.6 | 34.0 / 73.2 |
| Child 3 | HEAD | 11960.33 | (test harness) | | 501 | | | passed | passed |
| Child 4 | HEAD | 11962.91 | 6.97 | | 501 | 2038 | 70760 | 24.0 / 51.4 | 39.7 / 94.6 |
| Child A | **main files** | 11958.50 | 6.97 | 5.72 | 501 | 2038 | 70760 | 22.2 / 27.6 | 32.7 / 80.8 |
| Child B | **main files** | 11963.53 | 6.98 | 5.73 | 501 | 2038 | 70760 | 21.5 / 26.1 | 35.0 / 87.1 |

HEAD range **11957.63–11966.34**. Main range **11958.50–11963.53**. Overlap; no restore delta.

Vs published baselines in the test comment:

| Host | crossing allocated |
|---|---|
| Dev mac (cap-commit) | 5893–5911 MiB |
| CI low mode | 6385–6740 MiB |
| CI high mode | 7273–7338 MiB |
| **This VM** | **11958–11966 MiB** (~1.63× CI high, ~2.0× mac) |
| Ceiling (unchanged) | **8448 MiB** |

### Shallow 500 (not the official leftover; recorded because it sits on the same meter)

Ceiling **19456 MiB** (19 GiB). Cap-commit: mac 13961–13977, CI 17631–17811.

| Sample | allocated MiB | vs 19456 |
|---|---|---|
| Isolated child (earlier) | 19106.17 | under |
| Isolated child | 18963.37 | under |
| Isolated child | 19115.37 | under |
| Same-file harness after crossing sibling start (shallow ran first) | **19712.80** | **over** |

Shallow on this host is **near the ceiling** and can straddle it (~3% spread). Official run 3 reported shallow **pass**. Do **not** loosen 19 GiB either. Not treated as a new audit ID.

## Isolated commands (this pass)

```
node --expose-gc --max-old-space-size=128 \
  debug/benchmarks/partial-eraser-complexity-child.mjs \
  crossing 500 highlighter 20 4 64
```

Then the same after `git checkout 9a5260c3 -- src/utils/pageSpaceEraser.js src/utils/eraserPolicy.js` (restored to HEAD afterward; tree clean).

```
node --test --test-name-pattern='500 crossing cuts|500 shallow bites' \
  tests/partialEraserComplexity.test.mjs
```

Exit **1**: crossing **11960.33 > 8448**; that paired run also saw shallow **19712.80 > 19456**. Timing 75 / 250 held.

**Did not** re-run official `npm test` (product untouched). Official leftover remains the crossing allocation from run 3.

## What was not done

- No cap loosen (8448 and 19 GiB and 75 / 250 left).
- No product edit (`pageSpaceEraser.js`, `eraserPolicy.js`, `paperAnnotationGeometry.js`, high-risk files).
- No KB-1 intended / break / edge re-prove (no product fix).
- No official `node scripts/run-node-tests.mjs` this pass.
- 18 host leftovers unchanged (not retried): `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Goal

Stays **open**. Honest leftover: official `npm test` **exit 1** on `partialEraserComplexity` crossing-500 **allocation** (pre-existing on `main` at this Node/host).
