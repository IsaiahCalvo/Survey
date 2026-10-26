import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getCategoryGlyphLabel } from '../viewerShared.js';
import SurveyPickList from './SurveyPickList';
import { SurveyEntitySwatch } from './SurveyEntityBar';
import { placeSurveyMarkerCard } from '../survey/markerPlacementCard.js';
import './SurveyMarkerPlacementDialog.css';

/**
 * The card that opens when a Survey Marker is drawn with no category armed
 * (owner 2026-10-22: the old centred form "doesn't look native"). It is the
 * app's own popover - the survey bars' list surface, 26px rows, category
 * initials, entity discs - sitting beside the marker, not a blurred modal.
 *
 * Intended UX: the entity is already picked (the last one used, else the
 * first) and shows as the ringed disc; a disc changes it, and the marker on
 * the page takes the new colour at once (onEntityChange). Only the module in
 * use is listed (owner 2026-10-22: "only show the module that is selected and
 * the categories within that module"); with more than one module, the module
 * button above the list swaps it for the module list, and a pick there brings
 * back that module's categories. Picking a category row places the marker at
 * once - one press, no Add button. Escape, the X or a press off the card takes
 * the marker back. On the phone it is a bottom sheet with the sheet's 44px
 * rows.
 */
export default function SurveyMarkerPlacementDialog({ marker, template, categoryId, mobile = false, onCancel, onConfirm, onEntityChange }) {
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
  // The list puts focus on its find field or first row itself (desktop); the
  // phone sheet opens with no focus, so no keyboard jumps up. Escape with the
  // module list open only closes the list (one thing per Escape).
  useFocusTrap(ref, true, {
    onEscape: () => (choosingModule ? setChoosingModule(false) : onCancel()),
    autoFocus: false,
  });
  const [position, setPosition] = useState(null);

  const currentModule = modules.find((entry) => entry.id === moduleId) || modules[0] || null;

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
    const node = document.querySelector(`[data-survey-marker-id="${CSS.escape(String(marker.id))}"]`);
    const rect = node?.getBoundingClientRect() || null;
    setPosition(placeSurveyMarkerCard(rect && rect.width > 0 ? rect : null, { width: card?.width, height: card?.height }, {
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  }, [marker.id, mobile]);

  const pickEntity = (entry) => {
    if (entry.id === entityId) return;
    setEntityId(entry.id);
    onEntityChange?.(entry);
  };

  const place = (item) => {
    const entity = entities.find((entry) => entry.id === entityId);
    onConfirm({
      ...marker,
      moduleId: item.moduleId,
      ...(entity ? { entityId: entity.id, entityName: entity.name, entityColor: entity.color } : {}),
    }, item.id);
  };

  const entity = entities.find((entry) => entry.id === entityId) || null;
  // Portalled to <body>: inside the viewer's z 5000 stacking context the
  // desktop rails (5600) painted over it and stayed clickable, so a category
  // could be deleted from the rail under this open card.
  const node = (
    <div
      className={`survey-place-scrim${mobile ? ' is-sheet' : ''}`}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="survey-marker-place-title"
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
          <span id="survey-marker-place-title" className="survey-place__title">New Survey Marker</span>
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
            <div className="survey-place__hint">Pick a category to place it</div>
            <SurveyPickList
              key={`categories:${currentModule?.id || ''}`}
              sections={sections}
              currentId={categoryId || null}
              ariaLabel="Category"
              searchPlaceholder="Find a category"
              emptyText="This module has no categories"
              variant={mobile ? 'sheet' : 'popover'}
              autoFocus={!mobile}
              onPick={(item) => place(item)}
            />
          </>
        )}
      </div>
    </div>
  );
  return typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node;
}
