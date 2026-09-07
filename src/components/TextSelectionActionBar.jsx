import Icon from '../Icons';
import './TextSelectionActionBar.css';

const GOLD = '#e5ad18';
const MARKS = [
  { id: 'highlight', label: 'Highlight', icon: 'formatHighlight' },
  { id: 'underline', label: 'Underline', icon: 'formatUnderline' },
  { id: 'squiggly', label: 'Squiggle', icon: 'formatSquiggle' },
  { id: 'strikeout', label: 'Strike Through', icon: 'formatStrikethrough' },
];

const buttonBase = {
  border: 0, background: 'transparent', color: '#e8e2d4', cursor: 'pointer', padding: 3,
};

// UX 2026-09-07: every glyph in this row renders at ONE size, 18. Redact used
// to override to 21, which made it the widest thing in the row and — together
// with its old solid redaction slab — the reason it read about half again as
// heavy as its neighbours. Reference behaviour: highlight / underline /
// squiggle / strike / hyperlink, all 18. Do not reintroduce a per-icon size.
function ToolIcon({ name, emphasized = false, size = 18 }) {
  return <Icon name={name} size={size} color={emphasized ? GOLD : '#e8e2d4'} style={{ display: 'block', opacity: 1 }} />;
}

function activateFromTouch(event, activate) {
  event.preventDefault();
  event.stopPropagation();
  activate();
}

function MarkControl({ mark, active, focused, paint, onToggle, onFocusPaint }) {
  return (
    <div className="text-selection-action-bar__mark" data-text-mark-control={mark.id} data-focused={focused ? 'true' : 'false'}>
      <button className="text-selection-action-bar__button" type="button" aria-label={`${active ? 'Remove' : 'Apply'} ${mark.label}`} aria-pressed={active} onClick={() => onToggle(mark.id)} onTouchEnd={(event) => activateFromTouch(event, () => onToggle(mark.id))} style={buttonBase}>
        <ToolIcon name={mark.icon} emphasized={active} />
      </button>
      <button className="text-selection-action-bar__button" type="button" aria-label={`Set ${mark.label} color`} onClick={() => onFocusPaint(mark.id)} onTouchEnd={(event) => activateFromTouch(event, () => onFocusPaint(mark.id))} style={{ ...buttonBase, padding: 4 }}>
        <span aria-hidden="true" style={{ width: 14, height: 14, display: 'block', border: '1px solid #eef0f3', borderRadius: '50%', background: paint?.color || '#f5c229', opacity: 1, boxShadow: '0 0 0 1px #090b0e' }} />
      </button>
    </div>
  );
}

export default function TextSelectionActionBar({
  selection,
  activeMarkupTypes = [],
  paintByMark = {},
  focusedPaintMark = null,
  linkEditorOpen = false,
  linkMode = 'web',
  linkValue = '',
  linkError = '',
  onAction,
  onFocusPaint,
  onLinkModeChange,
  onLinkValueChange,
  onLinkSubmit,
  onLinkOpen,
  onLinkRemove,
  onLinkCancel,
}) {
  const hasSelection = Boolean(selection?.pages?.length);
  if (!hasSelection) return null;
  const linkActive = activeMarkupTypes.includes('link');
  const redactActive = activeMarkupTypes.includes('redact');
  const moveToolbarFocus = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[nextIndex]?.focus({ preventScroll: true });
    buttons[nextIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <div className="text-selection-action-bar" data-text-selection-action-bar="true">
      <div
        className="text-selection-action-bar__toolbar"
        role="toolbar"
        aria-label="Text markup toolbar"
        aria-orientation="horizontal"
        onKeyDown={moveToolbarFocus}
        onPointerDown={(event) => { if (!event.target.closest('input, [data-text-link-control]')) event.preventDefault(); }}
      >
        <div className="text-selection-action-bar__tools">
          {MARKS.map((mark) => <MarkControl key={mark.id} mark={mark} active={activeMarkupTypes.includes(mark.id)} focused={focusedPaintMark === mark.id} paint={paintByMark[mark.id]} onToggle={onAction} onFocusPaint={onFocusPaint} />)}
          <button className="text-selection-action-bar__button" type="button" aria-label={linkEditorOpen ? 'Close Hyperlink editor' : linkActive ? 'Edit Hyperlink' : 'Add Hyperlink'} aria-pressed={linkActive} onClick={() => onAction('link')} onTouchEnd={(event) => activateFromTouch(event, () => onAction('link'))} style={buttonBase}><ToolIcon name="formatHyperlink" emphasized={linkActive} /></button>
          <button className="text-selection-action-bar__button" type="button" aria-label={`${redactActive ? 'Remove' : 'Apply'} Redact`} aria-pressed={redactActive} onClick={() => onAction('redact')} onTouchEnd={(event) => activateFromTouch(event, () => onAction('redact'))} style={buttonBase}><ToolIcon name="formatRedact" emphasized={redactActive} /></button>
        </div>
      </div>
      {hasSelection && linkEditorOpen && (
        <form className="text-selection-action-bar__link-form" data-text-link-editor="true" aria-label="Hyperlink controls" onSubmit={(event) => { event.preventDefault(); onLinkSubmit?.(); }}>
          <div className="text-selection-action-bar__link-modes">
            {[['web', 'Web address'], ['page', 'Page in document']].map(([mode, label]) => (
              <button key={mode} data-text-link-control="true" type="button" aria-pressed={linkMode === mode} onClick={() => onLinkModeChange?.(mode)} style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 5, background: linkMode === mode ? '#343a45' : 'transparent', color: linkMode === mode ? '#fff' : '#b9bec7', boxShadow: linkMode === mode ? '0 1px 3px rgba(0,0,0,.5)' : 'none', fontSize: 12, cursor: 'pointer' }}>{label}</button>
            ))}
          </div>
          <input className="text-selection-action-bar__link-input" autoFocus aria-label={linkMode === 'page' ? 'Page number' : 'Web address'} inputMode={linkMode === 'page' ? 'numeric' : 'url'} value={linkValue} onChange={(event) => onLinkValueChange?.(event.target.value)} placeholder={linkMode === 'page' ? '1' : 'https://example.com'} style={{ borderColor: linkError ? '#e45b5b' : '#555b67' }} />
          <div className="text-selection-action-bar__link-actions" data-text-link-actions="true">
            <button data-text-link-control="true" type="submit" aria-label="Apply hyperlink" style={{ height: 34, padding: '0 16px', border: '1px solid #d1a125', borderRadius: 6, background: '#d4a11e', color: '#16191e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
            {linkActive && <button data-text-link-control="true" type="button" aria-label="Open link" onClick={onLinkOpen} style={{ height: 34, padding: '0 12px', border: '1px solid #4d535e', borderRadius: 6, background: '#343a45', color: '#f2f4f7', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Open link</button>}
            {linkActive && <button data-text-link-control="true" type="button" aria-label="Remove link" onClick={onLinkRemove} style={{ height: 34, padding: '0 12px', border: '1px solid #7c4545', borderRadius: 6, background: '#3a2528', color: '#ffb4b4', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Remove link</button>}
            <button data-text-link-control="true" type="button" aria-label="Cancel hyperlink" onClick={onLinkCancel} style={{ height: 34, padding: '0 16px', border: '1px solid #4d535e', borderRadius: 6, background: '#2b3039', color: '#d9dce2', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          </div>
          {linkError && <span role="alert" style={{ width: '100%', color: '#ff8b8b', fontSize: 11, textAlign: 'center' }}>{linkError}</span>}
        </form>
      )}
    </div>
  );
}
