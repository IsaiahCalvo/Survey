// Library (Kal Voe suite, KAL-585; Nightly flag 'suite'): the person's
// Categories and Category Types, shared with Walkthru and Plot. "My library"
// always; "Company library" once they are in a company. Anyone may add; only
// the owner of a My library entry or a company owner / admin may rename or
// remove one. Works offline: changes show at once and send when online.
import { useMemo, useState } from 'react';
import { HubShell, Icon } from '../home/HubShell';
import { useTooltip } from '../components/Tooltip';
import { usePromptDialog } from '../components/dialogPrompts.jsx';
import { showToast } from '../utils/toast.js';
import { supabase } from '../supabaseClient.js';
import { canAddToLibrary, canManageEntry, libraryTabs, libraryTree } from './libraryModel.js';
import { libraryStoreFor, useSuiteLibrary } from './libraryStore.js';
import './suiteLibrary.css';

const MANAGE_REASON = 'Only a company owner or admin can rename or remove this.';

function EntryActions({ entry, ctx, store, ask, tip }) {
  const allowed = canManageEntry(entry, ctx);
  const noun = entry.kind === 'category' ? 'Category' : 'Category Type';
  const rename = async () => {
    const name = await ask({ title: `Rename ${noun}`, label: 'Name', defaultValue: entry.name, confirmLabel: 'Rename' });
    if (name && name.trim() && name.trim() !== entry.name) store.rename(entry.id, name);
  };
  const remove = async () => {
    store.remove(entry.id);
    showToast(`Removed ${entry.name}. Templates that use it keep their checklists.`, 'info');
  };
  return (
    <span className="suite-library__actions">
      <button type="button" className="hub-icon-btn" aria-label={`Rename ${entry.name}`} disabled={!allowed} onClick={rename} {...tip(allowed ? 'Rename' : MANAGE_REASON, 'below')}>
        <Icon name="edit" size={13} />
      </button>
      <button type="button" className="hub-icon-btn" aria-label={`Remove ${entry.name}`} disabled={!allowed} onClick={remove} {...tip(allowed ? 'Remove' : MANAGE_REASON, 'below')}>
        <Icon name="trash" size={13} />
      </button>
    </span>
  );
}

function AddRow({ placeholder, label, onAdd }) {
  const [text, setText] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const name = text.trim();
    if (!name) return;
    try { onAdd(name); setText(''); } catch (err) { showToast(err.message, 'error'); }
  };
  return (
    <form className="suite-library__add" onSubmit={submit}>
      <input type="text" value={text} maxLength={120} placeholder={placeholder} aria-label={label} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="hub-btn" disabled={!text.trim()}>Add</button>
    </form>
  );
}

export default function SuiteLibraryPage({ user, ...common }) {
  const tip = useTooltip();
  const [ask, dialog] = usePromptDialog();
  const store = useMemo(() => libraryStoreFor(supabase, user?.id), [user?.id]);
  const state = useSuiteLibrary(store);
  const [tab, setTab] = useState('mine');
  const company = state?.company || null;
  const tabs = libraryTabs(company);
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'mine';
  const ctx = { userId: user?.id || null, company };
  const tree = libraryTree(state?.entries || [], activeTab, ctx);
  const canAdd = canAddToLibrary(activeTab, ctx);
  const pending = state?.outbox?.length || 0;

  return (
    <HubShell {...common} tab="library" title="Library" userName={user?.name || user?.email?.split('@')[0] || 'You'}>
      <div className="suite-library" data-suite-library="true">
        <div className="suite-library__tabs" role="tablist" aria-label="Library">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`suite-library__tab${activeTab === t.id ? ' is-active' : ''}`}
              data-library-tab={t.id}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
        <p className="suite-library__lead">
          Categories and Category Types here are shared with Walkthru and Plot. Your Survey templates link to them when you save.
          {pending ? ` ${pending} ${pending === 1 ? 'change waits' : 'changes wait'} to send.` : ''}
        </p>
        {state?.error ? <div className="suite-library__error" role="status">{state.error}</div> : null}
        {canAdd ? (
          <AddRow placeholder="New Category, such as Camera" label="New Category" onAdd={(name) => store.add({ kind: 'category', name, scope: activeTab })} />
        ) : null}
        {!tree.length ? (
          <div className="suite-library__empty">{state?.loaded ? 'No Categories yet.' : 'Loading…'}</div>
        ) : (
          <ul className="suite-library__list">
            {tree.map((category) => (
              <li key={category.id} className="suite-library__category" data-library-entry={category.id}>
                <div className="suite-library__row">
                  <Icon name="folder" size={14} />
                  <span className="suite-library__name">{category.name}</span>
                  <EntryActions entry={category} ctx={ctx} store={store} ask={ask} tip={tip} />
                </div>
                <ul className="suite-library__types">
                  {category.types.map((type) => (
                    <li key={type.id} className="suite-library__row suite-library__row--type" data-library-entry={type.id}>
                      <span className="suite-library__name">{type.name}</span>
                      <EntryActions entry={type} ctx={ctx} store={store} ask={ask} tip={tip} />
                    </li>
                  ))}
                  {canAdd ? (
                    <li>
                      <AddRow placeholder="New Category Type, such as PTZ" label={`New Category Type for ${category.name}`} onAdd={(name) => store.add({ kind: 'categoryType', name, parentId: category.id, scope: activeTab })} />
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dialog}
    </HubShell>
  );
}
