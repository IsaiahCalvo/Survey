/* Nightly 'comment-pins': our own pin glyphs (Drawboard's behaviour, not
   its art). Comment = speech bubble, Issue = cone, Task = checklist. */

export function PinKindGlyph({ kind, size = 18, color = 'currentColor' }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  if (kind === 'issue') {
    return (
      <svg {...common}>
        <path d="M10.2 4.5h3.6L18 18H6l4.2-13.5Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8.6 10h6.8M7.4 14h9.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4 19.5h16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'task') {
    return (
      <svg {...common}>
        <path d="m4.5 7 1.7 1.7L9.5 5.4M4.5 14l1.7 1.7 3.3-3.3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.5 7.5H20M12.5 14.5H20M4.8 19.5H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8.5L6 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function PinSendGlyph({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M6 11l6-6 6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
