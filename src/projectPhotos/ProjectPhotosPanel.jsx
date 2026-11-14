/* Projects: the Photos tab of one project (flag `project-photos`, Drawboard
   Projects parity AE-32..39), plus the photo strip an Issue or Task shows
   (IS-15..17: attach from the gallery, upload, paste).

   Like Drawboard: "Add photo", Day / Week / Month groups, a Filter card
   (Uploaded by me, Linked, Not linked, Uploaded by, Uploaded within), a tick
   on every photo and every group, bulk download, a viewer ("Photo 2 of 9",
   uploader, date, links, download, delete) and "Edit image" (markup).
   Survey's way where it reads better: delete acts at once with a 5 s Undo
   instead of a confirm, photos can be dropped or pasted onto the page, and a
   marked photo can go back to its original. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTooltip } from '../components/Tooltip';
import { Icon, EmptyState } from '../home/HubShell';
import DialogCard from '../components/DialogCard.jsx';
import DismissBarrier from '../components/DismissBarrier';
import MenuRows from '../components/MenuRows.jsx';
import ValueSelect from '../components/ValueSelect.jsx';
import { checkboxProps } from '../utils/keyActivate';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { dismissToast, showToast } from '../utils/toast';
import { saveFile } from '../tools/browser.js';
import { itemCode } from '../projectItems/projectItems.js';
import { useProjectItems } from '../projectItems/projectItemsData.js';
import PhotoMarkupEditor from './PhotoMarkupEditor.jsx';
import {
  EMPTY_FILTER, GROUPINGS, WITHIN_OPTIONS, filterIsEmpty, filterPhotos, groupPhotos, photoFileName, shownPath, uploadedOn,
} from './projectPhotos.js';
import { downloadPhotoBlob, useProjectPhotos } from './projectPhotosData.js';
import './projectPhotos.css';

const canEditRole = (role) => role === 'owner' || role === 'editor';

/** Images from a paste or a drop. */
export function imageFilesFrom(dataTransfer) {
  const out = [];
  for (const f of Array.from(dataTransfer?.files || [])) if (String(f.type).startsWith('image/')) out.push(f);
  if (!out.length) {
    for (const it of Array.from(dataTransfer?.items || [])) {
      if (it.kind === 'file' && String(it.type).startsWith('image/')) { const f = it.getAsFile(); if (f) out.push(f); }
    }
  }
  return out;
}

async function downloadPhotos(list, projectName) {
  if (!list.length) return;
  if (list.length === 1) {
    const res = await downloadPhotoBlob(shownPath(list[0]));
    if (res.error) { showToast('Survey could not download that photo.', 'error'); return; }
    saveFile(res.blob, photoFileName(projectName, list[0]), res.blob.type || 'image/jpeg');
    return;
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  let n = 0;
  for (const [i, p] of list.entries()) {
    const res = await downloadPhotoBlob(shownPath(p));
    if (res.error) continue;
    zip.file(photoFileName(projectName, p, i), res.blob);
    n += 1;
  }
  if (!n) { showToast('Survey could not download those photos.', 'error'); return; }
  const blob = await zip.generateAsync({ type: 'blob' });
  const safe = String(projectName || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Project';
  saveFile(blob, `${safe} photos.zip`, 'application/zip');
  if (n < list.length) showToast(`${list.length - n} photo${list.length - n === 1 ? '' : 's'} could not be downloaded.`, 'error');
}

function Switch({ on, onChange, label, testId }) {
  return (
    <label className="photo-filter-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} data-photo-filter={testId} className={`photo-switch${on ? ' is-on' : ''}`} onClick={() => onChange(!on)}>
        <span />
      </button>
    </label>
  );
}

function FilterCard({ anchorRect, filter, setFilter, uploaders, onClose }) {
  const ref = useRef(null);
  if (!anchorRect) return null;
  const width = 260;
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8));
  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));
  const toggleUploader = (id) => setFilter((f) => {
    const cur = new Set(f.uploaders || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    return { ...f, uploaders: [...cur] };
  });
  return createPortal(
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} menu />
      <div ref={ref} className="hub-menu photo-filter-card" data-photo-filter-card style={{ top: anchorRect.bottom + 4, left, width }}>
        <Switch label="Uploaded by me" testId="mine" on={filter.mine} onChange={(v) => set({ mine: v })} />
        <Switch label="Linked" testId="linked" on={filter.linked} onChange={(v) => set({ linked: v })} />
        <Switch label="Not linked" testId="unlinked" on={filter.unlinked} onChange={(v) => set({ unlinked: v })} />
        <div className="photo-filter-label">Uploaded by</div>
        <div className="photo-filter-people">
          {uploaders.length ? uploaders.map((u) => (
            <button key={u.id} type="button" className="item-chip" aria-pressed={(filter.uploaders || []).includes(u.id)} onClick={() => toggleUploader(u.id)}>{u.name}</button>
          )) : <span className="photo-empty-note">No one yet</span>}
        </div>
        <div className="photo-filter-label">Uploaded within</div>
        {isPhoneLayout() ? (
          <select className="photo-filter-select" aria-label="Uploaded within" data-photo-within value={filter.within} onChange={(e) => set({ within: e.target.value })}>
            {WITHIN_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        ) : (
          <span data-photo-within style={{ display: 'block' }}>
            <ValueSelect label="Uploaded within" value={filter.within} options={WITHIN_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => set({ within: v })} size="sm" />
          </span>
        )}
        {filter.within === 'range' && (
          <div className="photo-filter-range">
            <input type="date" aria-label="From" value={filter.from} onChange={(e) => set({ from: e.target.value })} />
            <input type="date" aria-label="To" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
          </div>
        )}
        <button type="button" className="photo-filter-clear" disabled={filterIsEmpty(filter)} onClick={() => setFilter({ ...EMPTY_FILTER })}>Clear filters</button>
      </div>
    </>,
    document.body,
  );
}

