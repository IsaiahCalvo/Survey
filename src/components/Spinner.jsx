// src/components/Spinner.jsx
//
// THE one loading spinner (master plan 2026-07-07, decision 3: "one loading
// spinner"). A compact ring — faint track with a colored top arc — matching
// the warm-dark design language in docs/design/design.md.
//
// Every inline `border-radius:50% + rotate` spinner should use this instead of
// hand-rolling its own <span> + local @keyframes. Defaults are design-system
// gold; pass `color="currentColor"` inside status chips that tint by state.
//
// UX — WHEN TO SHOW ONE (500ms threshold rule, KAL-73):
// Any async action that MAY exceed ~500ms must show loading feedback; anything
// that always resolves under 500ms must NOT, because a spinner that flashes for
// one frame reads as lag rather than progress. The two sanctioned treatments:
//   * inside a button  — size 14 to the LEFT of the label, 8px gap, and the
//     label switches to the present participle ("Send invite" -> "Sending
//     invite…"). The button stays disabled while it spins.
//   * on an empty surface — size 18 centred with descriptive text to its right
//     ("Loading pages…"), so the user knows what is loading, not just that
//     something is.
// Purely local work (a toggle, an in-memory filter, a synchronous state edit)
// gets no spinner.

// Inject the keyframes once per document (module-level singleton, SSR-safe).
const KEYFRAMES_ID = 'survey-spinner-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(KEYFRAMES_ID)) {
  try {
    const style = document.createElement('style');
    style.id = KEYFRAMES_ID;
    style.textContent = '@keyframes survey-spinner-rotate { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  } catch (_e) { /* never let spinner setup break the app */ }
}

/**
 * @param {object} props
 * @param {number} [props.size=14]        Outer diameter in px.
 * @param {number} [props.thickness=2]    Ring stroke width in px.
 * @param {string} [props.color]          Arc color. Defaults to design gold.
 * @param {string} [props.trackColor]     Faint full-ring track behind the arc.
 * @param {object} [props.style]          Extra inline styles merged last.
 */
export default function Spinner({
  size = 14,
  thickness = 2,
  color = 'var(--accent)', // --gold (docs/design/design.md)
  trackColor = 'rgba(141,150,166,0.25)', // --ink-200 at low opacity
  style,
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        flex: 'none',
        boxSizing: 'border-box',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `${thickness}px solid ${trackColor}`,
        borderTopColor: color,
        animation: 'survey-spinner-rotate 0.8s linear infinite',
        ...style,
      }}
    />
  );
}
