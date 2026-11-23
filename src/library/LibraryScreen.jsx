/* Library tab (KAL-585, Nightly flag 'suite'): "My library", plus "Company
   library" once the person is in a company.

   A library holds Categories (Camera) and their optional Category Types
   (PTZ, Fisheye). Every Survey template Category saves itself here when
   templates are saved; this screen also adds the ones not saved yet, adds
   entries by hand, and renames or removes them (your own library: you; the
   Company library: owners and admins). Changes made offline wait on this
   device and sync one at a time. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { HubShell, Icon } from '../home/HubShell';
import SectionIconButton from '../components/SectionIconButton.jsx';
import ListItemContextMenu from '../components/ListItemContextMenu.jsx';
import { countLabel } from '../home/countLabel.js';
import './library.css';
import { useTooltip } from '../components/Tooltip';
import { DIALOG_FIELD_STYLE } from '../components/DialogCard.jsx';
import { useConfirmDialog, usePromptDialog } from '../components/dialogPrompts.jsx';
import { showToast } from '../utils/toast';
import {
  LIBRARY_KIND,
  LIBRARY_SCOPE,
  LIBRARY_WORDS,
  unlinkedCategorySummary,
  unlinkedNoteFor,
  libraryOutline,
  manageRefusal,
} from './libraryModel.js';
import { suiteLibraryStore } from './suiteLibrary.js';
import { useTemplatesNeedPro } from '../home/useTemplatesNeedPro.js';
import { TEMPLATE_PLAN_MESSAGE, isTemplatePlanError } from '../home/templatePersistence.js';

const EMPTY_STATE = { entries: [], outbox: [], company: null, status: 'idle', error: '' };

function useLibraryState(store) {
  return useSyncExternalStore(
    (fn) => (store ? store.subscribe(fn) : () => {}),
    () => (store ? store.getState() : EMPTY_STATE),
  );
}

function statusLine(state) {
  const waiting = state.outbox.length;
  if (state.status === 'not-on-server') return `Saved on this device. The library is not on the server yet${waiting ? ` (${waiting} waiting)` : ''}.`;
  if (state.status === 'offline') return `No connection. ${waiting} change${waiting === 1 ? '' : 's'} will sync when you are back online.`;
  if (state.status === 'syncing') return 'Syncing…';
  return 'Synced';
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
  borderBottom: '1px solid var(--ink-500)', minHeight: 40,
};

// The menu opens under its More button, right edges lined up, as the
// Templates rows' menus do.
const MENU_WIDTH = 180;
const menuPointFor = (button) => {
  const r = button.getBoundingClientRect();
  return { x: r.right - MENU_WIDTH, y: r.bottom + 4 };
};

export default function LibraryScreen({ user, onNav, templatesLocked = false, templates = [], onSaveTemplates }) {
  const tip = useTooltip();
  const userId = user?.id || null;
  const store = useMemo(() => suiteLibraryStore(userId), [userId]);
  const state = useLibraryState(store);
  const [askPrompt, promptDialog] = usePromptDialog();
  const [askConfirm, confirmDialog] = useConfirmDialog();
  const [view, setView] = useState(LIBRARY_SCOPE.MINE);
  const [newName, setNewName] = useState('');
  const [linking, setLinking] = useState(false);
  // { entry, point }: the row whose More menu (or right-click menu) is open.
  const [menu, setMenu] = useState(null);
  const addFieldRef = useRef(null);
  const templatesNeedPro = useTemplatesNeedPro();

  useEffect(() => { if (store) void store.ready().then(() => store.refresh()); }, [store]);
  useEffect(() => { if (state.error) showToast(state.error, 'warn'); }, [state.error]);

  const company = state.company;
  // Company library shows only after joining a company.
  const scope = company?.id ? view : LIBRARY_SCOPE.MINE;
  const library = scope === LIBRARY_SCOPE.COMPANY
    ? { scope, companyId: company.id }
    : { scope, userId };
  const outline = libraryOutline(state.entries, library);
  const unlinkedSummary = unlinkedCategorySummary(templates, { entries: state.entries, userId, company });
  const unlinked = unlinkedSummary.total;
  const unlinkedNote = unlinkedNoteFor(unlinkedSummary);
  const who = { userId, company };

  const report = (result) => {
    if (result && !result.ok && result.reason) showToast(result.reason, 'warn');
    return result?.ok;
  };

  const addCategory = () => {
    if (!store) return;
    if (report(store.add({ kind: LIBRARY_KIND.CATEGORY, name: newName, scope }))) setNewName('');
  };

  const addType = async (category) => {
    const name = await askPrompt({
      title: `New Category Type under “${category.name}”`,
      label: 'Category Type',
      placeholder: 'PTZ',
      confirmLabel: 'Add',
    });
    if (name == null) return;
    report(store.add({ kind: LIBRARY_KIND.CATEGORY_TYPE, name, parentId: category.id, scope }));
  };

  const rename = async (entry) => {
    const name = await askPrompt({
      title: `Rename “${entry.name}”`,
      label: entry.kind === LIBRARY_KIND.CATEGORY ? 'Category' : 'Category Type',
      defaultValue: entry.name,
      confirmLabel: 'Rename',
    });
    if (name == null) return;
    report(store.rename(entry.id, name));
  };

  const remove = async (entry) => {
    const ok = await askConfirm({
      title: `Remove “${entry.name}”?`,
      message: 'Templates linked to it keep their Categories and checklists. Only the library entry goes.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) report(store.remove(entry.id));
  };

  const linkTemplates = async () => {
    if (!store || !onSaveTemplates || linking) return;
    // Linking saves the templates, which Free can't (KAL-755): say so before
    // any library entry is made.
    if (templatesNeedPro()) return;
    setLinking(true);
    try {
      const { templates: linked, linked: count, created } = store.linkTemplates(templates);
      if (count > 0) await onSaveTemplates(linked);
      // `count` also counts Category Types, so the words don't give a number.
      showToast(created.length > 0 ? 'Added to the library and linked.' : 'Linked to the library.', 'success');
    } catch (err) {
      showToast(isTemplatePlanError(err) ? TEMPLATE_PLAN_MESSAGE : 'Could not save the templates. Try again.', 'error');
    } finally {
      setLinking(false);
    }
  };

  // Rename and Remove for this person, or the reason they can't (a Company
  // entry for a member who is not an owner or admin).
  const menuItems = (entry) => {
    const refusal = manageRefusal(entry, who);
    return [
      entry.kind === LIBRARY_KIND.CATEGORY
        ? { label: 'Add Category Type', icon: 'plus', onClick: () => addType(entry) }
        : null,
      { label: 'Rename', reason: refusal || undefined, onClick: () => rename(entry) },
      { label: 'Remove', danger: true, reason: refusal || undefined, onClick: () => remove(entry) },
    ].filter(Boolean);
  };

  const openMenu = (entry, point) => setMenu((open) => (open?.entry.id === entry.id && !point.fromContext ? null : { entry, point }));

  const entryRow = (entry, { type = false, count = null } = {}) => (
    <div
      className={`library-row${type ? ' is-type' : ''}${menu?.entry.id === entry.id ? ' is-menu-open' : ''}`}
      onContextMenu={(event) => { event.preventDefault(); openMenu(entry, { x: event.clientX, y: event.clientY, fromContext: true }); }}
    >
      <span className="library-row__name">{entry.name}</span>
      {count != null ? <span className="library-row__count">{count}</span> : null}
      <button
        type="button"
        className="hub-icon-btn library-row__more"
        aria-haspopup="menu"
        aria-expanded={menu?.entry.id === entry.id}
        aria-label="More"
        {...tip(`More for ${entry.name}`)}
        onClick={(event) => openMenu(entry, menuPointFor(event.currentTarget))}
      ><Icon name="more" size={14} /></button>
    </div>
  );

  const libraryTabs = company?.id ? (
    <div role="tablist" aria-label="Library" style={{ display: 'flex', gap: 6 }}>
      {[LIBRARY_SCOPE.MINE, LIBRARY_SCOPE.COMPANY].map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={scope === key}
          className={`btn${scope === key ? ' primary' : ''}`}
          onClick={() => setView(key)}
        >{LIBRARY_WORDS[key]}</button>
      ))}
    </div>
  ) : null;

  return (
    <HubShell
      tab="library"
      onNav={onNav}
      title={company?.id ? 'Library' : LIBRARY_WORDS.mine}
      subtitle={<span>{statusLine(state)}</span>}
      actions={libraryTabs}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <div style={{ padding: 'var(--library-body-top, 0px) 8px 8px', flex: 1, minHeight: 0, overflow: 'auto' }} className="slim-scroll library-body">
        {unlinked > 0 && onSaveTemplates ? (
          <div className="card" role="status" style={{ ...rowStyle, borderBottom: 0, marginBottom: 8 }}>
            <span style={{ flex: 1 }}>{unlinkedNote.text}</span>
            <button type="button" className="btn primary" disabled={linking} onClick={linkTemplates}>{unlinkedNote.action}</button>
          </div>
        ) : null}
        {/* Clipped, so the last row's divider stops at the rounded corner. */}
        <div className="card library-card" style={{ overflow: 'hidden' }}>
          <div className="hub-section-head library-card__head">
            <p className="micro hub-section-label" style={{ margin: 0 }}>Categories<span className="hub-section-count">{outline.length}</span></p>
            <div className="hub-section-actions">
              <SectionIconButton action="add" label="Add Category" onClick={() => addFieldRef.current?.focus()} />
            </div>
          </div>
          <form
            className="library-add"
            onSubmit={(event) => { event.preventDefault(); addCategory(); }}
          >
            <input
              ref={addFieldRef}
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New Category, for example Camera"
              aria-label={`New Category in ${LIBRARY_WORDS[scope]}`}
              maxLength={120}
              // A field, not an inline rename: it had no edge or fill and read
              // as a plain row. 28px, the height of Add beside it.
              style={{ ...DIALOG_FIELD_STYLE, flex: 1, minWidth: 0, width: 'auto', height: 28 }}
            />
            <button type="submit" className="btn primary" disabled={!newName.trim()}>Add</button>
          </form>
          {outline.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-100)' }}>
              {scope === LIBRARY_SCOPE.COMPANY
                ? 'Nothing in the Company library yet. Categories your team adds show here.'
                : 'Nothing here yet. Name a Category in a template, or add one above.'}
            </div>
          ) : (
            <ul aria-label={LIBRARY_WORDS[scope]} className="library-list">
              {outline.map((category) => (
                <li key={category.id}>
                  {entryRow(category, { count: category.types.length ? countLabel(category.types.length, 'type') : null })}
                  {category.types.length > 0 ? (
                    <ul aria-label={`${category.name} Category Types`} className="library-list">
                      {category.types.map((type) => (
                        <li key={type.id}>{entryRow(type, { type: true })}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {menu ? (
        <ListItemContextMenu point={menu.point} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />
      ) : null}
      {promptDialog}
      {confirmDialog}
    </HubShell>
  );
}