/* The viewer: photo (or the markup editor) on the left, facts on the right. */
function PhotoViewer({ photos, index, setIndex, urls, data, lookupMember, itemLabel, onOpenItem, canEdit, canDeletePhoto, onDelete, projectName, onClose }) {
  const tip = useTooltip();
  const photo = photos[index];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEditing(false); }, [photo?.id]);
  useEffect(() => {
    if (editing) return undefined;
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); setIndex(index - 1); }
      if (e.key === 'ArrowRight' && index < photos.length - 1) { e.preventDefault(); setIndex(index + 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, index, photos.length, setIndex]);
  if (!photo) return null;
  const src = urls.get(shownPath(photo));
  const links = data.links.filter((l) => l.photo_id === photo.id);
  const name = (id) => lookupMember?.(id)?.name || 'Someone';

  const saveMarkup = async (blob) => {
    setBusy(true);
    const res = await data.saveMarkup(photo.id, blob);
    setBusy(false);
    if (res.error) { showToast(`Survey could not save the markup. ${res.error}`, 'error'); return; }
    setEditing(false);
    showToast('Markup saved', 'success');
  };
  const backToOriginal = async () => {
    const res = await data.clearMarkup(photo.id);
    if (res.error) showToast(`Survey could not change that. ${res.error}`, 'error');
  };

  return (
    <DialogCard title={`Photo ${index + 1} of ${photos.length}`} onClose={onClose} width={Math.min(980, window.innerWidth - 24)} atRoot>
      <div className={`photo-viewer${isPhoneLayout() ? ' is-phone' : ''}`} data-photo-viewer={photo.id}>
        <div className="photo-viewer-main">
          {editing && src ? (
            <PhotoMarkupEditor src={src} busy={busy} onSave={saveMarkup} onCancel={() => setEditing(false)} />
          ) : (
            <>
              <div className="photo-viewer-stage">
                {index > 0 && (
                  <button type="button" className="hub-icon-btn photo-viewer-nav is-prev" aria-label="Previous photo" onClick={() => setIndex(index - 1)} {...tip('Previous photo')}><Icon name="chevronLeft" size={16} /></button>
                )}
                {src ? <img src={src} alt="" data-photo-full /> : <div className="photo-empty-note">Loading…</div>}
                {index < photos.length - 1 && (
                  <button type="button" className="hub-icon-btn photo-viewer-nav is-next" aria-label="Next photo" onClick={() => setIndex(index + 1)} {...tip('Next photo')}><Icon name="chevronRight" size={16} /></button>
                )}
              </div>
              {canEdit && (
                <div className="photo-viewer-edit">
                  <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-photo-edit disabled={!src} onClick={() => setEditing(true)}>Edit image</button>
                  {photo.marked_path && <button type="button" className="hub-btn dialog-touch-pad" data-photo-original onClick={backToOriginal}>Back to original</button>}
                </div>
              )}
            </>
          )}
        </div>
        <aside className="photo-viewer-info">
          <dl>
            <dt>Uploaded by</dt><dd>{name(photo.uploaded_by)}</dd>
            <dt>Uploaded on</dt><dd>{uploadedOn(photo.created_at)}</dd>
            {photo.marked_at && (<><dt>Marked up</dt><dd>{name(photo.marked_by)}, {uploadedOn(photo.marked_at)}</dd></>)}
            <dt>Links</dt>
            <dd data-photo-links>
              {links.length ? links.map((l) => (
                <button key={l.item_id} type="button" className="photo-link-chip" onClick={() => onOpenItem?.(l.item_id)}>{itemLabel(l.item_id)}</button>
              )) : <em>No links</em>}
            </dd>
          </dl>
          <div className="photo-viewer-actions">
            <button type="button" className="hub-btn dialog-touch-pad" data-photo-download onClick={() => downloadPhotos([photo], projectName)}><Icon name="download" size={12} />Download</button>
            {canDeletePhoto(photo) && (
              <button type="button" className="hub-btn is-danger dialog-touch-pad" data-photo-delete onClick={() => onDelete([photo.id])}><Icon name="trash" size={12} />Delete</button>
            )}
          </div>
        </aside>
      </div>
    </DialogCard>
  );
}

