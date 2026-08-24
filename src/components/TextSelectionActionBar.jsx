import Icon from '../Icons';
import { computeTextSelectionActionBarPosition } from '../utils/pdfTextMarkup.js';
import highlightIconSvg from '../assets/text-markup-highlight.svg';
import squiggleIconSvg from '../assets/text-markup-squiggle.svg';

const ACTIONS = [
  { id: 'copy', label: 'Copy', icon: 'copy' },
  { id: 'highlight', label: 'Highlight', iconAsset: highlightIconSvg },
  { id: 'underline', label: 'Underline', icon: 'underline' },
  { id: 'squiggly', label: 'Squiggle', iconAsset: squiggleIconSvg },
  { id: 'strikeout', label: 'Strikeout', textGlyph: 'S' },
];

function TextFormatGlyph({ action }) {
  const underline = action.id === 'underline';
  return (
    <span
      data-text-format-glyph={action.id}
      style={{
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: 13,
        fontWeight: 400,
        lineHeight: 'normal',
        textDecoration: underline ? 'underline' : 'line-through',
      }}
    >
      {action.textGlyph}
    </span>
  );
}

function ActionIcon({ action }) {
  let content = null;
  if (action.iconAsset) {
    content = (
      <img
        src={action.iconAsset}
        alt=""
        style={{
          width: 14,
          height: 14,
          display: 'block',
          objectFit: 'contain',
        }}
      />
    );
  } else if (action.textGlyph) {
    content = <TextFormatGlyph action={action} />;
  } else {
    content = <Icon name={action.icon} size={14} />;
  }
  return (
    <span
      data-text-selection-action-icon="true"
      aria-hidden="true"
      style={{
        width: 14,
        height: 14,
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 14px',
      }}
    >
      {content}
    </span>
  );
}

export default function TextSelectionActionBar({ selection, color, opacity, overlapMode, activeMarkupTypes = [], colorPickerOpen = false, onAction, onColorClick, onOverlapModeChange }) {
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
        display: 'flex', alignItems: 'center', gap: 1, padding: 3,
        border: '1px solid #3a4252', borderRadius: 7, background: '#181b20',
        boxShadow: '0 8px 24px rgba(0,0,0,.45)', color: '#e8e2d4',
      }}
      onPointerDown={(event) => {
        // Keep the PDF text range active when action buttons are pressed, but
        // let form controls receive a real pointer press so their menus open.
        if (!event.target.closest('select')) event.preventDefault();
      }}
    >
      <button type="button" aria-label="Markup color" onClick={onColorClick} style={{ width: 24, height: 24, border: 0, borderRadius: 4, background: 'transparent', padding: 5 }}>
        <span style={{ display: 'block', width: 14, height: 14, borderRadius: 3, background: color, opacity, border: '1px solid rgba(255,255,255,.45)' }} />
      </button>
      {ACTIONS.map((action) => {
        const pressed = action.id !== 'copy' && activeMarkupTypes.includes(action.id);
        return (
        <button
          key={action.id}
          type="button"
          title={action.label}
          aria-label={action.label}
          aria-pressed={action.id === 'copy' ? undefined : pressed}
          onClick={() => onAction(action.id)}
          style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, color: pressed ? '#d8a84e' : '#e8e2d4', background: 'transparent', cursor: 'pointer', padding: 5 }}
        >
          <ActionIcon action={action} />
        </button>
        );
      })}
      <select
        aria-label="Highlight overlap mode"
        title="Layered keeps editable native PDF highlights. Uniform exports as one flat visual mask so overlaps stay even in other viewers."
        value={overlapMode}
        onChange={(event) => onOverlapModeChange(event.target.value)}
        style={{ height: 24, maxWidth: 72, border: '1px solid #3a4252', borderRadius: 4, background: '#22262d', color: '#e8e2d4', fontSize: 10 }}
      >
        <option value="layered">Layered</option>
        <option value="uniform">Uniform</option>
      </select>
    </div>
  );
}
