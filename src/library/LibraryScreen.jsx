/* Library tab (KAL-585, Nightly flag 'suite'): "My library", plus "Company
   library" once the person is in a company.

   A library holds Categories (Camera) and their optional Category Types
   (PTZ, Fisheye). Every Survey template Category saves itself here when
   templates are saved; this screen also adds the ones not saved yet, adds
   entries by hand, and renames or removes them (your own library: you; the
   Company library: owners and admins). Changes made offline wait on this
   device and sync one at a time. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { HubShell } from '../home/HubShell';
import { useTooltip } from '../components/Tooltip';
import { DIALOG_FIELD_STYLE } from '../components/DialogCard.jsx';
import { useConfirmDialog, usePromptDialog } from '../components/dialogPrompts.jsx';
import { showToast } from '../utils/toast';
import {
  LIBRARY_KIND,
  LIBRARY_SCOPE,
  LIBRARY_WORDS,
  countUnlinkedCategories,
  libraryOutline,
  manageRefusal,
} from './libraryModel.js';
import { suiteLibraryStore } from './suiteLibrary.js';

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

  useEffect(() => { if (store) void store.ready().then(() => store.refresh()); }, [store]);
  useEffect(() => { if (state.error) showToast(state.error, 'warn'); }, [state.error]);

  const company = state.company;
  // Company library shows only after joining a company.
  const scope = company?.id ? view : LIBRARY_SCOPE.MINE;
  const library = scope === LIBRARY_SCOPE.COMPANY
    ? { scope, companyId: company.id }
    : { scope, userId };
  const outline = libraryOutline(state.entries, library);
  const unlinked = countUnlinkedCategories(templates);
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
    setLinking(true);
    try {
      const { templates: linked, linked: count } = store.linkTemplates(templates);
      if (count > 0) await onSaveTemplates(linked);
      showToast(count === 1 ? 'Added 1 Category to the library.' : `Added ${count} Categories to the library.`, 'success');
    } catch {
      showToast('Could not save the templates. Try again.', 'error');
    } finally {
      setLinking(false);
    }
  };

  const manageButtons = (entry) => {
    const refusal = manageRefusal(entry, who);
    const props = (label) => (refusal
      ? { 'aria-disabled': 'true', ...tip(refusal, 'left') }
      : { 'aria-label': `${label} ${entry.name}` });
    return (
      <>
        <button type="button" className="btn" {...props('Rename')} onClick={() => (refusal ? showToast(refusal, 'warn') : rename(entry))}>Rename</button>
        <button type="button" className="btn" {...props('Remove')} onClick={() => (refusal ? showToast(refusal, 'warn') : remove(entry))}>Remove</button>
      </>
    );
  };

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
      subtitle={statusLine(state)}
      actions={libraryTabs}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <div style={{ padding: '0 8px 8px', flex: 1, minHeight: 0, overflow: 'auto' }} className="slim-scroll">
        {unlinked > 0 && onSaveTemplates ? (
          <div className="card" role="status" style={{ ...rowStyle, borderBottom: 0, marginBottom: 8 }}>
            <span style={{ flex: 1 }}>
              {unlinked === 1 ? '1 Category in your templates is not in the library yet.' : `${unlinked} Categories in your templates are not in the library yet.`}
            </span>
            <button type="button" className="btn primary" disabled={linking} onClick={linkTemplates}>Add them</button>
          </div>
        ) : null}
        {/* Clipped, so the last row's divider stops at the rounded corner. */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <form
            style={{ ...rowStyle }}
            onSubmit={(event) => { event.preventDefault(); addCategory(); }}
          >
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New Category, for example Camera"
              aria-label={`New Category in ${LIBRARY_WORDS[scope]}`}
              maxLength={120}
              // A field, not an inline rename: it had no edge or fill and read
              // as a plain row. 28px, the height of Add Category beside it.
              style={{ ...DIALOG_FIELD_STYLE, flex: 1, minWidth: 0, width: 'auto', height: 28 }}
            />
            <button type="submit" className="btn primary" disabled={!newName.trim()}>Add Category</button>
          </form>
          {outline.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-100)' }}>
              {scope === LIBRARY_SCOPE.COMPANY
                ? 'Nothing in the Company library yet. Categories your team adds show here.'
                : 'Nothing here yet. Name a Category in a template, or add one above.'}
            </div>
          ) : (
            <ul aria-label={LIBRARY_WORDS[scope]} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {outline.map((category) => (
                <li key={category.id}>
                  <div style={rowStyle}>
                    <span style={{ flex: 1, fontWeight: 600 }}>{category.name}</span>
                    <button type="button" className="btn" aria-label={`Add a Category Type under ${category.name}`} onClick={() => addType(category)}>Add type</button>
                    {manageButtons(category)}
                  </div>
                  {category.types.length > 0 ? (
                    <ul aria-label={`${category.name} Category Types`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {category.types.map((type) => (
                        <li key={type.id} style={{ ...rowStyle, paddingLeft: 34 }}>
                          <span style={{ flex: 1 }}>{type.name}</span>
                          {manageButtons(type)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {promptDialog}
      {confirmDialog}
    </HubShell>
  );
}