export default function ProjectPhotosPanel({ project, user, role, lookupMember, itemsOn = false, onOpenItem, phone = false }) {
  const tip = useTooltip();
  const data = useProjectPhotos({ projectId: project?.id });
  // Link names ("ISS-3 Duct clash") come from the Issues and Tasks lists.
  const { items } = useProjectItems({ projectId: project?.id, enabled: itemsOn });
  const canEdit = canEditRole(role);
  const userId = user?.id;
  const [grouping, setGrouping] = useState(() => {
    try { return window.localStorage.getItem('survey.photoGrouping') || 'day'; } catch (_e) { return 'day'; }
  });
  const pickGrouping = (g) => { setGrouping(g); try { window.localStorage.setItem('survey.photoGrouping', g); } catch (_e) { /* private mode */ } };
  const [filter, setFilter] = useState({ ...EMPTY_FILTER });
  const [filterRect, setFilterRect] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [hidden, setHidden] = useState(() => new Set());
  const [viewIndex, setViewIndex] = useState(-1);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const rootRef = useRef(null);

  const linkCounts = useMemo(() => {
    const m = new Map();
    for (const l of data.links) m.set(l.photo_id, (m.get(l.photo_id) || 0) + 1);
    return m;
  }, [data.links]);
  const uploaders = useMemo(() => {
    const ids = [...new Set(data.photos.map((p) => p.uploaded_by).filter(Boolean))];
    return ids.map((id) => ({ id, name: lookupMember?.(id)?.name || (id === userId ? 'You' : 'Someone') }));
  }, [data.photos, lookupMember, userId]);
  const shown = useMemo(
    () => filterPhotos(data.photos, filter, { userId, linkCounts }).filter((p) => !hidden.has(p.id)),
    [data.photos, filter, hidden, linkCounts, userId],
  );
  const groups = useMemo(() => groupPhotos(shown, grouping), [shown, grouping]);
  const ordered = useMemo(() => groups.flatMap((g) => g.photos), [groups]);
  const itemLabel = useCallback((id) => {
    const it = items.find((i) => i.id === id);
    return it ? `${itemCode(it.kind, it.number)}${it.title ? ` ${it.title}` : ''}` : 'Item';
  }, [items]);
  const canDeletePhoto = useCallback((p) => role === 'owner' || (canEdit && p.uploaded_by === userId), [canEdit, role, userId]);

  const addFiles = useCallback(async (files) => {
    if (!canEdit) { showToast('Only editors can add photos.', 'info'); return; }
    const list = Array.from(files || []).slice(0, 50);
    if (!list.length) return;
    setUploading((n) => n + list.length);
    let ok = 0;
    for (const f of list) {
      const res = await data.add(f);
      setUploading((n) => n - 1);
      if (res.error) showToast(`Survey could not add a photo. ${res.error}`, 'error');
      else ok += 1;
    }
    if (ok) showToast(ok === 1 ? 'Photo added' : `${ok} photos added`, 'success');
  }, [canEdit, data]);

  // Paste a picture anywhere on the tab (Survey extra).
  useEffect(() => {
    const onPaste = (e) => {
      if (viewIndex >= 0 || e.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (!rootRef.current?.isConnected) return;
      const files = imageFilesFrom(e.clipboardData);
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles, viewIndex]);

  // Delete: hide at once, send after 5 s unless Undo (Survey rule).
  const deletePhotos = (ids) => {
    setViewIndex(-1);
    setSel(new Set());
    let undone = false;
    setHidden((cur) => new Set([...cur, ...ids]));
    const unhide = () => setHidden((cur) => { const n = new Set(cur); ids.forEach((id) => n.delete(id)); return n; });
    const toastId = showToast(ids.length === 1 ? 'Photo deleted' : `${ids.length} photos deleted`, 'info', {
      action: { label: 'Undo', onClick: () => { undone = true; unhide(); } },
      duration: 5000,
    });
    setTimeout(async () => {
      dismissToast(toastId);
      if (undone) return;
      const res = await data.remove(ids);
      unhide();
      if (res.error) showToast(res.error, 'error');
    }, 5000);
  };

  const toggleSel = (id) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (g) => setSel((cur) => {
    const n = new Set(cur);
    const all = g.photos.every((p) => n.has(p.id));
    g.photos.forEach((p) => (all ? n.delete(p.id) : n.add(p.id)));
    return n;
  });
  const selPhotos = ordered.filter((p) => sel.has(p.id));
  const empty = !data.loading && !data.photos.length;

  return (
    <div
      ref={rootRef}
      className={`project-photos${phone ? ' is-phone' : ''}${dragOver ? ' is-drop' : ''}`}
      data-project-photos={project?.id}
      onDragOver={(e) => { if (canEdit && Array.from(e.dataTransfer?.types || []).includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={(e) => { setDragOver(false); const files = imageFilesFrom(e.dataTransfer); if (files.length) { e.preventDefault(); addFiles(files); } }}
    >
      <div className="project-photos__bar">
        <div className="photo-grouping" role="radiogroup" aria-label="Group photos by">
          {GROUPINGS.map((g) => (
            <button key={g.key} type="button" role="radio" aria-checked={grouping === g.key} data-photo-grouping={g.key} className={grouping === g.key ? 'is-on' : ''} onClick={() => pickGrouping(g.key)}>{g.label}</button>
          ))}
        </div>
        <button
          type="button"
          className={`item-chip${filterIsEmpty(filter) ? '' : ' is-active'}`}
          aria-pressed={!filterIsEmpty(filter)}
          data-photo-filter-open
          onClick={(e) => setFilterRect(filterRect ? null : e.currentTarget.getBoundingClientRect())}
        >
          <Icon name="filter" size={12} />&nbsp;Filter
        </button>
        <span className="photo-count">{shown.length} of {data.photos.length - hidden.size}</span>
        <span style={{ flex: 1 }} />
        {uploading > 0 && <span className="photo-count" data-photo-uploading>Adding {uploading}…</span>}
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden data-photo-input onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="hub-btn hub-btn--primary" data-photo-add onClick={() => fileRef.current?.click()}><Icon name="plus" size={12} />Add photo</button>
          </>
        )}
      </div>
      {selPhotos.length > 0 && (
        <div className="project-photos__bulk" data-photo-bulk>
          <span>{selPhotos.length} selected</span>
          <button type="button" className="hub-btn" onClick={() => downloadPhotos(selPhotos, project?.name)}><Icon name="download" size={12} />Download</button>
          {selPhotos.every(canDeletePhoto) && <button type="button" className="hub-btn is-danger" onClick={() => deletePhotos(selPhotos.map((p) => p.id))}><Icon name="trash" size={12} />Delete</button>}
          <button type="button" className="hub-btn" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="project-photos__body slim-scroll">
        {data.loading ? <div className="photo-empty-note">Loading photos…</div> : empty ? (
          <EmptyState
            icon="image"
            line="No photos yet"
            description="Add site photos here, then link them to issues and tasks. You can also drop or paste pictures."
            actionLabel={canEdit ? 'Add photo' : undefined}
            onAction={canEdit ? () => fileRef.current?.click() : undefined}
          />
        ) : !shown.length ? <div className="photo-empty-note">No photos match these filters.</div> : groups.map((g) => {
          const allOn = g.photos.every((p) => sel.has(p.id));
          return (
            <section key={g.key} className="photo-group" data-photo-group={g.key}>
              <header>
                <span {...checkboxProps(allOn, () => toggleGroup(g), `Select ${g.label}`)} onClick={() => toggleGroup(g)} className={`photo-check${allOn ? ' is-on' : ''}`}>{allOn && <Icon name="check" size={10} />}</span>
                <h3>{g.label}</h3>
                <span className="photo-count">{g.photos.length}</span>
              </header>
              <div className="photo-grid">
                {g.photos.map((p) => {
                  const on = sel.has(p.id);
                  const idx = ordered.indexOf(p);
                  const url = data.urls.get(shownPath(p));
                  return (
                    <div key={p.id} className={`photo-tile${on ? ' is-selected' : ''}`} data-photo-tile={p.id}>
                      <button type="button" className="photo-tile-open" aria-label={`Open photo from ${uploadedOn(p.created_at)}`} onClick={() => setViewIndex(idx)}>
                        {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="photo-tile-wait" />}
                      </button>
                      <span {...checkboxProps(on, () => toggleSel(p.id), 'Select photo')} onClick={() => toggleSel(p.id)} className={`photo-check photo-tile-check${on ? ' is-on' : ''}`}>{on && <Icon name="check" size={10} />}</span>
                      <button type="button" className="photo-tile-download" aria-label="Download photo" onClick={() => downloadPhotos([p], project?.name)} {...tip('Download')}><Icon name="download" size={12} /></button>
                      {(linkCounts.get(p.id) || 0) > 0 && <span className="photo-tile-links" aria-label={`${linkCounts.get(p.id)} links`}><Icon name="paperclip" size={10} />{linkCounts.get(p.id)}</span>}
                      {p.marked_path && <span className="photo-tile-marked" aria-label="Marked up"><Icon name="pen" size={10} /></span>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {filterRect && <FilterCard anchorRect={filterRect} filter={filter} setFilter={setFilter} uploaders={uploaders} onClose={() => setFilterRect(null)} />}
      {viewIndex >= 0 && ordered[viewIndex] && (
        <PhotoViewer
          photos={ordered}
          index={viewIndex}
          setIndex={setViewIndex}
          urls={data.urls}
          data={data}
          lookupMember={lookupMember}
          itemLabel={itemLabel}
          onOpenItem={(id) => { const it = items.find((i) => i.id === id); if (!it) return; setViewIndex(-1); onOpenItem?.(it); }}
          canEdit={canEdit}
          canDeletePhoto={canDeletePhoto}
          onDelete={deletePhotos}
          projectName={project?.name}
          onClose={() => setViewIndex(-1)}
        />
      )}
    </div>
  );
}

/* The gallery picker an item opens with "Browse gallery". */
function GalleryPicker({ photos, urls, already, onPick, onClose }) {
  const [sel, setSel] = useState(() => new Set());
  const list = photos.filter((p) => !already.has(p.id));
  return (
    <DialogCard
      title="Add from project photos"
      onClose={onClose}
      width={Math.min(640, window.innerWidth - 24)}
      atRoot
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-photo-gallery-add disabled={!sel.size} onClick={() => onPick([...sel])}>Add {sel.size || ''}</button>
        </>
      )}
    >
      {list.length ? (
        <div className="photo-grid photo-grid--picker" data-photo-gallery>
          {list.map((p) => {
            const on = sel.has(p.id);
            const url = urls.get(shownPath(p));
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                data-photo-gallery-tile={p.id}
                className={`photo-tile photo-tile--pick${on ? ' is-selected' : ''}`}
                onClick={() => setSel((cur) => { const n = new Set(cur); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
              >
                {url ? <img src={url} alt="" loading="lazy" /> : <span className="photo-tile-wait" />}
                <span className={`photo-check photo-tile-check${on ? ' is-on' : ''}`} aria-hidden>{on && <Icon name="check" size={10} />}</span>
              </button>
            );
          })}
        </div>
      ) : <div className="photo-empty-note">Every project photo is already on this item.</div>}
    </DialogCard>
  );
}

/* An item's Photos section (Drawboard's ATTACHMENTS): thumbnails, + to
   upload or browse the gallery, paste a picture while the item is open. */
export function ItemPhotos({ project, item, canEdit, lookupMember }) {
  const tip = useTooltip();
  const data = useProjectPhotos({ projectId: project?.id });
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);
  const [picker, setPicker] = useState(false);
  const [viewIndex, setViewIndex] = useState(-1);
  const fileRef = useRef(null);
  const rootRef = useRef(null);
  const linked = useMemo(() => {
    const ids = new Set(data.links.filter((l) => l.item_id === item.id).map((l) => l.photo_id));
    return data.photos.filter((p) => ids.has(p.id));
  }, [data.links, data.photos, item.id]);
  const linkedIds = useMemo(() => new Set(linked.map((p) => p.id)), [linked]);

  const upload = useCallback(async (files) => {
    for (const f of Array.from(files || []).slice(0, 20)) {
      const res = await data.add(f, { itemId: item.id });
      if (res.error) showToast(`Survey could not add a photo. ${res.error}`, 'error');
    }
  }, [data, item.id]);

  useEffect(() => {
    if (!canEdit) return undefined;
    const onPaste = (e) => {
      if (!rootRef.current?.isConnected || e.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const files = imageFilesFrom(e.clipboardData);
      if (files.length) { e.preventDefault(); upload(files); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [canEdit, upload]);

  if (!data.live) return null;
  return (
    <div ref={rootRef} className="item-photos" data-item-photos={item.id}>
      <div className="item-photos-head">Photos ({linked.length})</div>
      <div className="item-photos-strip">
        {linked.map((p, i) => {
          const url = data.urls.get(shownPath(p));
          return (
            <div key={p.id} className="item-photo" data-item-photo={p.id}>
              <button type="button" className="photo-tile-open" aria-label="Open photo" onClick={() => setViewIndex(i)}>
                {url ? <img src={url} alt="" loading="lazy" /> : <span className="photo-tile-wait" />}
              </button>
              {canEdit && (
                <button type="button" className="item-photo-remove" aria-label="Remove photo from this item" onClick={() => data.unlink(p.id, item.id)} {...tip('Remove from item')}><Icon name="close" size={9} /></button>
              )}
            </div>
          );
        })}
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden data-item-photo-input onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            <button
              type="button"
              className="item-photo-add"
              aria-label="Add photo"
              data-item-photo-add
              onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
              {...tip('Add photo')}
            >
              <Icon name="plus" size={14} />
            </button>
          </>
        )}
      </div>
      {menu && createPortal(
        <>
          <DismissBarrier insideRefs={[menuRef]} onDismiss={() => setMenu(null)} menu />
          <div ref={menuRef} role="menu" className="hub-menu" data-item-photo-menu style={{ top: menu.bottom + 4, left: Math.max(8, Math.min(menu.left, window.innerWidth - 200)), minWidth: 180 }}>
            <MenuRows
              tip={tip}
              onClose={() => setMenu(null)}
              items={[
                { label: 'Upload photo', icon: 'upload', onClick: () => fileRef.current?.click() },
                { label: 'Browse project photos', icon: 'image', onClick: () => setPicker(true) },
              ]}
            />
          </div>
        </>,
        document.body,
      )}
      {picker && (
        <GalleryPicker
          photos={data.photos}
          urls={data.urls}
          already={linkedIds}
          onClose={() => setPicker(false)}
          onPick={async (ids) => {
            setPicker(false);
            const res = await data.link(ids, item.id);
            if (res.error) showToast(`Survey could not add those photos. ${res.error}`, 'error');
          }}
        />
      )}
      {viewIndex >= 0 && linked[viewIndex] && (
        <PhotoViewer
          photos={linked}
          index={viewIndex}
          setIndex={setViewIndex}
          urls={data.urls}
          data={data}
          lookupMember={lookupMember}
          itemLabel={() => itemCode(item.kind, item.number)}
          canEdit={canEdit}
          canDeletePhoto={() => false}
          onDelete={() => {}}
          projectName={project?.name}
          onClose={() => setViewIndex(-1)}
        />
      )}
    </div>
  );
}
