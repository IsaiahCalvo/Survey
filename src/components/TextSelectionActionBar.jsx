import Icon from '../Icons';
import { computeTextSelectionActionBarPosition } from '../utils/pdfTextMarkup.js';
import highlightIconSvg from '../assets/text-markup-highlight.svg';
import squiggleIconSvg from '../assets/text-markup-squiggle.svg';

const ACTIONS = [
  { id: 'copy', label: 'Copy', icon: 'copy' },
  { id: 'highlight', label: 'Highlight', iconAsset: highlightIconSvg },
  { id: 'underline', label: 'Underline', textGlyph: 'U' },
  { id: 'squiggly', label: 'Squiggle', iconAsset: squiggleIconSvg },
  { id: 'strikeout', label: 'Strikeout', textGlyph: 'S' },
];

function TextFormatGlyph({ action }) {
  const underline = action.id === 'underline';
  return (
    <span
      aria-hidden="true"
      style={{
        color: 'currentColor',
        fontFamily: 'Arial, sans-serif',
        fontSize: 15,
        fontWeight: 600,
        lineHeight: 1,
        textDecoration: underline ? 'underline' : 'line-through',
        textDecorationThickness: '1.5px',
        textUnderlineOffset: underline ? '2px' : undefined,
      }}
    >
      {action.textGlyph}
    </span>
  );
}

export default function TextSelectionActionBar({ selection, color, opacity, overlapMode, colorPickerOpen = false, onAction, onColorClick, onOverlapModeChange }) {
  if (!selection?.pages?.length || !selection?.anchor) return null;
  const chromeBottom = Math.max(
    document.getElementById('chrome-top-host')?.getBoundingClientRect?.().bottom || 0,
    colorPickerOpen
      ? document.querySelector('[data-annotation-color-picker]')?.getBoundingClientRect?.().bottom || 0
      : 0,
  );
  const { left, top } = computeTextSelectionActionBarPosition(selection.anchor, {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    chromeBottom,
  });
  return (
    <div
      data-text-selection-action-bar="true"
      role="toolbar"
      aria-label="Text selection actions"
      style={{
        position: 'fixed', left, top, transform: 'translateX(-50%)', zIndex: 100000,
        display: 'flex', alignItems: 'center', gap: 2, padding: 4,
        border: '1px solid #3a4252', borderRadius: 7, background: '#181b20',
        boxShadow: '0 8px 24px rgba(0,0,0,.45)', color: '#e8e2d4',
      }}
      onPointerDown={(event) => {
        // Keep the PDF text range active when action buttons are pressed, but
        // let form controls receive a real pointer press so their menus open.
        if (!event.target.closest('select')) event.preventDefault();
      }}
    >
      <button type="button" aria-label="Markup color" onClick={onColorClick} style={{ width: 26, height: 26, border: 0, borderRadius: 4, background: 'transparent', padding: 5 }}>
        <span style={{ display: 'block', width: 16, height: 16, borderRadius: 3, background: color, opacity, border: '1px solid rgba(255,255,255,.45)' }} />
      </button>
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          title={action.label}
          aria-label={action.label}
          onClick={() => onAction(action.id)}
          style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, color: '#e8e2d4', background: 'transparent', cursor: 'pointer' }}
        >
          {action.iconAsset ? (
            <img
              aria-hidden="true"
              src={action.iconAsset}
              alt=""
              style={{
                width: 16,
                height: 16,
                display: 'block',
              }}
            />
          ) : action.textGlyph ? (
            <TextFormatGlyph action={action} />
          ) : <Icon name={action.icon} size={15} />}
        </button>
      ))}
      <select
        aria-label="Highlight overlap mode"
        title="Layered keeps editable native PDF highlights. Uniform exports as one flat visual mask so overlaps stay even in other viewers."
        value={overlapMode}
        onChange={(event) => onOverlapModeChange(event.target.value)}
        style={{ height: 28, maxWidth: 82, border: '1px solid #3a4252', borderRadius: 4, background: '#22262d', color: '#e8e2d4', fontSize: 11 }}
      >
        <option value="layered">Layered</option>
        <option value="uniform">Uniform</option>
      </select>
    </div>
  );
}
