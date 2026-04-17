# Phase 15 Deferred Items (out of scope per plan boundaries)

## Infra: `node-canvas` native binding mismatch

**Discovered during:** Plan 15-01 Task 1 — attempting to `import { fabric } from 'fabric'` in `tests/lineArrowPersistence.test.mjs`.

**Symptom:**

```
Error: The module '.../node_modules/canvas/build/Release/canvas.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 116. This version of Node.js requires
NODE_MODULE_VERSION 127.
```

**Context:**

- `fabric@5.5.2` pulls in `node-canvas` for Node-side Canvas API emulation.
- Current Node runtime: v22.17.0 (NODE_MODULE_VERSION 127).
- Installed `node-canvas` binary: NODE_MODULE_VERSION 116 (older Node).
- Electron dev flow does not hit this because Electron ships its own Node ABI.
- Only the `npm test` flow (native Node, `node --test`) is affected.

**Scope verdict (Rule 3 boundary):**

Plan 15-01's contract is zero src/ changes. Running `npm rebuild canvas` would touch `node_modules` / `package-lock.json` — an infra change that belongs in its own cleanup task, not a Wave 0 test-scaffolding plan.

**Workaround used:**

`tests/lineArrowPersistence.test.mjs` exercises the plain-JSON round-trip contract directly (simulating the exact shape `Fabric.Line.toJSON(['data'])` emits). Phase 15's drag commit runs `JSON.parse(JSON.stringify(annotations))` — that is the transformation the tests guard. The Fabric toJSON contract that any prop named in the argument array survives serialization is a stable Fabric 5.x API guarantee.

**Follow-up (low priority — file under v2.3 infra):**

Run `npm rebuild canvas` (or `npm install` after blowing away `node_modules/canvas`) on a dev machine with the matching Node.js toolchain, verify `import { fabric } from 'fabric'` works in `node --test`, then the persistence tests can be upgraded to exercise the real Fabric.Line → toJSON path. No user action required until someone wants full Fabric-runtime test coverage in Node contexts.

**Does NOT block:**

- Any Phase 15 plan (15-01 / 15-02 / 15-03) — all tests that matter pass.
- Any Playwright test — Playwright runs real Fabric in a real browser.
- Any production code — the Electron main + browser dev flow is unaffected.
