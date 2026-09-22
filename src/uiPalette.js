// The short colour names the modal and full-page views speak.
//
// UX 2026-09-22 (revision-3 palette): six files each declared their own private
// `const C = { ... }` with the same nine or ten keys. They agreed today, by
// luck; the moment one of them gained a key or drifted a value there would be
// two answers to "what colour is a card?" — which is the whole thing
// src/styles/tokens.css exists to prevent. One map now, and it resolves to
// tokens like everything else.
//
// Every value is a `var(--token)` string, so the browser resolves it. These
// only ever reach React inline styles. Do NOT feed one to a canvas 2D context,
// to Fabric, or to a PDF export path — a var() string fails silently there.
//
// The scrim is the app's one modal scrim (KAL-62); always pair it with
// backdropFilter: 'blur(8px)'.
export const C = Object.freeze({
  scrim: 'var(--overlay-scrim)',
  bg: 'var(--surface-1)',
  deep: 'var(--surface-1)',
  card: 'var(--surface-2)',
  raised: 'var(--surface-3)',
  rule: 'var(--border)',
  ruleStrong: 'var(--border-strong)',
  ink: 'var(--text-1)',
  inkSoft: 'var(--text-2)',
  muted: 'var(--text-3)',
  disabled: 'var(--text-disabled)',
  disabledFill: 'var(--disabled-fill)',
  gold: 'var(--accent)',
  goldHover: 'var(--accent-light)',
  goldPress: 'var(--accent-press)',
  onGold: 'var(--accent-text)',
  // `good` is the gold on purpose: there is no green accent in this app.
  good: 'var(--accent)',
  danger: 'var(--danger)',
  // The word "Delete" on any surface. --danger itself measures 4.05 on
  // surface-2 and 3.49 on surface-3, so it is a fill, never a label.
  dangerText: 'var(--danger-text)',
  // The darkened red a WHITE label may sit on (6.06).
  dangerFill: 'var(--danger-fill)',
  onDanger: 'var(--on-danger)',
  hover: 'var(--hover)',
  pressed: 'var(--pressed)',
  focus: 'var(--focus)',
});

export default C;
