/**
 * LineMediaAnswer — the answer control for a Photo or Signature checklist
 * line (nightly 'custom-answers').
 *
 * The image itself is ordinary Survey Marker media (surveyMediaService): it
 * is uploaded to the `survey-media` bucket and kept in the marker's
 * `note.media`, tagged with the line's id (`lineId`), so delete, purge and
 * archive handle it like any other photo. The note's media strip leaves such
 * photos out; this control shows them on their line.
 *
 * The line's saved answer is a plain string that follows the media:
 * "2 photos" or "Signed 2026-10-26" ('' with none). An effect writes it
 * whenever the media and the answer disagree (after an upload lands, after
 * a removal), so the answer never claims a photo that is not there.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { showToast } from '../utils/toast';
import { useTooltip } from './Tooltip';
import useModalFocusTrap from '../home/useModalFocusTrap';
import { SurveyMediaViewer, useSurveyMediaUrl } from './SurveyMediaStrip';
import { buildNoteWithMedia, normalizeNoteMedia, uploadSurveyMedia } from '../services/surveyMediaService';
import { deleteSurveyMediaOrQueue } from '../services/surveyMediaDeleteQueue';
import { itemKind } from '../services/answerSets.js';
import { lineMediaAnswer, lineMediaOf } from '../services/lineMedia.js';

const stop = (e) => e.stopPropagation();

function Thumb({ item, label, width, height, onOpen }) {
  const { url } = useSurveyMediaUrl(item);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => { stop(e); onOpen(); }}
      style={{
        width, height, padding: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden',
        background: url ? `center / ${item.lineSignature ? 'contain' : 'cover'} no-repeat url("${url}") var(--surface-1)` : 'var(--panel-well)',
        cursor: 'pointer', flex: 'none',
      }}
    />
  );
}

// Draw with a finger, pen or mouse on a white pad; Save hands back a PNG.
function SignaturePad({ title, phone, onSave, onClose }) {
  const tip = useTooltip();
  const canvasRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const drawing = useRef(null);
  const [inked, setInked] = useState(false);
  const [saving, setSaving] = useState(false);
  useModalFocusTrap({ active: true, containerRef: dialogRef, initialFocusRef: closeRef, onClose });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2.2;
  }, []);

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const p = point(e);
    drawing.current = p;
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = '#111111';
    ctx.fill();
    setInked(true);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const p = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(drawing.current.x, drawing.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawing.current = p;
  };
  const up = () => { drawing.current = null; };
  const clear = () => {
    const canvas = canvasRef.current;
    const { width, height } = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    setInked(false);
  };
  const save = () => {
    setSaving(true);
    canvasRef.current.toBlob((blob) => {
      if (!blob) { setSaving(false); showToast('Couldn\'t read the signature. Try again.', 'error'); return; }
      onSave(new File([blob], 'signature.png', { type: 'image/png' }));
    }, 'image/png');
  };

  return createPortal(
    // A portal still bubbles React events to the row that opened it.
    <div
      onClick={(e) => { stop(e); onClose(); }}
      onPointerDown={stop}
      onMouseDown={stop}
      onKeyDown={stop}
      style={{ position: 'fixed', inset: 0, background: 'var(--overlay-scrim)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5600 }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Sign: ${title}`}
        data-modal-focus-layer="true"
        tabIndex={-1}
        onClick={stop}
        style={{ width: phone ? 'calc(100vw - 32px)' : 520, maxWidth: 'calc(100vw - 32px)', overflow: 'hidden', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-dialog)' }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, letterSpacing: 0, color: 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--font-ui)' }}>Sign</p>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '2px 0 0', color: 'var(--text-1)', letterSpacing: '-0.025em', fontFamily: 'var(--font-ui)' }}>{title}</h3>
          </div>
          <button type="button" ref={closeRef} onClick={onClose} aria-label="Close" {...tip('Close')} className="hub-icon-btn"><Icon name="close" size={13} /></button>
        </div>
        <div style={{ padding: '14px 16px' }}>
          <canvas
            ref={canvasRef}
            aria-label="Signature pad"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            style={{ display: 'block', width: '100%', height: phone ? 160 : 180, background: '#ffffff', borderRadius: 6, border: '1px solid var(--border)', touchAction: 'none', cursor: 'crosshair' }}
          />
          <p className="micro" style={{ margin: '6px 0 0', color: 'var(--text-3)' }}>Sign above with a finger, pen or mouse.</p>
        </div>
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-1)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={clear} disabled={!inked || saving} className="hub-btn" style={{ marginRight: 'auto' }}>Clear</button>
          <button type="button" onClick={onClose} className="hub-btn">Cancel</button>
          <button type="button" onClick={save} disabled={!inked || saving} className="hub-btn hub-btn--primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * media: { note, documentId, markerId, canEdit, onUpdateNote } — the open
 * Survey Marker's note and its functional note patch (as SurveyMarkerNotes).
 */
