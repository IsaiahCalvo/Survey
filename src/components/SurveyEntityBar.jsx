import { useEffect, useMemo, useState } from 'react';
import SurveyOverflowRow from './SurveyOverflowRow';
import useSurveyRecents from '../hooks/useSurveyRecents';
import { ChosenCheck } from './QuickStyleControls';
import { HISTORY_PAGE_SELECTION_EVENT } from '../utils/historyMarkFilter.js';
import { needsSwatchHairline, swatchCheckInk, swatchRingColour } from '../utils/quickStylePresets';
import './QuickStyleControls.css';

/**
 * The survey bar's ENTITY swatches (desktop). Owner 2026-10-13: "Display
 * entities as swatches ... matching the current mobile layout"; owner
 * 2026-10-26: one survey bar, not two ("put them on the left"), so they open
 * the survey bar's centre group, before the module menu, with a rule after
 * them - pinned to the tool bar's centre with the rest of that group.
 *
 * Intended UX - "the same as clicking a swatch for any other annotation tool,
 * except there is no colour picker":
 *   - a swatch sets the entity the NEXT Survey Marker starts with (the same
 *     value the Survey panel's Entity menu sets: rememberSurveyEntity);
 *   - and when Survey Markers are selected on the page, it changes theirs too,
 *     through the very write the panel's Entity menu makes (save, sync, undo).
 * The ringed swatch is the selected marker's entity, else the next marker's.
 * The swatches are the tool bar's colour discs (QuickColourDots: the colour's
 * own ring and a check, no gold); the name shows on hover (the shared
 * tooltip). Above 8 entities: 7 swatches and "All N" (SurveyOverflowRow). A
 * template with no entities draws nothing (and no rule).
 *
 * @param {Array<{id, name, color}>} entities
 * @param {string|null} nextEntityId   the entity a new marker starts with
 * @param {object} surveyMarkers       { [id]: { entityId } } - to ring a
 *                                     selected marker's entity
 * @param {(entityId: string, markerIds: string[]) => void} onPick
 */
export default function SurveyEntityBar({ templateId, entities, nextEntityId, surveyMarkers, onPick, tip, max }) {
  const selectedMarkerIds = useSelectedSurveyMarkerIds();
  const markerIds = useMemo(
    () => selectedMarkerIds.filter((id) => surveyMarkers?.[id]),
    [selectedMarkerIds, surveyMarkers],
  );
  const markerEntityId = markerIds.length ? (surveyMarkers[markerIds[0]]?.entityId || null) : undefined;
  const currentId = markerEntityId !== undefined ? markerEntityId : (nextEntityId || null);
  const recents = useSurveyRecents('entity', templateId, nextEntityId || null);
  const list = useMemo(() => (entities || []).filter((entity) => entity && entity.id != null), [entities]);
  const sections = useMemo(() => [{
    id: 'entities',
    label: null,
    items: list.map((entity) => ({ id: entity.id, label: entity.name || 'Untitled entity', swatch: entity.color || null })),
  }], [list]);
  if (list.length === 0) return null;

  return (
    <div
      className="survey-subrow__entities"
      data-survey-entity-bar="true"
      role="group"
      aria-label="Survey entities"
    >
      <SurveyOverflowRow
        className="survey-entitybar__centre quick-style quick-style--colours"
        items={list}
        currentId={currentId}
        recentIds={recents}
        sections={sections}
        noun="entities"
        searchPlaceholder="Find an entity"
        tip={tip}
        max={max}
        onPickFromList={(item) => onPick?.(item.id, markerIds)}
        renderItem={(entity) => (
          <SurveyEntitySwatch
            key={entity.id}
            entity={entity}
            current={entity.id === currentId}
            tip={tip}
            onPick={() => onPick?.(entity.id, markerIds)}
          />
        )}
      />
      <div className="chrome-divider" aria-hidden="true" />
    </div>
  );
}

/**
 * One entity swatch: the tool bar's colour disc (the colour's own ring and a
 * check when it is the current one, no gold), named on hover. Shared by the
 * survey bar, the new-marker card and the selection quick bar (components/SelectionQuickBar.jsx), which
 * shows a picked Survey Marker's entities the same way.
 */
export function SurveyEntitySwatch({ entity, current = false, tip, tipSide = 'below', onPick }) {
  const colour = entity?.color || 'transparent';
  const name = entity?.name || 'Untitled entity';
  return (
    <button
      type="button"
      className={`quick-style__dot hero-swatch survey-entitybar__swatch${current ? ' is-current' : ''}`}
      data-selected={current ? 'true' : 'false'}
      data-survey-entity-id={entity?.id}
      style={{
        '--quick-style-dot': colour,
        '--quick-style-ring': swatchRingColour(colour),
        '--hero-swatch-ring': swatchRingColour(colour),
        borderRadius: '50%',
      }}
      {...(tip ? tip(name, tipSide) : {})}
      aria-label={`Entity ${name}`}
      aria-pressed={current}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => onPick?.()}
    >
      <span className={`quick-style__dot-fill hero-swatch__fill${needsSwatchHairline(colour) ? ' has-hairline' : ''}`}>
        {current && (
          <span className="quick-style__check hero-swatch__check" style={{ color: swatchCheckInk(colour) }} aria-hidden="true">
            <ChosenCheck />
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The Survey Markers selected on the page now. Every page layer announces its
 * pick on the window (HISTORY_PAGE_SELECTION_EVENT, the History panel's and
 * pageSelectionPresence's source), and an empty pick when it clears or goes.
 * Shared with the phone rail's entity discs (mobile/MobileSurveyRail.jsx).
 */
export function useSelectedSurveyMarkerIds() {
  const [byPage, setByPage] = useState(() => new Map());
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPick = (event) => {
      const page = Number(event?.detail?.pageNumber);
      if (!Number.isFinite(page)) return;
      const ids = (event?.detail?.items || [])
        .filter((item) => item?.typeKey === 'surveyMarker' && item.id)
        .map((item) => String(item.id));
      setByPage((current) => {
        const before = current.get(page) || [];
        if (before.length === ids.length && before.every((id, i) => id === ids[i])) return current;
        const next = new Map(current);
        if (ids.length) next.set(page, ids); else next.delete(page);
        return next;
      });
    };
    window.addEventListener(HISTORY_PAGE_SELECTION_EVENT, onPick);
    return () => window.removeEventListener(HISTORY_PAGE_SELECTION_EVENT, onPick);
  }, []);
  return useMemo(() => [...byPage.values()].flat(), [byPage]);
}
