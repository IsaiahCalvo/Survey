import Icon from '../Icons';

const ACTIONS = [
  { id: 'copy', label: 'Copy', icon: 'copy' },
  { id: 'highlight', label: 'Highlight', icon: 'highlighter' },
  { id: 'underline', label: 'Underline', icon: 'underline' },
  { id: 'squiggly', label: 'Squiggle', icon: 'squiggly' },
  { id: 'strikeout', label: 'Strikeout', icon: 'strikeout' },
];

export default function TextSelectionActionBar({ selection, color, opacity, overlapMode, onAction, onColorClick, onOverlapModeChange }) {
  if (!selection?.pages?.length || !selection?.anchor) return null;
  const left = Math.max(12, Math.min(window.innerWidth - 220, selection.anchor.left + selection.anchor.width / 2));
  const top = Math.max(12, selection.anchor.top - 48);
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
      onPointerDown={(event) => event.preventDefault()}
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
          <Icon name={action.icon} size={15} />
        </button>
      ))}
      <select
        aria-label="Highlight overlap mode"
        title="Layered makes overlaps darker. Uniform keeps the same visual strength within each saved range."
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
