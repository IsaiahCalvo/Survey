/* BL-23 — pure helpers for TemplatesEditor's prop-reload guard, legacy-row id
   stability, and title-rename commit semantics.

   This module is deliberately dependency-free (zero imports) so the Node test
   suite exercises the REAL code (tests/templatesEditorReloadGuard.test.mjs) —
   component files resolve only under vite (BL-22 round-3 lesson). */

/* Decide what to do with a freshly-built working copy when the host republishes
   the `templates` prop.

   - Not dirty → 'replace': full reload, exactly the pre-BL-23 behavior.
   - Dirty and nextRich contains template ids the working copy doesn't have →
     'append': the new templates (e.g. host-created via the New Template modal)
     are surfaced without rebuilding over unsaved edits.
   - Dirty otherwise → 'keep': the wipe-prevention case. Remote deletes/edits of
     templates already in the working copy are deferred until Save (which writes
     the full working copy, last-writer-wins — today's Save semantics) or Cancel
     (which reloads the latest prop). */
export const resolveTemplatesReload = ({ dirty, prevRich, nextRich }) => {
  if (!dirty) return { mode: 'replace' };
  const have = new Set((prevRich || []).map((t) => t.id));
  const appended = (nextRich || []).filter((t) => !have.has(t.id));
  return appended.length ? { mode: 'append', appended } : { mode: 'keep' };
};

/* Cached id minting so legacy rows WITHOUT a persisted id keep the same minted
   id across every rebuild in a session — otherwise their keyed inputs remount
   on each background refresh and wipe uncommitted typing. `cache` is a Map
   owned by the component instance; `makeId(prefix)` mints fresh ids. */
export const createStableIdMint = (cache, makeId) => (key, prefix) => {
  if (cache.has(key)) return cache.get(key);
  const id = makeId(prefix);
  cache.set(key, id);
  return id;
};

/* Semantic cache keys for the mint above: JSON-array encoding of
   [scopeKey, label, occurrence] — collision-proof against any characters in
   user-entered names. Occurrence is the nth sibling with that label inside
   that scope, counted per rebuild pass (instantiate one keyer per pass).

   Documented limit: rows with IDENTICAL labels are told apart only by
   occurrence order, so inserting/removing/reordering a same-label row above an
   id-less duplicate shifts the suffix and re-mints ids for the later
   duplicates. That corner (duplicate names + id-less legacy rows + a remote
   same-label change mid-typing) is accepted and pinned by tests. */
export const createOccurrenceKeyer = () => {
  const counts = new Map();
  return (scopeKey, label) => {
    const slot = JSON.stringify([scopeKey, label]);
    const occurrence = counts.get(slot) || 0;
    counts.set(slot, occurrence + 1);
    return JSON.stringify([scopeKey, label, occurrence]);
  };
};

/* Seed the colour-picker maps from each entity's persisted refinements so
   saved colours round-trip. Shared by the full-reload path and the
   append-while-dirty path. */
export const seedColorMaps = (richTemplates) => {
  const roleColors = {}, borderColors = {}, matchFill = {};
  (richTemplates || []).forEach((t) => (t.roster || []).forEach((r) => {
    roleColors[r.id] = { color: r.color, opacity: r.opacity ?? 0.35 };
    if (r.borderColor) {
      borderColors[r.id] = { color: r.borderColor, opacity: r.borderOpacity ?? (r.opacity ?? 0.35) };
    }
    if (r.matchFill) matchFill[r.id] = true;
  }));
  return { roleColors, borderColors, matchFill };
};

/* Commit semantics for an inline title rename (uncontrolled input, blur-commit).

   - Empty after trim → 'restore': the caller writes `name` (the CURRENT name)
     back into the input, so the rejected empty title visibly snaps back instead
     of silently showing an empty field over a model that kept the old name.
   - Unchanged after trim → 'noop': no mutator call (a no-op blur must not dirty
     the editor); `name` is the canonical current name so the caller normalizes
     whitespace-only variants in the input. Also makes Escape-then-blur clean.
   - Otherwise → 'commit' with the trimmed name. */
export const resolveTitleCommit = (rawValue, currentName) => {
  const trimmed = (rawValue ?? '').trim();
  if (!trimmed) return { action: 'restore', name: currentName };
  if (trimmed === currentName) return { action: 'noop', name: currentName };
  return { action: 'commit', name: trimmed };
};
