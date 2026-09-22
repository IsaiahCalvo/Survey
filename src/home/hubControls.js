/* One leftover control style.

   2026-09-22: the home screens used to build their small buttons here as
   inline styles — `miniButtonStyle` (18px tall, 2px radius, 10.5px label),
   `miniSelectButtonStyle` and `moreButtonStyle`. That was a second button
   system living beside the header's `.btn`, and inline styles cannot carry a
   hover or a press at all. All three are gone: the home screens now use the
   four button classes in hub.css (`hub-btn`, `hub-btn--primary`,
   `hub-btn--tertiary`, `hub-icon-btn`). Do not add a new style helper here —
   add the button to that system instead.

   `closeButtonStyle` stays for one caller outside the hub,
   components/dialogPrompts.jsx, which renders inside the PDF viewer where
   hub.css is not the styling authority. */

const DEFAULT_RULE = 'var(--ink-500)';
const DEFAULT_MUTED = 'var(--ink-200)';

export const closeButtonStyle = ({
  borderColor = DEFAULT_RULE,
  color = DEFAULT_MUTED,
  size = 24,
} = {}) => ({
  width: size,
  height: size,
  borderRadius: 6,
  padding: 0,
  background: 'transparent',
  border: `1px solid ${borderColor}`,
  color,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'inherit',
  flex: 'none',
});
