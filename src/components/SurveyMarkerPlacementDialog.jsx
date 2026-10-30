import { queryFrontTab } from '../utils/tabBehind.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getCategoryGlyphLabel } from '../viewerShared.js';
import SurveyPickList from './SurveyPickList';
import { SurveyEntitySwatch } from './SurveyEntityBar';
import { placeSurveyMarkerCard } from '../survey/markerPlacementCard.js';
import { getInputModality } from '../utils/inputModality.js';
import './SurveyMarkerPlacementDialog.css';

/**
 * The card that opens beside every Survey Marker just drawn (owner
 * 2026-10-22: the old centred form "doesn't look native"; owner 2026-10-26:
 * "they should still have the option to change that entity, module, and
 * category like they do, but they also need a way to assign a name to it").
 * It is the app's own popover - the survey bars' list surface, 26px rows,
 * category initials, entity discs - sitting beside the marker, not a blurred
 * modal.
 *
 * Intended UX: the category (the armed one - the module's first by default),
 * module and entity (the last one used, else the first) are already picked.
 * The card's title IS the marker's name: "Camera 7" (the category's next
 * number), selected so typing replaces it; Enter places the marker with that
 * name, and so does a press off the card (on the phone too: "if you click off
 * of it, it just commits it"). Until the name is typed over it follows the
 * category. A disc changes the entity, and the marker on the page takes the
 * new colour at once (onEntityChange). Only the module in use is listed
 * (owner 2026-10-22); with more than one module, the module button above the
 * list swaps it for the module list, and a pick there brings back that
 * module's categories. Picking a category row places the marker in it at
 * once - one press, no Add button. Escape or the X takes the marker back. On
 * the phone it is a bottom sheet with the sheet's 44px rows, and the name
 * field waits for a tap (no keyboard thrown up unasked).
 *
 * @param {(categoryId, moduleId) => string} defaultNameFor  the default name
 *   ("Camera 7") a marker of that category would get
 */
