/**
 * CommentsPanel - comments on marks (behind the 'mark-comments' flag).
 *
 * Threads hang off one mark or a page. Start one from the selection bar's
 * Comment button (OPEN_MARK_COMMENTS_EVENT) or "Comment on page N"; reply,
 * @mention someone on the document (they get an email that opens the
 * comment), edit or delete your own. A deleted comment leaves a stub so the
 * replies keep their place. Clicking a thread's label zooms to its mark the
 * way History does. Viewers read; editors post (the server checks both).
 * Editors resolve a thread when it is dealt with (KAL-415, as Drawboard
 * does): it leaves the Open list for Resolved, where Reopen brings it back.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import SectionIconButton from '../components/SectionIconButton.jsx';
import './CommentsPanel.css';
import { supabase } from '../supabaseClient';
import { useTooltip } from '../components/Tooltip';
import { useConfirmDialog } from '../components/dialogPrompts';
import { showToast } from '../utils/toast';
import { useMarkComments } from '../hooks/useMarkComments.js';
import {
  MARK_COMMENT_MAX_CHARS,
  addMarkComment,
  commentPieces,
  commentShareUrl,
  deleteMarkComment,
  editMarkComment,
  groupThreads,
  insertMention,
  matchPeople,
  mentionQueryAt,
  mentionsInText,
  notifyCommentMentions,
  personLabel,
  setMarkCommentResolved,
  splitResolvedThreads,
} from '../services/markComments.js';
import { historyGlyphFor, historyTypeKey } from '../utils/historyFeed.js';
import { presenceInitials } from '../components/presenceIdentity.js';
import { USER_INITIALS_INK, userColorFill } from '../utils/userColors.js';
import { historyMarkFilterNoun } from '../utils/historyMarkFilter.js';
import { historyAnnotationInkBox } from '../utils/historyGeometry.js';
import { measureMarkBox } from '../components/revisions/historyPageOverlay.js';

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function timeLabel(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * A text box that offers people as you type "@". It grows with its text.
 * `inline` (editing a posted comment): no buttons of its own and the body's
 * own type, so the words stay where they were; the comment's head carries
 * Cancel / Save, which call submit() / onCancel through the ref.
 */
