import highlightIconSvg from '../assets/text-markup-highlight.svg';
import underlineIconSvg from '../assets/text-markup-underline.svg';
import squiggleIconSvg from '../assets/text-markup-squiggle.svg';
import strikeIconSvg from '../assets/text-markup-strike.svg';
import linkIconSvg from '../assets/text-markup-link.svg';
import redactIconSvg from '../assets/text-markup-redact.svg';

const GOLD = '#e5ad18';
const MARKS = [
  { id: 'highlight', label: 'Highlight', icon: highlightIconSvg },
  { id: 'underline', label: 'Underline', icon: underlineIconSvg },
  { id: 'squiggly', label: 'Squiggle', icon: squiggleIconSvg },
  { id: 'strikeout', label: 'Strike Through', icon: strikeIconSvg },
];

const buttonBase = {
  width: 32, height: 32, display: 'grid', placeItems: 'center', border: 0,
  borderRadius: 5, background: 'transparent', color: '#e8e2d4', cursor: 'pointer', padding: 4,
};

function ToolIcon({ src, active = false, invert = false }) {
  return <img src={src} alt="" aria-hidden="true" style={{ width: 24, height: 24, display: 'block', objectFit: 'contain', opacity: active ? 1 : 0.68, filter: invert ? 'invert(1)' : undefined }} />;
}

function MarkControl({ mark, active, focused, paint, onToggle, onFocusPaint }) {
  return (
    <div data-text-mark-control={mark.id} style={{ height: 36, display: 'flex', alignItems: 'center', gap: 1, padding: 1, border: `1px solid ${focused ? GOLD : 'transparent'}`, borderRadius: 7, background: focused ? '#20242b' : 'transparent', boxShadow: focused ? '0 0 0 1px #0d0f12 inset' : 'none' }}>
      <button type="button" aria-label={`${active ? 'Remove' : 'Apply'} ${mark.label}`} aria-pressed={active} onClick={() => onToggle(mark.id)} style={buttonBase}>
        <ToolIcon src={mark.icon} active={active} />
      </button>
      <button type="button" aria-label={`Set ${mark.label} color`} onClick={() => onFocusPaint(mark.id)} style={{ ...buttonBase, width: 30, padding: 5 }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, display: 'block', border: '1.5px solid #eef0f3', borderRadius: '50%', background: paint?.color || '#f5c229', opacity: Math.max(0.05, Math.min(1, Number(paint?.opacity ?? 30) / 100)), boxShadow: '0 0 0 1px #090b0e' }} />
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
  if (!selection?.pages?.length) return null;
  const linkActive = activeMarkupTypes.includes('link');
  const redactActive = activeMarkupTypes.includes('redact');
  return (
    <div data-text-selection-action-bar="true" style={{ width: '100%' }}>
      <div role="toolbar" aria-label="Text markup toolbar" style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, borderBottom: '1px solid #30353e', background: 'linear-gradient(100deg, #15191f, #1b1f26)', color: '#e8e2d4', boxSizing: 'border-box' }} onPointerDown={(event) => { if (!event.target.closest('input, [data-text-link-control]')) event.preventDefault(); }}>
        {MARKS.map((mark) => <MarkControl key={mark.id} mark={mark} active={activeMarkupTypes.includes(mark.id)} focused={focusedPaintMark === mark.id} paint={paintByMark[mark.id]} onToggle={onAction} onFocusPaint={onFocusPaint} />)}
        <button type="button" aria-label={`${linkActive ? 'Remove' : 'Apply'} Hyperlink`} aria-pressed={linkActive} onClick={() => onAction('link')} style={buttonBase}><ToolIcon src={linkIconSvg} active={linkActive} invert /></button>
        <button type="button" aria-label={`${redactActive ? 'Remove' : 'Apply'} Redact`} aria-pressed={redactActive} onClick={() => onAction('redact')} style={buttonBase}><ToolIcon src={redactIconSvg} active={redactActive} invert /></button>
      </div>
      {linkEditorOpen && (
        <form data-text-link-editor="true" aria-label="Hyperlink controls" onSubmit={(event) => { event.preventDefault(); onLinkSubmit?.(); }} style={{ width: '100%', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '7px 12px', borderBottom: '1px solid #343942', background: 'linear-gradient(100deg, #171b21, #22262e)', boxShadow: '0 5px 16px rgba(0,0,0,.25)', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', padding: 3, border: '1px solid #474d58', borderRadius: 7, background: '#15181d' }}>
            {[['web', 'Web address'], ['page', 'Page in document']].map(([mode, label]) => (
              <button key={mode} data-text-link-control="true" type="button" aria-pressed={linkMode === mode} onClick={() => onLinkModeChange?.(mode)} style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 5, background: linkMode === mode ? '#343a45' : 'transparent', color: linkMode === mode ? '#fff' : '#b9bec7', boxShadow: linkMode === mode ? '0 1px 3px rgba(0,0,0,.5)' : 'none', fontSize: 12, cursor: 'pointer' }}>{label}</button>
            ))}
          </div>
          <input autoFocus aria-label={linkMode === 'page' ? 'Page number' : 'Web address'} inputMode={linkMode === 'page' ? 'numeric' : 'url'} value={linkValue} onChange={(event) => onLinkValueChange?.(event.target.value)} placeholder={linkMode === 'page' ? '1' : 'https://example.com'} style={{ width: 360, maxWidth: '42vw', height: 35, padding: '0 11px', border: `1px solid ${linkError ? '#e45b5b' : '#555b67'}`, borderRadius: 5, outline: 0, background: '#12151a', color: '#f2f3f5', fontSize: 12 }} />
          <button data-text-link-control="true" type="submit" aria-label="Apply hyperlink" style={{ height: 34, padding: '0 16px', border: '1px solid #d1a125', borderRadius: 6, background: '#d4a11e', color: '#16191e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
          <button data-text-link-control="true" type="button" aria-label="Cancel hyperlink" onClick={onLinkCancel} style={{ height: 34, padding: '0 16px', border: '1px solid #4d535e', borderRadius: 6, background: '#2b3039', color: '#d9dce2', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          {linkError && <span role="alert" style={{ color: '#ff8b8b', fontSize: 11 }}>{linkError}</span>}
        </form>
      )}
    </div>
  );
}
