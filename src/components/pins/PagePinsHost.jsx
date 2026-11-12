/* Nightly 'comment-pins': the viewer side of page pins, mounted once.
 *   - Loads the document's comments (pins are page threads with a spot) and
 *     keeps them live, into services/pagePinsStore for every page's layer.
 *   - N arms the Pin tool; while it is on, M cycles Comment, Issue, Task.
 *   - The composer opens beside a new pin: Enter makes a new line, the send
 *     button (or Ctrl / Cmd + Enter) saves. The tool stays on afterwards.
 *   - A pin's card opens beside it: header (Comment, or ISS-7 with its status
 *     pill), author row with Edit / Copy link / Delete, the words, replies and
 *     "Add a reply".
 *   - A dragged pin moves (PIN_MOVE_EVENT from the layer).
 * Rules: utils/pagePins.js. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../supabaseClient';
import { useMarkComments } from '../../hooks/useMarkComments.js';
import { useConfirmDialog } from '../dialogPrompts';
import { useTooltip } from '../Tooltip';
import { showToast } from '../../utils/toast';
import { isTypingTarget } from '../../utils/typingTarget.js';
import { requestMarkCommentsFocus } from '../../services/markCommentsFocus.js';
import {
  addMarkComment,
  addPagePin,
  commentShareUrl,
  deleteMarkComment,
  editMarkComment,
  insertMention,
  matchPeople,
  MARK_COMMENT_MAX_CHARS,
  mentionQueryAt,
  mentionsInText,
  notifyCommentMentions,
  personLabel,
  updatePagePin,
} from '../../services/markComments.js';
import { getPagePinsState, setPagePinsState, usePagePins } from '../../services/pagePinsStore.js';
import {
  PIN_KIND_LABELS,
  PIN_KINDS,
  PIN_STATUS_LABELS,
  PIN_STATUSES,
  PIN_TOOL_ID,
  isPinCycleKey,
  isPinToolKey,
  nextPinKind,
  pinCode,
  pinStatusColor,
  readPinFilter,
  PIN_INK,
} from '../../utils/pagePins.js';
import { PinFace, PIN_MOVE_EVENT } from './PagePinsLayer.jsx';
import { PinKindGlyph, PinSendGlyph } from './PinGlyphs.jsx';

const CARD_GAP = 8;
const GUTTER = 12;

const cardStyle = (width) => ({
  position: 'fixed',
  width,
  maxWidth: `calc(100vw - ${GUTTER * 2}px)`,
  boxSizing: 'border-box',
  background: 'var(--surface-2)',
  color: 'var(--text-1)',
  border: '1px solid var(--surface-3)',
  borderRadius: 10,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
  padding: 10,
  // Over the page layers and the picked bar (5700).
  zIndex: 5800,
  fontSize: 13,
});
const iconBtn = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-2)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 16,
};
const textBtn = {
  border: 'none',
  background: 'transparent',
  color: 'var(--text-2)',
  cursor: 'pointer',
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 6,
};

function timeLabel(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Beside the pin (right, else left), top-aligned; on a narrow screen, under it. */
function useBesideAnchor(anchor, width, open) {
  const [pos, setPos] = useState(null);
  const cardRef = useRef(null);
  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return undefined; }
    let raf = 0;
    const tick = () => {
      const el = document.querySelector(`[data-page-pin-anchor="${anchor}"]`);
      const r = el?.getBoundingClientRect();
      if (r) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = Math.min(width, vw - GUTTER * 2);
        const h = cardRef.current?.offsetHeight || 160;
        let left = r.right + CARD_GAP;
        let top = r.top;
        if (left + w > vw - GUTTER) left = r.left - CARD_GAP - w;
        if (left < GUTTER) {
          left = Math.max(GUTTER, Math.min(vw - GUTTER - w, r.left));
          top = r.bottom + CARD_GAP;
        }
        top = Math.max(GUTTER, Math.min(vh - GUTTER - h, top));
        setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [anchor, width, open]);
  return [pos, cardRef];
}

