/** The eye used for show / hide switches (layers, hide all marks). */
export default function EyeGlyph({ open, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      {open ? <circle cx="12" cy="12" r="3" /> : <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
