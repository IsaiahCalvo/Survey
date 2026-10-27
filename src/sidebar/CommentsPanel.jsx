/**
 * CommentsPanel - comments on marks (behind the 'mark-comments' flag).
 *
 * Threads hang off one mark or a page. Start one from the selection bar's
 * Comment button (OPEN_MARK_COMMENTS_EVENT) or "Comment on page N"; reply,
 * @mention someone on the document (they get an email that opens the
 * comment), edit or delete your own. A deleted comment leaves a stub so the
 * replies keep their place. Clicking a thread's label zooms to its mark the
 * way History does. Viewers read; editors post (the server checks both).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icons';
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
  deleteMarkComment,
  editMarkComment,
  groupThreads,
  insertMention,
  matchPeople,
  mentionQueryAt,
  mentionsInText,
  notifyCommentMentions,
  personLabel,
} from '../services/markComments.js';
import { historyTypeKey } from '../utils/historyFeed.js';
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

/** A text box that offers people as you type "@". */
function CommentBox({ people, placeholder, initial = '', initialMentions = [], submitLabel, onSubmit, onCancel, autoFocus = false, busy = false }) {
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

  return (
    <div className="comments-box">
      <textarea
        ref={areaRef}
        autoFocus={autoFocus}
        value={text}
        rows={2}
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
      <div className="comments-box__actions">
        {onCancel && <button type="button" className="hub-btn" onClick={onCancel}>Cancel</button>}
        <button type="button" className="hub-btn hub-btn--primary" data-comment-submit="true" disabled={!text.trim() || busy} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function CommentItem({ comment, peopleById, mine, canWrite, onEdit, onDelete, onCopyLink, editing, setEditing, people, tip }) {
  const author = peopleById.get(comment.authorId);
  if (comment.deletedAt) {
    return (
      <div className="comments-item comments-item--deleted" data-comment-id={comment.id}>
        <span>Comment deleted</span>
      </div>
    );
  }
  return (
    <div className="comments-item" data-comment-id={comment.id}>
      <div className="comments-item__head">
        <span className="comments-item__author">{comment.authorId ? personLabel(author) : 'Former member'}</span>
        <span className="comments-item__time">
          {timeLabel(comment.createdAt)}{comment.editedAt ? ' · edited' : ''}
        </span>
        <span className="comments-item__tools">
          <button type="button" className="comments-icon" aria-label="Copy link to comment" {...tip('Copy link')} onClick={() => onCopyLink(comment)}>
            <Icon name="formatHyperlink" size={13} />
          </button>
          {mine && canWrite && !editing && (
            <>
              <button type="button" className="comments-icon" aria-label="Edit comment" {...tip('Edit')} onClick={() => setEditing(comment.id)}>
                <Icon name="edit" size={13} />
              </button>
              <button type="button" className="comments-icon" aria-label="Delete comment" {...tip('Delete')} onClick={() => onDelete(comment)}>
                <Icon name="trash" size={13} />
              </button>
            </>
          )}
        </span>
      </div>
      {editing ? (
        <CommentBox
          people={people}
          initial={comment.body}
          initialMentions={comment.mentions}
          placeholder="Edit comment"
          submitLabel="Save"
          autoFocus
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
  onNavigateToPage = null,
  focusRequest = null,
}) {
  const tip = useTooltip();
  const [askConfirm, confirmDialog] = useConfirmDialog();
  const { comments, people, status, applyLocal } = useMarkComments(documentId);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const threads = useMemo(() => groupThreads(comments), [comments]);
  const [draft, setDraft] = useState(null); // { markId, pageNumber }
  const [replyingTo, setReplyingTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const listRef = useRef(null);
  const userId = user?.id || null;

  // Start a comment on a mark, or show one from a link.
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.commentId) {
      setHighlightId(focusRequest.commentId);
    } else if (canWrite) {
      setDraft({ markId: focusRequest.markId || null, pageNumber: Number(focusRequest.pageNumber) || pageNum || 1 });
    }
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bring a linked comment into view once it has loaded.
  useEffect(() => {
    if (!highlightId || !isActive) return undefined;
    const el = listRef.current?.querySelector?.(`[data-comment-id="${highlightId}"]`);
    if (!el) return undefined;
    el.scrollIntoView?.({ block: 'center' });
    const timer = window.setTimeout(() => setHighlightId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightId, isActive, comments]);

  const markLabel = useCallback((markId, pageNumber) => {
    if (!markId) return `Page ${pageNumber}`;
    const located = typeof locateHistoryMark === 'function' ? locateHistoryMark(markId) : null;
    if (!located) return `Removed mark · page ${pageNumber}`;
    const typeKey = located.kind === 'surveyMarker' ? 'surveyMarker' : historyTypeKey(located.annotation?.type, located.annotation);
    const noun = historyMarkFilterNoun([{ id: markId, typeKey }]).replace(/^this /, '');
    return `${capitalize(noun)} · page ${located.pageNumber || pageNumber}`;
  }, [locateHistoryMark]);

  const goTo = useCallback((markId, pageNumber) => {
    const located = markId && typeof locateHistoryMark === 'function' ? locateHistoryMark(markId) : null;
    const page = located?.pageNumber || pageNumber;
    const box = (markId && typeof document !== 'undefined' ? measureMarkBox(document, markId, page) : null)
      || (located?.annotation ? historyAnnotationInkBox(located.annotation) : null);
    const focused = typeof focusHistoryMark === 'function' ? focusHistoryMark(page, box) : false;
    if (!focused) onNavigateToPage?.(page, { fallback: 'nearest', bypassActiveSpace: true });
  }, [focusHistoryMark, locateHistoryMark, onNavigateToPage]);

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
  const copyLink = async (comment) => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('docId', documentId);
    url.searchParams.set('comment', comment.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      showToast('Link copied', 'success');
    } catch {
      showToast('Could not copy the link');
    }
  };

  const itemProps = { peopleById, people, canWrite, onEdit: edit, onDelete: remove, onCopyLink: copyLink, setEditing, tip };

  return (
    <div className="comments-panel" data-testid="comments-panel" ref={listRef}>
      {canWrite && !draft && (
        <button type="button" className="hub-btn comments-new" onClick={() => setDraft({ markId: null, pageNumber: pageNum || 1 })}>
          <Icon name="plus" size={14} /> Comment on page {pageNum || 1}
        </button>
      )}
      {draft && (
        <div className="comments-thread comments-thread--draft" data-comment-draft={draft.markId || `page-${draft.pageNumber}`}>
          <div className="comments-thread__target">{markLabel(draft.markId, draft.pageNumber)}</div>
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
      {threads.map((thread) => (
        <div
          key={thread.id}
          className={`comments-thread${[thread.root, ...thread.replies].some((c) => c.id === highlightId) ? ' is-highlighted' : ''}`}
          data-comment-thread={thread.id}
        >
          <button type="button" className="comments-thread__target comments-thread__target--link" onClick={() => goTo(thread.markId, thread.pageNumber)}>
            {markLabel(thread.markId, thread.pageNumber)}
          </button>
          <CommentItem comment={thread.root} mine={thread.root.authorId === userId} editing={editing === thread.root.id} {...itemProps} />
          {thread.replies.map((reply) => (
            <div key={reply.id} className="comments-reply">
              <CommentItem comment={reply} mine={reply.authorId === userId} editing={editing === reply.id} {...itemProps} />
            </div>
          ))}
          {canWrite && (replyingTo === thread.id ? (
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
            <button type="button" className="hub-btn comments-reply-btn" data-comment-reply={thread.id} onClick={() => setReplyingTo(thread.id)}>
              Reply
            </button>
          ))}
        </div>
      ))}
      {confirmDialog}
    </div>
  );
}