export default function LineMediaAnswer({ item, value, onCommit, phone = false, media }) {
  const tip = useTooltip();
  const kind = itemKind(item);
  const label = item?.text || 'Checklist';
  const { note, documentId, markerId, canEdit = true, onUpdateNote } = media || {};
  const items = lineMediaOf(note, item.id);
  const saved = value == null ? '' : String(value);
  const answer = lineMediaAnswer(item, items);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(-1);
  const [signing, setSigning] = useState(false);
  const fileRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // The answer follows the media (see the header).
  useEffect(() => {
    if (canEdit && answer !== saved) onCommit(answer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, answer, saved]);

  const upload = async (file, extra = {}) => {
    if (!documentId) { showToast('Save this document to your account before adding photos.', 'warn'); return false; }
    setBusy(true);
    try {
      const ref = await uploadSurveyMedia({ documentId, markerId, file, kind: 'photo' });
      onUpdateNote((prev) => buildNoteWithMedia(prev, [...normalizeNoteMedia(prev), { ...ref, lineId: item.id, ...extra }]), { requireExisting: true });
      return true;
    } catch (error) {
      console.warn('[surveyMedia] line upload failed', error);
      showToast(error?.code && error?.message ? error.message : `Couldn't upload the ${kind === 'signature' ? 'signature' : 'photo'}.`, error?.code === 'not-set-up' || error?.code === 'too-large' ? 'warn' : 'error');
      return false;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };
  const remove = (ref) => {
    onUpdateNote((prev) => buildNoteWithMedia(prev, normalizeNoteMedia(prev).filter((m) => m.id !== ref.id)), { requireExisting: true });
    if (ref.path) void deleteSurveyMediaOrQueue(ref);
  };
  const buttonClass = phone ? 'mobile-survey-check-btn' : 'survey-rail__answer';
  const thumbSize = phone ? 32 : 24;

  const viewer = viewing >= 0 && items[viewing] ? (
    <SurveyMediaViewer
      items={items}
      index={viewing}
      onIndexChange={setViewing}
      onClose={() => setViewing(-1)}
      onRemove={canEdit ? (ref) => { remove(ref); setViewing(-1); } : undefined}
    />
  ) : null;

  if (kind === 'signature') {
    const signed = items[items.length - 1];
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={stop}>
        {signed ? (
          <>
            <Thumb item={{ ...signed, lineSignature: true }} label={`${label} signature`} width={phone ? 84 : 64} height={thumbSize} onOpen={() => setViewing(items.length - 1)} />
            {canEdit && (
              <button type="button" className="hub-icon-btn" aria-label={`Clear ${label} signature`} {...tip('Clear the signature')} onClick={(e) => { stop(e); remove(signed); }}>
                <Icon name="close" size={11} />
              </button>
            )}
          </>
        ) : (
          <button type="button" className={buttonClass} disabled={!canEdit || busy} aria-label={`Sign ${label}`} onClick={(e) => { stop(e); setSigning(true); }}>
            {busy ? 'Saving…' : 'Sign'}
          </button>
        )}
        {signing && (
          <SignaturePad
            title={label}
            phone={phone}
            onClose={() => setSigning(false)}
            onSave={async (file) => {
              const ok = await upload(file, { name: `${label} signature` });
              if (ok && mountedRef.current) setSigning(false);
            }}
          />
        )}
        {viewer}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }} onClick={stop}>
      {items.map((m, i) => (
        <Thumb key={m.id} item={m} label={`${label} photo ${i + 1}`} width={thumbSize} height={thumbSize} onOpen={() => setViewing(i)} />
      ))}
      {canEdit && (
        <>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            aria-label={`Add a photo to ${label}`}
            {...(phone ? {} : tip('Take or add a photo for this line'))}
            onClick={(e) => { stop(e); fileRef.current?.click(); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="camera" size={phone ? 15 : 12} color="currentColor" />
            {busy ? '…' : items.length ? null : 'Photo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            data-testid={`line-photo-input-${item.id}`}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              for (const file of files) await upload(file);
            }}
          />
        </>
      )}
      {viewer}
    </span>
  );
}
