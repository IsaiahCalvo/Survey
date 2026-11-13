/* Nightly 'equation-tool': Drawboard's Insert > Equation card.
 *   - Equation in the Text group (EQUATION_OPEN_EVENT) opens "New equation":
 *     type LaTeX, the drawing below follows as you type; Insert drops it in
 *     the middle of the page in view (one save, one Undo step, picked).
 *   - Equation on the picked bar (EQUATION_EDIT_EVENT) opens it again; Save
 *     redraws it in place.
 * MathJax loads only when the card first opens (utils/equationRender.js).
 * The mark and its rules: utils/equation.js. */
import { useCallback, useEffect, useRef, useState } from 'react';
import DialogCard, { DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import { useTooltip } from './Tooltip';
import { placeLibraryItem } from '../markLibrary/markLibraryPlacement.js';
import { showToast } from '../utils/toast';
import {
  EQUATION_COLORS,
  EQUATION_DEFAULT_COLOR,
  EQUATION_EDIT_EVENT,
  EQUATION_OPEN_EVENT,
  EQUATION_TEX_MAX,
  equationItem,
} from '../utils/equation.js';
import './EquationHost.css';

const loadRenderer = () => import('../utils/equationRender.js');

export function EquationDialog({ open, mode = 'create', initial = null, onSubmit, onCancel }) {
  const tip = useTooltip();
  const [tex, setTex] = useState('');
  const [color, setColor] = useState(EQUATION_DEFAULT_COLOR);
  // { tex, color, picture } once drawn, or { error }.
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setTex(initial?.tex || '');
    setColor(initial?.color || EQUATION_DEFAULT_COLOR);
    setPreview(null);
  }, [open, initial]);
  useEffect(() => {
    if (open) fieldRef.current?.focus?.();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    if (!tex.trim()) { setPreview(null); return undefined; }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const { renderTexToPng } = await loadRenderer();
        const picture = await renderTexToPng(tex, color);
        if (!stale) setPreview({ tex, color, picture });
      } catch (error) {
        if (!stale) setPreview({ error: String(error?.message || 'That equation could not be drawn.') });
      }
    }, 220);
    return () => { stale = true; clearTimeout(timer); };
  }, [open, tex, color]);

  const ready = Boolean(preview?.picture) && preview.tex === tex && preview.color === color;
  const submit = async () => {
    if (busy || !tex.trim()) return;
    setBusy(true);
    try {
      const picture = ready ? preview.picture : await (await loadRenderer()).renderTexToPng(tex, color);
      onSubmit?.({ tex, color, picture });
    } catch (error) {
      setPreview({ error: String(error?.message || 'That equation could not be drawn.') });
    } finally {
      setBusy(false);
    }
  };
  const title = mode === 'edit' ? 'Edit equation' : 'New equation';
  return (
    <DialogCard
      open={open}
      title={title}
      ariaLabel={title}
      onClose={onCancel}
      width={440}
      zIndex={1400}
      cardProps={{ 'data-equation-dialog': mode }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="hub-btn hub-btn--primary dialog-touch-pad"
            data-equation-submit=""
            disabled={!tex.trim() || Boolean(preview?.error) || busy}
            onClick={submit}
          >
            {mode === 'edit' ? 'Save' : 'Insert'}
          </button>
        </>
      )}
    >
      <span style={DIALOG_LABEL_STYLE} id="equation-tex-label">LaTeX</span>
      <textarea
        ref={fieldRef}
        className="dialog-prompt-input equation-dialog__tex"
        aria-labelledby="equation-tex-label"
        placeholder={'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={EQUATION_TEX_MAX}
        rows={3}
        value={tex}
        onChange={(e) => setTex(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
      />
      <div className="equation-dialog__preview" data-equation-preview="" aria-live="polite">
        {preview?.picture && (
          <img
            src={preview.picture.src}
            alt="Equation preview"
            style={{ width: preview.picture.pixelWidth, maxWidth: '100%', height: 'auto' }}
          />
        )}
        {preview?.error && <span role="alert" className="equation-dialog__error">{preview.error}</span>}
        {!preview && <span className="equation-dialog__hint">The equation shows here as you type.</span>}
      </div>
      <span style={DIALOG_LABEL_STYLE} id="equation-colour-label">Colour</span>
      <div className="equation-dialog__colours" role="radiogroup" aria-labelledby="equation-colour-label">
        {EQUATION_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={color === c.hex}
            aria-label={c.label}
            {...tip(c.label, 'below')}
            className={`equation-dialog__swatch${color === c.hex ? ' is-on' : ''}`}
            style={{ background: c.hex }}
            data-equation-colour={c.id}
            onClick={() => setColor(c.hex)}
          />
        ))}
      </div>
    </DialogCard>
  );
}

export default function EquationHost({
  isActive = true,
  readOnly = false,
  selectedEquation = null, // { id, tex, color } for the one picked equation
  onPatchSelectedEquation = null,
}) {
  const [dialog, setDialog] = useState(null); // { mode, initial }
  useEffect(() => {
    if (!isActive) setDialog(null);
  }, [isActive]);
  useEffect(() => {
    if (!isActive) return undefined;
    const onOpen = () => {
      if (readOnly) return;
      setDialog({ mode: 'create', initial: null });
    };
    window.addEventListener(EQUATION_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(EQUATION_OPEN_EVENT, onOpen);
  }, [isActive, readOnly]);
  const selectedRef = useRef(selectedEquation);
  selectedRef.current = selectedEquation;
  useEffect(() => {
    if (!isActive) return undefined;
    const onEdit = () => {
      const picked = selectedRef.current;
      if (!picked || readOnly) return;
      setDialog({ mode: 'edit', initial: { tex: picked.tex, color: picked.color } });
    };
    window.addEventListener(EQUATION_EDIT_EVENT, onEdit);
    return () => window.removeEventListener(EQUATION_EDIT_EVENT, onEdit);
  }, [isActive, readOnly]);

  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const close = useCallback(() => setDialog(null), []);
  const submit = useCallback(({ tex, color, picture }) => {
    const current = dialogRef.current;
    dialogRef.current = null;
    setDialog(null);
    if (!current || !picture) return;
    if (current.mode === 'edit') {
      onPatchSelectedEquation?.({ ...picture, tex, color });
      return;
    }
    const item = equationItem({ ...picture, tex, color });
    if (!item || !placeLibraryItem(item, { center: true })) {
      showToast('The equation could not be placed.', 'error');
    }
  }, [onPatchSelectedEquation]);

  return (
    <EquationDialog
      open={Boolean(dialog)}
      mode={dialog?.mode || 'create'}
      initial={dialog?.initial || null}
      onSubmit={submit}
      onCancel={close}
    />
  );
}
