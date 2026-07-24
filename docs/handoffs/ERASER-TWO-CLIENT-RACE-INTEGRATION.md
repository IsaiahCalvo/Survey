# Eraser two-client race integration

This branch starts from canonical `42570e96`. It adds only the same-target
two-client race delta; it does not copy the stalled worktree's older sync,
history, lifecycle, or geometry implementations.

Contract:

1. One bounded survivor lane per writer/annotation; no growing gesture log.
2. A stale held-pointer survivor rebases onto a remote move/style edit.
3. An incompatible remote geometry replacement invalidates only stale lanes;
   newer compatible writer lanes still compose.
4. Remote base deletion wins and cannot resurrect geometry.
5. React receives the Y.Doc-materialized page synchronously.
6. The carved preview releases only after the exact mutation acknowledgment
   and exact SVG repaint.
7. Yjs merge and cold reload retain the same winner.

Automated integration check:

```bash
node scripts/verify-eraser-race-integration.mjs
```

Real mounted two-client browser check (starts its own strict-port Vite server):

```bash
ERASER_RACE_PORT=5209 node scripts/verify-eraser-race-browser.mjs
```

It holds client A's real Fabric eraser pointer while client B edits, moves, or
deletes the same production-schema ink annotation. Each case verifies exact
mutation acknowledgment before preview release, exact two-client SVG
convergence, and an exact cold reload (including no resurrection after delete).

Mounted two-client harness:

```text
http://127.0.0.1:<port>/?eraserRace=1&raceRole=a&raceSession=<unique>
http://127.0.0.1:<port>/?eraserRace=1&raceRole=b&raceSession=<same>
```