export default function SurveyMarkerPlacementDialog({ marker, template, categoryId, mobile = false, onCancel, onConfirm, onEntityChange, defaultNameFor }) {
  const modules = useMemo(() => template.modules || template.spaces || [], [template]);
  const entities = useMemo(() => (template.entities || []).filter((entity) => entity && entity.id != null), [template]);
  const [entityId, setEntityId] = useState(() => (
    entities.some((entity) => entity.id === marker.entityId) ? marker.entityId : (entities[0]?.id || '')
  ));
  const ref = useRef(null);
  const [moduleId, setModuleId] = useState(() => (
    modules.find((entry) => entry.id === marker.moduleId) || modules[0] || null
  )?.id ?? null);
  const [choosingModule, setChoosingModule] = useState(false);
  // null = untouched (the category's default name shows and follows it); any
  // string, '' included, is the user's text.
  const [name, setName] = useState(null);
  const nameRef = useRef(null);
  // Desktop focuses the name (below) once the card is placed; the phone sheet
  // opens with no focus, so no keyboard jumps up. Escape with the module list
  // open only closes the list (one thing per Escape).
  useFocusTrap(ref, true, {
    onEscape: () => (choosingModule ? setChoosingModule(false) : onCancel()),
    autoFocus: false,
  });
  const [position, setPosition] = useState(null);

  const currentModule = modules.find((entry) => entry.id === moduleId) || modules[0] || null;
  const moduleCategories = currentModule?.categories || [];
  // The category Enter (or a press off the card) places in: the armed one
  // while it is in the module shown, else that module's first.
  const currentCategoryId = (moduleCategories.find((entry) => entry.id === categoryId) || moduleCategories[0] || null)?.id ?? null;
  const nameFor = (id, inModuleId) => (id ? String(defaultNameFor?.(id, inModuleId) || '') : '');
  const defaultName = nameFor(currentCategoryId, currentModule?.id);

  const sections = useMemo(() => (currentModule ? [{
    id: currentModule.id,
    label: null,
    items: (currentModule.categories || []).map((category) => ({
      id: category.id,
      label: category.name || 'Untitled category',
      glyph: getCategoryGlyphLabel(category.name),
      moduleId: currentModule.id,
    })),
  }] : []), [currentModule]);
  const moduleSections = useMemo(() => [{
    id: 'modules',
    label: null,
    items: modules.map((entry) => ({ id: entry.id, label: entry.name || 'Untitled module' })),
  }], [modules]);

  useLayoutEffect(() => {
    if (mobile || typeof document === 'undefined') return;
    const card = ref.current?.getBoundingClientRect();
    const node = queryFrontTab(`[data-survey-marker-id="${CSS.escape(String(marker.id))}"]`);
    const rect = node?.getBoundingClientRect() || null;
    setPosition(placeSurveyMarkerCard(rect && rect.width > 0 ? rect : null, { width: card?.width, height: card?.height }, {
      width: window.innerWidth,
      height: window.innerHeight,
    }, { inputKind: getInputModality() }));
  }, [marker.id, mobile]);

  // Desktop: the name is ready to type over once the card is in place.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (mobile || !position || focusedRef.current) return;
    focusedRef.current = true;
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.select();
  }, [mobile, position]);

  const pickEntity = (entry) => {
    if (entry.id === entityId) return;
    setEntityId(entry.id);
    onEntityChange?.(entry);
  };

  const place = (placeCategoryId, placeModuleId) => {
    if (!placeCategoryId) return;
    const entity = entities.find((entry) => entry.id === entityId);
    // An emptied name falls back to the default: a marker always has a name
    // (the items map and Excel sync match by it).
    const fallback = nameFor(placeCategoryId, placeModuleId);
    onConfirm({
      ...marker,
      moduleId: placeModuleId,
      name: (name ?? fallback).trim() || fallback,
      ...(entity ? { entityId: entity.id, entityName: entity.name, entityColor: entity.color } : {}),
    }, placeCategoryId);
  };
  const placeCurrent = () => {
    if (currentCategoryId) place(currentCategoryId, currentModule?.id ?? null);
    else onCancel();
  };

  const entity = entities.find((entry) => entry.id === entityId) || null;
  // Portalled to <body>: inside the viewer's z 5000 stacking context the
  // desktop rails (5600) painted over it and stayed clickable, so a category
  // could be deleted from the rail under this open card.
  const node = (
    <div
      className={`survey-place-scrim${mobile ? ' is-sheet' : ''}`}
      // A press off the card places the marker as it stands (owner
      // 2026-10-26); with no category to place it in, it is taken back.
      onPointerDown={(event) => { if (event.target === event.currentTarget) placeCurrent(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="New Survey Marker"
        data-survey-marker-placement="true"
        data-survey-place-choosing={choosingModule ? 'true' : undefined}
        className={`survey-place annotation-dropdown__popover${mobile ? ' survey-place--sheet' : ''}`}
        style={mobile ? undefined : {
          left: position?.left ?? -9999,
          top: position?.top ?? -9999,
          visibility: position ? 'visible' : 'hidden',
        }}
      >
        <div className="survey-place__head">
          <input
            ref={nameRef}
            type="text"
            className="survey-place__name"
            data-survey-place-name="true"
            aria-label="Survey Marker name"
            placeholder={defaultName || 'Name'}
            value={name ?? defaultName}
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return;
              event.preventDefault();
              placeCurrent();
            }}
          />
          <button type="button" className="survey-place__close" aria-label="Cancel Survey Marker" onClick={onCancel}>
            <Icon name="close" size={12} color="currentColor" />
          </button>
        </div>
        {entities.length > 0 && (
          <div className="survey-place__entities" role="group" aria-label="Entity">
            <div className="survey-place__swatches quick-style quick-style--colours">
              {entities.map((entry) => (
                <SurveyEntitySwatch
                  key={entry.id}
                  entity={entry}
                  current={entry.id === entityId}
                  onPick={() => pickEntity(entry)}
                />
              ))}
            </div>
            <span className="survey-place__entity-name">{entity?.name || 'Untitled entity'}</span>
          </div>
        )}
        {modules.length > 1 && (
          <button
            type="button"
            className="survey-place__module"
            aria-label={`Module: ${currentModule?.name || 'Untitled module'}. Change module`}
            aria-expanded={choosingModule}
            data-survey-place-module="true"
            onClick={() => setChoosingModule((open) => !open)}
          >
            <span className="survey-place__module-word">Module</span>
            <span className="survey-place__module-name">{currentModule?.name || 'Untitled module'}</span>
            <Icon name={choosingModule ? 'chevronUp' : 'chevronDown'} size={9} color="currentColor" />
          </button>
        )}
        {choosingModule ? (
          <SurveyPickList
            key="modules"
            sections={moduleSections}
            currentId={currentModule?.id || null}
            ariaLabel="Module"
            searchPlaceholder="Find a module"
            variant={mobile ? 'sheet' : 'popover'}
            autoFocus={!mobile}
            onPick={(item) => {
              setModuleId(item.id);
              setChoosingModule(false);
            }}
          />
        ) : (
          <>
            {/* The phone has no keyboard up: a tap off the sheet places it. */}
            <div className="survey-place__hint">{mobile ? 'Tap outside to place it, or pick a category' : 'Enter places it, or pick a category'}</div>
            <SurveyPickList
              key={`categories:${currentModule?.id || ''}`}
              sections={sections}
              currentId={currentCategoryId}
              ariaLabel="Category"
              searchPlaceholder="Find a category"
              emptyText="This module has no categories"
              variant={mobile ? 'sheet' : 'popover'}
              autoFocus={false}
              onPick={(item) => place(item.id, item.moduleId)}
            />
          </>
        )}
      </div>
    </div>
  );
  return typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node;
}
