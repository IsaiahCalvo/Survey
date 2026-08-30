import Icon from '../Icons';

const GOLD = '#e5ad18';
const MARKS = [
  { id: 'highlight', label: 'Highlight', icon: 'formatHighlight' },
  { id: 'underline', label: 'Underline', icon: 'formatUnderline' },
  { id: 'squiggly', label: 'Squiggle', icon: 'formatSquiggle' },
  { id: 'strikeout', label: 'Strike Through', icon: 'formatStrikethrough' },
];

const buttonBase = {
  width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0,
  borderRadius: 4, background: 'transparent', color: '#e8e2d4', cursor: 'pointer', padding: 3,
};

function ToolIcon({ name, emphasized = false, size = 18 }) {
  return <Icon name={name} size={size} color={emphasized ? GOLD : '#e8e2d4'} style={{ display: 'block', opacity: emphasized ? 1 : 0.68 }} />;
}

function MarkControl({ mark, active, focused, paint, onToggle, onFocusPaint }) {
  return (
    <div data-text-mark-control={mark.id} style={{ height: 31, display: 'flex', alignItems: 'center', gap: 0, padding: 0, border: '1px solid transparent', borderRadius: 5, background: 'transparent', boxShadow: 'none' }}>
      <button type="button" aria-label={`${active ? 'Remove' : 'Apply'} ${mark.label}`} aria-pressed={active} onClick={() => onToggle(mark.id)} style={buttonBase}>
        <ToolIcon name={mark.icon} emphasized={active} />
      </button>
      <button type="button" aria-label={`Set ${mark.label} color`} onClick={() => onFocusPaint(mark.id)} style={{ ...buttonBase, padding: 4 }}>
        <span aria-hidden="true" style={{ width: 14, height: 14, display: 'block', border: '1px solid #eef0f3', borderRadius: '50%', background: paint?.color || '#f5c229', opacity: Math.max(0.05, Math.min(1, Number(paint?.opacity ?? 30) / 100)), boxShadow: '0 0 0 1px #090b0e' }} />
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
  onLinkCancel,
}) {
  const hasSelection = Boolean(selection?.pages?.length);
  if (!hasSelection) return null;
  const linkActive = activeMarkupTypes.includes('link');
  const redactActive = activeMarkupTypes.includes('redact');
  return (
    <div data-text-selection-action-bar="true" style={{ width: '100%' }}>
      <div role="toolbar" aria-label="Text markup toolbar" style={{ width: '100%', height: 35, minHeight: 35, display: 'flex', alignItems: 'center', justifyContent: 'safe center', gap: 'clamp(1px, 0.6vw, 12px)', overflowX: 'auto', borderBottom: '1px solid #30353e', background: 'linear-gradient(100deg, #15191f, #1b1f26)', color: '#e8e2d4', boxSizing: 'border-box' }} onPointerDown={(event) => { if (!event.target.closest('input, [data-text-link-control]')) event.preventDefault(); }}>
        <>
          {MARKS.map((mark) => <MarkControl key={mark.id} mark={mark} active={activeMarkupTypes.includes(mark.id)} focused={focusedPaintMark === mark.id} paint={paintByMark[mark.id]} onToggle={onAction} onFocusPaint={onFocusPaint} />)}
          <button type="button" aria-label={linkEditorOpen ? 'Close Hyperlink editor' : linkActive ? 'Edit Hyperlink' : 'Add Hyperlink'} aria-pressed={linkActive} onClick={() => onAction('link')} style={buttonBase}><ToolIcon name="formatHyperlink" emphasized={linkActive} /></button>
          <button type="button" aria-label={`${redactActive ? 'Remove' : 'Apply'} Redact`} aria-pressed={redactActive} onClick={() => onAction('redact')} style={buttonBase}><ToolIcon name="formatRedact" emphasized={redactActive} size={21} /></button>
        </>
      </div>
      {hasSelection && linkEditorOpen && (
        <form data-text-link-editor="true" aria-label="Hyperlink controls" onSubmit={(event) => { event.preventDefault(); onLinkSubmit?.(); }} style={{ width: '100%', minHeight: 52, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '7px 12px', overflowX: 'hidden', borderBottom: '1px solid #343942', background: 'linear-gradient(100deg, #171b21, #22262e)', boxShadow: '0 5px 16px rgba(0,0,0,.25)', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', padding: 3, border: '1px solid #474d58', borderRadius: 7, background: '#15181d' }}>
            {[['web', 'Web address'], ['page', 'Page in document']].map(([mode, label]) => (
              <button key={mode} data-text-link-control="true" type="button" aria-pressed={linkMode === mode} onClick={() => onLinkModeChange?.(mode)} style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 5, background: linkMode === mode ? '#343a45' : 'transparent', color: linkMode === mode ? '#fff' : '#b9bec7', boxShadow: linkMode === mode ? '0 1px 3px rgba(0,0,0,.5)' : 'none', fontSize: 12, cursor: 'pointer' }}>{label}</button>
            ))}
          </div>
          <input autoFocus aria-label={linkMode === 'page' ? 'Page number' : 'Web address'} inputMode={linkMode === 'page' ? 'numeric' : 'url'} value={linkValue} onChange={(event) => onLinkValueChange?.(event.target.value)} placeholder={linkMode === 'page' ? '1' : 'https://example.com'} style={{ width: 360, maxWidth: '100%', minWidth: 0, flex: '1 1 220px', height: 35, padding: '0 11px', border: `1px solid ${linkError ? '#e45b5b' : '#555b67'}`, borderRadius: 5, outline: 0, background: '#12151a', color: '#f2f3f5', fontSize: 12, boxSizing: 'border-box' }} />
          <div data-text-link-actions="true" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button data-text-link-control="true" type="submit" aria-label="Apply hyperlink" style={{ height: 34, padding: '0 16px', border: '1px solid #d1a125', borderRadius: 6, background: '#d4a11e', color: '#16191e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
            <button data-text-link-control="true" type="button" aria-label="Cancel hyperlink" onClick={onLinkCancel} style={{ height: 34, padding: '0 16px', border: '1px solid #4d535e', borderRadius: 6, background: '#2b3039', color: '#d9dce2', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          </div>
          {linkError && <span role="alert" style={{ width: '100%', color: '#ff8b8b', fontSize: 11, textAlign: 'center' }}>{linkError}</span>}
        </form>
      )}
    </div>
  );
}
