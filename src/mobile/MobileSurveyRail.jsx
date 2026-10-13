/**
 * MobileSurveyRail - the phone tool rail's survey pieces (phone survey round,
 * owner 2026-10-13: "We'll have to figure out a way to implement this into
 * mobile as well properly, understanding what's going to happen if the user
 * has a ton of templates, a ton of checklists, a ton of entities").
 *
 * The desktop rules on the phone (listDebate/DECISION.md, utils/surveyPickLists):
 *   - the category and entity disc columns: up to 8 every disc; above 8, 7
 *     discs (the armed / current one, then the most recently used, then
 *     template order - drawn in template order) and an "All" disc opening a
 *     bottom sheet with every item by full name (SurveyPickList, 44px rows,
 *     categories grouped by module, a find field from 15). When the screen is
 *     too short for both columns, the longer one gives up discs first
 *     (planPhoneSurveyRail), so no disc ever hides below the rail's fold.
 *   - an entity disc tapped while Survey Markers are selected changes their
 *     entity (the desktop entity bar's write: save, sync, undo) and is the
 *     next marker's entity too; with nothing selected it arms the entity as
 *     before.
 *   - the Survey Marker shape (Rectangle / Freehand / Smart fill when a
 *     provider registers): one rail chip showing the shape in use, opening a
 *     small menu beside the rail (the desktop tool bar's marker group).
 *   - the template menu from 15 templates: the same sheet with "Find a
 *     template" and the 3 most recently used at the top.
 * Recents are the desktop's (same localStorage keys), so both agree on a
 * device.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Icon from '../Icons';
import SurveyPickList from '../components/SurveyPickList';
import { useSelectedSurveyMarkerIds } from '../components/SurveyEntityBar';
import DismissBarrier from '../components/DismissBarrier';
import useSurveyRecents from '../hooks/useSurveyRecents';
import { pickSurveyRowItems, surveyTemplateSections } from '../utils/surveyPickLists.js';
import { getCategoryGlyphLabel } from '../viewerShared';
import { useMobileSheetMotion } from './useMobileSheetMotion';
import { railDiscSlots } from './mobileSurveyRailFit.js';
import { setMarkerDrawMode, setMarkerModeToolsShown, useShownMarkerDrawMode } from '../survey/markerDrawMode.js';
import { getMarkerShapeProviders, subscribeMarkerShapeProviders } from '../survey/markerShapeProviders.js';

/**
 * Measures the rail room from the top of the first survey column (which never
 * depends on how many discs are drawn) down to the rail's footer (More, sync,
 * History, people - pinned to the rail's foot, so its top never moves while
 * the tool column grows or shrinks; the tool column itself is only as tall as
 * what it holds, so it is no measure). Measured with no tool group open (a
 * group's strip pushes the columns down for as long as it is open, and the
 * column then scrolls - owner 2026-10-01), so opening Draw never changes what
 * the columns show.
 */
export function useMobileSurveyRailSlots({ mainEl, anchorEl, groupOpen, bothColumns }) {
  const [slots, setSlots] = useState(null);
  const groupOpenRef = useRef(groupOpen);
  groupOpenRef.current = groupOpen;
  const measure = useCallback(() => {
    if (!mainEl || !anchorEl || groupOpenRef.current) return;
    const footer = mainEl.parentElement?.querySelector('.mobile-pdf-tools__footer');
    if (!footer) return;
    const top = anchorEl.getBoundingClientRect().top + mainEl.scrollTop;
    const padBottom = parseFloat(getComputedStyle(mainEl).paddingBottom) || 0;
    const avail = footer.getBoundingClientRect().top - padBottom - top;
    const next = railDiscSlots(avail, { bothColumns });
    setSlots((prev) => (prev === next ? prev : next));
  }, [mainEl, anchorEl, bothColumns]);
  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    if (groupOpen) return undefined;
    // A group just closed: its strip glides shut (useRailGroupMotion), so
    // measure once it has.
    const timer = setTimeout(measure, 360);
    return () => clearTimeout(timer);
  }, [groupOpen, measure]);
  useEffect(() => {
    // The rail itself (screen height, rotation) and its footer (it gains the
    // Pencil-only control) - never the tool column, whose height follows what
    // it draws.
    const railEl = mainEl?.parentElement;
    if (!railEl || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(railEl);
    const footer = railEl.querySelector('.mobile-pdf-tools__footer');
    if (footer) observer.observe(footer);
    return () => observer.disconnect();
  }, [mainEl, measure]);
  return slots;
}

