// The calm "drop here" picture for PDFs dragged in from the computer (see
// src/hooks/useFileDropZone.js). A dashed outline with a light tint over the
// place the files will land, and one small card that says what will happen.
// It never takes the pointer (pointer-events: none), so the drag keeps
// reaching the real elements underneath and nothing flickers.
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import './FileDropOverlay.css';

// A target shorter than this (a project row) gets its card under the outline
// instead of inside it.
const CARD_INSIDE_MIN_HEIGHT = 140;

export default function FileDropOverlay({ overlay }) {
  if (!overlay || typeof document === 'undefined') return null;
  const { rect, label, hint, accept, kind } = overlay;
  const cardInside = Boolean(rect && rect.height >= CARD_INSIDE_MIN_HEIGHT);
  let cardStyle;
  if (cardInside) {
    cardStyle = { left: rect.left + rect.width / 2, top: rect.top + rect.height / 2, transform: 'translate(-50%, -50%)' };
  } else if (rect) {
    const below = rect.top + rect.height + 10;
    const fitsBelow = below + 72 < window.innerHeight;
    cardStyle = {
      left: Math.max(12, rect.left),
      top: fitsBelow ? below : Math.max(12, rect.top - 82),
    };
  } else {
    cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  return createPortal(
    <div className="file-drop-overlay" data-testid="file-drop-overlay" data-drop-kind={kind || 'none'} aria-hidden="true">
      {rect && accept ? (
        <div
          className="file-drop-overlay__outline"
          data-testid="file-drop-outline"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ) : null}
      <div className={`file-drop-overlay__card${accept ? '' : ' is-blocked'}`} style={cardStyle}>
        <span className="file-drop-overlay__icon"><Icon name="upload" size={18} color="currentColor" /></span>
        <span className="file-drop-overlay__copy">
          <span className="file-drop-overlay__label" data-testid="file-drop-label">{label}</span>
          {hint ? <span className="file-drop-overlay__hint">{hint}</span> : null}
        </span>
      </div>
    </div>,
    document.body,
  );
}
