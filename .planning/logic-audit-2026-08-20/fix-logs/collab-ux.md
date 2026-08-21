# collab-ux

## P1-30 — Remote-delete “Removed by X — Restore?” toast is dead
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/collab/YDocProvider.jsx`, `src/components/collab/remoteDeleteInteraction.js` (new)
- Intended behavior confirmed: toast gate now unions Phase-29 `window.__phase29InteractionState`, the live `window.__selectedAnnotationIds` SVG mirror, and selected SVG nodes (`cursor:move` on `[data-anno-id]`). A remote delete of a selected annotation is no longer silently dropped when those seams are set.
- Break / adversarial attempts: empty state / different id / null window → no toast (silent apply). Empty/missing `annoId` never matches.
- Edges covered: Phase-29 selectedId; SVG id mirror; DOM selected node; e2e that still injects `__phase29InteractionState` keeps working.
- Test command + result: `node --test tests/remoteDeleteInteraction.test.mjs` → 7/7 pass.
- Remaining risk: `__selectedAnnotationIds` is still production-stripped in `useSVGInteraction` (out of allowlist). Production relies on the SVG `cursor:move` fallback. Drag/scale/edit-canvas/context-menu bindings are still unpublished unless a later SVG-path publisher writes `__phase29InteractionState`. Did not recreate the Phase-28 fallback provider.

## P2-16 — Remote-delete Restore? toast permanently dead (pass-2 confirmation of P1-30)
- Date: 2026-08-20
- Status: fixed
- Files changed: same as P1-30
- Intended behavior confirmed: same helper; YDocProvider no longer reads only the dead `__phase29InteractionState` object.
- Break / adversarial attempts: same as P1-30.
- Edges covered: same as P1-30.
- Test command + result: `node --test tests/remoteDeleteInteraction.test.mjs` → 7/7 pass.
- Remaining risk: same as P1-30. A dedicated SVG publisher would still make drag/edit-without-visible-selection more reliable.

## P2-12 — Access-removed banner can be permanently lost after re-sign-in
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/collab/YDocProvider.jsx`, `src/components/collab/collabBannerState.js` (new)
- Intended behavior confirmed: `permission_revoked` outranks `login_expiry_failure`. Sign-out while revoked keeps the access-removed banner. Re-sign-in while `accessRevoked` is still true restores `permission_revoked`, not `ok`. A reactive effect re-derives the banner from `accessRevoked`.
- Break / adversarial attempts: re-sign-in after expiry must not clear a still-revoked lockout (`code !== 'ok'`).
- Edges covered: expiry without revoke still shows `login_expiry_failure`; successful re-sign-in without revoke returns `ok`.
- Test command + result: `node --test tests/collabBannerState.test.mjs` → 5/5 pass.
- Remaining risk: ReadOnlyGate still depends on `accessRevoked` independently (unchanged). If a future path clears `accessRevoked` without a real access restore, the banner would also clear.
