// Nightly 'signature-tool' (Drawboard PDF Pro push 2026-11-12,
// drawboard-trial/pdf-pro/apps-side-by-side.md A8).
//
//   - The Text group's Signature button opens a card with the saved
//     signatures and an Add tile.
//   - Add opens a dialog: Draw (a pad, three inks, three widths, Clear) or
//     Type (a name in one of three styles), a title, then Save. With
//     'phone-sign' a Phone tab shows a QR code; what the phone draws lands
//     on the Draw pad.
//   - Pick a signature (blue ring), then click the page: it lands centred on
//     the click and stays picked, so each further click signs again. Esc or
//     another tool lets go. A finger only pans (house rule), so a tap on a
//     tile drops it in the middle of the page in view.
// Placement is the mark library's (markLibraryPlacement.js): a picture mark,
// one save, one Undo step, and the new signature becomes the selection.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import { viewerBounds } from './SelectionQuickBar.jsx';
import {
  armLibraryItem,
  disarmLibraryItem,
  getArmedLibraryItem,
  placeLibraryItem,
  subscribeLibraryPlacement,
} from '../markLibrary/markLibraryPlacement.js';
import { insertedImageItem } from '../utils/insertedImage.js';
import { getSignatureStore } from '../signature/signatureStore.js';
import { isFeatureOn } from '../featureFlags';
import PhoneSignPanel from './PhoneSignPanel.jsx';
import SignaturePad, { SIGNATURE_PAD_H, SIGNATURE_PAD_W } from '../signature/SignaturePad.jsx';
import {
  SIGNATURE_FONTS,
  SIGNATURE_INKS,
  SIGNATURE_WIDTHS,
  drawnSignature,
  fontCss,
  typedSignature,
} from '../signature/signaturePicture.js';
import './SelectionPropertiesPanel.css';
import './SignatureCard.css';

export const SIGNATURE_ITEM_PREFIX = 'signature:';

const listeners = new Set();
let open = false;
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const isSignatureItem = (item) => String(item?.id || '').startsWith(SIGNATURE_ITEM_PREFIX);
export const isSignatureCardOpen = () => open;
export function setSignatureCardOpen(next) {
  const value = Boolean(next);
  if (value === open) return;
  open = value;
  if (!value && isSignatureItem(getArmedLibraryItem()?.item)) disarmLibraryItem();
  listeners.forEach((listener) => listener());
}
export const useSignatureCardOpen = () => useSyncExternalStore(subscribe, isSignatureCardOpen, () => false);

const useArmedId = () => useSyncExternalStore(
  subscribeLibraryPlacement,
  () => getArmedLibraryItem()?.item?.id || null,
  () => null,
);

/** A saved signature as the placement's item (a picture mark). */
export function signatureItem(row) {
  const item = insertedImageItem({ src: row.src, pixelWidth: row.width, pixelHeight: row.height, name: row.title });
  return item ? { ...item, id: `${SIGNATURE_ITEM_PREFIX}${row.id}` } : null;
}

const PAD_W = SIGNATURE_PAD_W;
const PAD_H = SIGNATURE_PAD_H;

function ChoiceRow({ label, options, value, onChange, render }) {
  return (
    <div className="signature-choice" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          aria-label={option.label}
          className="signature-choice__option"
          data-signature-choice={option.id}
          onClick={() => onChange(option.id)}
        >
          {render(option)}
        </button>
      ))}
    </div>
  );
}

