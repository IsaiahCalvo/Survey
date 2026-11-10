/* Screens for the Home extras (homeLibrary.js). Copied from Drawboard PDF's
   Home (trial 2026-11-09): the Add tag popover, tag chips on a row, the side
   bar's views and Tags list, the phone's filter chips, the list-size menu and
   Tiles. Styles: homeLibrary.css. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './HubShell';
import DismissBarrier from '../components/DismissBarrier';
import { useTooltip } from '../components/Tooltip';
import PdfPageThumb from './PdfPageThumb';
import { PdfThumb } from './HubShell';
import { LIST_DENSITIES, allTags, hasTag, parseTagInput } from './homeLibrary.js';
import './homeLibrary.css';

const VIEW_LABEL = { all: 'All files', 'shared-by-me': 'Shared by me', 'shared-with-me': 'Shared with me' };

/* Drawboard's Add tag popover: the document's name, a field ("Separate tags
   with commas") with a + button, then every tag you have as a chip you press
   to put on or take off. It stays open after each change so you can add
   several, and closes on Escape or a press outside. `docs` = the documents it
   acts on (one, or a selection). */
export function TagPopover({ anchorRect, docs, tagsByDoc, onAdd, onRemove, onClose }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [pos, setPos] = useState(null);
  const ids = docs.map((d) => d.id);
  // A tag taken off its last document stays in the popover until it closes,
  // so a mistaken press can be put right with a second one.
  const [kept, setKept] = useState(() => allTags(tagsByDoc));
  const fresh = allTags(tagsByDoc);
  const known = [...kept, ...fresh.filter((t) => !hasTag(kept, t))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  useEffect(() => {
    if (fresh.some((t) => !hasTag(kept, t))) setKept(known);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh.join('\u0000')]);
  const onAll = (tag) => ids.length > 0 && ids.every((id) => hasTag(tagsByDoc.get(id), tag));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchorRect) return;
    const w = el.offsetWidth || 300;
    const h = el.offsetHeight || 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = anchorRect.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, anchorRect.top - h - 6);
    const left = Math.max(8, Math.min(anchorRect.left, vw - w - 8));
    setPos({ top, left });
  }, [anchorRect, known.length]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = () => {
    const tags = parseTagInput(text);
    if (!tags.length) return;
    onAdd(ids, tags);
    setText('');
  };

  const title = docs.length === 1 ? docs[0].name : `${docs.length} documents`;
  return createPortal(
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label={`Tags for ${title}`}
        className="home-tag-popover"
        data-home-tag-popover=""
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
      >
        <div className="home-tag-popover__title">{title}</div>
        <form
          className="home-tag-popover__field"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Separate tags with commas"
            aria-label="New tags"
            maxLength={400}
          />
          <button type="submit" className="hub-icon-btn" aria-label="Add tags" disabled={!parseTagInput(text).length}>
            <Icon name="plus" size={14} />
          </button>
        </form>
        {known.length > 0 ? (
          <div className="home-tag-popover__chips" role="group" aria-label="Your tags">
            {known.map((tag) => {
              const on = onAll(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  className={`home-tag-chip is-toggle${on ? ' is-on' : ''}`}
                  onClick={() => (on ? onRemove(ids, tag) : onAdd(ids, [tag]))}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="home-tag-popover__empty">Tags you add show here, ready to reuse.</div>
        )}
      </div>
    </>,
    document.body,
  );
}

/* A row's Tags cell: up to two chips, then "+N", or "Add tag" when it has
   none (Drawboard's row chip). Pressing it opens the popover. */
export function TagCell({ tags, onOpen, compact = false }) {
  const shown = (tags || []).slice(0, compact ? 1 : 2);
  const more = (tags || []).length - shown.length;
  return (
    <button
      type="button"
      className={`home-tag-cell${tags?.length ? '' : ' is-empty'}`}
      data-home-tag-cell=""
      onClick={(event) => { event.stopPropagation(); onOpen(event.currentTarget.getBoundingClientRect()); }}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-label={tags?.length ? `Tags: ${tags.join(', ')}. Edit tags` : 'Add tag'}
    >
      {tags?.length ? (
        <>
          {shown.map((tag) => <span key={tag} className="home-tag-chip">{tag}</span>)}
          {more > 0 ? <span className="home-tag-chip is-more">+{more}</span> : null}
        </>
      ) : (
        <><Icon name="tag" size={12} color="currentColor" />Add tag</>
      )}
    </button>
  );
}

/* The side bar under Documents (desktop and tablet): All files, Shared by
   me, Shared with me with their counts, then the Tags group that folds
   like Drawboard's. */
export function HomeNavSection({ views, view, counts, tags, tag, onView, onTag }) {
  const [tagsOpen, setTagsOpen] = useState(true);
  return (
    <div className="home-nav-section" data-home-nav="">
      {views.map((key) => (
        <button
          key={key}
          type="button"
          className={`home-nav-item${view === key && !tag ? ' active' : ''}`}
          aria-current={view === key && !tag ? 'true' : undefined}
          onClick={() => onView(key)}
        >
          <span className="home-nav-item__label">{VIEW_LABEL[key]}</span>
          <span className="home-nav-item__count">{counts[key] ?? 0}</span>
        </button>
      ))}
      {tags ? (
        <>
          <button
            type="button"
            className="home-nav-group"
            aria-expanded={tagsOpen}
            onClick={() => setTagsOpen((open) => !open)}
          >
            <Icon name={tagsOpen ? 'chevronDown' : 'chevronRight'} size={12} color="currentColor" />Tags
          </button>
          {tagsOpen && (tags.length ? tags.map((row) => (
            <button
              key={row.tag}
              type="button"
              className={`home-nav-item is-tag${tag && tag.toLowerCase() === row.tag.toLowerCase() ? ' active' : ''}`}
              aria-current={tag && tag.toLowerCase() === row.tag.toLowerCase() ? 'true' : undefined}
              onClick={() => onTag(row.tag)}
            >
              <Icon name="tag" size={11} color="currentColor" />
              <span className="home-nav-item__label">{row.tag}</span>
              <span className="home-nav-item__count">{row.count}</span>
            </button>
          )) : <div className="home-nav-empty">No tags yet</div>)}
        </>
      ) : null}
    </div>
  );
}

/* The phone's filter chips under the search (Drawboard's phone Home):
   All, Shared by me, Shared with me with counts, then a chip per tag. They
   scroll sideways. */
export function HomeFilterChips({ views, view, counts, tags, tag, onView, onTag }) {
  return (
    <div className="home-filter-chips" role="toolbar" aria-label="Filter documents" data-home-chips="">
      {views.map((key) => {
        const on = view === key && !tag;
        return (
          <button key={key} type="button" aria-pressed={on} className={`home-filter-chip${on ? ' is-on' : ''}`} onClick={() => onView(key)}>
            {key === 'all' ? 'All' : VIEW_LABEL[key]}<span className="home-filter-chip__count">{counts[key] ?? 0}</span>
          </button>
        );
      })}
      {(tags || []).map((row) => {
        const on = Boolean(tag && tag.toLowerCase() === row.tag.toLowerCase());
        return (
          <button key={`t:${row.tag}`} type="button" aria-pressed={on} className={`home-filter-chip is-tag${on ? ' is-on' : ''}`} onClick={() => onTag(on ? null : row.tag)}>
            <Icon name="tag" size={11} color="currentColor" />{row.tag}<span className="home-filter-chip__count">{row.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/* The list-size button at the right of the header (Drawboard's view menu):
   Large list, Medium list, Compact list, Tiles. */
export function ListViewButton({ density, onChange, phone = false }) {
  const tip = useTooltip();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  return (
    <span className="home-view-button" ref={rootRef}>
      <DismissBarrier active={open} insideRefs={[rootRef]} onDismiss={() => setOpen(false)} menu />
      <button
        type="button"
        className={phone ? 'btn documents-mobile-filter home-view-button__trigger' : 'hub-icon-btn home-view-button__trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="List view"
        data-home-view-button=""
        {...tip('List view')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={density === 'tiles' ? 'pages' : 'listChecks'} size={14} color="currentColor" />
      </button>
      {open && (
        <div className="hub-menu home-view-menu" role="menu" aria-label="List view">
          {LIST_DENSITIES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={density === key}
              className={`hub-menu__item${density === key ? ' active' : ''}`}
              onClick={() => { onChange(key); setOpen(false); }}
            >
              <span style={{ width: 14, display: 'inline-flex' }}>{density === key ? <Icon name="check" size={12} color="currentColor" /> : null}</span>
              {label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* Tiles: a card per document with its first page, the name and a line of
   detail. Click previews, double-click (or a tap) opens, right-click and ⋮
   give the row menu, like the list. */
export function HomeTiles({ docs, selectedIds, previewId, downloadDocument, metaFor, onClick, onDoubleClick, onContextMenu, onMore, tagsByDoc, onTags }) {
  const tip = useTooltip();
  return (
    <div className="home-tiles" data-home-tiles="">
      {docs.map((d) => {
        const selected = selectedIds.has(d.id) || d.id === previewId;
        const tags = tagsByDoc?.get(d.id) || [];
        return (
          <div
            key={d.id}
            data-document-id={d.id}
            className={`home-tile${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            onClick={(event) => onClick(event, d)}
            onDoubleClick={(event) => onDoubleClick(event, d)}
            onContextMenu={(event) => onContextMenu(event, d)}
            onKeyDown={(event) => { if (event.key === 'Enter') onDoubleClick(event, d); }}
          >
            <div className="home-tile__thumb">
              <PdfPageThumb doc={d.raw} downloadDocument={downloadDocument} variant="preview" fill fallback={<PdfThumb height="100%" stamp="" />} />
            </div>
            <div className="home-tile__foot">
              <div className="home-tile__text">
                <div className="home-tile__name">{d.name}</div>
                <div className="home-tile__meta">{metaFor(d)}</div>
                {onTags && tags.length ? (
                  <div className="home-tile__tags">{tags.slice(0, 3).map((tag) => <span key={tag} className="home-tag-chip">{tag}</span>)}</div>
                ) : null}
              </div>
              <button
                type="button"
                aria-haspopup="menu"
                className="hub-icon-btn"
                aria-label="More"
                {...tip('More')}
                onClick={(event) => onMore(event, d)}
                onDoubleClick={(event) => event.stopPropagation()}
              ><Icon name="more" size={14} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
