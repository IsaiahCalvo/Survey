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
 * first) and shows as the ringed disc; a disc changes it. Picking a category
 * row places the marker at once - one press, no Add button. Escape, the X or
 * a press off the card takes the marker back. On the phone it is a bottom
 * sheet with the sheet's 44px rows.
 */
export default function SurveyMarkerPlacementDialog({ marker, template, categoryId, mobile = false, onCancel, onConfirm }) {
  const modules = useMemo(() => template.modules || template.spaces || [], [template]);
  const entities = useMemo(() => (template.entities || []).filter((entity) => entity && entity.id != null), [template]);
  const [entityId, setEntityId] = useState(() => (
    entities.some((entity) => entity.id === marker.entityId) ? marker.entityId : (entities[0]?.id || '')
  ));
  const ref = useRef(null);
  // The list puts focus on its find field or first row itself (desktop); the
  // phone sheet opens with no focus, so no keyboard jumps up.
  useFocusTrap(ref, true, { onEscape: onCancel, autoFocus: false });
  const [position, setPosition] = useState(null);

  // The marker's own module first, then the rest, each as a section.
  const sections = useMemo(() => {
    const first = modules.find((module) => module.id === marker.moduleId) || modules[0] || null;
    const ordered = first ? [first, ...modules.filter((module) => module !== first)] : modules;
    return ordered
      .filter((module) => (module.categories || []).length > 0)
      .map((module) => ({
        id: module.id,
        label: modules.length > 1 ? (module.name || 'Untitled module') : null,
        items: module.categories.map((category) => ({
          id: category.id,
          label: category.name || 'Untitled category',
          glyph: getCategoryGlyphLabel(category.name),
          moduleId: module.id,
        })),
      }));
  }, [modules, marker.moduleId]);

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
                  onPick={() => setEntityId(entry.id)}
                />
              ))}
            </div>
            <span className="survey-place__entity-name">{entity?.name || 'Untitled entity'}</span>
          </div>
        )}
        <div className="survey-place__hint">Pick a category to place it</div>
        <SurveyPickList
          sections={sections}
          currentId={categoryId || null}
          ariaLabel="Category"
          searchPlaceholder="Find a category"
          emptyText="This module has no categories"
          variant={mobile ? 'sheet' : 'popover'}
          autoFocus={!mobile}
          onPick={(item) => place(item)}
        />
      </div>
    </div>
  );
  return typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node;
}