export function AddSignatureDialog({ onClose, onSaved }) {
  const [tab, setTab] = useState('draw');
  // Nightly 'phone-sign': a Phone tab with a QR code (signature/phoneSign.js).
  const [phoneSignOn] = useState(() => isFeatureOn('phone-sign'));
  const tabs = phoneSignOn ? [['draw', 'Draw'], ['type', 'Type'], ['phone', 'Phone']] : [['draw', 'Draw'], ['type', 'Type']];
  const [title, setTitle] = useState('Signature');
  const [inkId, setInkId] = useState('black');
  const [widthId, setWidthId] = useState('medium');
  const [strokes, setStrokes] = useState([]);
  const [text, setText] = useState('');
  const [fontId, setFontId] = useState('script');
  const ink = (SIGNATURE_INKS.find((i) => i.id === inkId) || SIGNATURE_INKS[0]).hex;
  const lineWidth = (SIGNATURE_WIDTHS.find((w) => w.id === widthId) || SIGNATURE_WIDTHS[1]).px;
  const ready = tab === 'draw' ? strokes.some((s) => s.length) : tab === 'type' && Boolean(text.trim());
  const save = () => {
    if (!ready) return;
    const picture = tab === 'draw'
      ? drawnSignature(strokes, { width: PAD_W, height: PAD_H, ink, lineWidth })
      : typedSignature(text, { fontId, ink });
    if (!picture) return;
    const row = getSignatureStore().add({ title: title.trim() || 'Signature', ...picture });
    if (row) onSaved?.(row);
    onClose();
  };
  return (
    <DialogCard
      title="Add signature"
      onClose={onClose}
      width={500}
      atRoot
      zIndex={30000}
      as="form"
      cardProps={{ 'data-signature-dialog': 'true', onSubmit: (event) => { event.preventDefault(); save(); } }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
          <button type="submit" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={!ready}>Save</button>
        </>
      )}
    >
      <div className="signature-dialog">
        <div className="signature-tabs" role="tablist" aria-label="How to sign">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-signature-tab={id}
              className={`signature-tabs__tab${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab !== 'phone' && <div className="signature-dialog__row">
          <ChoiceRow
            label="Ink"
            options={SIGNATURE_INKS}
            value={inkId}
            onChange={setInkId}
            render={(option) => <span className="signature-ink" style={{ background: option.hex }} />}
          />
          {tab === 'draw' && (
            <ChoiceRow
              label="Pen width"
              options={SIGNATURE_WIDTHS}
              value={widthId}
              onChange={setWidthId}
              render={(option) => <span className="signature-width" style={{ height: Math.max(1, option.px) }} />}
            />
          )}
          {tab === 'draw' && (
            <button type="button" className="hub-btn signature-clear" onClick={() => setStrokes([])} disabled={!strokes.length}>Clear</button>
          )}
        </div>}
        {tab === 'phone' && (
          <PhoneSignPanel onStrokes={(next) => { setStrokes(next); setTab('draw'); }} />
        )}
        {tab === 'phone' ? null : tab === 'draw' ? (
          <SignaturePad strokes={strokes} setStrokes={setStrokes} ink={ink} lineWidth={lineWidth} />
        ) : (
          <>
            <label style={{ display: 'block' }}>
              <span style={DIALOG_LABEL_STYLE}>Name</span>
              <input
                type="text"
                value={text}
                maxLength={60}
                autoFocus
                data-signature-name="true"
                style={DIALOG_FIELD_STYLE}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <div className="signature-fonts" role="radiogroup" aria-label="Style">
              {SIGNATURE_FONTS.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  role="radio"
                  aria-checked={fontId === font.id}
                  aria-label={font.label}
                  data-signature-font={font.id}
                  className="signature-fonts__option"
                  style={{ font: fontCss(font.id, 26), color: ink }}
                  onClick={() => setFontId(font.id)}
                >
                  {text.trim() || 'Your name'}
                </button>
              ))}
            </div>
          </>
        )}
        <label style={{ display: 'block' }}>
          <span style={DIALOG_LABEL_STYLE}>Title</span>
          <input
            type="text"
            value={title}
            maxLength={60}
            data-signature-title="true"
            style={DIALOG_FIELD_STYLE}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      </div>
    </DialogCard>
  );
}

export default function SignatureCard({ enabled = false, phone = false, tip = null }) {
  const isOpen = useSignatureCardOpen();
  const armedId = useArmedId();
  const store = getSignatureStore();
  const rows = useSyncExternalStore(store.subscribe, store.get, store.get);
  const items = useMemo(() => rows.map((row) => ({ row, item: signatureItem(row) })).filter((x) => x.item), [rows]);
  const [frame, setFrame] = useState(null);
  const [adding, setAdding] = useState(false);
  const pointerTypeRef = useRef('mouse');
  const active = enabled && isOpen;

  useEffect(() => {
    if (!active) return undefined;
    const place = () => {
      const b = viewerBounds(phone);
      setFrame({ top: b.top + 10, right: Math.max(10, window.innerWidth - b.right + 10) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [active, phone]);

  useEffect(() => {
    if (!active || adding) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' || armedId) return;
      setSignatureCardOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, armedId, adding]);

  useEffect(() => () => setSignatureCardOpen(false), []);
  useEffect(() => { if (!active) setAdding(false); }, [active]);

  const pick = useCallback((item) => {
    if (pointerTypeRef.current === 'touch' || phone) {
      placeLibraryItem(item, { center: true });
      return;
    }
    if (getArmedLibraryItem()?.item?.id === item.id) disarmLibraryItem();
    else armLibraryItem(item, { keep: true });
  }, [phone]);

  if (!active || !frame || typeof document === 'undefined') return null;
  const chip = typeof tip === 'function' ? tip : () => ({});
  return (
    <>
      {createPortal(
        <section
          className="props-panel signature-card"
          data-signature-card=""
          data-mark-library-panel=""
          aria-label="Signature"
          style={{ top: frame.top, right: frame.right }}
        >
          <header className="props-panel__header">
            <div className="props-panel__heading"><div className="props-panel__count">Signature</div></div>
            <button
              type="button"
              className="props-panel__icon-button"
              aria-label="Close"
              onClick={() => setSignatureCardOpen(false)}
              {...chip('Close', 'below')}
            >
              <Icon name="close" size={16} color="currentColor" />
            </button>
          </header>
          <div className="props-panel__body">
            <div className="signature-card__list" role="listbox" aria-label="Saved signatures">
              {items.map(({ row, item }) => (
                <div key={row.id} className="signature-card__slot">
                  <button
                    type="button"
                    role="option"
                    aria-selected={armedId === item.id}
                    aria-label={row.title}
                    className="signature-card__tile"
                    data-signature-id={row.id}
                    onPointerDown={(event) => { pointerTypeRef.current = event.pointerType || 'mouse'; }}
                    onClick={() => pick(item)}
                    {...chip(phone ? row.title : `${row.title}: pick, then click the page`, 'below')}
                  >
                    <img src={row.src} alt="" draggable={false} />
                    <span className="signature-card__title">{row.title}</span>
                  </button>
                  <button
                    type="button"
                    className="props-panel__icon-button signature-card__remove"
                    aria-label={`Delete ${row.title}`}
                    data-signature-remove={row.id}
                    onClick={() => {
                      if (armedId === item.id) disarmLibraryItem();
                      store.remove(row.id);
                    }}
                    {...chip('Delete', 'below')}
                  >
                    <Icon name="trash" size={14} color="currentColor" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="signature-card__add"
                data-signature-add="true"
                onClick={() => {
                  // Nothing stays picked under the dialog: a press on it must not sign the page.
                  disarmLibraryItem();
                  setAdding(true);
                }}
              >
                <Icon name="plus" size={16} color="currentColor" />
                <span>Add signature</span>
              </button>
            </div>
          </div>
        </section>,
        document.body,
      )}
      {adding && (
        <AddSignatureDialog
          onClose={() => setAdding(false)}
          onSaved={(row) => {
            // A new signature is picked at once, ready to place.
            const item = signatureItem(row);
            if (item && !phone) armLibraryItem(item, { keep: true });
          }}
        />
      )}
    </>
  );
}