const CommentBox = forwardRef(function CommentBox({ people, placeholder, initial = '', initialMentions = [], submitLabel, onSubmit, onCancel, autoFocus = false, busy = false, inline = false, onDirtyChange = null }, ref) {
  const [text, setText] = useState(initial);
  const [picked, setPicked] = useState(() => people.filter((p) => initialMentions.includes(p.id)));
  const [mention, setMention] = useState(null);
  const [active, setActive] = useState(0);
  const areaRef = useRef(null);
  const matches = mention ? matchPeople(people, mention.query) : [];

  const readMention = (value, caret) => {
    const next = mentionQueryAt(value, caret);
    setMention(next);
    setActive(0);
  };
  const pick = (person) => {
    if (!mention) return;
    const { text: next, caret } = insertMention(text, mention, person);
    setText(next);
    setPicked((current) => (current.some((p) => p.id === person.id) ? current : [...current, person]));
    setMention(null);
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  };
  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    const ok = await onSubmit(body, mentionsInText(body, picked));
    if (ok !== false) {
      setText('');
      setPicked([]);
      setMention(null);
    }
  };
  useImperativeHandle(ref, () => ({ submit }));
  const canSubmit = Boolean(text.trim()) && !busy;
  useEffect(() => { onDirtyChange?.(canSubmit); }, [canSubmit, onDirtyChange]);

  // Grow with the text (no inner scroll bar, no jump when a line wraps).
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);
  // Editing starts with the caret after the last word.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!autoFocus || !area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`comments-box${inline ? ' comments-box--inline' : ''}`}>
      <textarea
        ref={areaRef}
        value={text}
        rows={1}
        maxLength={MARK_COMMENT_MAX_CHARS}
        placeholder={placeholder}
        aria-label={placeholder}
        data-comment-input="true"
        onChange={(e) => { setText(e.target.value); readMention(e.target.value, e.target.selectionStart); }}
        onClick={(e) => readMention(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
          if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
        }}
      />
      {matches.length > 0 && (
        <div className="comments-mentions" role="listbox" aria-label="People on this document">
          {matches.map((person, index) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={index === active}
              data-mention-option={person.id}
              className={`comments-mentions__item${index === active ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(person); }}
            >
              <span>{personLabel(person)}</span>
              {person.email && <span className="comments-mentions__email">{person.email}</span>}
            </button>
          ))}
        </div>
      )}
      {!inline && (
        <div className="comments-box__actions">
          {onCancel && <button type="button" className="comments-text-btn" onClick={onCancel}>Cancel</button>}
          <button type="button" className="comments-text-btn comments-text-btn--primary" data-comment-submit="true" disabled={!canSubmit} onClick={submit}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
});

function CommentItem({ comment, peopleById, mine, canWrite, onEdit, onDelete, onCopyLink, editing, setEditing, people, tip }) {
  const author = peopleById.get(comment.authorId);
  const boxRef = useRef(null);
  const [canSave, setCanSave] = useState(true);
  if (comment.deletedAt) {
    return (
      <div className="comments-item comments-item--deleted" data-comment-id={comment.id}>
        <span>Comment deleted</span>
      </div>
    );
  }
  return (
    <div className={`comments-item${editing ? ' is-editing' : ''}`} data-comment-id={comment.id}>
      <div className="comments-item__head">
        {/* Owner 2026-11-10 (Comments "very professional"): each comment
            wears its author's face - their own pastel and initials, the same
            disc as the presence row and the share list. */}
        <span
          className="comments-avatar"
          aria-hidden="true"
          style={comment.authorId ? { background: userColorFill(comment.authorId), color: USER_INITIALS_INK } : undefined}
        >
          {comment.authorId ? presenceInitials(personLabel(author)) : '?'}
        </span>
        <span className="comments-item__author">{comment.authorId ? personLabel(author) : 'Former member'}</span>
        <span className="comments-item__time">
          {timeLabel(comment.createdAt)}{comment.editedAt ? ' · edited' : ''}
        </span>
        {/* Editing swaps the icons for Cancel / Save in the same row, so
            nothing below moves (owner 2026-11-09: "it shifts things around"). */}
        {editing ? (
          <span className="comments-item__tools">
            <button type="button" className="comments-text-btn" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="comments-text-btn comments-text-btn--primary" data-comment-submit="true" disabled={!canSave} onClick={() => boxRef.current?.submit()}>Save</button>
          </span>
        ) : (
          <span className="comments-item__tools">
            <button type="button" className="comments-icon" aria-label="Copy link to comment" {...tip('Copy link')} onClick={() => onCopyLink(comment)}>
              <Icon name="formatHyperlink" size={14} />
            </button>
            {mine && canWrite && (
              <>
                <button type="button" className="comments-icon" aria-label="Edit comment" {...tip('Edit')} onClick={() => setEditing(comment.id)}>
                  <Icon name="edit" size={14} />
                </button>
                <button type="button" className="comments-icon" aria-label="Delete comment" {...tip('Delete')} onClick={() => onDelete(comment)}>
                  <Icon name="trash" size={14} />
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <CommentBox
          ref={boxRef}
          inline
          people={people}
          initial={comment.body}
          initialMentions={comment.mentions}
          placeholder="Edit comment"
          autoFocus
          onDirtyChange={setCanSave}
          onCancel={() => setEditing(null)}
          onSubmit={(body, mentions) => onEdit(comment, body, mentions)}
        />
      ) : (
        <div className="comments-item__body" data-comment-body="true">
          {commentPieces(comment.body, comment.mentions, peopleById).map((piece, i) => (
            piece.mention
              ? <span key={i} className="comments-mention">{piece.text}</span>
              : <React.Fragment key={i}>{piece.text}</React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommentsPanel({
  documentId,
  user,
  isActive = true,
  pageNum = 1,
  canWrite = false,
  locateHistoryMark = null,
  focusHistoryMark = null,
  selectHistoryMark = null,
  onNavigateToPage = null,
  onRequestSheetClose = null,
  focusRequest = null,
  // Desktop: the rail's title row, where the + for a page comment sits.
  headActionsHost = null,
}) {
  const tip = useTooltip();
  const [askConfirm, confirmDialog] = useConfirmDialog();
  const { comments, people, status, applyLocal } = useMarkComments(documentId);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const threads = useMemo(() => groupThreads(comments), [comments]);
  const lists = useMemo(() => splitResolvedThreads(threads), [threads]);
  const [view, setView] = useState('open'); // 'open' | 'resolved'
  const shown = view === 'resolved' ? lists.resolved : lists.open;
  const [draft, setDraft] = useState(null); // { markId, pageNumber }
  const [replyingTo, setReplyingTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  // The thread whose mark was last shown on the page (it stays marked).
  const [activeThreadId, setActiveThreadId] = useState(null);
  const listRef = useRef(null);
  const userId = user?.id || null;

  // Start a comment on a mark, or show one from a link. A mark that already
  // has a thread opens that thread (reply box ready) instead of a second one,
  // as Drawboard does; the request waits until the comments have loaded.
  const [pendingMarkRequest, setPendingMarkRequest] = useState(null);
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.commentId) {
      setHighlightId(focusRequest.commentId);
    } else if (focusRequest.markId) {
      setPendingMarkRequest(focusRequest);
    } else if (canWrite) {
      setDraft({ markId: null, pageNumber: Number(focusRequest.pageNumber) || pageNum || 1 });
    }
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingMarkRequest || status === 'loading' || status === 'idle') return;
    const markId = String(pendingMarkRequest.markId);
    const existing = threads.find((t) => t.markId != null && String(t.markId) === markId);
    setPendingMarkRequest(null);
    if (existing) {
      setDraft(null);
      setActiveThreadId(existing.id);
      setView(existing.root.resolvedAt ? 'resolved' : 'open');
      if (canWrite && !existing.root.resolvedAt) setReplyingTo(existing.id);
      setHighlightId(existing.root.id);
    } else if (canWrite) {
      setDraft({ markId, pageNumber: Number(pendingMarkRequest.pageNumber) || pageNum || 1 });
    }
  }, [pendingMarkRequest, status, threads, canWrite, pageNum]);

  // A linked comment in a resolved thread opens the Resolved list (and back).
  useEffect(() => {
    if (!highlightId) return;
    const thread = threads.find((t) => t.root.id === highlightId || t.replies.some((r) => r.id === highlightId));
    if (thread) setView(thread.root.resolvedAt ? 'resolved' : 'open');
  }, [highlightId, threads]);

  // Bring a linked comment into view once it has loaded.
  useEffect(() => {
    if (!highlightId || !isActive) return undefined;
    const el = listRef.current?.querySelector?.(`[data-comment-id="${highlightId}"]`);
    if (!el) return undefined;
    el.scrollIntoView?.({ block: 'center' });
    const timer = window.setTimeout(() => setHighlightId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightId, isActive, comments]);

  // What a thread hangs off: its words and the mark kind's own glyph.
  const markTarget = useCallback((markId, pageNumber) => {
    if (!markId) return { label: `Page ${pageNumber}`, icon: 'pages' };
    const located = typeof locateHistoryMark === 'function' ? locateHistoryMark(markId) : null;
    if (!located) return { label: `Removed mark · page ${pageNumber}`, icon: 'shapes' };
    const typeKey = located.kind === 'surveyMarker' ? 'surveyMarker' : historyTypeKey(located.annotation?.type, located.annotation);
    const noun = historyMarkFilterNoun([{ id: markId, typeKey }]).replace(/^this /, '');
    return { label: `${capitalize(noun)} · page ${located.pageNumber || pageNumber}`, icon: historyGlyphFor(typeKey) };
  }, [locateHistoryMark]);
  const markLabel = (markId, pageNumber) => markTarget(markId, pageNumber).label;

  // Owner 2026-11-09: the zoom to the mark glides, and the mark is picked
  // so you can see which one the comment means.
  const goTo = useCallback((markId, pageNumber) => {
    const located = markId && typeof locateHistoryMark === 'function' ? locateHistoryMark(markId) : null;
    const page = located?.pageNumber || pageNumber;
    const box = (markId && typeof document !== 'undefined' ? measureMarkBox(document, markId, page) : null)
      || (located?.annotation ? historyAnnotationInkBox(located.annotation) : null);
    const picked = located && typeof selectHistoryMark === 'function' ? selectHistoryMark(markId) : false;
    // Phone: the sheet covers half the page, so it steps down first (as a
    // Search hit does) and the mark lands in the whole view; reopen Comments
    // and the thread is still marked.
    if (typeof onRequestSheetClose === 'function') onRequestSheetClose();
    const focus = () => {
      const focused = typeof focusHistoryMark === 'function' ? focusHistoryMark(page, box, { animate: true }) : false;
      if (!focused) onNavigateToPage?.(page, { fallback: 'nearest', bypassActiveSpace: true });
    };
    // Picking a mark brings up its style row above the page; centre in the
    // view that is left once that row is in (Locate on page waits the same
    // three frames).
    if (picked && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const raf = window.requestAnimationFrame;
      raf(() => raf(() => raf(focus)));
    } else {
      focus();
    }
  }, [focusHistoryMark, locateHistoryMark, onNavigateToPage, onRequestSheetClose, selectHistoryMark]);

  const linkOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const post = async ({ body, mentions, markId = null, pageNumber, threadId = null }) => {
    setBusy(true);
    try {
      const saved = await addMarkComment(supabase, { documentId, pageNumber, body, markId, threadId, mentions });
      applyLocal(saved);
      if (saved?.mentions?.length) notifyCommentMentions(supabase, saved.id, linkOrigin);
      return true;
    } catch (err) {
      showToast(err?.message || 'Could not post the comment');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const edit = async (comment, body, mentions) => {
    try {
      applyLocal(await editMarkComment(supabase, { commentId: comment.id, body, mentions }));
      setEditing(null);
      return true;
    } catch (err) {
      showToast(err?.message || 'Could not save the change');
      return false;
    }
  };
  const remove = (comment) => {
    askConfirm({
      title: 'Delete this comment?',
      message: 'It is removed for everyone. Replies stay.',
      confirmLabel: 'Delete',
      danger: true,
    }).then(async (confirmed) => {
      if (!confirmed) return;
      try {
        applyLocal(await deleteMarkComment(supabase, comment.id));
      } catch (err) {
        showToast(err?.message || 'Could not delete the comment');
      }
    });
  };
  // Act first with an Undo on the toast, no confirm (owner rule).
  const setResolved = async (thread, resolved, { quiet = false } = {}) => {
    try {
      applyLocal(await setMarkCommentResolved(supabase, { commentId: thread.root.id, resolved }));
      if (replyingTo === thread.id) setReplyingTo(null);
      if (!quiet) {
        showToast(resolved ? 'Thread resolved' : 'Thread reopened', 'success', {
          action: { label: 'Undo', onClick: () => { setResolved(thread, !resolved, { quiet: true }); } },
        });
      }
    } catch (err) {
      showToast(err?.message || (resolved ? 'Could not resolve the thread' : 'Could not reopen the thread'));
    }
  };
  const copyLink = async (comment) => {
    try {
      await navigator.clipboard.writeText(commentShareUrl(window.location, documentId, comment.id));
      showToast('Link copied', 'success');
    } catch {
      showToast('Could not copy the link');
    }
  };

  const itemProps = { peopleById, people, canWrite, onEdit: edit, onDelete: remove, onCopyLink: copyLink, setEditing, tip };

  const newPageComment = () => setDraft({ markId: null, pageNumber: pageNum || 1 });
  const newButton = canWrite && !draft ? (
    headActionsHost
      ? createPortal(
        <SectionIconButton action="add" label={`Comment on page ${pageNum || 1}`} data-comment-new="true" onClick={newPageComment} />,
        headActionsHost,
      )
      : (
        <button type="button" className="comments-text-btn comments-new" data-comment-new="true" onClick={newPageComment}>
          <Icon name="plus" size={14} /> Comment on page {pageNum || 1}
        </button>
      )
  ) : null;
  // A press anywhere on a thread (not on its buttons or a text box) shows its mark.
  const openThread = (event, thread) => {
    if (event.target.closest?.('button, textarea, input, a, [role="listbox"]')) return;
    if (typeof window !== 'undefined' && String(window.getSelection?.() || '')) return;
    setActiveThreadId(thread.id);
    goTo(thread.markId, thread.pageNumber);
  };

  const filter = threads.length > 0 ? (
    <div className="comments-filter" role="group" aria-label="Show threads">
      {[['open', 'Open', lists.open.length], ['resolved', 'Resolved', lists.resolved.length]].map(([key, label, count]) => (
        <button
          key={key}
          type="button"
          className={`comments-filter__btn${view === key ? ' is-on' : ''}`}
          aria-pressed={view === key}
          data-comment-filter={key}
          onClick={() => setView(key)}
        >
          {label} <span className="comments-filter__count">{count}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="comments-panel" data-testid="comments-panel" ref={listRef}>
      {newButton}
      {filter}
      {draft && (
        <div className="comments-thread comments-thread--draft" data-comment-draft={draft.markId || `page-${draft.pageNumber}`}>
          <div className="comments-thread__target">
            <Icon name={markTarget(draft.markId, draft.pageNumber).icon} size={13} />
            <span>{markLabel(draft.markId, draft.pageNumber)}</span>
          </div>
          <CommentBox
            people={people}
            placeholder="Add a comment. Type @ to mention someone."
            submitLabel="Post"
            autoFocus
            busy={busy}
            onCancel={() => setDraft(null)}
            onSubmit={async (body, mentions) => {
              const ok = await post({ body, mentions, markId: draft.markId, pageNumber: draft.pageNumber });
              if (ok) setDraft(null);
              return ok;
            }}
          />
        </div>
      )}
      {status === 'loading' && threads.length === 0 && <div className="comments-empty">Loading comments…</div>}
      {status === 'error' && <div className="comments-empty">Comments couldn’t load. Check your connection.</div>}
      {status === 'ready' && threads.length === 0 && !draft && (
        <div className="comments-empty">
          No comments yet. {canWrite ? 'Pick a mark and press Comment, or comment on this page.' : ''}
        </div>
      )}
      {threads.length > 0 && shown.length === 0 && !draft && (
        <div className="comments-empty">
          {view === 'resolved' ? 'No resolved threads.' : 'No open threads. Resolved ones are under Resolved.'}
        </div>
      )}
      {shown.map((thread) => (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the label button is the keyboard way in
        <div
          key={thread.id}
          className={`comments-thread${[thread.root, ...thread.replies].some((c) => c.id === highlightId) ? ' is-highlighted' : ''}${activeThreadId === thread.id ? ' is-active' : ''}${thread.root.resolvedAt ? ' is-resolved' : ''}`}
          data-comment-thread={thread.id}
          data-comment-resolved={thread.root.resolvedAt ? 'true' : undefined}
          onClick={(event) => openThread(event, thread)}
        >
          <button
            type="button"
            className="comments-thread__target comments-thread__target--link"
            {...tip(thread.markId ? 'Show on the page' : `Go to page ${thread.pageNumber}`)}
            onClick={() => { setActiveThreadId(thread.id); goTo(thread.markId, thread.pageNumber); }}
          >
            <Icon name={markTarget(thread.markId, thread.pageNumber).icon} size={13} />
            <span>{markLabel(thread.markId, thread.pageNumber)}</span>
          </button>
          {thread.root.resolvedAt && (
            <div className="comments-resolved-note" data-comment-resolved-note="true">
              <Icon name="check" size={12} />
              <span>
                Resolved{thread.root.resolvedBy ? ` by ${thread.root.resolvedBy === userId ? 'you' : personLabel(peopleById.get(thread.root.resolvedBy))}` : ''} · {timeLabel(thread.root.resolvedAt)}
              </span>
            </div>
          )}
          <CommentItem comment={thread.root} mine={thread.root.authorId === userId} editing={editing === thread.root.id} {...itemProps} />
          {thread.replies.map((reply) => (
            <div key={reply.id} className="comments-reply">
              <CommentItem comment={reply} mine={reply.authorId === userId} editing={editing === reply.id} {...itemProps} />
            </div>
          ))}
          {canWrite && thread.root.resolvedAt && (
            <div className="comments-thread__actions">
              <button type="button" className="comments-text-btn comments-reply-btn" data-comment-reopen={thread.id} onClick={() => setResolved(thread, false)}>
                Reopen
              </button>
            </div>
          )}
          {canWrite && !thread.root.resolvedAt && (replyingTo === thread.id ? (
            <div className="comments-reply">
              <CommentBox
                people={people}
                placeholder="Reply. Type @ to mention someone."
                submitLabel="Reply"
                autoFocus
                busy={busy}
                onCancel={() => setReplyingTo(null)}
                onSubmit={async (body, mentions) => {
                  const ok = await post({ body, mentions, threadId: thread.id, pageNumber: thread.pageNumber });
                  if (ok) setReplyingTo(null);
                  return ok;
                }}
              />
            </div>
          ) : (
            <div className="comments-thread__actions">
              <button type="button" className="comments-text-btn comments-reply-btn" data-comment-reply={thread.id} onClick={() => setReplyingTo(thread.id)}>
                Reply
              </button>
              <button type="button" className="comments-text-btn" data-comment-resolve={thread.id} onClick={() => setResolved(thread, true)}>
                Resolve
              </button>
            </div>
          ))}
        </div>
      ))}
      {confirmDialog}
    </div>
  );
}
