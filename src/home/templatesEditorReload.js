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

/* "Only a real change asks to be saved" (owner 2026-10-02: "If I double-click
   into a module to rename it and then click off without renaming it, I still
   get prompted to save the template ... If I don't make a change, what's the
   point in saving?").

   The editor used to raise its Save / Cancel bar whenever ANY mutator ran,
   even one that wrote back exactly what was there. Now the bar also needs the
   working copy to differ from the last loaded / saved baseline. These helpers
   build the comparison: one string per template holding exactly what Save
   persists (names, module / category / item order and text, archive flags,
   entity names and resolved colours), keyed by template id so the order of the
   template LIST (a separate, instantly saved preference) never counts.

   `ignoreItemIds` holds the blank placeholder checklist rows that "act like
   they were never created" until the user types into them. */
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v ?? null);
const roundOpacity = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v ?? null);

/* The colour an entity would be SAVED with: the picker maps win over the
   entity's own fields. Mirrors TemplatesEditor's richToTemplate. */
export const resolveEntityStyle = (entity, maps = {}) => {
  const roleColors = maps.roleColors || {};
  const borderColors = maps.borderColors || {};
  const matchFill = maps.matchFill || {};
  const fillColor = roleColors[entity.id]?.color || entity.color || '#8c8c8a';
  const fillOpacity = roleColors[entity.id]?.opacity ?? entity.opacity ?? 0.35;
  const matched = Object.prototype.hasOwnProperty.call(matchFill, entity.id)
    ? !!matchFill[entity.id]
    : !!entity.matchFill;
  const border = matched
    ? { color: fillColor, opacity: fillOpacity }
    : (borderColors[entity.id] || {
      color: entity.borderColor || fillColor,
      opacity: entity.borderOpacity ?? fillOpacity,
    });
  return {
    color: fillColor,
    opacity: fillOpacity,
    borderColor: border.color,
    borderOpacity: border.opacity,
    matchFill: matched,
  };
};

export const templateFingerprint = (template, maps = {}, ignoreItemIds = null) => JSON.stringify([
  template?.name ?? '',
  (template?.modules || []).map((m) => [
    m.id,
    m.name,
    (m.categories || []).map((c) => [
      c.id,
      c.name,
      (c.items || [])
        .filter((it) => !(ignoreItemIds && ignoreItemIds.has(it.id)))
        .map((it) => (it.archived === true
          ? [it.id, it.text ?? '', true, it.archivedAt ?? null, it.lastKnownLabel || it.text || null]
          : [it.id, it.text ?? ''])),
    ]),
  ]),
  (template?.roster || []).map((e) => {
    const s = resolveEntityStyle(e, maps);
    return [e.id, e.role, lower(s.color), roundOpacity(s.opacity), lower(s.borderColor), roundOpacity(s.borderOpacity), s.matchFill];
  }),
]);

export const fingerprintTemplates = (templates, maps = {}, ignoreItemIds = null) => {
  const out = {};
  (templates || []).forEach((t) => { out[t.id] = templateFingerprint(t, maps, ignoreItemIds); });
  return out;
};

/* True when the working copy is not what was last loaded or saved: a template
   added or removed, or any template's content changed. */
export const workingCopyDiffers = (current, baseline) => {
  if (!baseline) return true;
  const ids = Object.keys(current || {});
  if (ids.length !== Object.keys(baseline).length) return true;
  return ids.some((id) => !Object.prototype.hasOwnProperty.call(baseline, id) || baseline[id] !== current[id]);
};