/** A text box that offers people after "@". Enter: new line (or save, for a reply). */
function PinTextBox({ people, placeholder, initial = '', initialMentions = [], enterSaves = false, autoFocus = false, onSubmit, onChange, boxRef, minHeight = 36 }) {
  const [text, setText] = useState(initial);
  const [picked, setPicked] = useState(() => (people || []).filter((p) => initialMentions.includes(p.id)));
  const [mention, setMention] = useState(null);
  const [active, setActive] = useState(0);
  const areaRef = useRef(null);
  const matches = mention ? matchPeople(people, mention.query) : [];

  useEffect(() => { onChange?.(text); }, [text, onChange]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.max(minHeight, area.scrollHeight)}px`;
  }, [text, minHeight]);
  useLayoutEffect(() => {
    if (!autoFocus) return;
    const area = areaRef.current;
    area?.focus({ preventScroll: true });
    area?.setSelectionRange(area.value.length, area.value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const read = (value, caret) => { setMention(mentionQueryAt(value, caret)); setActive(0); };
  const pick = (person) => {
    if (!mention) return;
    const { text: next, caret } = insertMention(text, mention, person);
    setText(next);
    setPicked((c) => (c.some((p) => p.id === person.id) ? c : [...c, person]));
    setMention(null);
    requestAnimationFrame(() => { areaRef.current?.focus(); areaRef.current?.setSelectionRange(caret, caret); });
  };
  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    const ok = await onSubmit?.(body, mentionsInText(body, picked));
    if (ok !== false) { setText(''); setPicked([]); setMention(null); }
  };
  if (boxRef) {
    boxRef.current = {
      submit,
      startMention: () => {
        const area = areaRef.current;
        if (!area) return;
        const caret = area.selectionStart ?? text.length;
        const before = text.slice(0, caret);
        const add = before && !/\s$/.test(before) ? ' @' : '@';
        const next = before + add + text.slice(caret);
        setText(next);
        requestAnimationFrame(() => {
          area.focus();
          const at = caret + add.length;
          area.setSelectionRange(at, at);
          read(next, at);
        });
      },
    };
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={areaRef}
        value={text}
        rows={1}
        maxLength={MARK_COMMENT_MAX_CHARS}
        placeholder={placeholder}
        aria-label={placeholder}
        data-pin-input="true"
        onChange={(e) => { setText(e.target.value); read(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (enterSaves && !e.shiftKey))) { e.preventDefault(); submit(); }
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'none',
          minHeight,
          maxHeight: 200,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--surface-3)',
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
          font: 'inherit',
          fontSize: 13,
          lineHeight: 1.4,
          outline: 'none',
        }}
      />
      {matches.length > 0 && (
        <div role="listbox" aria-label="People on this document" style={{ ...cardStyle(240), position: 'absolute', left: 0, top: '100%', padding: 4, zIndex: 2 }}>
          {matches.map((person, index) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => { e.preventDefault(); pick(person); }}
              style={{ ...textBtn, display: 'block', width: '100%', textAlign: 'left', background: index === active ? 'var(--surface-3)' : 'transparent', color: 'var(--text-1)' }}
            >
              {personLabel(person)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ kind, status, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const color = pinStatusColor(kind, status);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-pin-status-pill={status}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${PIN_STATUS_LABELS[status]}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          border: 'none',
          borderRadius: 999,
          background: color,
          color: PIN_INK,
          fontSize: 11,
          fontWeight: 600,
          padding: '3px 9px',
          cursor: disabled ? 'default' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {PIN_STATUS_LABELS[status]}
        {!disabled && <span aria-hidden="true" style={{ fontSize: 10 }}>▾</span>}
      </button>
      {open && (
        <div role="listbox" aria-label="Status" style={{ ...cardStyle(150), position: 'absolute', right: 0, top: 'calc(100% + 4px)', padding: 4 }}>
          {(PIN_STATUSES[kind] || []).map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={s === status}
              data-pin-status-option={s}
              onClick={() => { setOpen(false); if (s !== status) onChange?.(s); }}
              style={{ ...textBtn, display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', color: 'var(--text-1)', background: s === status ? 'var(--surface-3)' : 'transparent' }}
            >
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: pinStatusColor(kind, s) }} />
              {PIN_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function KindSwitch({ kind, onKind }) {
  return (
    <div role="radiogroup" aria-label="Pin type" style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      {PIN_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={k === kind}
          data-pin-kind-option={k}
          onClick={() => onKind(k)}
          style={{ ...textBtn, display: 'inline-flex', alignItems: 'center', gap: 4, background: k === kind ? 'var(--surface-3)' : 'transparent', color: k === kind ? 'var(--text-1)' : 'var(--text-2)' }}
        >
          <PinKindGlyph kind={k} size={14} />
          {PIN_KIND_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

function PinComposer({ draft, people, coarse, onSave, onDiscard }) {
  const tip = useTooltip();
  const [status, setStatus] = useState('draft');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const [pos, cardRef] = useBesideAnchor('draft', 320, true);
  const kind = draft.kind;
  const noun = PIN_KIND_LABELS[kind];
  const save = async (body, mentions) => {
    if (busy) return false;
    setBusy(true);
    const ok = await onSave({ body, mentions, status: kind === 'comment' ? null : status });
    setBusy(false);
    return ok;
  };
  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`New ${noun.toLowerCase()}`}
      data-pin-composer={kind}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDiscard(); } }}
      style={{ ...cardStyle(320), left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {coarse && <KindSwitch kind={kind} onKind={(k) => setPagePinsState((s) => ({ kind: k, draft: s.draft ? { ...s.draft, kind: k } : null }))} />}
      {kind !== 'comment' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>{noun}</strong>
          <StatusPill kind={kind} status={status} onChange={setStatus} />
        </div>
      )}
      <PinTextBox
        key={kind}
        boxRef={boxRef}
        people={people}
        placeholder={kind === 'comment' ? 'Add a comment' : 'Add a short summary...'}
        autoFocus
        onChange={setText}
        onSubmit={save}
      />
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 8, gap: 4 }}>
        <button type="button" style={iconBtn} aria-label="Mention someone" {...tip('Mention someone', 'below')} onClick={() => boxRef.current?.startMention()}>@</button>
        <span style={{ flex: 1 }} />
        <button type="button" style={iconBtn} aria-label={`Discard new ${noun.toLowerCase()}`} {...tip('Discard', 'below')} data-pin-discard="true" onClick={onDiscard}>✕</button>
        <button
          type="button"
          aria-label={`Save ${noun.toLowerCase()}`}
          {...tip(`Save ${noun.toLowerCase()}`, 'below')}
          data-pin-save="true"
          disabled={!text.trim() || busy}
          onClick={() => boxRef.current?.submit()}
          style={{ ...iconBtn, borderRadius: '50%', background: text.trim() && !busy ? 'var(--accent, #2f6fed)' : 'var(--surface-3)', color: PIN_INK }}
        >
          <PinSendGlyph />
        </button>
      </div>
    </div>,
    document.body,
  );
}

function PinCard({ pin, replies, people, userId, canWrite, panelOn, documentId, onClose, onEditBody, onDelete, onReply, onStatus, onDeleteReply }) {
  const tip = useTooltip();
  const [pos, cardRef] = useBesideAnchor(pin.id, 360, true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const editRef = useRef(null);
  const author = people.find((p) => p.id === pin.authorId);
  const mine = Boolean(userId && pin.authorId === userId);
  const title = pin.kind === 'comment' ? 'Comment' : pinCode(pin);
  const copyLink = async (id) => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(commentShareUrl(window.location, documentId, id));
      showToast('Link copied', 'success');
    } catch {
      showToast('Could not copy the link');
    }
  };
  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={title}
      data-pin-card={pin.kind}
      data-pin-card-id={pin.id}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      style={{ ...cardStyle(360), left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }} data-pin-card-title="true">{title}</strong>
        <span style={{ flex: 1 }} />
        {pin.kind !== 'comment' && <StatusPill kind={pin.kind} status={pin.status} disabled={!canWrite} onChange={onStatus} />}
        {panelOn && (
          <button type="button" style={iconBtn} aria-label="Open in the Comments panel" {...tip('Open in the Comments panel', 'below')} onClick={() => requestMarkCommentsFocus({ documentId, commentId: pin.id, pageNumber: pin.pageNumber })}>
            ⇱
          </button>
        )}
        <button type="button" style={iconBtn} aria-label="Close" {...tip('Close', 'below')} onClick={onClose}>✕</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PinFace kind="comment" authorId={pin.authorId} people={people} size={24} />
        <span style={{ fontWeight: 600 }}>{pin.authorId ? personLabel(author) : 'Former member'}{mine ? ' (you)' : ''}</span>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{timeLabel(pin.createdAt)}{pin.comment?.editedAt ? ' · edited' : ''}</span>
        <span style={{ flex: 1 }} />
        <span style={{ position: 'relative' }}>
          <button type="button" style={iconBtn} aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} data-pin-card-menu="true" {...tip('More', 'below')} onClick={() => setMenuOpen((o) => !o)}>⋮</button>
          {menuOpen && (
            <div role="menu" style={{ ...cardStyle(150), position: 'absolute', right: 0, top: 'calc(100% + 4px)', padding: 4 }}>
              {mine && canWrite && (
                <button type="button" role="menuitem" style={{ ...textBtn, display: 'block', width: '100%', textAlign: 'left', color: 'var(--text-1)' }} onClick={() => { setMenuOpen(false); setEditing(true); }}>Edit</button>
              )}
              <button type="button" role="menuitem" style={{ ...textBtn, display: 'block', width: '100%', textAlign: 'left', color: 'var(--text-1)' }} onClick={() => copyLink(pin.id)}>Copy Link</button>
              {canWrite && (mine || !pin.authorId) && (
                <button type="button" role="menuitem" style={{ ...textBtn, display: 'block', width: '100%', textAlign: 'left', color: 'var(--danger, #d14343)' }} onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button>
              )}
            </div>
          )}
        </span>
      </div>
      {editing ? (
        <div style={{ marginTop: 6 }}>
          <PinTextBox boxRef={editRef} people={people} placeholder="Edit" initial={pin.body} initialMentions={pin.comment?.mentions || []} autoFocus onSubmit={async (body, mentions) => { const ok = await onEditBody(body, mentions); if (ok !== false) setEditing(false); return ok; }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 6 }}>
            <button type="button" style={textBtn} onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" style={{ ...textBtn, color: 'var(--text-1)', fontWeight: 600 }} data-pin-edit-save="true" onClick={() => editRef.current?.submit()}>Save</button>
          </div>
        </div>
      ) : (
        <div data-pin-card-body="true" style={{ margin: '6px 0 8px 32px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-1)' }}>{pin.body}</div>
      )}
      {replies.length > 0 && (
        <div style={{ borderTop: '1px solid var(--surface-3)', paddingTop: 6, marginBottom: 6, maxHeight: 220, overflowY: 'auto' }}>
          {replies.map((r) => {
            const who = people.find((p) => p.id === r.authorId);
            return (
              <div key={r.id} data-pin-reply={r.id} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
                <PinFace kind="comment" authorId={r.authorId} people={people} size={20} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{r.authorId ? personLabel(who) : 'Former member'}</span>
                    <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{timeLabel(r.createdAt)}</span>
                    {r.authorId === userId && canWrite && (
                      <button type="button" style={{ ...textBtn, padding: '0 4px', marginLeft: 4 }} onClick={() => onDeleteReply(r)}>Delete</button>
                    )}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canWrite && (
        <PinTextBox people={people} placeholder="Add a reply" enterSaves onSubmit={onReply} minHeight={32} />
      )}
    </div>,
    document.body,
  );
}

export default function PagePinsHost({
  enabled = false,
  isActive = true,
  documentId = null,
  userId = null,
  readOnly = false,
  activeTool,
  setActiveTool,
  panelOn = false,
}) {
  const live = Boolean(enabled && isActive && documentId);
  const { comments, people, applyLocal } = useMarkComments(documentId, { enabled: Boolean(enabled && documentId) });
  const [askConfirm, confirmDialog] = useConfirmDialog();
  const canWrite = !readOnly;
  const coarse = useMemo(() => {
    try { return window.matchMedia?.('(pointer: coarse)')?.matches === true; } catch { return false; }
  }, []);

  // Publish this document's pins while its tab is in front.
  useEffect(() => {
    if (!live) return;
    setPagePinsState({ enabled: true, documentId, userId, canWrite, comments, people });
  }, [live, documentId, userId, canWrite, comments, people]);
  useEffect(() => {
    if (!live) return undefined;
    setPagePinsState({ filter: readPinFilter(userId), draft: null, openId: null, moving: null });
    return () => {
      if (getPagePinsState().documentId === documentId) {
        setPagePinsState({ enabled: false, draft: null, openId: null, moving: null });
      }
    };
  }, [live, documentId, userId]);

  // Putting the tool down drops an unsaved pin.
  useEffect(() => {
    if (activeTool !== PIN_TOOL_ID && getPagePinsState().draft) setPagePinsState({ draft: null });
  }, [activeTool]);

  // N arms the tool; while it is on, M cycles the type (capture, so M's
  // usual "put the tools down" never sees it). Esc closes a card.
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  useEffect(() => {
    if (!live) return undefined;
    const onKey = (event) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === 'Escape') {
        const s = getPagePinsState();
        if (s.openId || s.draft) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setPagePinsState({ openId: null, draft: null });
        }
        return;
      }
      if (!canWrite) return;
      if (isPinToolKey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveTool?.(PIN_TOOL_ID);
        return;
      }
      if (isPinCycleKey(event) && toolRef.current === PIN_TOOL_ID) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPagePinsState((s) => {
          const kind = nextPinKind(s.kind);
          return { kind, draft: s.draft ? { ...s.draft, kind } : null };
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [live, canWrite, setActiveTool]);

  // A dragged pin lands: show it there at once, then save.
  useEffect(() => {
    if (!live) return undefined;
    const onMove = async (event) => {
      const { id, pageNumber, x, y } = event.detail || {};
      const before = getPagePinsState().comments.find((c) => c.id === id);
      if (!before?.pin) { setPagePinsState({ moving: null }); return; }
      applyLocal({ ...before, pageNumber, pin: { ...before.pin, x, y } });
      setPagePinsState({ moving: null });
      try {
        applyLocal(await updatePagePin(supabase, { commentId: id, pageNumber, x, y }));
      } catch (err) {
        applyLocal(before);
        showToast(err?.message || 'Could not move the pin');
      }
    };
    window.addEventListener(PIN_MOVE_EVENT, onMove);
    return () => window.removeEventListener(PIN_MOVE_EVENT, onMove);
  }, [live, applyLocal]);

  const draft = usePagePins((s) => (s.documentId === documentId ? s.draft : null));
  const openId = usePagePins((s) => (s.documentId === documentId ? s.openId : null));
  const pins = usePagePins((s) => s.pins);
  const openPin = openId ? pins.find((p) => p.id === openId) : null;
  const replies = useMemo(() => (openId ? comments.filter((c) => c.threadId === openId && !c.deletedAt) : []), [comments, openId]);
  const linkOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;

  const savePin = useCallback(async ({ body, mentions, status }) => {
    const d = getPagePinsState().draft;
    if (!d) return false;
    try {
      const saved = await addPagePin(supabase, { documentId, pageNumber: d.pageNumber, x: d.x, y: d.y, kind: d.kind, body, status, mentions });
      if (saved) applyLocal(saved);
      if (saved?.mentions?.length) notifyCommentMentions(supabase, saved.id, linkOrigin);
      setPagePinsState({ draft: null });
      return true;
    } catch (err) {
      showToast(err?.message || 'Could not save the pin');
      return false;
    }
  }, [documentId, applyLocal, linkOrigin]);

  if (!live) return confirmDialog;
  return (
    <>
      {draft && (
        <PinComposer
          key={`${draft.pageNumber}:${draft.x}:${draft.y}`}
          draft={draft}
          people={people}
          coarse={coarse}
          onSave={savePin}
          onDiscard={() => setPagePinsState({ draft: null })}
        />
      )}
      {openPin && !draft && (
        <PinCard
          key={openPin.id}
          pin={openPin}
          replies={replies}
          people={people}
          userId={userId}
          canWrite={canWrite}
          panelOn={panelOn}
          documentId={documentId}
          onClose={() => setPagePinsState({ openId: null })}
          onStatus={async (status) => {
            const before = openPin.comment;
            applyLocal({ ...before, pin: { ...before.pin, status } });
            try {
              applyLocal(await updatePagePin(supabase, { commentId: openPin.id, status }));
            } catch (err) {
              applyLocal(before);
              showToast(err?.message || 'Could not change the status');
            }
          }}
          onEditBody={async (body, mentions) => {
            try {
              const saved = await editMarkComment(supabase, { commentId: openPin.id, body, mentions });
              if (saved) applyLocal(saved);
              if (saved?.mentions?.length) notifyCommentMentions(supabase, saved.id, linkOrigin);
              return true;
            } catch (err) {
              showToast(err?.message || 'Could not save the change');
              return false;
            }
          }}
          onReply={async (body, mentions) => {
            try {
              const saved = await addMarkComment(supabase, { documentId, pageNumber: openPin.pageNumber, body, threadId: openPin.id, mentions });
              if (saved) applyLocal(saved);
              if (saved?.mentions?.length) notifyCommentMentions(supabase, saved.id, linkOrigin);
              return true;
            } catch (err) {
              showToast(err?.message || 'Could not post the reply');
              return false;
            }
          }}
          onDeleteReply={async (reply) => {
            try { applyLocal(await deleteMarkComment(supabase, reply.id)); } catch (err) { showToast(err?.message || 'Could not delete the reply'); }
          }}
          onDelete={() => {
            const noun = PIN_KIND_LABELS[openPin.kind];
            askConfirm({
              title: `Delete this ${noun}?`,
              message: 'This is a permanent action and cannot be undone.',
              confirmLabel: `Delete ${noun.toLowerCase()}`,
              danger: true,
            }).then(async (confirmed) => {
              if (!confirmed) return;
              try {
                applyLocal(await deleteMarkComment(supabase, openPin.id));
                setPagePinsState({ openId: null });
              } catch (err) {
                showToast(err?.message || 'Could not delete the pin');
              }
            });
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}
