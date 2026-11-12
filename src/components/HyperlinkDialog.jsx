/* Nightly 'link-tool': Drawboard's "New hyperlink" card, shown in the middle
   of the screen after a box is dragged with the Hyperlink tool, and again
   (as "Edit hyperlink") from Link on the picked bar. Link to a page, a
   website, or an area (Choose Area: the next box dragged sets it), pick a
   style and a colour. Rules: utils/linkTool.js. */
import { useEffect, useRef, useState } from 'react';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import ButtonGroup from './ButtonGroup.jsx';
import { LINK_COLORS, LINK_DEFAULT_COLOR, LINK_STYLES, LINK_TARGETS, resolveLinkInput } from '../utils/linkTool.js';
import { useTooltip } from './Tooltip';

const GAP = { marginBottom: 14 };

const startValue = (link) => {
  if (!link) return '';
  if (link.kind === 'url') return link.href;
  if (link.kind === 'page') return String(link.page);
  return '';
};

export default function HyperlinkDialog({
  open,
  mode = 'create', // 'create' | 'edit'
  initial = null, // { link, style, color } when editing, or the last style / colour used
  numPages = 1,
  onSubmit,
  onCancel,
}) {
  const tip = useTooltip();
  const [kind, setKind] = useState('page');
  const [value, setValue] = useState('');
  const [style, setStyle] = useState('box');
  const [color, setColor] = useState(LINK_DEFAULT_COLOR);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setKind(initial?.link?.kind || 'page');
    setValue(startValue(initial?.link));
    setStyle(initial?.style || 'box');
    setColor(initial?.color || LINK_DEFAULT_COLOR);
    setError('');
  }, [open, initial]);
  useEffect(() => {
    if (open && kind !== 'area') inputRef.current?.focus?.();
  }, [open, kind]);

  const keepsArea = mode === 'edit' && kind === 'area' && initial?.link?.kind === 'area';
  const ready = kind === 'area' || String(value).trim() !== '';
  const submit = () => {
    if (!ready) return;
    if (keepsArea) {
      onSubmit?.({ link: initial.link, style, color });
      return;
    }
    const result = resolveLinkInput(kind, value, numPages);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSubmit?.({ link: result.link || null, pendingArea: Boolean(result.pendingArea), style, color });
  };
  const pickKind = (next) => {
    setKind(next);
    setValue(next === initial?.link?.kind ? startValue(initial.link) : '');
    setError('');
  };

  const action = kind === 'area' && !keepsArea ? 'Choose Area' : mode === 'edit' ? 'Save' : 'Create';
  return (
    <DialogCard
      open={open}
      title={mode === 'edit' ? 'Edit hyperlink' : 'New hyperlink'}
      ariaLabel={mode === 'edit' ? 'Edit hyperlink' : 'New hyperlink'}
      onClose={onCancel}
      width={380}
      zIndex={1400}
      cardProps={{ 'data-hyperlink-dialog': mode }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="hub-btn hub-btn--primary dialog-touch-pad"
            disabled={!ready}
            data-hyperlink-submit=""
            onClick={submit}
          >
            {action}
          </button>
        </>
      )}
    >
      <span style={DIALOG_LABEL_STYLE} id="hyperlink-target-label">Link to</span>
      <div style={GAP} data-hyperlink-targets="">
        <ButtonGroup
          value={kind}
          labelledBy="hyperlink-target-label"
          fill
          options={LINK_TARGETS.map((t) => ({ value: t.id, label: t.label }))}
          onChange={pickKind}
        />
      </div>
      {kind !== 'area' && (
        <label style={{ display: 'block', ...GAP }}>
          <span style={DIALOG_LABEL_STYLE}>{kind === 'page' ? `Page number (1 to ${numPages})` : 'Web address'}</span>
          <input
            ref={inputRef}
            className="dialog-prompt-input"
            type="text"
            inputMode={kind === 'page' ? 'numeric' : 'url'}
            aria-label={kind === 'page' ? 'Page number' : 'Web address'}
            placeholder={kind === 'page' ? '' : 'https://example.com'}
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            style={DIALOG_FIELD_STYLE}
          />
        </label>
      )}
      {kind === 'area' && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 14px' }}>
          {keepsArea ? 'Keeps the area it opens now.' : 'Next, drag a box round the area this link should open.'}
        </p>
      )}
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--danger, #d14343)', marginTop: -8, marginBottom: 12 }}>{error}</div>}
      <span style={DIALOG_LABEL_STYLE} id="hyperlink-style-label">Style</span>
      <div style={GAP} data-hyperlink-styles="">
        <ButtonGroup
          value={style}
          labelledBy="hyperlink-style-label"
          size="sm"
          fill
          options={LINK_STYLES.map((s) => ({ value: s.id, label: s.id === 'none' ? 'None' : s.id === 'dashed' ? 'Dashed' : s.label }))}
          onChange={setStyle}
        />
      </div>
      <span style={DIALOG_LABEL_STYLE}>Colour</span>
      <div role="group" aria-label="Colour" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {LINK_COLORS.map((c) => {
          const on = color.toLowerCase() === c.color.toLowerCase();
          return (
            <button
              key={c.id}
              type="button"
              aria-label={c.label}
              aria-pressed={on}
              data-hyperlink-color={c.id}
              {...tip(c.label, 'below')}
              onClick={() => setColor(c.color)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: c.color,
                border: '1px solid var(--ink-ring)',
                boxShadow: on ? '0 0 0 2px var(--surface-2), 0 0 0 4px var(--text-1)' : 'none',
                padding: 0,
                cursor: 'pointer',
              }}
            />
          );
        })}
      </div>
    </DialogCard>
  );
}
