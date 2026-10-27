/**
 * MarkLibrarySaveDialog — "Save to library" for the picked marks (mark menu).
 *
 * Drawboard's save: name it, pick the library (when you may add to the
 * project's), add tags. Survey also lets you put the marks in an item you
 * already have ("Replace"), which is Drawboard's edit flow (place, change,
 * save again) without a second item to clean up.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from '../components/DialogCard.jsx';
import BodyPortal from '../components/BodyPortal.js';
import ValueSelect from '../components/ValueSelect.jsx';
import { showToast } from '../utils/toast.js';
import { Z_INDEX } from '../theme';
import { libraryErrorMessage, markLibraryStore, useMarkLibrary } from './markLibraryStore.js';
import {
  LIBRARY_KIND_LABELS,
  cleanLibraryName,
  cleanLibraryTags,
  defaultLibraryItemName,
  libraryTagsOf,
  payloadHasTokens,
  sortLibraryItems,
  summarizeLibraryKinds,
} from './markLibraryModel.js';

const NEW_ITEM = '__new__';

export default function MarkLibrarySaveDialog({ open, payload, onClose }) {
  const state = useMarkLibrary();
  const libraries = markLibraryStore.addableLibraries();
  const [library, setLibrary] = useState('personal');
  const [name, setName] = useState('');
  const [tagText, setTagText] = useState('');
  const [target, setTarget] = useState(NEW_ITEM);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    if (!open || !payload) return;
    setName(defaultLibraryItemName(payload));
    setTagText('');
    setTarget(NEW_ITEM);
    setLibrary(state.view.library === 'project' && libraries.includes('project') ? 'project' : 'personal');
    setBusy(false);
    // Select the name so typing replaces it.
    requestAnimationFrame(() => nameRef.current?.select?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload]);

  const items = library === 'project' ? state.project.items : state.personal.items;
  const replaceable = useMemo(
    () => sortLibraryItems(items.filter((it) => markLibraryStore.canChange(it)), 'recent', state.recents).slice(0, 50),
    [items, state.recents],
  );
  const knownTags = useMemo(() => libraryTagsOf([...state.personal.items, ...state.project.items]), [state.personal.items, state.project.items]);
  const typedTags = cleanLibraryTags(tagText);
  const kinds = payload ? summarizeLibraryKinds(payload) : [];

  if (!open || !payload) return null;

  const addTag = (tag) => {
    const next = cleanLibraryTags([...typedTags, tag]);
    setTagText(next.join(', '));
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (target !== NEW_ITEM) {
        const item = await markLibraryStore.replacePayload(target, payload);
        const rename = cleanLibraryName(name);
        if (rename && item && rename !== item.name) await markLibraryStore.renameItem(target, rename);
        if (typedTags.length) await markLibraryStore.setTags(target, cleanLibraryTags([...(item?.tags || []), ...typedTags]));
        showToast(`Updated “${rename || item?.name || 'item'}” in your ${library === 'project' ? 'project' : 'personal'} library`, 'success');
      } else {
        await markLibraryStore.addItems([{ library, name: cleanLibraryName(name) || defaultLibraryItemName(payload), tags: typedTags, payload }]);
        showToast(library === 'project'
          ? `Saved to ${state.access.projectName || 'the project'}'s library`
          : 'Saved to your library', 'success');
      }
      markLibraryStore.setView({ library });
      onClose?.(true);
    } catch (error) {
      setBusy(false);
      showToast(libraryErrorMessage(error), 'error');
    }
  };

  const libraryOptions = libraries.map((value) => ({
    value,
    label: value === 'project' ? `Project: ${state.access.projectName || 'this project'}` : 'Personal (only you)',
  }));
  const targetOptions = [
    { value: NEW_ITEM, label: 'A new item' },
    ...replaceable.map((it) => ({ value: it.id, label: `Replace “${it.name}”` })),
  ];

  return (
    <BodyPortal>
      <DialogCard
        open
        title="Save to library"
        message={`${kinds.map((k) => LIBRARY_KIND_LABELS[k]).join(', ')}${payloadHasTokens(payload) ? ' · fills in {{tokens}} when placed' : ''}`}
        onClose={() => onClose?.(false)}
        busy={busy}
        width={420}
        zIndex={Z_INDEX.modalOverlay}
        cardProps={{ 'data-mark-library-save': '' }}
        footer={(
          <>
            <button type="button" className="hub-btn dialog-touch-pad" onClick={() => onClose?.(false)} disabled={busy}>Cancel</button>
            <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={save} disabled={busy}>
              {target === NEW_ITEM ? 'Save' : 'Replace'}
            </button>
          </>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <span style={DIALOG_LABEL_STYLE}>Name</span>
            <input
              ref={nameRef}
              className="dialog-prompt-input"
              type="text"
              aria-label="Name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
              style={DIALOG_FIELD_STYLE}
            />
          </label>
          {libraries.length > 1 && (
            <div>
              <span style={DIALOG_LABEL_STYLE}>Library</span>
              <ValueSelect
                label="Library"
                value={library}
                options={libraryOptions}
                onChange={(value) => { setLibrary(value); setTarget(NEW_ITEM); }}
              />
            </div>
          )}
          {replaceable.length > 0 && (
            <div>
              <span style={DIALOG_LABEL_STYLE}>Save as</span>
              <ValueSelect label="Save as" value={target} options={targetOptions} onChange={setTarget} />
            </div>
          )}
          <label style={{ display: 'block' }}>
            <span style={DIALOG_LABEL_STYLE}>Tags (comma between them)</span>
            <input
              className="dialog-prompt-input"
              type="text"
              aria-label="Tags"
              value={tagText}
              placeholder="Electrical, Review"
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
              style={DIALOG_FIELD_STYLE}
            />
          </label>
          {knownTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label="Tags you use">
              {knownTags.filter((t) => !typedTags.some((x) => x.toLowerCase() === t.toLowerCase())).slice(0, 12).map((tag) => (
                <button key={tag} type="button" className="mark-library-tag-chip" onClick={() => addTag(tag)}>{tag}</button>
              ))}
            </div>
          )}
        </div>
      </DialogCard>
    </BodyPortal>
  );
}
