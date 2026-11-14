/* Projects: the Issues or Tasks list of one project (flag `project-issues`,
   Drawboard Projects parity, rows IS-01..58 of
   drawboard-trial/deep/projects-parity-spec.md).

   A table (ID, Summary, Status, Assignee, Links, Due) with search by title or
   ID, quick filters (Created by me, Assigned to me, Due soon, Overdue),
   status-group chips, tag chips, an assignee picker, sortable headers, Show
   archived, select mode (Archive, Export, Delete) and an Issues Register CSV.
   A row opens its detail beside the list (in a sheet on a phone): summary,
   description, status, assignee, due date, tags, linked documents, then
   Discussion and Activity. Survey's way where it reads better: changes save
   as you go, and Archive / Delete act at once with an Undo toast instead of a
   confirm (Survey rule). */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTooltip } from '../components/Tooltip';
import { Icon, Avatar, EmptyState } from '../home/HubShell';
import MenuRows from '../components/MenuRows.jsx';
import DismissBarrier from '../components/DismissBarrier';
import ValueSelect from '../components/ValueSelect.jsx';
import SectionIconButton from '../components/SectionIconButton.jsx';
import { presenceInitials } from '../components/presenceIdentity.js';
import { checkboxProps } from '../utils/keyActivate';
import { keyboardControlProps } from '../utils/keyboardActivation.js';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { dismissToast, showToast } from '../utils/toast';
import { saveFile } from '../tools/browser.js';
import {
  ITEM_KINDS, ITEM_SORTS, QUICK_FILTERS, STATUS_GROUPS,
  allItemTags, describeEvent, filterItems, formatDue, groupCounts, isDueSoon, isOverdue,
  itemCode, itemsCsv, localDay, parseItemTags, registerFileName, sortItems, statusInfo, statusesFor, timeAgo,
} from './projectItems.js';
import {
  useProjectItems, loadItemEvents, loadItemComments, addItemComment, deleteItemComment, loadLatestComments,
  notifyItemAssignee,
} from './projectItemsData.js';
import { isFeatureOn } from '../featureFlags.js';
import './projectItems.css';

// Nightly 'project-photos': loads only when an item opens with the flag on.
const ItemPhotosLazy = lazy(() => import('../projectPhotos/ProjectPhotosPanel.jsx').then((m) => ({ default: m.ItemPhotos })));

function PopMenu({ anchorRect, items, onClose, minWidth = 180 }) {
  const tip = useTooltip();
  const ref = useRef(null);
  if (!anchorRect) return null;
  const phone = isPhoneLayout();
  const width = phone ? Math.max(minWidth, 200) : minWidth;
  const est = items.length * (phone ? 44 : 28) + 10;
  let top = anchorRect.bottom + 4;
  if (top + est > window.innerHeight - 8) top = Math.max(8, anchorRect.top - est - 4);
  const left = Math.max(8, Math.min(anchorRect.right - width, window.innerWidth - width - 8));
  return createPortal(
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} menu />
      <div ref={ref} role="menu" className="hub-menu" data-item-menu style={{ top, left, minWidth: width }}>
        <MenuRows items={items} tip={tip} onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}

/* Phones keep the browser's own list (ValueSelect's rule); elsewhere the
   app's drop-down. */
function FieldSelect({ label, value, options, onChange, disabled, testId }) {
  if (isPhoneLayout()) {
    return (
      <select
        className="item-native-select"
        aria-label={label}
        data-testid={testId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <span data-testid={testId} style={{ display: 'block' }}>
      <ValueSelect label={label} value={value} options={options} onChange={onChange} disabled={disabled} size="sm" />
    </span>
  );
}

function StatusChip({ status, kind }) {
  const info = statusInfo(status);
  return <span className={`item-status is-${info.tone}`} data-item-status={info.key} data-item-kind={kind}><i aria-hidden="true" />{info.label}</span>;
}

function Person({ id, lookup, size = 18, empty = 'Unassigned' }) {
  if (!id) return <span className="item-person is-empty">{empty}</span>;
  const m = lookup(id);
  const name = m?.name || 'Teammate';
  return (
    <span className="item-person">
      <Avatar initials={presenceInitials(name)} id={id} size={size} />
      <span className="item-person__name">{name}</span>
    </span>
  );
}

/* Save-as-you-go text: commits on blur or Enter (Shift+Enter in the
   description makes a new line). */
function CommitText({ value, onCommit, multiline = false, placeholder, label, disabled, className, testId }) {
  const [draft, setDraft] = useState(value || '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value || ''); }, [value]);
  const commit = () => { if ((draft || '') !== (value || '')) onCommit(draft); };
  const common = {
    value: draft,
    placeholder,
    'aria-label': label,
    'data-testid': testId,
    disabled,
    className,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; commit(); },
    onChange: (e) => setDraft(e.target.value),
  };
  if (multiline) {
    return <textarea {...common} rows={4} onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value || ''); e.currentTarget.blur(); } }} />;
  }
  return (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(value || ''); e.currentTarget.blur(); }
      }}
    />
  );
}

