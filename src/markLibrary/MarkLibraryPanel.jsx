/**
 * MarkLibraryPanel — the Library tab of the left rail (beta flag
 * 'mark-library', Survey Nightly only). Drawboard Projects' Markup Library:
 *
 *   [Personal | Project]                       [Select] [...]
 *   [ search ................................ ]
 *   [tag] [tag] [tag]
 *   +------+ +------+ +------+
 *   | pic  | | pic  | | pic  |      click: arm it, then click the page
 *   | name | | name | | name |      drag: drop it where you let go
 *   +------+ +------+ +------+
 *
 * "..." holds the layout (large grid, small grid, list), the sort (recently
 * used, name, newest), Group by tag, Import and Export library. Each item's
 * own "..." (or right-click) holds Rename, Tags, Duplicate, Move or Copy to
 * the other library, Export and Delete; Select mode does the same to many at
 * once. Deletes act at once with an Undo toast. A project item can be
 * changed by its author or a project owner; everyone in the project can
 * place it (the database enforces the same rules).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icons.jsx';
import { useTooltip } from '../components/Tooltip.jsx';
import SectionIconButton, { SelectModeButtons } from '../components/SectionIconButton.jsx';
import ListItemContextMenu from '../components/ListItemContextMenu.jsx';
import SwipeActionsRow, { buildSwipeActions } from '../components/SwipeActionsRow.jsx';
import { usePromptDialog } from '../components/dialogPrompts.jsx';
import { showToast } from '../utils/toast.js';
import { libraryErrorMessage, markLibraryStore, useMarkLibrary } from './markLibraryStore.js';
import {
  armLibraryItem,
  beginLibraryDrag,
  disarmLibraryItem,
  getArmedLibraryItem,
  placeLibraryItem,
  subscribeLibraryPlacement,
} from './markLibraryPlacement.js';
import { libraryThumbnail } from './markLibraryThumbnail.js';
import {
  LIBRARY_EXPORT_EXTENSION,
  LIBRARY_KIND_LABELS,
  LIBRARY_SORTS,
  LIBRARY_TOKENS,
  buildLibraryExportFile,
  filterLibraryItems,
  groupLibraryItemsByTag,
  libraryExportFileName,
  libraryTagsOf,
  parseLibraryImportFile,
  payloadHasTokens,
  planBulkTagChange,
  sortLibraryItems,
} from './markLibraryModel.js';
import './MarkLibraryPanel.css';

const LAYOUTS = [
  { id: 'large', label: 'Large grid' },
  { id: 'small', label: 'Small grid' },
  { id: 'list', label: 'List' },
];
const DRAG_START_PX = 6;

function downloadText(text, fileName) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useThumbnail(item, px) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    libraryThumbnail(item, { px }).then((next) => { if (!cancelled) setUrl(next); });
    return () => { cancelled = true; };
  }, [item, px]);
  return url;
}

function Thumb({ item, px }) {
  const url = useThumbnail(item, px);
  return (
    <span className="mark-library__thumb" aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="mark-library__thumb-wait" />}
    </span>
  );
}

function useArmedId() {
  const [armedId, setArmedId] = useState(() => getArmedLibraryItem()?.item?.id || null);
  useEffect(() => subscribeLibraryPlacement(() => setArmedId(getArmedLibraryItem()?.item?.id || null)), []);
  return armedId;
}

function LibraryTile({
  item, layout, armed, selectMode, selected, canChange, onActivate, onToggleSelect, onMenu, onDelete,
}) {
  const tip = useTooltip();
  const press = useRef(null);
  // The drag starts once the press moves a few pixels, wherever the pointer
  // is by then (a quick move leaves the tile before its own move fires).
  const handlePointerDown = (event) => {
    if (selectMode || event.button !== 0 || event.pointerType === 'touch') return;
    if (event.target.closest('.mark-library__more')) return;
    const p = { x: event.clientX, y: event.clientY, id: event.pointerId, dragging: false };
    press.current = p;
    const stop = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
    };
    const onMove = (move) => {
      if (move.pointerId !== p.id) return;
      if (Math.hypot(move.clientX - p.x, move.clientY - p.y) < DRAG_START_PX) return;
      stop();
      p.dragging = true;
      disarmLibraryItem();
      beginLibraryDrag(item);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', stop, true);
    window.addEventListener('pointercancel', stop, true);
  };
  const handleClick = (event) => {
    const dragged = press.current?.dragging;
    press.current = null;
    if (dragged) return;
    if (selectMode) { onToggleSelect(item.id); return; }
    onActivate(item, event);
  };
  const kinds = item.kinds.map((k) => LIBRARY_KIND_LABELS[k] || k).join(', ');
  const name = item.name;
  const body = (
    <div
      role="button"
      tabIndex={0}
      className={`mark-library__tile mark-library__tile--${layout}${armed ? ' is-armed' : ''}${selected ? ' is-selected' : ''}`}
      data-mark-library-item={item.id}
      aria-pressed={selectMode ? selected : armed}
      aria-label={`${name}${kinds ? ` (${kinds})` : ''}`}
      {...(layout === 'small' ? tip(name, 'below') : {})}
      onPointerDown={handlePointerDown}
      onPointerCancel={() => { press.current = null; }}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleClick(event); }
      }}
      onContextMenu={(event) => { event.preventDefault(); onMenu(item, { x: event.clientX, y: event.clientY }); }}
    >
      <Thumb item={item} px={layout === 'large' ? 160 : 80} />
      {layout !== 'small' && (
        <span className="mark-library__meta">
          <span className="mark-library__name">{name}</span>
          {layout === 'list' && (
            <span className="mark-library__sub">
              {[kinds, ...(item.tags || [])].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      )}
      {payloadHasTokens(item.payload) && <span className="mark-library__badge" {...tip('Fills in {{tokens}} when placed', 'below')}>{'{ }'}</span>}
      {selectMode ? (
        <span className={`mark-library__check${selected ? ' is-on' : ''}`} aria-hidden="true">
          {selected ? <Icon name="check" size={12} color="currentColor" /> : null}
        </span>
      ) : (
        <button
          type="button"
          className="mark-library__more"
          aria-label={`More for ${name}`}
          {...tip('More', 'below')}
          onClick={(event) => {
            event.stopPropagation();
            const r = event.currentTarget.getBoundingClientRect();
            onMenu(item, { x: r.left, y: r.bottom + 4 });
          }}
        >
          <Icon name="moreHorizontal" size={14} color="currentColor" />
        </button>
      )}
    </div>
  );
  if (layout !== 'list') return body;
  return (
    <SwipeActionsRow
      label={name}
      disabled={selectMode}
      actions={buildSwipeActions({ onDelete: canChange ? () => onDelete([item.id]) : undefined })}
    >
      {body}
    </SwipeActionsRow>
  );
}

export default function MarkLibraryPanel({ phone = false }) {
  const state = useMarkLibrary();
  const tip = useTooltip();
  const armedId = useArmedId();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [menu, setMenu] = useState(null); // { point, items }
  const [showTokens, setShowTokens] = useState(false);
  const [askPrompt, promptDialog] = usePromptDialog();
  const fileRef = useRef(null);

  const hasProject = Boolean(state.projectId && state.access.canRead);
  const library = state.view.library === 'project' && hasProject ? 'project' : 'personal';
  const bucket = library === 'project' ? state.project : state.personal;
  const items = bucket.items;
  const otherLibrary = library === 'project' ? 'personal' : 'project';
  const canAddHere = library === 'personal' || state.access.canAdd;
  const canAddOther = otherLibrary === 'personal' || (state.projectId && state.access.canAdd);

  useEffect(() => { setSelected(new Set()); setTag(null); }, [library]);
  useEffect(() => { if (!selectMode) setSelected(new Set()); }, [selectMode]);

  const tags = useMemo(() => libraryTagsOf(items), [items]);
  const visible = useMemo(
    () => sortLibraryItems(filterLibraryItems(items, { query, tag }), state.view.sort, state.recents),
    [items, query, tag, state.view.sort, state.recents],
  );
  const groups = state.view.groupByTag ? groupLibraryItemsByTag(visible) : [{ tag: undefined, items: visible }];
  const layout = phone && state.view.layout === 'small' ? 'large' : state.view.layout;

  const run = useCallback(async (work, done) => {
    try {
      const result = await work();
      if (done) done(result);
      return result;
    } catch (error) {
      showToast(libraryErrorMessage(error), 'error');
      return null;
    }
  }, []);

  const deleteItems = useCallback((ids) => run(() => markLibraryStore.deleteItems(ids), (removed) => {
    if (!removed?.length) return;
    setSelected(new Set());
    showToast(removed.length === 1 ? `Deleted “${removed[0].name}”` : `Deleted ${removed.length} items`, 'info', {
      action: {
        label: 'Undo',
        onClick: () => run(() => markLibraryStore.addItems(removed.map((it) => ({
          library: it.library, name: it.name, tags: it.tags, payload: it.payload,
        })))),
      },
    });
  }), [run]);

  const duplicate = (ids) => run(() => markLibraryStore.duplicateItems(ids), (copies) => {
    if (copies?.length) showToast(copies.length === 1 ? `Made “${copies[0].name}”` : `Made ${copies.length} copies`, 'success');
  });
  const sendTo = (ids, move) => run(
    () => (move ? markLibraryStore.moveItems(ids, otherLibrary) : markLibraryStore.duplicateItems(ids, otherLibrary)),
    (copies) => {
      if (!copies?.length) return;
      setSelected(new Set());
      const where = otherLibrary === 'project' ? `${state.access.projectName || 'the project'}'s library` : 'your library';
      showToast(`${move ? 'Moved' : 'Copied'} ${copies.length === 1 ? `“${copies[0].name}”` : `${copies.length} items`} to ${where}`, 'success');
    },
  );
  const exportItems = (list) => {
    if (!list.length) return;
    downloadText(buildLibraryExportFile(list), libraryExportFileName());
  };
  const editTags = async (list) => {
    const current = libraryTagsOf(list);
    const answer = await askPrompt({
      title: list.length === 1 ? `Tags for “${list[0].name}”` : `Tags for ${list.length} items`,
      message: list.length === 1
        ? 'Put a comma between tags.'
        : 'Tags you type are added to each item. Start a tag with a minus (-Old) to take it off.',
      label: 'Tags',
      defaultValue: list.length === 1 ? current.join(', ') : '',
      placeholder: 'Electrical, Review',
      confirmLabel: 'Save',
    });
    if (answer == null) return;
    const words = String(answer).split(',').map((s) => s.trim()).filter(Boolean);
    const plan = list.length === 1
      ? [{ id: list[0].id, tags: words }]
      : planBulkTagChange(list, {
        add: words.filter((w) => !w.startsWith('-')),
        remove: words.filter((w) => w.startsWith('-')).map((w) => w.slice(1)),
      });
    await run(async () => { for (const change of plan) await markLibraryStore.setTags(change.id, change.tags); });
  };
  const rename = async (item) => {
    const answer = await askPrompt({ title: 'Rename', label: 'Name', defaultValue: item.name, confirmLabel: 'Rename' });
    if (answer == null || !answer.trim()) return;
    await run(() => markLibraryStore.renameItem(item.id, answer));
  };

  const openItemMenu = (item, point) => {
    const canChange = markLibraryStore.canChange(item);
    const locked = canChange ? null : 'Only its author or a project owner can change this';
    const moveLabel = otherLibrary === 'project' ? 'Move to project' : 'Move to personal';
    const copyLabel = otherLibrary === 'project' ? 'Copy to project' : 'Copy to personal';
    setMenu({
      point,
      items: [
        { label: 'Place in the middle of the page', icon: 'plus', onClick: () => placeLibraryItem(item, { center: true }) },
        { label: 'Rename', disabled: !canChange, reason: locked, onClick: () => rename(item) },
        { label: 'Tags', icon: 'filter', disabled: !canChange, reason: locked, onClick: () => editTags([item]) },
        { label: 'Duplicate', disabled: !canAddHere, onClick: () => duplicate([item.id]) },
        ...(canAddOther ? [
          canChange
            ? { label: moveLabel, onClick: () => sendTo([item.id], true) }
            : { label: copyLabel, onClick: () => sendTo([item.id], false) },
        ] : []),
        { label: 'Export', onClick: () => exportItems([item]) },
        { label: 'Delete', danger: true, disabled: !canChange, reason: locked, onClick: () => deleteItems([item.id]) },
      ],
    });
  };

  const choice = (on) => (on ? { icon: 'check' } : { iconNode: <span className="hub-menu__icon-gap" aria-hidden="true" /> });
  const openPanelMenu = (event) => {
    const r = event.currentTarget.getBoundingClientRect();
    setMenu({
      point: { x: r.left - 120, y: r.bottom + 4 },
      items: [
        ...LAYOUTS.filter((l) => !(phone && l.id === 'small')).map((l) => ({
          label: l.label, ...choice(layout === l.id), onClick: () => markLibraryStore.setView({ layout: l.id }),
        })),
        ...LIBRARY_SORTS.map((s) => ({
          label: `Sort: ${s.label}`, ...choice(state.view.sort === s.id), onClick: () => markLibraryStore.setView({ sort: s.id }),
        })),
        { label: 'Group by tag', ...choice(state.view.groupByTag), onClick: () => markLibraryStore.setView({ groupByTag: !state.view.groupByTag }) },
        { label: 'Import to library', icon: 'upload', disabled: !canAddHere, onClick: () => fileRef.current?.click() },
        { label: 'Export library', icon: 'download', disabled: items.length === 0, onClick: () => exportItems(items) },
      ],
    });
  };

  const onImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const parsed = parseLibraryImportFile(await file.text());
    if (parsed.error) { showToast(parsed.error, 'error'); return; }
    await run(
      () => markLibraryStore.addItems(parsed.items.map((it) => ({ ...it, library }))),
      (saved) => {
        if (!saved) return;
        showToast(`Imported ${saved.length} item${saved.length === 1 ? '' : 's'}${parsed.skipped ? ` (${parsed.skipped} could not be used)` : ''}`, 'success');
      },
    );
  };

  const activate = (item, event) => {
    if (event?.pointerType === 'touch' || phone) {
      if (placeLibraryItem(item, { center: true })) showToast(`Placed “${item.name}”`, 'info');
      return;
    }
    if (armedId === item.id) { disarmLibraryItem(); return; }
    armLibraryItem(item, { keep: Boolean(event?.shiftKey) });
  };

  const selectedItems = items.filter((it) => selected.has(it.id));
  const allChangeable = selectedItems.every((it) => markLibraryStore.canChange(it));
  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const status = bucket.status;
  const emptyText = (() => {
    if (status === 'loading' || status === 'idle') return 'Loading…';
    if (status === 'error') return 'Could not load the library. Check your connection.';
    if (items.length && !visible.length) return 'Nothing matches.';
    if (library === 'project') {
      return state.access.canAdd
        ? 'Nothing in the project library yet. Pick marks on a page, right-click them and choose Save to library, then pick the project.'
        : 'Your team has not saved anything here yet.';
    }
    return 'Nothing saved yet. Pick marks on a page, right-click them and choose Save to library.';
  })();

  return (
    <div className="mark-library" data-mark-library-panel="" data-testid="mark-library-panel">
      <div className="mark-library__head">
        {state.projectId ? (
          <div className="mark-library__tabs" role="tablist" aria-label="Library">
            {['personal', 'project'].map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={library === id}
                className={`mark-library__tab${library === id ? ' is-active' : ''}`}
                disabled={id === 'project' && !hasProject}
                {...(id === 'project' && !hasProject ? tip('You are not on this document\'s project team', 'below') : {})}
                onClick={() => markLibraryStore.setView({ library: id })}
              >
                {id === 'personal' ? 'Personal' : 'Project'}
              </button>
            ))}
          </div>
        ) : <span className="mark-library__title">Personal</span>}
        <span className="mark-library__head-actions">
          <SectionIconButton
            action="select"
            label={selectMode ? 'Done' : 'Select'}
            active={selectMode}
            nothingToSelect={!items.length}
            onClick={() => setSelectMode((on) => !on)}
          />
          {!selectMode && (
            <SectionIconButton icon="moreHorizontal" action="more" label="Library options" onClick={openPanelMenu} />
          )}
        </span>
      </div>
      {selectMode && (
        <div className="mark-library__select-row">
          <span className="mark-library__count">{selected.size} selected</span>
          <SelectModeButtons
            phone={phone}
            count={selected.size}
            total={visible.length}
            allSelected={visible.length > 0 && visible.every((it) => selected.has(it.id))}
            onToggleAll={() => setSelected((prev) => (visible.every((it) => prev.has(it.id)) ? new Set() : new Set(visible.map((it) => it.id))))}
            can={{
              duplicate: canAddHere ? true : 'You can\'t add to this library',
              move: !canAddOther ? 'There is no other library to move to' : (allChangeable ? true : 'Only its author or a project owner can move this'),
              copy: canAddOther ? true : 'There is no other library to copy to',
              delete: allChangeable ? true : 'Only its author or a project owner can delete this',
            }}
            onDuplicate={() => duplicate([...selected])}
            onMove={() => sendTo([...selected], true)}
            onCopy={() => sendTo([...selected], false)}
            onDelete={() => deleteItems([...selected])}
          />
        </div>
      )}
      <input
        className="mark-library__search"
        type="search"
        placeholder={library === 'project' ? `Search ${state.access.projectName || 'project'} library` : 'Search your library'}
        aria-label="Search the library"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {tags.length > 0 && (
        <div className="mark-library__tags" role="group" aria-label="Show one tag">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className={`mark-library-tag-chip${tag === t ? ' is-active' : ''}`}
              aria-pressed={tag === t}
              onClick={() => setTag((cur) => (cur === t ? null : t))}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="mark-library__body">
        {visible.length === 0 ? <p className="mark-library__empty">{emptyText}</p> : groups.map((group) => (
          <section key={group.tag ?? '__all__'} className="mark-library__group">
            {group.tag !== undefined && <h3 className="mark-library__group-title">{group.tag ?? 'No tag'}</h3>}
            <div className={`mark-library__grid mark-library__grid--${layout}`}>
              {group.items.map((item) => (
                <LibraryTile
                  key={`${group.tag ?? ''}:${item.id}`}
                  item={item}
                  layout={layout}
                  armed={armedId === item.id}
                  selectMode={selectMode}
                  selected={selected.has(item.id)}
                  canChange={markLibraryStore.canChange(item)}
                  onActivate={activate}
                  onToggleSelect={toggleSelect}
                  onMenu={openItemMenu}
                  onDelete={deleteItems}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {selectMode && selected.size > 0 && (
        <div className="mark-library__footer">
          <button type="button" className="hub-btn" disabled={!allChangeable} onClick={() => editTags(selectedItems)}>Tags</button>
          <button type="button" className="hub-btn" onClick={() => exportItems(selectedItems)}>Export</button>
        </div>
      )}
      <div className="mark-library__hint">
        {armedId
          ? 'Click the page to place it. Esc lets go.'
          : (phone ? 'Tap an item to put it in the middle of the page.' : 'Click an item, then click the page. Or drag it onto the page.')}
        {' '}
        <button type="button" className="mark-library__link" aria-expanded={showTokens} onClick={() => setShowTokens((on) => !on)}>
          Text tokens
        </button>
        {showTokens && (
          <ul className="mark-library__tokens">
            {LIBRARY_TOKENS.map((t) => <li key={t.token}><code>{`{{${t.token}}}`}</code> {t.label}</li>)}
            <li><code>{'{{ date | formatDate: "DD MMM YYYY" }}'}</code> Date your way</li>
          </ul>
        )}
      </div>
      <input ref={fileRef} type="file" accept={`${LIBRARY_EXPORT_EXTENSION},application/json`} hidden onChange={onImportFile} />
      {menu && <ListItemContextMenu point={menu.point} items={menu.items} onClose={() => setMenu(null)} />}
      {promptDialog}
    </div>
  );
}
