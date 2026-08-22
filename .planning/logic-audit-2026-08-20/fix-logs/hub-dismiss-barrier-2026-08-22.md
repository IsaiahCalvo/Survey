# Hub dismiss-barrier contract — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Official `npm test` after UL-31 Continue pin exited 1 on `hubDismissBarrierContracts.test.mjs`. Cap **8448** not loosened.

## Verdict

**Stale contract, not a product regression.** Campaign product (Projects extras) already keeps the More trigger inside `DismissBarrier` so a first-click on the same trigger does not consume-and-dismiss. Documents already used `insideRefs={[ref, trigger]}`. The contract still required Projects `PopupMenu` `insideRefs={[ref]}` only.

| Check | Result |
|---|---|
| Shared barrier consume + trailing click | **pass** |
| Home Search `insideRefs={[rootRef]}` + blur | **pass** |
| Documents `DocumentActionMenu` `[ref, trigger]` | **pass** (unchanged) |
| Projects `PopupMenu` `[ref, trigger]` | **fail** until contract matched intended |
| Templates `MoreMenu` `[ref]` | **pass** (unchanged) |
| Manage Team search / `insideSelector` | **pass** |
| Archive first-click / Search `dismissActionSelector` | **not in this file** — not the fail |

## Fix

Min-viable: update `tests/hubDismissBarrierContracts.test.mjs` to expect `[ref, trigger]` on Projects. Product left as-is (`src/home/ProjectsFolderTree.jsx:128`). 8448 not loosened. Right-click guard in `PDFViewer.jsx` not touched.

Node after fix: `hubDismissBarrierContracts` **4 / 4**. `continuePin` **4 / 4**. `leftover18FailClosed` **12 / 12**.