function ItemDetail({
  item, kind, lookup, members, documents, userId, canEdit, canDelete, phone, project, photosOn = false,
  onUpdate, onClose, onDuplicate, onArchive, onUnarchive, onDelete, onOpenDocument,
}) {
  const tip = useTooltip();
  const [tab, setTab] = useState('discussion');
  const [menu, setMenu] = useState(null);
  const [events, setEvents] = useState([]);
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [sending, setSending] = useState(false);
  const today = localDay();
  const k = ITEM_KINDS[kind];

  // Only the newest Activity read is shown: an older one that comes back
  // late never replaces a fuller log.
  const eventsReadRef = useRef(0);
  const refreshEvents = useCallback(async () => {
    const read = ++eventsReadRef.current;
    const res = await loadItemEvents(item.id);
    if (read === eventsReadRef.current) setEvents(res.events);
  }, [item.id]);
  // Only the newest read lands: a slow answer for the item shown before
  // never replaces this item's thread.
  const commentsReadRef = useRef(0);
  const refreshComments = useCallback(async () => {
    const read = ++commentsReadRef.current;
    const res = await loadItemComments(item.id);
    if (read === commentsReadRef.current) setComments(res.comments);
  }, [item.id]);

  useEffect(() => { setTab('discussion'); setCommentDraft(''); setTagDraft(''); setComments([]); setEvents([]); refreshComments(); refreshEvents(); }, [item.id, refreshComments, refreshEvents]);
  // A saved change adds a line to the Activity tab.
  useEffect(() => { refreshEvents(); }, [item.updated_at, refreshEvents]);

  const save = async (patch) => {
    const res = await onUpdate(item.id, patch);
    if (res?.error) showToast(`Survey could not save that change. ${res.error}`, 'error');
    return res;
  };
  // Nightly 'item-assign-email': the new assignee gets an email with a link.
  const [assignEmailOn] = useState(() => isFeatureOn('item-assign-email'));
  const assign = async (id) => {
    const res = await save({ assignee_id: id });
    if (!assignEmailOn || res?.error || !id || id === userId) return;
    const out = await notifyItemAssignee(item.id);
    if (out.sent) {
      const name = members.find((m) => m.id === id)?.name || 'They';
      showToast(`${name} will get an email about ${itemCode(item.kind, item.number)}.`, 'success');
    }
  };

  const addTags = () => {
    const next = parseItemTags(tagDraft);
    if (!next.length) return;
    setTagDraft('');
    save((now) => {
      const merged = [...(now.tags || [])];
      for (const t of next) if (!merged.some((m) => m.toLowerCase() === t.toLowerCase())) merged.push(t);
      return { tags: merged.slice(0, 20) };
    });
  };

  const linkedIds = new Set((item.links || []).map((l) => l.document_id));
  const unlinked = documents.filter((d) => !linkedIds.has(d.id));
  const docName = (id) => documents.find((d) => d.id === id)?.name || 'Removed document';

  const send = async () => {
    const body = commentDraft.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await addItemComment(item.id, body);
    setSending(false);
    if (res.error) { showToast('Survey could not send that comment. Try again.', 'error'); return; }
    setCommentDraft('');
    setComments((cur) => [...cur, res.comment]);
  };

  const archived = Boolean(item.archived_at);
  const menuItems = [
    ...(canEdit ? [{ label: 'Duplicate', onClick: () => onDuplicate(item) }] : []),
    ...(canDelete && !archived ? [{ label: 'Archive', icon: 'download', onClick: () => onArchive([item.id]) }] : []),
    ...(canDelete && archived ? [{ label: 'Unarchive', icon: 'undo', onClick: () => onUnarchive([item.id]) }] : []),
    ...(canDelete && archived ? [{ label: 'Delete', danger: true, onClick: () => onDelete([item.id]) }] : []),
  ];

  return (
    <div className={`item-detail${phone ? ' is-sheet' : ''}`} data-item-detail={item.id} role={phone ? 'dialog' : 'region'} aria-label={`${itemCode(item.kind, item.number)} details`}>
      <div className="item-detail__head">
        <span className="item-code" data-item-code>{itemCode(item.kind, item.number)}</span>
        {archived && <span className="item-archived-badge">Archived</span>}
        <span style={{ flex: 1 }} />
        {menuItems.length > 0 && (
          <button
            type="button"
            className="hub-icon-btn"
            aria-haspopup="menu"
            aria-label={`More for ${itemCode(item.kind, item.number)}`}
            {...tip('More')}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu((m) => (m ? null : r)); }}
          ><Icon name="more" size={14} /></button>
        )}
        <button type="button" className="hub-icon-btn" aria-label="Close details" {...tip('Close')} onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
      <div className="item-detail__body slim-scroll">
        <CommitText
          className="item-title-input"
          label="Summary"
          placeholder={`${k.one} summary`}
          value={item.title}
          disabled={!canEdit}
          testId="item-title"
          onCommit={(title) => save({ title: title.slice(0, 200) })}
        />
        <div className="item-fields">
          <label className="item-field-label" htmlFor={`item-status-${item.id}`}>Status</label>
          <FieldSelect
            label="Status"
            testId="item-status-select"
            value={item.status}
            disabled={!canEdit}
            options={statusesFor(item.kind).map((s) => ({ value: s.key, label: s.label }))}
            onChange={(status) => save({ status })}
          />
          <span className="item-field-label">Assignee</span>
          <FieldSelect
            label="Assignee"
            testId="item-assignee-select"
            value={item.assignee_id || ''}
            disabled={!canEdit}
            options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: m.id === userId ? `${m.name} (you)` : m.name }))]}
            onChange={(id) => assign(id || null)}
          />
          <span className="item-field-label">Due date</span>
          <span className="item-due-field">
            <input
              type="date"
              aria-label="Due date"
              data-testid="item-due"
              className={`item-date${isOverdue(item, today) ? ' is-overdue' : ''}`}
              value={item.due_date || ''}
              disabled={!canEdit}
              onChange={(e) => save({ due_date: e.target.value || null })}
            />
            {item.due_date && canEdit && (
              <button type="button" className="hub-icon-btn" aria-label="Clear due date" {...tip('Clear due date')} onClick={() => save({ due_date: null })}><Icon name="close" size={12} /></button>
            )}
          </span>
          <span className="item-field-label">Tags</span>
          <span className="item-tags-field">
            {(item.tags || []).map((t) => (
              <span key={t} className="item-tag">
                {t}
                {canEdit && (
                  <button type="button" aria-label={`Remove tag ${t}`} onClick={() => save((now) => ({ tags: (now.tags || []).filter((x) => x !== t) }))}><Icon name="close" size={10} /></button>
                )}
              </span>
            ))}
            {canEdit && (
              <input
                className="item-tag-input"
                aria-label="Add tags"
                placeholder={(item.tags || []).length ? 'Add tag' : 'Separate tags with commas'}
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={addTags}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTags(); } }}
              />
            )}
          </span>
        </div>
        <span className="item-field-label item-block-label">Description</span>
        <CommitText
          multiline
          className="item-description"
          label="Description"
          placeholder="Add a description"
          value={item.description}
          disabled={!canEdit}
          testId="item-description"
          onCommit={(description) => save({ description: description.slice(0, 10000) })}
        />
        <span className="item-field-label item-block-label">Linked documents<b className="hub-section-count">{(item.links || []).length}</b></span>
        <div className="item-links" data-item-links>
          {(item.links || []).map((l) => (
            <div key={l.document_id} className="item-link-row">
              <button type="button" className="item-link-open" onClick={() => { const d = documents.find((x) => x.id === l.document_id); if (d) onOpenDocument?.(d); }}>
                <Icon name="document" size={13} contentType="document" />
                <span>{docName(l.document_id)}</span>
              </button>
              {canEdit && (
                <button type="button" className="hub-icon-btn" aria-label={`Unlink ${docName(l.document_id)}`} {...tip('Unlink')} onClick={() => save((now) => ({ links: (now.links || []).filter((x) => x.document_id !== l.document_id) }))}><Icon name="close" size={12} /></button>
              )}
            </div>
          ))}
          {canEdit && unlinked.length > 0 && (
            <FieldSelect
              label="Link a document"
              testId="item-link-select"
              value=""
              options={[{ value: '', label: 'Link a document…' }, ...unlinked.map((d) => ({ value: d.id, label: d.name }))]}
              onChange={(id) => { if (id) save((now) => ({ links: [...(now.links || []).filter((x) => x.document_id !== id), { document_id: id }] })); }}
            />
          )}
          {!(item.links || []).length && !(canEdit && unlinked.length) && <span className="meta item-empty-line">No linked documents.</span>}
        </div>
        {photosOn && project && (
          <Suspense fallback={null}>
            <ItemPhotosLazy project={project} item={item} canEdit={canEdit} lookupMember={lookup} />
          </Suspense>
        )}
        <div className="item-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'discussion'} className={tab === 'discussion' ? 'is-on' : ''} onClick={() => setTab('discussion')}>
            Discussion<b className="hub-section-count">{comments.length}</b>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'is-on' : ''} onClick={() => setTab('activity')}>Activity</button>
        </div>
        {tab === 'discussion' ? (
          <div className="item-discussion" data-item-discussion>
            {comments.length === 0 && <span className="meta item-empty-line">No comments yet.</span>}
            {comments.map((c) => (
              <div key={c.id} className="item-comment">
                <Avatar initials={presenceInitials(lookup(c.author_id)?.name || 'Teammate')} id={c.author_id} size={22} />
                <div className="item-comment__text">
                  <div className="item-comment__meta"><b>{lookup(c.author_id)?.name || 'Teammate'}</b> · {timeAgo(c.created_at)}</div>
                  <div className="item-comment__body">{c.body}</div>
                </div>
                {c.author_id === userId && (
                  <button
                    type="button"
                    className="hub-icon-btn"
                    aria-label="Delete comment"
                    {...tip('Delete comment')}
                    onClick={async () => {
                      const res = await deleteItemComment(c.id);
                      if (res.error) showToast('Survey could not delete that comment.', 'error');
                      else setComments((cur) => cur.filter((x) => x.id !== c.id));
                    }}
                  ><Icon name="trash" size={12} /></button>
                )}
              </div>
            ))}
            {canEdit && <div className="item-comment-box">
              <textarea
                aria-label="Write a comment"
                data-testid="item-comment-input"
                placeholder="Write a comment"
                rows={2}
                maxLength={4000}
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
              <button type="button" className="btn primary" data-testid="item-comment-send" disabled={!commentDraft.trim() || sending} onClick={send}>Send</button>
            </div>}
          </div>
        ) : (
          <div className="item-activity" data-item-activity>
            {events.map((ev) => (
              <div key={ev.id} className="item-event">
                <b>{lookup(ev.actor_id)?.name || 'Teammate'}</b> {describeEvent(ev, { memberName: (id) => lookup(id)?.name, kind })}
                <span className="meta"> · {timeAgo(ev.created_at)}</span>
              </div>
            ))}
            {events.length === 0 && <span className="meta item-empty-line">Nothing yet.</span>}
          </div>
        )}
      </div>
      {menu && <PopMenu anchorRect={menu} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

export default function ProjectItemsPanel({
  project, kind = 'issue', user = null, role = 'viewer', members = [], lookupMember, documents = [],
  onOpenDocument, phone: phoneProp, photosOn = false, openItemId = null,
}) {
  const tip = useTooltip();
  const phone = phoneProp ?? isPhoneLayout();
  const k = ITEM_KINDS[kind] || ITEM_KINDS.issue;
  const userId = user?.id || null;
  const canEdit = role === 'owner' || role === 'editor';
  const canDelete = role === 'owner';
  const data = useProjectItems({ projectId: project?.id });
  const { items } = data;
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState(() => new Set());
  const [groups, setGroups] = useState(() => new Set());
  const [tagFilter, setTagFilter] = useState(() => new Set());
  const [assignee, setAssignee] = useState('all');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState({ key: 'number', dir: 'desc' });
  const [openId, setOpenId] = useState(openItemId);
  // A photo's link chip opens its item here (Nightly 'project-photos').
  useEffect(() => { if (openItemId) setOpenId(openItemId); }, [openItemId]);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [menu, setMenu] = useState(null); // { rect, items }
  const [hiddenIds, setHiddenIds] = useState(() => new Set()); // deleted, Undo still open
  const hideOwnerRef = useRef(new Map()); // id -> the delete that hid it
  const [width, setWidth] = useState(1000);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  // The list's own width (the details pane takes a share of the panel).
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new project or list starts clean, but for an item asked for from
  // outside (a photo's link chip, an "assigned to you" email link).
  const openItemIdRef = useRef(openItemId);
  openItemIdRef.current = openItemId;
  useEffect(() => {
    setOpenId(openItemIdRef.current || null); setSel(new Set()); setSelecting(false); setQ(''); setQuick(new Set());
    setGroups(new Set()); setTagFilter(new Set()); setAssignee('all'); setArchived(false);
  }, [project?.id, kind]);

  const lookup = useCallback((id) => (lookupMember ? lookupMember(id) : null), [lookupMember]);
  const memberName = useCallback((id) => lookup(id)?.name || '', [lookup]);
  const today = localDay();
  const listItems = useMemo(() => items.filter((i) => i.kind === kind), [items, kind]);
  const counts = useMemo(() => groupCounts(listItems), [listItems]);
  const tags = useMemo(() => allItemTags(listItems), [listItems]);
  const archivedCount = useMemo(() => listItems.filter((i) => i.archived_at).length, [listItems]);
  const shown = useMemo(() => sortItems(filterItems(listItems, {
    q, quick, groups, tags: tagFilter, archived, userId, today,
    assignees: assignee === 'all' ? new Set() : new Set([assignee]),
  }), sort.key, sort.dir, { memberName }), [archived, assignee, groups, listItems, memberName, q, quick, sort, tagFilter, today, userId]);
  const open = listItems.find((i) => i.id === openId) || null;
  const split = !phone && (rootRef.current?.clientWidth || width) >= 860;
  const compact = width < 640;

  const toggle = (setter) => (key) => setter((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const createItem = async () => {
    if (!canEdit) { showToast(`Only editors can add ${k.many.toLowerCase()}.`, 'info'); return; }
    const res = await data.create(kind, {});
    if (res.error) { showToast(`Survey could not add the ${k.one.toLowerCase()}. ${res.error}`, 'error'); return; }
    setArchived(false);
    setOpenId(res.item.id);
    // Type the summary straight away, as in Drawboard.
    requestAnimationFrame(() => document.querySelector(`[data-item-detail="${res.item.id}"] [data-testid="item-title"]`)?.focus());
  };

  const archiveIds = async (ids) => {
    const res = await data.archive(ids);
    if (res.error) { showToast(`Survey could not archive that. ${res.error}`, 'error'); return; }
    if (ids.includes(openId)) setOpenId(null);
    setSel(new Set());
    showToast(ids.length === 1 ? `${k.one} archived` : `${ids.length} ${k.many.toLowerCase()} archived`, 'info', {
      action: { label: 'Undo', onClick: () => { data.unarchive(ids); } },
    });
  };
  const unarchiveIds = async (ids) => {
    const res = await data.unarchive(ids);
    if (res.error) { showToast(`Survey could not unarchive that. ${res.error}`, 'error'); return; }
    if (ids.includes(openId)) setOpenId(null);
    setSel(new Set());
    showToast(ids.length === 1 ? `${k.one} unarchived` : `${ids.length} ${k.many.toLowerCase()} unarchived`, 'info', {
      action: { label: 'Undo', onClick: () => { data.archive(ids); } },
    });
  };
  /* Delete cannot be undone on the server, so it waits 5 s for Undo. The
     toast is taken down when the 5 s are up (even if a hover paused its own
     clock), so Undo is never on screen after the delete has gone out. */
  const deleteIds = (ids) => {
    if (ids.includes(openId)) setOpenId(null);
    setSel(new Set());
    let undone = false;
    // Each row remembers the latest delete that hid it, so an older delete's
    // timer never shows a row a newer delete is still holding back.
    const token = {};
    ids.forEach((id) => hideOwnerRef.current.set(id, token));
    const unhide = () => setHiddenIds((cur) => {
      const n = new Set(cur);
      ids.forEach((id) => {
        if (hideOwnerRef.current.get(id) !== token) return;
        hideOwnerRef.current.delete(id);
        n.delete(id);
      });
      return n;
    });
    const toastId = showToast(ids.length === 1 ? `${k.one} deleted` : `${ids.length} ${k.many.toLowerCase()} deleted`, 'info', {
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          // The rows come back at once, not when the 5 s are up.
          unhide();
        },
      },
      duration: 5000,
    });
    setHiddenIds((cur) => new Set([...cur, ...ids]));
    setTimeout(async () => {
      dismissToast(toastId);
      if (undone) return;
      unhide();
      const res = await data.remove(ids);
      if (res.error) showToast(res.error, 'error');
    }, 5000);
  };

  const duplicateItem = async (item) => {
    const res = await data.duplicate(item);
    if (res.error) { showToast(`Survey could not duplicate that. ${res.error}`, 'error'); return; }
    setArchived(false);
    setOpenId(res.item.id);
    showToast(`${itemCode(res.item.kind, res.item.number)} added`, 'success');
  };

  const exportCsv = async (list) => {
    const latest = await loadLatestComments(project.id);
    const csv = itemsCsv(list, {
      memberName,
      docName: (id) => documents.find((d) => d.id === id)?.name || '',
      lastComment: (id) => latest.get(id) || '',
    });
    saveFile(csv, registerFileName(project?.name, kind), 'text/csv;charset=utf-8');
  };

  const rowMenu = (item) => [
    ...(canEdit ? [{ label: 'Duplicate', onClick: () => duplicateItem(item) }] : []),
    ...(canDelete && !item.archived_at ? [{ label: 'Archive', icon: 'download', onClick: () => archiveIds([item.id]) }] : []),
    ...(canDelete && item.archived_at ? [{ label: 'Unarchive', icon: 'undo', onClick: () => unarchiveIds([item.id]) }] : []),
    ...(canDelete && item.archived_at ? [{ label: 'Delete', danger: true, onClick: () => deleteIds([item.id]) }] : []),
  ];

  const listMenu = [
    { label: archived ? `Show unarchived ${k.many.toLowerCase()}` : `Show archived ${k.many.toLowerCase()} (${archivedCount})`, icon: 'history', onClick: () => { setArchived((a) => !a); setSel(new Set()); setOpenId(null); } },
    ...(canEdit ? [{ label: 'Export CSV', icon: 'download', onClick: () => exportCsv(shown) }] : []),
  ];

  const visible = shown.filter((i) => !hiddenIds.has(i.id));
  const selItems = visible.filter((i) => sel.has(i.id));
  const allSel = selItems.length === visible.length && visible.length > 0;

  const headCell = (key, label, className = '') => {
    const on = sort.key === key;
    return (
      <button
        type="button"
        className={`item-th ${className}${on ? ' is-sorted' : ''}`}
        aria-label={`Sort by ${label}`}
        onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'number' ? 'desc' : 'asc' }))}
      >
        {label}{on && <Icon name={sort.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={10} />}
      </button>
    );
  };

  const memberOptions = [
    { value: 'all', label: 'Any assignee' },
    { value: 'none', label: 'Unassigned' },
    ...members.map((m) => ({ value: m.id, label: m.id === userId ? `${m.name} (you)` : m.name })),
  ];

  const filtersOn = q || quick.size || groups.size || tagFilter.size || assignee !== 'all';

  return (
    <div ref={rootRef} className={`project-items${split && open ? ' has-detail' : ''}${phone ? ' is-phone' : ''}${compact ? ' is-compact' : ''}`} data-project-items={kind}>
      <div ref={listRef} className="project-items__list">
        <div className="project-items__bar">
          {canEdit && (
            <button type="button" className="btn primary hub-new-btn" data-testid="item-new" onClick={createItem}>
              <Icon name="plus" size={11} />New {k.one.toLowerCase()}
            </button>
          )}
          <div className="hub-search item-search">
            <Icon name="search" size={13} color="var(--ink-200)" />
            <input
              aria-label={`Search ${k.many.toLowerCase()}`}
              data-testid="item-search"
              placeholder="Search by summary or ID"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span style={{ flex: 1 }} />
          {canEdit && <SectionIconButton
            action="select"
            label={selecting ? 'Done' : 'Select'}
            nothingToSelect={visible.length === 0}
            active={selecting}
            onClick={() => { setSelecting((s) => !s); setSel(new Set()); }}
          />}
          <button
            type="button"
            className="hub-icon-btn"
            aria-haspopup="menu"
            aria-label={`${k.many} list options`}
            data-testid="item-list-menu"
            {...tip(`${k.many} list options`)}
            onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setMenu((m) => (m ? null : { rect, items: listMenu })); }}
          ><Icon name="moreHorizontal" size={14} /></button>
        </div>
        <div className="project-items__chips" data-item-chips>
          {QUICK_FILTERS.map((f) => (
            <button key={f.key} type="button" className="item-chip" aria-pressed={quick.has(f.key)} onClick={() => toggle(setQuick)(f.key)}>{f.label}</button>
          ))}
          <span className="item-chip-sep" aria-hidden="true" />
          {STATUS_GROUPS.map((g) => (
            <button key={g.key} type="button" className="item-chip" aria-pressed={groups.has(g.key)} onClick={() => toggle(setGroups)(g.key)}>
              {g.label}<b className="hub-section-count">{counts[g.key]}</b>
            </button>
          ))}
          {tags.length > 0 && <span className="item-chip-sep" aria-hidden="true" />}
          {tags.map((t) => (
            <button key={t} type="button" className="item-chip is-tag" aria-pressed={tagFilter.has(t)} onClick={() => toggle(setTagFilter)(t)}>{t}</button>
          ))}
          <span className="item-assignee-filter">
            <FieldSelect label="Assignee filter" testId="item-assignee-filter" value={assignee} options={memberOptions} onChange={setAssignee} />
          </span>
          {filtersOn ? (
            <button type="button" className="item-chip is-clear" onClick={() => { setQ(''); setQuick(new Set()); setGroups(new Set()); setTagFilter(new Set()); setAssignee('all'); }}>Clear</button>
          ) : null}
        </div>
        {archived && <div className="item-archived-note">Showing archived {k.many.toLowerCase()}.</div>}
        {selecting && (
          <div className="project-items__bulk" data-item-bulk>
            <span
              {...checkboxProps(allSel, () => setSel(allSel ? new Set() : new Set(visible.map((i) => i.id))), 'Select all')}
              className={`item-check${allSel ? ' is-on' : ''}`}
            >{allSel && <Icon name="check" size={10} color="var(--accent-text)" />}</span>
            <span className="meta">{selItems.length} selected</span>
            <span style={{ flex: 1 }} />
            {canDelete && !archived && <button type="button" className="btn" disabled={!selItems.length} onClick={() => archiveIds(selItems.map((i) => i.id))}>Archive</button>}
            {canDelete && archived && <button type="button" className="btn" disabled={!selItems.length} onClick={() => unarchiveIds(selItems.map((i) => i.id))}>Unarchive</button>}
            {canEdit && <button type="button" className="btn" disabled={!selItems.length} onClick={() => exportCsv(selItems)}>Export</button>}
            {canDelete && archived && <button type="button" className="btn danger" disabled={!selItems.length} onClick={() => deleteIds(selItems.map((i) => i.id))}>Delete</button>}
          </div>
        )}
        {!phone && visible.length > 0 && (
          <div className={`item-row item-row--head${selecting ? ' has-check' : ''}`} role="row">
            {selecting ? <span /> : null}
            {headCell('number', 'ID')}
            {headCell('title', 'Summary')}
            {headCell('status', 'Status')}
            {!compact && headCell('assignee', 'Assignee')}
            {!compact && <span className="item-th is-static">Links</span>}
            {headCell('due', 'Due')}
            <span />
          </div>
        )}
        <div className="project-items__rows slim-scroll" role="list" data-item-rows>
          {data.loading && !listItems.length ? (
            <div className="meta item-empty-line">Loading {k.many.toLowerCase()}…</div>
          ) : visible.length === 0 ? (
            listItems.length === 0 && !archived ? (
              canEdit ? (
                <EmptyState icon="listChecks" line={`No ${k.many.toLowerCase()} yet`} description={`Raise ${kind === 'issue' ? 'an issue' : 'a task'} with an ID, a status, an assignee and a due date, and link it to drawings.`} actionLabel={`New ${k.one.toLowerCase()}`} onAction={createItem} />
              ) : (
                <div className="meta item-empty-line">No {k.many.toLowerCase()} yet.</div>
              )
            ) : (
              <div className="meta item-empty-line">{archived ? `No archived ${k.many.toLowerCase()}.` : `No ${k.many.toLowerCase()} match these filters.`}</div>
            )
          ) : visible.map((item) => {
            const isSel = sel.has(item.id);
            const overdue = isOverdue(item, today);
            const soon = !overdue && isDueSoon(item, today);
            const onRow = () => { if (selecting) { setSel((cur) => { const n = new Set(cur); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; }); } else setOpenId(item.id); };
            const menuItems = rowMenu(item);
            if (phone) {
              return (
                <div
                  key={item.id}
                  role="listitem"
                  data-item-row={item.id}
                  className={`item-card${isSel ? ' is-selected' : ''}${item.id === openId ? ' is-open' : ''}`}
                  onClick={onRow}
                  {...keyboardControlProps()}
                >
                  <div className="item-card__top">
                    <span className="item-code">{itemCode(item.kind, item.number)}</span>
                    <StatusChip status={item.status} kind={item.kind} />
                    <span style={{ flex: 1 }} />
                    {selecting && <span className={`item-check${isSel ? ' is-on' : ''}`}>{isSel && <Icon name="check" size={10} color="var(--accent-text)" />}</span>}
                  </div>
                  <div className="item-card__title">{item.title || <span className="meta">No summary</span>}</div>
                  <div className="item-card__meta">
                    <Person id={item.assignee_id} lookup={lookup} size={16} />
                    {item.due_date && <span className={`item-due${overdue ? ' is-overdue' : ''}${soon ? ' is-soon' : ''}`}>{formatDue(item.due_date, today)}</span>}
                    {(item.links || []).length > 0 && <span className="item-links-count"><Icon name="formatHyperlink" size={11} />{item.links.length}</span>}
                  </div>
                </div>
              );
            }
            return (
              <div
                key={item.id}
                role="listitem"
                data-item-row={item.id}
                className={`item-row${selecting ? ' has-check' : ''}${isSel ? ' is-selected' : ''}${item.id === openId ? ' is-open' : ''}`}
                onClick={onRow}
                onContextMenu={(e) => { if (!menuItems.length) return; e.preventDefault(); setMenu({ rect: { left: e.clientX, right: e.clientX + 180, top: e.clientY, bottom: e.clientY }, items: menuItems }); }}
                {...keyboardControlProps()}
              >
                {selecting ? (
                  <span className={`item-check${isSel ? ' is-on' : ''}`} {...checkboxProps(isSel, onRow, `Select ${itemCode(item.kind, item.number)}`)} onClick={(e) => { e.stopPropagation(); onRow(); }}>
                    {isSel && <Icon name="check" size={10} color="var(--accent-text)" />}
                  </span>
                ) : null}
                <span className="item-code">{itemCode(item.kind, item.number)}</span>
                <span className="item-title">
                  <span className="item-title__text">{item.title || <span className="meta">No summary</span>}</span>
                  {!compact && (item.tags || []).slice(0, 2).map((t) => <span key={t} className="item-tag is-small">{t}</span>)}
                </span>
                <StatusChip status={item.status} kind={item.kind} />
                {!compact && <Person id={item.assignee_id} lookup={lookup} />}
                {!compact && <span className="item-links-count">{(item.links || []).length ? <><Icon name="formatHyperlink" size={11} />{item.links.length}</> : <span className="meta">—</span>}</span>}
                <span className={`item-due${overdue ? ' is-overdue' : ''}${soon ? ' is-soon' : ''}`}>{item.due_date ? formatDue(item.due_date, today) : <span className="meta">—</span>}</span>
                {menuItems.length ? (
                  <button
                    type="button"
                    className="hub-icon-btn"
                    aria-haspopup="menu"
                    aria-label={`More for ${itemCode(item.kind, item.number)}`}
                    {...tip('More')}
                    onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setMenu((m) => (m ? null : { rect, items: menuItems })); }}
                  ><Icon name="more" size={14} /></button>
                ) : <span />}
              </div>
            );
          })}
        </div>
      </div>
      {open && (split ? (
        <ItemDetail
          item={open} kind={kind} lookup={lookup} members={members} documents={documents} userId={userId}
          canEdit={canEdit} canDelete={canDelete} phone={false} project={project} photosOn={photosOn}
          onUpdate={data.update} onClose={() => setOpenId(null)} onDuplicate={duplicateItem}
          onArchive={archiveIds} onUnarchive={unarchiveIds} onDelete={deleteIds} onOpenDocument={onOpenDocument}
        />
      ) : createPortal(
        <div className="survey-hub item-sheet-layer">
          <button type="button" className="item-sheet-scrim" aria-label="Close details" onClick={() => setOpenId(null)} />
          <ItemDetail
            item={open} kind={kind} lookup={lookup} members={members} documents={documents} userId={userId}
            canEdit={canEdit} canDelete={canDelete} phone project={project} photosOn={photosOn}
            onUpdate={data.update} onClose={() => setOpenId(null)} onDuplicate={duplicateItem}
            onArchive={archiveIds} onUnarchive={unarchiveIds} onDelete={deleteIds} onOpenDocument={onOpenDocument}
          />
        </div>,
        document.body,
      ))}
      {menu && <PopMenu anchorRect={menu.rect} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/* Files · Issues · Tasks, above the open project (one row of tabs). */
export function ProjectItemsTabs({ value, onChange, counts = {}, issues = true, activity = false, photos = false }) {
  const tabs = [
    { key: 'files', label: 'Files' },
    ...(issues ? [{ key: 'issue', label: 'Issues' }, { key: 'task', label: 'Tasks' }] : []),
    // Nightly 'project-activity': Drawboard's project Activity page.
    ...(activity ? [{ key: 'activity', label: 'Activity' }] : []),
    // Nightly 'project-photos': Drawboard's project Photos page.
    ...(photos ? [{ key: 'photos', label: 'Photos' }] : []),
  ];
  return (
    <div className="project-items-tabs" role="tablist" aria-label="Project lists" data-project-items-tabs>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className={value === t.key ? 'is-on' : ''}
          onClick={() => onChange(t.key)}
        >
          {t.label}{counts[t.key] != null && <b className="hub-section-count">{counts[t.key]}</b>}
        </button>
      ))}
    </div>
  );
}