/** The "All" disc that ends a long column. */
function RailAllDisc({ total, noun, open, onOpen }) {
  return (
    <button
      type="button"
      className={`mobile-pdf-tools__survey-all${open ? ' is-open' : ''}`}
      data-survey-row-all="true"
      aria-label={`All ${total} ${noun}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={`All ${total} ${noun}`}
      onClick={onOpen}
    >
      All
    </button>
  );
}

/**
 * The category disc column. `toolbar` is bottomToolbarApi.surveyToolbar;
 * `onTapCategory(category)` keeps the rail's own tap rule (a second tap on the
 * armed disc hands the tool back to Pan).
 */
export function MobileSurveyCategoryColumn({ toolbar, armed, max, columnRef, allOpen, onOpenAll, onTapCategory }) {
  const categories = toolbar?.categories || [];
  const activeId = armed ? (toolbar?.selectedCategoryId || null) : null;
  const recents = useSurveyRecents('category', toolbar?.templateId, activeId);
  const { shown, overflow, total } = pickSurveyRowItems(categories, { currentId: activeId, recentIds: recents, max });
  return (
    <div
      ref={columnRef}
      className="mobile-pdf-tools__survey-categories"
      aria-label="Survey categories"
      data-survey-row-overflow={overflow ? 'true' : undefined}
    >
      {shown.map((category) => (
        <button
          type="button"
          key={category.id}
          className={activeId === category.id ? 'is-active' : ''}
          aria-label={`Survey category ${category.name || 'Untitled Category'}`}
          title={category.name || 'Untitled Category'}
          onClick={() => onTapCategory?.(category)}
        >
          {getCategoryGlyphLabel(category.name)}
        </button>
      ))}
      {overflow && <RailAllDisc total={total} noun="categories" open={allOpen} onOpen={onOpenAll} />}
    </div>
  );
}

/** The marker's entity the rail rings, or undefined when no marker is picked. */
export function selectedMarkersEntityId(markerIds, surveyMarkers) {
  if (!markerIds?.length) return undefined;
  return surveyMarkers?.[markerIds[0]]?.entityId || null;
}

/**
 * The entity disc column. A tap with Survey Markers selected changes their
 * entity (toolbar.onApplyEntity); with none it is the rail's arm / toggle tap
 * (`onTapEntity`). The ringed disc: the selected marker's entity (bright ink
 * ring, calm), else the armed entity (the gold ring the phone always had).
 */
export function MobileSurveyEntityColumn({ toolbar, armed, max, columnRef, allOpen, onOpenAll, onTapEntity }) {
  const entities = toolbar?.entities || [];
  const selectedIds = useSelectedSurveyMarkerIds();
  const markerIds = useMemo(
    () => selectedIds.filter((id) => toolbar?.surveyMarkers?.[id]),
    [selectedIds, toolbar?.surveyMarkers],
  );
  const markerEntityId = selectedMarkersEntityId(markerIds, toolbar?.surveyMarkers);
  const nextId = toolbar?.selectedEntityId || null;
  const armedId = armed ? nextId : null;
  const currentId = markerEntityId !== undefined ? markerEntityId : armedId;
  const recents = useSurveyRecents('entity', toolbar?.templateId, nextId);
  const { shown, overflow, total } = pickSurveyRowItems(entities, { currentId: currentId || nextId, recentIds: recents, max });
  return (
    <div
      ref={columnRef}
      className="mobile-pdf-tools__survey-entities"
      aria-label="Survey entities"
      data-survey-row-overflow={overflow ? 'true' : undefined}
      data-survey-entity-target={markerIds.length ? 'selection' : 'next'}
    >
      {shown.map((entity) => {
        const ringed = entity.id === currentId;
        const cls = ringed ? (markerEntityId !== undefined ? 'is-current' : 'is-active') : '';
        return (
          <button
            type="button"
            key={entity.id}
            className={cls}
            data-survey-entity-id={entity.id}
            aria-pressed={ringed}
            aria-label={`Survey entity ${entity.name || 'Untitled Entity'}`}
            title={entity.name || 'Untitled Entity'}
            onClick={() => {
              if (markerIds.length) {
                toolbar?.onApplyEntity?.(entity.id, markerIds);
                return;
              }
              onTapEntity?.(entity);
            }}
          >
            <span style={{ background: entity.color || 'var(--border-strong)' }} />
          </button>
        );
      })}
      {overflow && <RailAllDisc total={total} noun="entities" open={allOpen} onOpen={onOpenAll} />}
    </div>
  );
}

/**
 * The "All" sheet: one phone bottom sheet (useMobileSheetMotion, the shared
 * slide / drag / close) holding SurveyPickList's sheet variant.
 * kind: 'categories' | 'entities' | 'templates'.
 */
export function MobileSurveyAllSheet({ kind, toolbar, armed, closeKey = 0, onClose }) {
  const open = Boolean(kind);
  const shownKind = kind;
  const selectedIds = useSelectedSurveyMarkerIds();
  const markerIds = useMemo(
    () => selectedIds.filter((id) => toolbar?.surveyMarkers?.[id]),
    [selectedIds, toolbar?.surveyMarkers],
  );
  const templateRecents = useSurveyRecents('template', 'all', toolbar?.templateId || null);
  const {
    motionStyle,
    backdropStyle,
    sheetProps,
    requestClose,
  } = useMobileSheetMotion(onClose, { open, expandable: true });
  // Another phone panel opened (AppShell's aux close request): slide away so
  // only one sheet is up, like the Active users sheet.
  const closeKeyRef = useRef(closeKey);
  useEffect(() => {
    if (closeKeyRef.current === closeKey) return;
    closeKeyRef.current = closeKey;
    if (open) requestClose();
  }, [closeKey, open, requestClose]);

  const content = useMemo(() => {
    if (!toolbar || !shownKind) return null;
    if (shownKind === 'categories') {
      const modules = toolbar.modules || [];
      const current = modules.find((module) => module.id === toolbar.selectedModuleId) || modules[0] || null;
      const ordered = current ? [current, ...modules.filter((module) => module !== current)] : modules;
      const sections = ordered
        .filter((module) => (module.categories || []).length > 0)
        .map((module) => ({
          id: module.id,
          label: module.name || 'Untitled module',
          items: module.categories.map((category) => ({
            id: category.id,
            label: category.name || 'Untitled category',
            glyph: getCategoryGlyphLabel(category.name),
            moduleId: module.id,
          })),
        }));
      const total = sections.reduce((sum, section) => sum + section.items.length, 0);
      return {
        title: 'Categories',
        subtitle: `${total} in ${sections.length} module${sections.length === 1 ? '' : 's'}`,
        sections,
        currentId: armed ? (toolbar.selectedCategoryId || null) : null,
        searchPlaceholder: 'Find a category',
        emptyText: 'No categories match',
        onPick: (item) => toolbar.onPickCategory?.(item.id, item.moduleId),
      };
    }
    if (shownKind === 'entities') {
      const entities = toolbar.entities || [];
      const markerEntityId = selectedMarkersEntityId(markerIds, toolbar.surveyMarkers);
      return {
        title: 'Entities',
        subtitle: markerIds.length
          ? `Sets the selected Survey Marker${markerIds.length === 1 ? '' : 's'}`
          : `${entities.length} for the next Survey Marker`,
        sections: [{
          id: 'entities',
          label: null,
          items: entities.map((entity) => ({ id: entity.id, label: entity.name || 'Untitled entity', swatch: entity.color || null })),
        }],
        currentId: markerEntityId !== undefined ? markerEntityId : (toolbar.selectedEntityId || null),
        searchPlaceholder: 'Find an entity',
        emptyText: 'No entities match',
        onPick: (item) => {
          if (markerIds.length) toolbar.onApplyEntity?.(item.id, markerIds);
          else toolbar.onSelectEntity?.(item.id);
        },
      };
    }
    const templates = (toolbar.templates || []).map((template) => ({ ...template, name: template.name || 'Untitled template' }));
    return {
      title: 'Templates',
      subtitle: `${templates.length} templates`,
      // From 15 templates the three most recent sit on top (as on desktop).
      sections: surveyTemplateSections(templates, templateRecents),
      currentId: toolbar.templateId || null,
      searchPlaceholder: 'Find a template',
      emptyText: 'No templates match',
      onPick: (item) => { if (item.id !== toolbar.templateId) toolbar.onSelectTemplate?.(item.id); },
    };
  }, [toolbar, shownKind, armed, markerIds, templateRecents]);

  if (!open || !content) return null;
  return (
    <>
      <button
        type="button"
        className="mobile-pdf-sheet-backdrop"
        aria-label={`Close ${content.title.toLowerCase()} list`}
        onClick={requestClose}
        style={backdropStyle}
      />
      <section
        className="mobile-pdf-sheet mobile-survey-all-sheet"
        data-survey-all-sheet={shownKind}
        role="dialog"
        aria-label={`All ${content.title.toLowerCase()}`}
        {...sheetProps}
        style={motionStyle}
      >
        <div className="mobile-pdf-sheet__handle" />
        <header>
          <div>
            <strong>{content.title}</strong>
            <span>{content.subtitle}</span>
          </div>
        </header>
        <SurveyPickList
          key={shownKind}
          variant="sheet"
          sections={content.sections}
          currentId={content.currentId}
          ariaLabel={`All ${content.title.toLowerCase()}`}
          searchPlaceholder={content.searchPlaceholder}
          emptyText={content.emptyText}
          onPick={(item, section) => {
            content.onPick(item, section);
            requestClose();
          }}
        />
      </section>
    </>
  );
}

const BUILT_IN_SHAPES = [
  { mode: 'rectangle', label: 'Rectangle', icon: 'rect' },
  { mode: 'freehand', label: 'Freehand', icon: 'highlighter' },
];

/**
 * The Survey Marker shape chip: the rail's one control for how the next
 * marker is drawn. It shows the shape in use (gold while the marker tool is
 * armed, like every rail tool) and opens a small menu beside the rail -
 * Rectangle, Freehand, and Smart fill only while its provider is registered.
 * Picking one arms the Survey Marker tool. While the chip is on screen the
 * page draws in the picked shape (markerDrawMode: setMarkerModeToolsShown).
 */
export function MobileMarkerShapeChip({ armed, onArm, glyph = 17 }) {
  const shown = useShownMarkerDrawMode();
  const providers = useSyncExternalStore(subscribeMarkerShapeProviders, getMarkerShapeProviders, getMarkerShapeProviders);
  const smartFill = providers.find((provider) => provider.id === 'smartFill') || null;
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);
  const menuRef = useRef(null);
  const insideRefs = useMemo(() => [chipRef, menuRef], []);
  const [menuTop, setMenuTop] = useState(null);
  useEffect(() => {
    setMarkerModeToolsShown(true);
    return () => setMarkerModeToolsShown(false);
  }, []);
  const shapes = smartFill
    ? [...BUILT_IN_SHAPES, { mode: 'smartFill', label: smartFill.label || 'Smart fill', icon: smartFill.icon || 'paintBucket' }]
    : BUILT_IN_SHAPES;
  const current = shapes.find((shape) => shape.mode === shown) || shapes[0];
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const rect = chipRef.current?.getBoundingClientRect();
    setMenuTop(rect ? Math.max(8, rect.top - 6) : null);
    setOpen(true);
  };
  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={`mobile-pdf-tools__button mobile-pdf-tools__marker-shape${armed ? ' is-active' : ''}`}
        data-marker-draw-modes="phone"
        data-marker-draw-mode={current.mode}
        aria-label={`Survey Marker shape: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Survey Marker shape: ${current.label}`}
        onClick={toggle}
      >
        <Icon name={current.icon} size={glyph} color="currentColor" />
      </button>
      <DismissBarrier active={open} insideRefs={insideRefs} onDismiss={() => setOpen(false)} />
      {open && (
        <div
          ref={menuRef}
          className="mobile-pdf-tools__popover is-marker-shape"
          role="menu"
          aria-label="Survey Marker shape"
          style={menuTop != null ? { top: menuTop } : undefined}
        >
          <strong>Survey Marker shape</strong>
          {shapes.map((shape) => (
            <button
              key={shape.mode}
              type="button"
              role="menuitemradio"
              aria-checked={shape.mode === current.mode}
              data-marker-draw-mode={shape.mode}
              onClick={() => {
                setMarkerDrawMode(shape.mode);
                setOpen(false);
                onArm?.();
              }}
            >
              <Icon name={shape.icon} size={16} color="currentColor" />
              <span>{shape.label}</span>
              <span className="mobile-pdf-tools__popover-check" aria-hidden="true">
                {shape.mode === current.mode ? <Icon name="check" size={14} color="currentColor" /> : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
