// src/lib/calloutSharedStoreFlag.js
// Callout-unification keystone (Phase 5) — PERMANENTLY ON as of 2026-06-30.
//
// The keystone shipped and was validated end-to-end: a 3-pass adversarial gate
// (correctness + RLS + code review), a live RLS-enforced cloud-write proof, the
// lossless backfill of all 11 prod rows to `.fabricObject`, the full test suite,
// the callout-interaction-e2e harness, and the owner's hands-on testing. The
// `'0'` kill switch was retired (owner decision 2026-06-30) so the forked legacy
// callout sync code can be deleted — it is now provably unreachable.
//
// This function is kept (returning a constant) only so the remaining
// `calloutsInSharedStore()` call sites compile unchanged; they can be inlined in
// a later mechanical cleanup. Callout RENDER is already flag-independent.

/**
 * Always true — the shared-store callout keystone is permanent.
 * @returns {true}
 */
export function calloutsInSharedStore() {
  return true;
}
