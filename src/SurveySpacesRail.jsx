// SurveySpacesRail — the survey right rail. Renders the Survey panel docked on
// the right side of the viewer: the module/category controls, the survey-marker
// toolbar, and the export block (Open / Push / Pull / Live Sync). Published to
// the app shell via the rightRailApi object (mirrors the leftRailApi pattern);
// it talks to the shell purely through props, so it can be developed on its own.
//
// NAME NOTE: "Spaces" in the filename refers to the module/space data duality and
// the "Copy to Spaces" survey-marker action — this component renders NO Spaces
// tab or Spaces UI. The Spaces panel lives in the LEFT rail (PDFSidebar).
// Accurate rename candidate: SurveyRail.jsx.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Icon from './Icons';
import CreateCategoryModal from './components/CreateCategoryModal';
import Spinner from './components/Spinner';
import { useTooltip } from './components/Tooltip';
import DragRearrangeHandle from './reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from './reorder/SortableRearrangeList';
import { moveItemById } from './reorder/flatReorderUtils.js';
import { COLORS } from './theme';
import reviewWarningIcon from './assets/review-warning.svg';
import { SYNC_TONE_COLORS, liveSyncGateStatus, liveSyncVerifyStatus, syncMessagePresentation } from './services/excelSyncStatus';
import { compareSurveyMarkersForOrder } from './utils/surveyMarkerOrdering';
import { showToast } from './utils/toast';
import { watchLightPopover } from './components/dismissRules.js';
import { useConfirmDialog } from './components/dialogPrompts';
import SurveyMarkerNotes from './components/SurveyMarkerNotes';
import { normalizeNoteMedia } from './services/surveyMediaService';
import { SHEET_DETENT_FULL, SHEET_DETENT_STANDARD, useMobileSheetMotion } from './mobile/useMobileSheetMotion';
// Phone Survey panel look (layout B, one card divided). Every rule in it is
// scoped to .mobile-survey-sheet, which only the phone sheet carries.
import './mobile/mobileSurveyPanel.css';
// Desktop Survey panel look (one list, divided). Every rule in it is scoped to
// .survey-rail, which only the desktop rail carries.
import './surveyRailPanel.css';
import { RAIL_CONTROL, RAIL_CONTROL_GLYPH, RAIL_GLYPH } from './viewerShared';
import { useViewerSideOccluderRef } from './utils/viewerSideOverlay.js';
import { resolveAutoCompleteEntity } from './utils/surveyAutoEntity.js';
import { resolveSurveyMarkerPromptName } from './utils/surveyMarkerNamePrompt.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const getElementCenterY = (element) => {
  const rect = element?.getBoundingClientRect?.();
  return rect ? rect.top + rect.height / 2 : null;
};

const getNearestVerticalScrollContainer = (element) => {
  if (typeof window === 'undefined') return null;
  let current = element?.parentElement || null;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    if (
      /auto|scroll|overlay/.test(style.overflowY || '')
      && current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};

const preserveElementViewportY = (element, mutateLayout) => {
  const beforeY = getElementCenterY(element);
  const scrollContainer = getNearestVerticalScrollContainer(element);

  mutateLayout();

  if (beforeY == null || !scrollContainer) return;
  const afterY = getElementCenterY(element);
  if (afterY == null) return;

  const deltaY = afterY - beforeY;
  if (Math.abs(deltaY) < 0.5) return;

  if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement) {
    window.scrollBy(0, deltaY);
  } else {
    scrollContainer.scrollTop += deltaY;
  }
};

const SurveyMarkerLeadingSelect = ({
  selected,
  onClick,
  title,
  ariaLabel,
  category = false
}) => {
  // KAL-65: rail controls use the app's instant shared tooltip, never a native
  // title= (the OS tooltip takes ~1.5s and is styled by the OS, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  return (
    <button
      type="button"
      className={`survey-marker-leading-control survey-marker-leading-check${category ? ' survey-marker-leading-control-category' : ''}${selected ? ' is-selected' : ''}`}
      {...tip(title, 'below')}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span className="survey-marker-leading-checkbox" aria-hidden="true">
        {selected && <Icon name="check" size={12} className="survey-marker-leading-checkmark" />}
      </span>
    </button>
  );
};

const formatConflictFieldLabel = (field) => {
  if (!field) return null;
  if (field === 'item') return 'Item name';
  if (field === 'entity') return 'Entity';
  if (field === 'notes') return 'Notes';
  if (field === 'changedBy') return 'Changed by';
  if (field === 'changedDate') return 'Changed date';
  if (String(field).startsWith('answer:')) return 'Checklist answer';
  return String(field);
};

/* KAL-292 — "Rows we couldn't place".
   Rows that arrive from the linked Excel workbook but map to NO Survey Marker used to be
   dropped silently: the user's Excel edits just never appeared and nothing said why. This
   compact list sits at the top of the Survey panel and names each one (sheet, row number,
   Item cell) with a plain-English reason.
   UX rules baked in here:
     - Renders NOTHING when there are no unplaced rows, so it adds no permanent chrome.
     - A whole-change-set hold is explained ONCE at the top; the per-row reasons are then
       suppressed (a hundred identical sentences is worse than useless).
     - The only actions are Dismiss / Dismiss all. There is deliberately NO "apply anyway":
       these are exactly the rows the server refused to write, and applying them from the
       client would route around that server-side gate. */
const ExcelUnplacedRows = ({
  rows = [],
  batchTitle = null,
  batchNotice = null,
  onDismiss,
  onDismissAll
}) => {
  if (!rows || rows.length === 0) return null;

  const describeRow = (row) => {
    const parts = [];
    if (row.rowNumber) parts.push(`Row ${row.rowNumber}`);
    if (row.sheetName) parts.push(row.sheetName);
    return parts.join(' · ');
  };

  return (
    <section className="survey-unplaced" aria-label="Rows we couldn’t place">
      <div className="survey-unplaced-header">
        <img src={reviewWarningIcon} alt="" width={14} height={14} aria-hidden="true" />
        <span className="survey-unplaced-title">
          {batchTitle || `Rows we couldn’t place (${rows.length})`}
        </span>
        <button
          type="button"
          className="survey-unplaced-dismiss-all"
          title="Hide this list. Rows come back on the next sync if they still can’t be placed."
          onClick={() => onDismissAll?.()}
        >
          Dismiss all
        </button>
      </div>
      {batchNotice && (
        <p className="survey-unplaced-notice">{batchNotice}</p>
      )}
      {!batchNotice && (
        <p className="survey-unplaced-notice">
          These rows came from the linked Excel file but couldn’t be matched to a Survey Marker,
          so nothing in the app was changed.
        </p>
      )}
      <ul className="survey-unplaced-list">
        {rows.map((row) => (
          <li key={row.key} className="survey-unplaced-row">
            <div className="survey-unplaced-row-main">
              <span className="survey-unplaced-row-name">
                {row.itemName || 'Unnamed row'}
              </span>
              {describeRow(row) && (
                <span className="survey-unplaced-row-where">{describeRow(row)}</span>
              )}
              {row.message && (
                <span className="survey-unplaced-row-reason">{row.message}</span>
              )}
            </div>
            <button
              type="button"
              className="survey-unplaced-row-dismiss"
              title="Hide this row. It comes back on the next sync if it still can’t be placed."
              aria-label={`Dismiss ${row.itemName || 'this row'}`}
              onClick={() => onDismiss?.(row.key)}
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const SurveyMarkerReviewIndicator = ({
  markerId,
  message,
  conflict,
  onKeepApp,
  onUseExcel
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef(null);

  const clearCloseTimer = () => {
    if (!closeTimerRef.current) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const openTooltip = () => {
    clearCloseTimer();
    setIsOpen(true);
  };

  const closeTooltipSoon = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = null;
    }, 280);
  };

  const closeTooltipNow = () => {
    clearCloseTimer();
    setIsOpen(false);
  };

  useEffect(() => clearCloseTimer, []);

  if (!message) return null;

  const conflictFields = Array.isArray(conflict?.conflictFields)
    ? [...new Set(conflict.conflictFields.map(formatConflictFieldLabel).filter(Boolean))]
    : [];

  return (
    <span
      className={`survey-marker-review-wrap${isOpen ? ' is-open' : ''}`}
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltipSoon}
      onFocus={openTooltip}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeTooltipSoon();
      }}
    >
      <button
        type="button"
        className="survey-marker-review-button"
        aria-label={message}
        aria-describedby={`survey-marker-review-${markerId || (conflict ? 'conflict' : 'review')}`}
        aria-expanded={isOpen}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closeTooltipNow();
          }
        }}
      >
        <img src={reviewWarningIcon} alt="" width={15} height={15} aria-hidden="true" />
      </button>
      <span
        id={`survey-marker-review-${markerId || (conflict ? 'conflict' : 'review')}`}
        className="survey-marker-review-tooltip"
        role="tooltip"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="survey-marker-review-tooltip-title">
          {conflict ? 'Excel sync conflict' : 'Excel sync review'}
        </span>
        <span className="survey-marker-review-tooltip-body">
          {message}
        </span>
        {conflictFields.length > 0 && (
          <span className="survey-marker-review-tooltip-meta">
            Affected: {conflictFields.join(', ')}
          </span>
        )}
        {conflict && (
          <span className="survey-marker-review-tooltip-actions">
            <button
              type="button"
              onClick={(event) => {
                closeTooltipNow();
                onKeepApp?.(event);
              }}
            >
              Keep app
            </button>
            <button
              type="button"
              onClick={(event) => {
                closeTooltipNow();
                onUseExcel?.(event);
              }}
            >
              Use Excel
            </button>
          </span>
        )}
      </span>
    </span>
  );
};

const SurveySpacesRail = ({
  activeSpaceId,
  addCategoryAsNewTemplate,
  addCategoryToCurrentTemplate,
  annotationsByPage,
  applyLayoutDrivenZoom,
  categorySelectModeActive,
  copiedItemSelection,
  copyModeActive,
  DEFAULT_SURVEY_MARKER_OPACITY,
  deleteAnnotations,
  deleteCategory = () => {},
  documentSyncEnabled,
  expandedCategories,
  expandedSurveyMarkers,
  exportMenuRef,
  features,
  getCanvasAnnotationVisibilityState,
  getCategoryName,
  getModuleDataKey,
  getModuleName,
  getSurveyAnnotationVisibilityState,
  graphClient,
  handleCancelRegionEdit,
  handleDeleteSurveyMarkerItem,
  handleExitSpaceMode,
  handleExportSpaceToCSV,
  handleExportSpaceToPDF,
  handleExportSurveyToExcel,
  handleLocateItemOnPDF,
  handleReorderSurveyCategories = () => {},
  handleReorderSpaces,
  handleRequestRegionEdit,
  handleSetActiveSpace,
  handleSpaceAssignPages,
  handleSpaceCreate,
  handleSpaceDelete,
  handleSpaceRemovePage,
  handleSpaceRenamePage,
  handleSpaceUpdate,
  handleSurveyToggle,
  handleSyncFromExcel,
  handleToggleCanvasAnnotations,
  handleToggleRegionOverlay,
  handleToggleSurveyAnnotations,
  hexToRgba,
  isExporting,
  isRegionOverlayEnabled,
  isRegionOverlayToggleEnabled,
  itemSelectModeActive,
  items,
  lastSyncMessage,
  linkedExcelExists,
  liveSyncEnabled,
  liveSyncGate,
  liveSyncStatus,
  liveSyncSupported,
  liveSyncVerify,
  msLogin,
  msNeedsReconnect,
  normalizeSurveyMarkerColor,
  numPages,
  onLiveSyncToggle,
  onVerifyLiveSync,
  onCloseSurveyMode,
  onRequestCreateTemplate,
  onSelectSurveyTemplate,
  pdfFile,
  scale,
  selectedCategories,
  selectedCategoryId,
  // Survey calm gold (2026-10-01): true while the Survey Marker tool is armed,
  // so the chosen category is gold only when a touch on the page places it.
  surveyPlacementArmed = false,
  // Owner 2026-10-01 ("Yes, inline like phone"): { id, tick } - focus that
  // new desktop Survey Marker's name; undoSurveyMarkerPlacement(id) takes a
  // just-placed marker back as one Undo step (true when it did);
  // rememberSurveyEntity(id) - the entity a new desktop marker starts with.
  surveyMarkerNameFocusRequest = null,
  undoSurveyMarkerPlacement,
  rememberSurveyEntity,
  selectedItemsInCategory,
  selectedModuleId,
  selectedSpaceId,
  selectedTemplate,
  setActiveCategoryDropdown,
  setActiveTool,
  setAnnotations,
  setAnnotationsByPage,
  setCategorySelectModeActive,
  setCategorySelectModeForCategory,
  setCopiedItemSelection,
  setCopyModeActive,
  setExpandedCategories,
  setExpandedSurveyMarkers,
  setItemSelectModeActive,
  setItems,
  setNewSurveyMarkersByPage,
  setPendingLocationItem,
  setSelectedCategories,
  setSelectedCategoryId,
  setSelectedItemsInCategory,
  setSelectedModuleId,
  setSelectedSpaceId,
  setShowExportMenu,
  setShowSpaceSelection,
  setShowSurveyPanel,
  setSurveyMarkers,
  setSurveyMarkersToRemoveByPage,
  showExportMenu,
  showRegionSelection,
  showSurveyPanel,
  spaces,
  surveyMarkers,
  surveyTemplates = [],
  surveyReviewByMarkerId = {},
  surveyConflictByMarkerId = {},
  // KAL-292 — { rows, batchNotice, batchTitle } for the "Rows we couldn't place" surface.
  surveyUnplacedRows = null,
  onDismissUnplacedRow = null,
  onDismissAllUnplacedRows = null,
  onResolveExcelConflict = null,
  user,
  expandRequestKey = 0,
  collapseRequestKey = 0,
  onCollapseChange = null,
  mobileMode = false,
  // Owner or editor of the document (PDFViewer's canRestoreFromHistory): may
  // add and remove Survey media and move legacy inline media to storage.
  canEditSurveyMarkers = true,
}) => {
  // KAL-65: rail controls use the app's instant shared tooltip, never a native
  // title= (the OS tooltip takes ~1.5s and is styled by the OS, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  // RULED 2026-09-23 (coordinator: auto refits keep the view; fits use the
  // band between panels): the open desktop panel covers the right ~272px of the
  // PDF, so it registers as a side panel. Fits then size and centre the page in
  // the part you can still see, search centres its match there, and the viewer
  // keeps scroll room so a page can be moved out from under it.
  const sideOccluderRef = useViewerSideOccluderRef();
  // KAL-57: themed replacement for the native confirm() that gated the three
  // bulk-delete actions in this rail (categories, copied items, category
  // items). Promise-based so each handler keeps its original
  // `if (!confirmed) return;` shape and nothing deletes before the user answers.
  const [askConfirm, confirmDialogElement] = useConfirmDialog();
  const [isSurveyPanelCollapsed, setIsSurveyPanelCollapsed] = useState(true);
  // Desktop panel motion (owner 2026-09-30: "the expand animation isn't
  // smooth"). Once the panel has been expanded or collapsed at least once, it
  // plays surveyRailExpand / surveyRailCollapse (styles.css) instead of the
  // mount-time slideInRight, so the very first render never plays a collapse.
  const railPrevCollapsedRef = useRef(isSurveyPanelCollapsed);
  const railToggledRef = useRef(false);
  if (railPrevCollapsedRef.current !== isSurveyPanelCollapsed) {
    railPrevCollapsedRef.current = isSurveyPanelCollapsed;
    railToggledRef.current = true;
  }
  const [openEntityDropdownId, setOpenEntityDropdownId] = useState(null);
  // The template switcher (owner 2026-10-01, "hybrid" design): the template
  // name in the panel header is a button. Phone: it swaps the category list
  // for an in-sheet list of templates. Desktop: it opens a small menu under
  // the rail header. The one way to switch template on each screen.
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
  const [templateSwitchQuery, setTemplateSwitchQuery] = useState('');
  // Mobile-only export menu in the sheet header (demo SurveySheet.tsx:324-348);
  // desktop keeps its bottom EXPORT bar untouched.
  const [isMobileExportMenuOpen, setIsMobileExportMenuOpen] = useState(false);
  // Phone: whether the open Survey Marker's entity menu is open.
  const [mobileDetailDropdown, setMobileDetailDropdown] = useState(null); // 'entity' | null
  // Desktop: the note glyph on a marker line opens the marker and puts the
  // caret in its inline Notes field (the 600px Note dialog is gone).
  const [noteFocusRequestId, setNoteFocusRequestId] = useState(null);
  const clearNoteFocusRequest = useCallback(() => setNoteFocusRequestId(null), []);
  // Desktop-only Create Category flow: the plus button in the "Categories"
  // heading row opens CreateCategoryModal (the old route opened a template
  // editor that has since been removed, leaving the button dead). Persistence
  // lives in PDFViewer via addCategoryToCurrentTemplate/addCategoryAsNewTemplate.
  const [isCreateCategoryModalOpen, setIsCreateCategoryModalOpen] = useState(false);
  const [railIconHover, setRailIconHover] = useState(null);
  const templateSelectorRef = useRef(null);
  const templateTitleButtonRef = useRef(null);
  const templateSwitchListRef = useRef(null);
  const mobileExportMenuRef = useRef(null);
  const surveyMarkerDragRestoreRef = useRef(null);
  const availableSurveyTemplates = Array.isArray(surveyTemplates) ? surveyTemplates : [];
  const surveyModuleOptions = selectedTemplate ? ((selectedTemplate.modules || selectedTemplate.spaces) || []) : [];
  const selectedModuleIndex = surveyModuleOptions.findIndex((module) => module.id === selectedModuleId);
  const activeSurveyModule = selectedModuleIndex >= 0 ? surveyModuleOptions[selectedModuleIndex] : null;

  // Create Category (desktop): hoisted from the old action-row IIFE so the
  // heading-row plus button and the modal share component scope.
  const openCreateCategoryModal = () => {
    if (!selectedTemplate?.id || !selectedModuleId) {
      showToast('Please select a template and module before creating a category.', 'warn');
      return;
    }
    setIsCreateCategoryModalOpen(true);
  };

  const handleCreateCategoryConfirm = async (option, { categoryName, newTemplateName }) => {
    try {
      if (option === 'modifyTemplate') {
        await addCategoryToCurrentTemplate?.(selectedModuleId, categoryName);
        showToast('Category added', 'success');
      } else if (option === 'newTemplate') {
        await addCategoryAsNewTemplate?.(selectedModuleId, categoryName, newTemplateName);
        showToast(`New template '${newTemplateName}' created`, 'success');
      }
      setIsCreateCategoryModalOpen(false);
    } catch (err) {
      console.error('[SurveySpacesRail] Failed to create category:', err);
      showToast('Failed to create category. Please try again.', 'error');
    }
  };
  // Phone (owner 2026-10-01, "works like desktop"): ONE accordion, the
  // desktop's tree - categories, their Survey Markers, and one open Survey
  // Marker inline. The open one rides the existing expandedSurveyMarkers state
  // (PDFViewer sets it when a placed Survey Marker is tapped or a new one
  // commits); on the phone only one is open at a time.
  const mobileDetailMarkerId = mobileMode
    ? (Object.keys(expandedSurveyMarkers || {}).find((id) => expandedSurveyMarkers[id] && surveyMarkers?.[id]) || null)
    : null;
  const mobileDetailMarker = mobileDetailMarkerId
    ? { ...surveyMarkers[mobileDetailMarkerId], id: mobileDetailMarkerId }
    : null;
  // Anything open in the phone accordion (a category or a Survey Marker)?
  // While it is, the sheet stands at Full screen (see the effect below).
  const mobileAccordionOpen = mobileMode && (
    Boolean(mobileDetailMarkerId)
    || Object.values(expandedCategories || {}).some(Boolean)
  );

  // Phase F (motion & feel): the survey sheet gets the same finger-follow drag +
  // velocity dismiss (dy>82 or vy>0.65) + spring-back + slide-down exit as the
  // hub/spaces sheets, replacing the old flat 48px touchend delta. Demo
  // SurveySetupSheet.tsx:51-96 / inv-demo §17. The real collapse still re-runs
  // the layout-driven zoom after the sheet finishes sliding down.
  const collapseSurveySheet = useCallback(() => {
    setIsSurveyPanelCollapsed(true);
    requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
  }, [applyLayoutDrivenZoom]);
  // 2026-09-17: the hook owns the slide-up too now (see useMobileSheetMotion),
  // so it needs the real open state — this element stays mounted and only
  // toggles .is-collapsed.
  // Owner 2026-09-30: Survey is a browse panel, so it climbs Standard ->
  // Expanded -> Full like Pages / Spaces (DESIGN-SYSTEM.md "Phone bottom
  // panels"), which is also the height it rises to when you type in it.
  const {
    motionStyle: surveySheetMotionStyle,
    backdropStyle: surveyBackdropStyle,
    sheetProps: surveySheetProps,
    requestClose: requestSurveySheetClose,
    expanded: surveySheetExpanded,
    fullscreen: surveySheetFullscreen,
    setDetent: setSurveySheetDetent,
  } = useMobileSheetMotion(collapseSurveySheet, {
    open: mobileMode && !isSurveyPanelCollapsed,
    expandable: mobileMode,
    fullscreenable: mobileMode,
    // Owner 2026-10-01: a swipe down closes the whole panel from any height
    // (even Full screen with a Survey Marker open); reopening restores the
    // open category / Survey Marker and the scroll (below). "< Categories"
    // is the way back a level.
    pullDownCloses: mobileMode,
  });

  // Owner 2026-10-01: opening anything in the phone accordion takes the sheet
  // to Full screen; closing everything brings it back to Standard. Only on a
  // change (or when the sheet opens), so a pull up on a closed list still
  // works as before.
  useEffect(() => {
    if (!mobileMode || isSurveyPanelCollapsed) return;
    setSurveySheetDetent(mobileAccordionOpen ? SHEET_DETENT_FULL : SHEET_DETENT_STANDARD);
  }, [mobileMode, isSurveyPanelCollapsed, mobileAccordionOpen, setSurveySheetDetent]);

  // Close everything in the phone accordion (the "Categories" back button).
  const collapseMobileAccordion = () => {
    setMobileDetailDropdown(null);
    setExpandedSurveyMarkers((prev) => (Object.keys(prev || {}).length ? {} : prev));
    setExpandedCategories((prev) => (Object.keys(prev || {}).length ? {} : prev));
  };

  // Phone: where the list was, so closing the panel (a swipe, the dock, a
  // tap outside) and opening it again comes back to the same place. Saved on
  // every scroll with the accordion state it belongs to; restored only when
  // the same category / Survey Marker is still open (a tap on another placed
  // Survey Marker opens that one instead).
  const mobileAccordionKey = mobileMode
    ? `${Object.keys(expandedCategories || {}).filter((id) => expandedCategories[id]).join(',')}|${mobileDetailMarkerId || ''}`
    : '';
  const mobileSurveyListRef = useRef(null);
  const mobileListScrollRef = useRef({ top: 0, key: '' });
  const mobileListRestoredRef = useRef(false);
  useLayoutEffect(() => {
    if (!mobileMode || isSurveyPanelCollapsed) return;
    const list = mobileSurveyListRef.current;
    const saved = mobileListScrollRef.current;
    if (!list || !saved.top || saved.key !== mobileAccordionKey) return;
    list.scrollTop = saved.top;
    // The open Survey Marker's bring-to-top (below) skips this reopen.
    mobileListRestoredRef.current = Boolean(mobileDetailMarkerId);
    // Only on the reopen itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileMode, isSurveyPanelCollapsed]);

  // Owner 2026-10-01 ("Yes, inline like phone"): a Survey Marker just placed
  // on desktop opens here with its name field focused and selected. While the
  // name is untouched, Escape takes the placement back (one Undo step);
  // typing, Enter or leaving the field keeps it.
  const justPlacedSurveyMarkerIdRef = useRef(null);
  useEffect(() => {
    if (mobileMode || !surveyMarkerNameFocusRequest?.id || typeof window === 'undefined') return undefined;
    const targetId = String(surveyMarkerNameFocusRequest.id);
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const input = Array.from(document.querySelectorAll('.survey-rail input[data-survey-marker-name-input]'))
        .find((el) => el.getAttribute('data-survey-marker-name-input') === targetId);
      if (input && input.offsetParent !== null) {
        justPlacedSurveyMarkerIdRef.current = targetId;
        input.focus({ preventScroll: false });
        input.select();
        input.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      frames += 1;
      if (frames < 40) raf = window.requestAnimationFrame(tryFocus);
    };
    raf = window.requestAnimationFrame(tryFocus);
    return () => window.cancelAnimationFrame(raf);
  }, [mobileMode, surveyMarkerNameFocusRequest]);

  // Phone: tapping a category opens it (and closes any other, one accordion).
  const toggleMobileCategory = (categoryId) => {
    const isOpen = Boolean(expandedCategories?.[categoryId]);
    setExpandedCategories(isOpen ? {} : { [categoryId]: true });
    if (isOpen || (mobileDetailMarker && mobileDetailMarker.categoryId !== categoryId)) {
      setExpandedSurveyMarkers((prev) => (Object.keys(prev || {}).length ? {} : prev));
    }
  };

  // Phone: "+ Place" on a category row arms the Survey Marker tool for that
  // category and slides the sheet away so the page is free to draw on.
  const placeMobileSurveyMarker = (categoryId) => {
    setSelectedCategoryId(categoryId);
    setActiveTool('survey-marker');
    requestSurveySheetClose();
  };

  const selectSurveyModule = (moduleId) => {
    if (!moduleId || moduleId === selectedModuleId) {
      return;
    }
    setSelectedModuleId(moduleId);
    setSelectedCategoryId(null);
    setActiveCategoryDropdown('survey');
    setActiveTool('survey-marker');
    setCopyModeActive(false);
    setCopiedItemSelection({});
    if (categorySelectModeActive) {
      setSelectedCategories({});
    }
    if (mobileMode) {
      // UX: flipping modules while the Survey Marker detail view is open must
      // return to the new module's category list. Keeping the detail open
      // would leave selectedModuleId pointing at a different module than the
      // shown marker, and commitSurveyMarkerName resolves the marker's linked
      // item via selectedModuleId — a rename in that state silently breaks
      // the marker <-> item link (adversarial review, 2026-07-12).
      setExpandedSurveyMarkers((prev) => (Object.keys(prev || {}).length ? {} : prev));
      // ...and the new module starts with its categories closed (the
      // accordion, and so the sheet's Full screen, belong to one module).
      setExpandedCategories((prev) => (Object.keys(prev || {}).length ? {} : prev));
    }
  };

  const exitSurveyMode = () => {
    if (typeof onCloseSurveyMode === 'function') {
      onCloseSurveyMode();
    } else {
      setShowSurveyPanel(false);
      setSelectedSpaceId(null);
      setSelectedModuleId(null);
      setSelectedCategoryId(null);
      setActiveCategoryDropdown(null);
      setCategorySelectModeActive(false);
      setCategorySelectModeForCategory(null);
      setSelectedCategories({});
      setCopyModeActive(false);
      setCopiedItemSelection({});
      setActiveTool('select');
    }
    if (mobileMode) {
      collapseMobileAccordion();
      mobileListScrollRef.current = { top: 0, key: '' };
    }
    setIsSurveyPanelCollapsed(true);
  };

  useEffect(() => {
    if (showSurveyPanel) {
      setIsSurveyPanelCollapsed(false);
    }
  }, [showSurveyPanel]);

  useEffect(() => {
    if (expandRequestKey > 0) {
      setIsSurveyPanelCollapsed(false);
    }
  }, [expandRequestKey]);

  useEffect(() => {
    if (collapseRequestKey <= 0) return;
    // Owner 2026-10-01 (iPhone: closing from the dock was abrupt): on the phone
    // the sheet slides down behind the dock like a swipe, or - when another
    // panel is opening in the same tap - hands over to it in place
    // (useMobileSheetMotion, PANEL TO PANEL).
    if (mobileMode && !isSurveyPanelCollapsed) {
      requestSurveySheetClose();
      return;
    }
    setIsSurveyPanelCollapsed(true);
    // Only a new request runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseRequestKey]);

  // Phone: the template list is showing in place of the category list. Only
  // from the category list itself (the title is hidden while a category is
  // open, so an open accordion always wins).
  const isMobileTemplateSwitching = mobileMode && isTemplateSelectorOpen && !mobileAccordionOpen;

  const closeTemplateSwitcher = useCallback(({ focusTitle = true } = {}) => {
    setIsTemplateSelectorOpen(false);
    setTemplateSwitchQuery('');
    if (focusTitle) {
      requestAnimationFrame(() => templateTitleButtonRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  // Switch to another template. The current one only closes the switcher.
  const switchSurveyTemplate = (template) => {
    if (template && template.id !== selectedTemplate?.id) {
      // Another template starts on its category list.
      if (mobileMode) collapseMobileAccordion();
      onSelectSurveyTemplate?.(template);
    }
    closeTemplateSwitcher();
  };

  // The switcher never outlives what it belongs to: closing the panel, an
  // accordion opening (a placed Survey Marker tapped), another template, or
  // desktop's category-select mode (whose title is the module, not the
  // template) all put it away.
  useEffect(() => {
    if (!isTemplateSelectorOpen) return;
    if (isSurveyPanelCollapsed || mobileAccordionOpen || (!mobileMode && categorySelectModeActive)) {
      setIsTemplateSelectorOpen(false);
      setTemplateSwitchQuery('');
    }
  }, [isTemplateSelectorOpen, isSurveyPanelCollapsed, mobileAccordionOpen, mobileMode, categorySelectModeActive]);
  useEffect(() => {
    setIsTemplateSelectorOpen(false);
    setTemplateSwitchQuery('');
  }, [selectedTemplate?.id]);

  // Focus lands on the current template when the list or menu opens.
  useEffect(() => {
    if (!isTemplateSelectorOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      const list = templateSwitchListRef.current;
      const current = list?.querySelector('[aria-current="true"], [aria-checked="true"]');
      current?.focus({ preventScroll: !mobileMode });
    });
    return () => cancelAnimationFrame(frame);
  }, [isTemplateSelectorOpen, mobileMode]);

  // Desktop: the template menu is a light popover — shared dismiss rules
  // R1/R2/R5 (src/components/dismissRules.js). The phone's list is part of
  // the sheet, so a tap elsewhere in it does not close it.
  useEffect(() => {
    if (!isTemplateSelectorOpen || mobileMode) return undefined;
    return watchLightPopover({
      contains: (target) => !templateSelectorRef.current || templateSelectorRef.current.contains(target),
      close: (_event, reason) => closeTemplateSwitcher({ focusTitle: reason === 'escape' }),
    });
  }, [isTemplateSelectorOpen, mobileMode, closeTemplateSwitcher]);

  // Desktop menu keys: up / down / Home / End move between templates.
  const handleTemplateMenuKeyDown = (event) => {
    const items = [...(templateSwitchListRef.current?.querySelectorAll('[role="menuitemradio"]') || [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
    else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items[items.length - 1];
    else if (event.key === 'Tab') { closeTemplateSwitcher({ focusTitle: false }); return; }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  useEffect(() => {
    if (!isMobileExportMenuOpen) return undefined;
    // Light popover — shared dismiss rules R1/R2/R5 (src/components/dismissRules.js).
    return watchLightPopover({
      contains: (target) => !mobileExportMenuRef.current || mobileExportMenuRef.current.contains(target),
      close: () => setIsMobileExportMenuOpen(false),
    });
  }, [isMobileExportMenuOpen]);

  useEffect(() => {
    if (isSurveyPanelCollapsed) setIsMobileExportMenuOpen(false);
  }, [isSurveyPanelCollapsed]);

  // Reset detail-local UI whenever the selected Survey Marker changes so the
  // dropdowns never carry over to another marker.
  useEffect(() => {
    setMobileDetailDropdown(null);
  }, [mobileDetailMarkerId]);

  // Owner 2026-10-01: closing the sheet KEEPS the accordion (the open
  // category and Survey Marker) so reopening comes back to the same place;
  // only its menus close. (It used to clear it, after the demo's dock button.) A placement or a tap on a placed Survey
  // Marker still opens the sheet with its own category and marker open
  // (PDFViewer replaces the open set). Exiting Survey starts fresh.
  useEffect(() => {
    if (mobileMode && isSurveyPanelCollapsed) setMobileDetailDropdown(null);
  }, [mobileMode, isSurveyPanelCollapsed]);

  // Phone: bring the open Survey Marker to the top of the list (after a
  // placement it can be far down a long category). Scrolls the list only -
  // never scrollIntoView, which would also nudge the overflow-hidden sheet.
  useEffect(() => {
    if (!mobileMode || !mobileDetailMarkerId || isSurveyPanelCollapsed) return undefined;
    // Reopened where the finger left it: keep that scroll.
    if (mobileListRestoredRef.current) {
      mobileListRestoredRef.current = false;
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`highlight-item-${mobileDetailMarkerId}`);
      const list = row?.closest('.mobile-survey-list');
      if (!row || !list) return;
      const rowTop = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      // Already in the top part of the list: leave it where the finger was.
      if (rowTop >= list.scrollTop && rowTop <= list.scrollTop + list.clientHeight * 0.4) return;
      // One row of context (its category, or the row before) stays visible.
      list.scrollTop = Math.max(0, rowTop - 40);
    });
    return () => cancelAnimationFrame(frame);
  }, [mobileMode, mobileDetailMarkerId, isSurveyPanelCollapsed]);

  // Outside-tap closes the open Survey Marker's entity menu.
  useEffect(() => {
    if (!mobileDetailDropdown) return undefined;
    // Light popover — shared dismiss rules R1/R2/R5 (src/components/dismissRules.js).
    return watchLightPopover({
      contains: (target) => Boolean(target.closest('.mobile-survey-detail-dropdown-wrap')),
      close: () => setMobileDetailDropdown(null),
    });
  }, [mobileDetailDropdown]);

  useEffect(() => {
    if (typeof onCollapseChange === 'function') {
      onCollapseChange(isSurveyPanelCollapsed);
    }
  }, [isSurveyPanelCollapsed, onCollapseChange]);

  useEffect(() => {
    if (!openEntityDropdownId) return undefined;
    // Light popover — shared dismiss rules R1/R2/R5 (src/components/dismissRules.js).
    return watchLightPopover({
      contains: (target) => Boolean(target.closest('.survey-marker-entity-select-wrap, .survey-rail__entity-wrap')),
      close: () => setOpenEntityDropdownId(null),
    });
  }, [openEntityDropdownId]);

  // O(1) entity-by-id lookup for the per-marker render loop below (entity ids are
  // unique, so a Map.get matches the old entities.find first-and-only result).
  const entitiesMap = useMemo(() => {
    const entities = selectedTemplate?.entities || [];
    return new Map(entities.map((e) => [e.id, e]));
  }, [selectedTemplate?.entities]);

  // O(1) item-by-name+type lookup for the per-marker render loop below.
  // Replaces repeated O(|items|) Object.values(items).find(name && itemType)
  // scans. Names+itemType pairs are unique per item, so Map.get matches the
  // old find first-and-only result.
  const itemsByNameType = useMemo(() => {
    const m = new Map();
    Object.values(items).forEach(item => {
      if (item?.name != null && item?.itemType != null) {
        const k = `${item.name}\0${item.itemType}`;
        // First-match wins, exactly like the original Object.values(items).find():
        // if two items share name+type, keep the earliest (do not overwrite).
        if (!m.has(k)) m.set(k, item);
      }
    });
    return m;
  }, [items]);

  const commitSurveyMarkerName = (annotationId, categoryId, previousName, nextRawName, fallbackName) => {
    // BL-22 resolver (was the desktop Name pop-up's): blank -> the default name.
    const nextName = resolveSurveyMarkerPromptName(nextRawName ?? '', fallbackName ?? '') || fallbackName;
    const oldName = (previousName || '').trim() || fallbackName;
    if (!annotationId || nextName === oldName) return;

    const currentMarker = surveyMarkers[annotationId] || {};
    setSurveyMarkers(prev => ({
      ...prev,
      [annotationId]: {
        ...(prev[annotationId] || {}),
        name: nextName
      }
    }));

    if (!selectedTemplate || !selectedModuleId || !categoryId) return;
    const categoryName = getCategoryName(selectedTemplate, selectedModuleId, categoryId);
    const itemFromMarkerId = currentMarker.itemId ? items[currentMarker.itemId] : null;
    const matchingItem = itemFromMarkerId || itemsByNameType.get(`${oldName}\0${categoryName}`);
    if (!matchingItem?.itemId) return;

    setItems(prev => ({
      ...prev,
      [matchingItem.itemId]: {
        ...(prev[matchingItem.itemId] || matchingItem),
        name: nextName
      }
    }));
  };

  // ——— Shared Survey Marker mutation helpers ———
  // UX (mobile demo parity): the mobile marker detail view re-houses the
  // desktop expanded-row logic (demo SurveySheet.tsx) with the SAME store
  // writes. These helpers are the single source for those writes so the
  // CRDT/sync layer sees identical operations from both surfaces.
  const findMarkerMatchingItem = (annotationId, markerModuleId, category) => {
    if (!selectedTemplate || !markerModuleId || !category) {
      return { matchingItem: null, moduleData: {}, dataKey: null };
    }
    const surveyMarkerData = surveyMarkers[annotationId];
    const categoryName = getCategoryName(selectedTemplate, markerModuleId, category.id);
    const markerName = surveyMarkerData?.name || '';
    const matchingItem = itemsByNameType.get(`${markerName}\0${categoryName}`) || null;
    const moduleName = getModuleName(selectedTemplate, markerModuleId);
    const dataKey = getModuleDataKey(moduleName);
    const moduleData = matchingItem?.[dataKey] || {};
    return { matchingItem, moduleData, dataKey };
  };

  // Same writes as the desktop expanded-row entity dropdown (handleEntitySelection
  // below): patch the marker annotation, then mirror onto the linked item's
  // module-specific data and its annotations. entityId '' / null clears.
  const applyEntitySelectionForMarker = (annotationId, markerModuleId, category, entityId, { automatic = false } = {}) => {
    const { matchingItem, moduleData, dataKey } = findMarkerMatchingItem(annotationId, markerModuleId, category);
    const entities = selectedTemplate?.entities || [];
    const entity = entityId ? entities.find(e => e.id === entityId) : null;
    // A user's pick is what the next desktop Survey Marker starts with.
    if (!automatic && typeof rememberSurveyEntity === 'function') rememberSurveyEntity(entity?.id || null);

    setSurveyMarkers(prev => ({
      ...prev,
      [annotationId]: {
        ...prev[annotationId],
        entityId: entity?.id,
        entityName: entity?.name,
        entityColor: entity?.color
      }
    }));

    if (matchingItem) {
      const updatedItem = {
        ...matchingItem,
        [dataKey]: {
          ...moduleData,
          entityId: entity ? entity.id : undefined,
          entityName: entity ? entity.name : undefined,
          entityColor: entity ? entity.color : undefined
        }
      };
      setItems(prev => ({
        ...prev,
        [matchingItem.itemId]: updatedItem
      }));
      setAnnotations(prev => {
        const updated = { ...prev };
        Object.values(updated).forEach(ann => {
          if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
            updated[ann.annotationId] = {
              ...ann,
              entityId: entity ? entity.id : undefined,
              entityName: entity ? entity.name : undefined,
              entityColor: entity ? entity.color : undefined
            };
          }
        });
        return updated;
      });
    }
  };

  // The checklist Y/N/N-A click handler, shared by the desktop row and the
  // phone's open Survey Marker. Owner ruling 2026-10-01 (auto entity): "When
  // every checklist answer is Y or N/A, set the entity to Complete by itself,
  // but never undo it." The rule lives in utils/surveyAutoEntity.js: every
  // ACTIVE item answered Y or N/A -> the template's Complete entity; a later
  // answer never clears or changes the entity; no Space has to be selected
  // (it used to run only with selectedSpaceId set, and cleared the entity to
  // None as soon as one answer was not Y / N/A).
  const applyChecklistResponseSelection = (annotationId, markerModuleId, category, markerRowName, checklistItemId, option) => {
    const currentMarker = surveyMarkers[annotationId] || {};
    const nextResponses = {
      ...currentMarker.checklistResponses,
      [checklistItemId]: {
        ...currentMarker.checklistResponses?.[checklistItemId],
        selection: option
      }
    };
    setSurveyMarkers(prev => ({
      ...prev,
      [annotationId]: {
        ...prev[annotationId],
        checklistResponses: {
          ...prev[annotationId]?.checklistResponses,
          [checklistItemId]: {
            ...prev[annotationId]?.checklistResponses?.[checklistItemId],
            selection: option
          }
        }
      }
    }));

    const { moduleData } = findMarkerMatchingItem(annotationId, markerModuleId, category);
    const completeEntity = resolveAutoCompleteEntity({
      checklist: category?.checklist,
      responses: nextResponses,
      entities: selectedTemplate?.entities,
      currentEntityId: moduleData?.entityId || currentMarker.entityId || null,
    });
    if (!completeEntity) return;
    applyEntitySelectionForMarker(annotationId, markerModuleId, category, completeEntity.id, { automatic: true });
    // Repaint the box on the page in the Complete colour (the same write the
    // old rule made, kept to this marker's own id).
    if (currentMarker.pageNumber && currentMarker.bounds) {
      const color = normalizeSurveyMarkerColor(completeEntity.color)
        || completeEntity.color
        || hexToRgba('#E3D1FB', DEFAULT_SURVEY_MARKER_OPACITY);
      setNewSurveyMarkersByPage(prev => {
        const pageMarkers = prev[currentMarker.pageNumber] || [];
        const existing = pageMarkers.find(h => h.annotationId === annotationId) || {};
        const painted = { ...existing, ...currentMarker.bounds, color, annotationId };
        delete painted.needsEntity;
        return {
          ...prev,
          [currentMarker.pageNumber]: [
            ...pageMarkers.filter(h => h.annotationId !== annotationId),
            painted
          ]
        };
      });
    }
  };

  // The open Survey Marker's note, edited inline (SurveyMarkerNotes) on the
  // phone and the desktop. Same write the retired Notes screen and Note
  // dialog made - patch the marker's `note` through setSurveyMarkers - so
  // persistence, sync and the Excel row see the identical operation. The
  // patch is functional, so a text save and an upload finishing at the same
  // moment both land. `requireExisting`: an upload that finishes after its
  // Survey Marker was deleted must not bring a stub of it back.
  const updateSurveyMarkerNote = useCallback((annotationId, updater, { requireExisting = false } = {}) => {
    if (!annotationId) return;
    setSurveyMarkers(prev => {
      const existing = prev?.[annotationId];
      if (!existing && requireExisting) return prev;
      const rawNote = existing?.note;
      let prevNote = {};
      if (rawNote && typeof rawNote === 'object') {
        prevNote = rawNote;
      } else if (typeof rawNote === 'string') {
        // document_annotations.notes is TEXT: an object note can arrive as
        // JSON text; anything else is a plain-text note.
        try {
          const parsed = rawNote.trim().startsWith('{') ? JSON.parse(rawNote) : null;
          prevNote = parsed && typeof parsed === 'object' ? parsed : { text: rawNote };
        } catch {
          prevNote = { text: rawNote };
        }
      }
      const nextNote = updater(prevNote);
      if (!nextNote || nextNote === prevNote) return prev;
      return {
        ...prev,
        [annotationId]: {
          ...(existing || {}),
          note: nextNote
        }
      };
    });
  }, [setSurveyMarkers]);

  const renderSurveyMarkerNotes = (annotationId, variant) => (
    <SurveyMarkerNotes
      key={annotationId}
      variant={variant}
      note={surveyMarkers?.[annotationId]?.note}
      markerId={annotationId}
      documentId={pdfFile?.id || null}
      canEdit={canEditSurveyMarkers !== false}
      onUpdateNote={(updater, options) => updateSurveyMarkerNote(annotationId, updater, options)}
      autoFocusNote={noteFocusRequestId === annotationId}
      onAutoFocused={clearNoteFocusRequest}
    />
  );

  // Item-row badges, shared by the phone and the desktop rows: checklist
  // progress ("2/3" answered of the category's active items) and whether the
  // Survey Marker has a note and how many photos / videos it carries.
  const getSurveyMarkerProgress = (annotationId, category) => {
    const active = (category?.checklist || []).filter((item) => item && item.archived !== true);
    const responses = surveyMarkers?.[annotationId]?.checklistResponses || {};
    const answered = active.filter((item) => Boolean(responses[item.id]?.selection)).length;
    const no = active.filter((item) => responses[item.id]?.selection === 'N').length;
    return { answered, total: active.length, no };
  };
  // The "answered/total" count. Owner 2026-10-01 (after a design debate):
  // green with a check only when every item is answered Y or N/A (the same
  // rule that marks the PDF marker Complete); red as soon as any item is N,
  // finished or not; grey otherwise. The check keeps "done" readable without
  // telling red from green.
  const renderSurveyMarkerProgress = ({ answered, total, no }) => {
    const done = total > 0 && answered === total && no === 0;
    const state = no > 0 ? ' is-no' : done ? ' is-done' : '';
    const label = done
      ? `All ${total} checklist items answered, complete`
      : `${answered} of ${total} checklist items answered${no > 0 ? `, ${no} answered No` : ''}`;
    return (
      <span className={`survey-marker-progress${state}`} aria-label={label} title={label}>
        {done ? <Icon name="check" size={12} color="currentColor" /> : null}
        {answered}/{total}
      </span>
    );
  };
  const getSurveyMarkerNoteInfo = (annotationId) => {
    const note = surveyMarkers?.[annotationId]?.note || {};
    // Every photo, video and audio clip: stored refs (note.media) and any
    // legacy inline photos / videos.
    const mediaCount = normalizeNoteMedia(note).length;
    return { text: typeof note.text === 'string' ? note.text.trim() : '', mediaCount };
  };
  const renderSurveyMarkerBadges = (annotationId, category, className) => {
    const progress = getSurveyMarkerProgress(annotationId, category);
    const { total } = progress;
    const { text, mediaCount } = getSurveyMarkerNoteInfo(annotationId);
    return (
      <span className={className}>
        {text ? (
          <span className="survey-marker-badge" aria-label="Has a note">
            <Icon name="note" size={12} color="currentColor" />
          </span>
        ) : null}
        {mediaCount > 0 ? (
          <span className="survey-marker-badge" aria-label={`${mediaCount} media attachment${mediaCount === 1 ? '' : 's'}`}>
            <Icon name="image" size={12} color="currentColor" />
            <span>{mediaCount}</span>
          </span>
        ) : null}
        {total > 0 ? renderSurveyMarkerProgress(progress) : null}
      </span>
    );
  };

  // Phone: the open Survey Marker, inline in the accordion (owner 2026-10-01,
  // replaces the separate detail view). Second pass (owner: "I don't like the
  // header being two lines... the item name with Locate, and underneath the
  // entity dropdown"): the open marker REPLACES its row with ONE line -
  //   [entity dot = the entity menu] [name field] [Locate] [close chevron]
  // - the desktop rail's line at phone size. The entity's full name is in its
  // menu (wrapped, never cut) and the button's label; the dot keeps its colour.
  // Locate: a target when the marker is on the page, an orange pin-plus when
  // it is not ("Not on the page - tap to place").
  const renderMobileOpenSurveyMarker = (surveyMarker, category, markerName, fallbackName, onClose) => {
    const annotationId = surveyMarker.id;
    const markerModuleId = surveyMarker.moduleId || selectedModuleId;
    const { moduleData } = findMarkerMatchingItem(annotationId, markerModuleId, category);
    const currentEntityId = moduleData.entityId || surveyMarkers[annotationId]?.entityId;
    const currentEntity = currentEntityId ? entitiesMap.get(currentEntityId) : null;
    const entityColor = currentEntity?.color || moduleData.entityColor || surveyMarkers[annotationId]?.entityColor || null;
    const entityName = currentEntity?.name || moduleData.entityName || surveyMarkers[annotationId]?.entityName || 'None';
    const entityOptions = [
      { id: '', name: 'None', color: null },
      ...((selectedTemplate?.entities || []).map(entity => ({ id: entity.id, name: entity.name, color: entity.color })))
    ];
    const checklist = (category?.checklist || []).filter((item) => item && item.archived !== true);
    const isPlaced = Boolean(surveyMarker.bounds && surveyMarker.pageNumber);
    const hasEntity = Boolean(currentEntityId || entityName !== 'None');

    return (
      <div className="mobile-survey-open" data-testid="mobile-survey-open-marker">
        <div className="mobile-survey-open-tools mobile-survey-detail-dropdown-wrap">
          <button
            type="button"
            className={`mobile-survey-entity-chip${hasEntity ? '' : ' is-empty'}`}
            aria-label={`Entity: ${hasEntity ? entityName : 'none'}. Choose Survey Marker entity`}
            aria-haspopup="listbox"
            aria-expanded={mobileDetailDropdown === 'entity'}
            onClick={() => setMobileDetailDropdown(prev => (prev === 'entity' ? null : 'entity'))}
          >
            <span
              className="mobile-survey-detail-entity-dot"
              style={{
                background: entityColor || 'transparent',
                borderColor: entityColor ? 'var(--ink-ring-strong)' : 'var(--text-3)'
              }}
            />
            <Icon name="chevronDown" size={12} color="currentColor" />
          </button>
          <div className="mobile-survey-detail-name-wrap">
            <input
              type="text"
              className="mobile-survey-detail-name"
              defaultValue={markerName}
              key={`${annotationId}:${markerName}`}
              aria-label={`Rename ${markerName}`}
              placeholder="Name"
              onFocus={() => setMobileDetailDropdown(null)}
              onBlur={(e) => {
                const nextName = (e.currentTarget.value || '').trim() || fallbackName;
                e.currentTarget.value = nextName;
                commitSurveyMarkerName(annotationId, surveyMarker.categoryId, markerName, nextName, fallbackName);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.currentTarget.value = markerName;
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
          <button
            type="button"
            className={`mobile-survey-locate${isPlaced ? '' : ' is-unplaced'}`}
            data-testid={isPlaced ? undefined : 'survey-marker-unplaced-tag'}
            aria-label={isPlaced ? 'Locate on page' : 'Not on the page. Place on page'}
            title={isPlaced ? 'Locate on page' : 'Not on the page \u2014 tap to place'}
            onClick={() => {
              if (isPlaced) {
                // Survey audit P1-5: lower the sheet to its standard height so
                // the page shows above it; the viewer then fits the marker in
                // that visible strip (PDFViewer handleLocateItemOnPDF).
                setSurveySheetDetent(SHEET_DETENT_STANDARD);
                handleLocateItemOnPDF(surveyMarker);
              } else {
                setPendingLocationItem(surveyMarker);
              }
            }}
          >
            <Icon name={isPlaced ? 'locate' : 'pinPlus'} size={18} color="currentColor" />
          </button>
          <button
            type="button"
            className="mobile-survey-open-close"
            aria-label={`Close ${markerName}`}
            aria-expanded="true"
            onClick={onClose}
          >
            <Icon name="chevronDown" size={14} color="currentColor" />
          </button>
          {mobileDetailDropdown === 'entity' && (
            <div className="mobile-survey-detail-menu mobile-survey-detail-entity-menu" role="listbox" aria-label="Entity">
              {entityOptions.map(option => {
                const isSelectedOption = (currentEntityId || '') === (option.id || '');
                return (
                  <button
                    key={option.id || 'none'}
                    type="button"
                    role="option"
                    aria-selected={isSelectedOption}
                    className={isSelectedOption ? 'is-active' : ''}
                    onClick={() => {
                      applyEntitySelectionForMarker(annotationId, markerModuleId, category, option.id);
                      setMobileDetailDropdown(null);
                    }}
                  >
                    <span
                      className="mobile-survey-detail-entity-dot"
                      style={{
                        background: option.color || 'transparent',
                        // UX: a USER colour gets the shared ink ring, no colour
                        // gets ordinary chrome.
                        borderColor: option.color ? 'var(--ink-ring-strong)' : 'var(--border-strong)'
                      }}
                    />
                    <span>{option.name}</span>
                    <span className="mobile-survey-detail-check" aria-hidden="true">
                      {isSelectedOption ? <Icon name="check" size={14} color="currentColor" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* The whole checklist, every row - no 4-row window scrolling inside
            a sheet that also scrolls. */}
        <div className="mobile-survey-detail-checklist">
          {checklist.length ? checklist.map(item => {
            const response = surveyMarkers[annotationId]?.checklistResponses?.[item.id]?.selection;
            return (
              <div key={item.id} className="mobile-survey-check-item">
                <span className="mobile-survey-check-text">{item.text}</span>
                <div className="mobile-survey-check-group">
                  {['Y', 'N', 'N/A'].map(option => (
                    <button
                      key={option}
                      type="button"
                      className={`mobile-survey-check-btn${response === option ? ` is-active is-${option === 'Y' ? 'yes' : option === 'N' ? 'no' : 'na'}` : ''}`}
                      aria-pressed={response === option}
                      aria-label={`${item.text} ${option}`}
                      onClick={() => applyChecklistResponseSelection(annotationId, markerModuleId, category, surveyMarker.name || '', item.id, option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            );
          }) : (
            <div className="mobile-survey-detail-empty">No checklist items</div>
          )}
        </div>

        {/* NOTES / MEDIA SLOT: the note edited in place and the media strip
            (audit chunk B, owner 2026-10-01) - the same block the desktop
            row shows. */}
        <div className="mobile-survey-open-notes" data-slot="survey-notes-media">
          {renderSurveyMarkerNotes(annotationId, 'phone')}
        </div>
      </div>
    );
  };

  const toggleSurveyMarkerExpanded = (annotationId) => {
    if (!annotationId) return;
    setExpandedSurveyMarkers(prev => ({
      ...prev,
      [annotationId]: !prev[annotationId]
    }));
  };

  const getEntitySwatchStyle = (color) => {
    const exactColor = color || null;
    return {
      backgroundColor: '#fff',
      // UX: when the swatch carries a colour the USER picked, its hairline is
      // the shared ink ring — a neutral border would let a near-black entity
      // colour vanish. With no colour chosen it is ordinary chrome and takes
      // the identifying border instead.
      borderColor: exactColor ? 'var(--ink-ring-strong)' : 'var(--border-strong)',
      '--survey-marker-entity-swatch-color': exactColor || 'transparent'
    };
  };

  const restoreSurveyMarkerAfterDrag = useCallback((delayMs = 180) => {
    const restoreState = surveyMarkerDragRestoreRef.current;
    if (!restoreState?.annotationId) return;

    if (restoreState.fallbackTimer) {
      clearTimeout(restoreState.fallbackTimer);
    }
    if (restoreState.restoreTimer) {
      clearTimeout(restoreState.restoreTimer);
    }

    restoreState.restoreTimer = setTimeout(() => {
      const latestRestoreState = surveyMarkerDragRestoreRef.current;
      const annotationId = latestRestoreState?.annotationId;
      if (annotationId) {
        setExpandedSurveyMarkers(prev => (
          prev[annotationId] ? prev : { ...prev, [annotationId]: true }
        ));
      }
      surveyMarkerDragRestoreRef.current = null;
    }, delayMs);
  }, [setExpandedSurveyMarkers]);

  useEffect(() => () => {
    const restoreState = surveyMarkerDragRestoreRef.current;
    if (restoreState?.fallbackTimer) clearTimeout(restoreState.fallbackTimer);
    if (restoreState?.restoreTimer) clearTimeout(restoreState.restoreTimer);
  }, []);

  const markSurveyMarkerDragStarted = useCallback(() => {
    const restoreState = surveyMarkerDragRestoreRef.current;
    if (!restoreState) return;
    restoreState.dragStarted = true;
    if (restoreState.fallbackTimer) {
      clearTimeout(restoreState.fallbackTimer);
      restoreState.fallbackTimer = null;
    }
  }, []);

  const collapseSurveyMarkerBeforeDrag = useCallback((annotationId, { restoreAfterDrag = false } = {}) => {
    if (!annotationId) return;

    if (restoreAfterDrag) {
      const existingRestoreState = surveyMarkerDragRestoreRef.current;
      if (existingRestoreState?.fallbackTimer) clearTimeout(existingRestoreState.fallbackTimer);
      if (existingRestoreState?.restoreTimer) clearTimeout(existingRestoreState.restoreTimer);
      surveyMarkerDragRestoreRef.current = {
        annotationId,
        dragStarted: false,
        fallbackTimer: setTimeout(() => {
          const restoreState = surveyMarkerDragRestoreRef.current;
          if (restoreState?.annotationId === annotationId && !restoreState.dragStarted) {
            restoreSurveyMarkerAfterDrag(0);
          }
        }, 650),
        restoreTimer: null,
      };
    }

    setOpenEntityDropdownId(prev => (
      prev === `${annotationId}:entity` ? null : prev
    ));
    setExpandedSurveyMarkers(prev => {
      if (!prev[annotationId]) return prev;
      return {
        ...prev,
        [annotationId]: false
      };
    });
  }, [restoreSurveyMarkerAfterDrag, setExpandedSurveyMarkers]);

  const reorderSurveyMarkersInCategory = useCallback((orderedMarkers, activeId, overId) => {
    if (!Array.isArray(orderedMarkers) || !overId || activeId === overId) return;

    const reorderedMarkers = moveItemById(orderedMarkers, activeId, overId);
    if (reorderedMarkers === orderedMarkers) return;

    setSurveyMarkers(prev => {
      let changed = false;
      const next = { ...prev };

      reorderedMarkers.forEach((marker, index) => {
        const markerId = marker.id;
        const existing = next[markerId];
        if (!existing) return;

        const nextOrder = index + 1;
        if (existing.surveyMarkerOrder !== nextOrder) {
          next[markerId] = {
            ...existing,
            surveyMarkerOrder: nextOrder
          };
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [setSurveyMarkers]);

  return (
          <>
            {mobileMode && !isSurveyPanelCollapsed && (
              <button
                type="button"
                className="mobile-pdf-sheet-backdrop"
                aria-label="Close Survey panel"
                // Slide down like a swipe, then collapse (owner 2026-09-30:
                // a tap outside is how a phone sheet closes).
                onClick={() => requestSurveySheetClose()}
                style={surveyBackdropStyle}
              />
            )}
            {/* Panel */}
            {/* UX 2026-05-29: the right rail starts at the same y-coordinate as
                chrome-sub-toolbar-host. It overlays the right edge of that strip
                instead of pushing or sitting below it, mirroring the left rail's
                top collapse row. */}
            <div
              // Survey audit P1-5: the phone sheet is a bottom occluder (as the
              // phone Pages sheet is), so "Locate on page" fits the marker in
              // the page left above it.
              ref={mobileMode ? undefined : sideOccluderRef}
              data-viewer-occluder={isSurveyPanelCollapsed ? undefined : (mobileMode ? 'sheet' : 'side')}
              // Phone: swipe down anywhere + the keyboard lift (owner 2026-09-30).
              {...(mobileMode ? surveySheetProps : null)}
              className={`${mobileMode ? 'mobile-pdf-sheet mobile-survey-sheet ' : 'survey-rail '}${mobileMode && surveySheetExpanded ? 'is-expanded ' : ''}${mobileMode && surveySheetFullscreen ? 'is-fullscreen ' : ''}${isSurveyPanelCollapsed ? 'is-collapsed' : ''}`}
              style={{
                // PASS 7 (DESIGN-SYSTEM.md, owner): every phone panel opens at
                // Standard - 448px plus the bottom safe area - so the tray does
                // not change height as you move between Pages, Search, Spaces and
                // Survey. This panel used to measure its own content instead (154
                // plus 48 a template, 392 with one chosen, 314 plus the checklist
                // window in detail), which made it the odd one out AND made it
                // resize under your finger as you moved through it. The token is
                // --mobile-panel-standard, and .mobile-pdf-sheet already falls
                // back to it, so nothing is set here: leaving --mobile-sheet-height
                // unset is what lets .is-expanded and .is-fullscreen set it on a
                // pull-up, which an inline value would have outranked.
                position: mobileMode ? 'fixed' : 'absolute',
                top: mobileMode ? 'auto' : 0,
                right: 0,
                bottom: mobileMode ? 0 : 'auto',
                left: mobileMode ? 0 : 'auto',
                height: mobileMode ? 'var(--mobile-sheet-height, var(--mobile-panel-standard))' : '100%',
                width: mobileMode ? '100%' : (isSurveyPanelCollapsed ? '48px' : '320px'),
                background: 'var(--surface-1)',
                borderLeft: mobileMode ? 'none' : '1px solid var(--border)',
                zIndex: mobileMode ? 6500 : 1,
                display: 'flex',
                flexDirection: 'column',
                // 2026-09-17: the desktop rail keeps its horizontal slide-in; on
                // phone the sheet rises from the bottom, so a right-edge
                // keyframe here would fight useMobileSheetMotion's transform.
                // 2026-09-30 (owner: expand/collapse not smooth, the footer
                // stretched ahead of the panel): the width is no longer
                // transitioned, which re-laid-out every row of the panel on
                // every frame. Expanding lays the panel out ONCE at 320px and
                // slides it in with a transform (surveyRailExpand); collapsing
                // shrinks only the light collapsed strip (surveyRailCollapse).
                // Both are 0.2s ease like the old transition, end in an
                // animationend the viewer's side-room measure listens for, and
                // are off under prefers-reduced-motion (styles.css). The rail
                // footer's expanded row lives INSIDE this panel (AppShell
                // portals it here), so it moves with it frame for frame.
                animation: mobileMode
                  ? 'none'
                  : (railToggledRef.current
                    ? (isSurveyPanelCollapsed ? 'surveyRailCollapse 0.2s ease' : 'surveyRailExpand 0.2s ease')
                    : 'slideInRight 0.3s ease-out'),
                // Phone: the sheet hook's resize glide owns every height
                // change (2026-10-01), so no CSS height leg to fight it.
                transition: mobileMode ? 'none' : 'right 0.2s ease, top 0.2s ease, height 0.2s ease',
                // Phase F: finger-follow / spring-back / slide-down exit, plus
                // (2026-09-17) the slide-up entrance — one transform timeline.
                ...(mobileMode ? surveySheetMotionStyle : null)
              }}
            >
              {/* Collapsed strip — Survey icon only, with a hover tooltip.
                  Mirrors the left rail's collapsed button metrics while keeping
                  Survey in its own persistent right-side home. */}
              {isSurveyPanelCollapsed && (
                <>
                  <div className={mobileMode ? 'mobile-survey-sheet-header' : undefined} style={{
                    height: '35px',
                    padding: '0 8px',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    // UX 2026-09-16: the collapsed rail is one icon column, so
                    // its top toggle sits on the same centre line as Survey,
                    // zoom, the page steppers and Fit below it. Left-aligning
                    // it to the rail's padding edge left it 3px off-axis.
                    justifyContent: mobileMode ? 'flex-start' : 'center',
                    background: 'var(--surface-1)',
                    flexShrink: 0
                  }}>
                    <button
                      onClick={() => {
                        setIsSurveyPanelCollapsed(false);
                        requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
                      }}
                      aria-label="Expand Survey panel"
                      {...tip('Expand Survey panel', 'left')}
                      // UX 2026-09-16 (desktop sweep): the shared rail control box
                      // and glyph. It was a 16px chevron in a padding-derived 24px
                      // box, so the top of the rail carried a glyph size nothing
                      // else in the column used. The box measures the same 24 as
                      // before, so the strip's 35px height and the rail's centre
                      // line are unchanged — nothing moves.
                      /* UX 2026-09-22 (desktop critic round): a resting chrome
                         icon is --text-2 on every rail and on the top bar — see
                         the note on the left rail's tabs in PDFSidebar.jsx.
                         The box radius is the house 6, not a rail-only 4. */
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', cursor: 'pointer', ...(mobileMode ? { padding: '4px' } : { padding: 0, width: `${RAIL_CONTROL}px`, height: `${RAIL_CONTROL}px` }), borderRadius: 'var(--chrome-radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; tip('Expand Survey panel', 'left').onMouseEnter(e); }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; tip('Expand Survey panel', 'left').onMouseLeave(e); }}
                    >
                      <Icon name="chevronLeft" size={mobileMode ? 16 : RAIL_CONTROL_GLYPH} color="var(--text-2)" />
                    </button>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '8px',
                    gap: '4px',
                    background: 'var(--surface-1)',
                    position: 'relative',
                    flex: 1
                  }}>
                    <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                      <button
                        onClick={() => {
                          setRailIconHover(null);
                          if (showSurveyPanel) {
                            setIsSurveyPanelCollapsed(false);
                          } else {
                            setIsSurveyPanelCollapsed(false);
                            handleSurveyToggle();
                          }
                          requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
                        }}
                        aria-label="Survey"
                        {...tip('Survey', 'left')}
                        // UX 2026-09-16 (desktop sweep): the Survey tab is a rail
                        // TAB, so it takes the rail tab glyph (18) like Pages,
                        // Search, Bookmarks and Spaces in the left rail — it was
                        // the one 20 in either rail. The padding is split 11/6 the
                        // way the left rail's tabs are, which keeps the button the
                        // same 40px tall around the smaller glyph: 18 + 22 = 40,
                        // exactly what 20 + 20 came to. Nothing moves.
                        style={{
                          background: 'transparent',
                          border: 'none',
                          /* UX 2026-09-22: resting chrome icon = --text-2, one
                             grey across both rails and the top bar. */
                          color: showSurveyPanel ? 'var(--accent)' : 'var(--text-2)',
                          cursor: 'pointer',
                          padding: '11px 6px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background 0.15s',
                          minWidth: '28px',
                          minHeight: '28px',
                          width: '100%'
                        }}
                        onMouseEnter={(e) => {
                          // UX: use the shared rail hint, including press dismissal.
                          tip('Survey', 'left').onMouseEnter(e);
                          e.currentTarget.style.background = 'var(--hover)';
                        }}
                        onMouseLeave={(e) => {
                          tip('Survey', 'left').onMouseLeave(e);
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <Icon
                          name="survey"
                          size={RAIL_GLYPH}
                          color="currentColor"
                          style={{ width: `${RAIL_GLYPH}px`, height: `${RAIL_GLYPH}px`, flexShrink: 0 }}
                        />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {!isSurveyPanelCollapsed && (
                <>
                  {/* Collapse row: mirrors the left rail's top strip. */}
                  <div
                    className={mobileMode ? 'mobile-pdf-sheet__handle mobile-pdf-sheet__handle--wide' : undefined}
                    style={{
                      height: '35px',
                      padding: '0 8px',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      background: 'var(--surface-1)',
                      flexShrink: 0
                    }}
                  >
                    <button
                      onClick={() => {
                        // Phase F: mobile collapse slides the sheet down first;
                        // desktop collapses immediately (no bottom-sheet motion).
                        if (mobileMode) {
                          requestSurveySheetClose();
                          return;
                        }
                        setIsSurveyPanelCollapsed(true);
                        requestAnimationFrame(() => {
                          applyLayoutDrivenZoom();
                        });
                      }}
                      aria-label="Collapse Survey panel"
                      // UX 2026-09-16 (desktop sweep): the shared rail control box
                      // and glyph, the same as its twin "Expand Survey panel" — it
                      // is the same control in the other state, so it cannot be a
                      // different size. The phone keeps its own 16px sheet handle
                      // chevron; mobile sizing is not this pass's lane.
                      style={{
                        background: 'transparent',
                        border: 'none',
                        /* UX 2026-09-22: was a raw rgb(153,153,153) — the one
                           chrome icon in the app painting a hand-typed grey.
                           It is the Expand chevron's twin, so it takes the same
                           resting token and the same house radius. */
                        color: 'var(--text-2)',
                        cursor: 'pointer',
                        ...(mobileMode
                          ? { padding: '4px' }
                          : { padding: 0, width: `${RAIL_CONTROL}px`, height: `${RAIL_CONTROL}px` }),
                        borderRadius: 'var(--chrome-radius)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Icon name={mobileMode ? 'chevronDown' : 'chevronRight'} size={mobileMode ? 16 : RAIL_CONTROL_GLYPH} color="var(--text-2)" />
                    </button>
                  </div>

                  {selectedTemplate && showSurveyPanel ? (
                  <>
                  {/* Template title lives below the rail tabs, not in the collapse row.
                      UX 2026-09-23 (owner: phone Survey panel integrated): on the
                      phone this is ONE slim 44px line - the template name as its
                      own switcher, then Exit Survey as a quiet red word, the
                      export glyph and the close glyph. The "SURVEY TEMPLATE"
                      eyebrow and the round plated buttons are gone, and Exit
                      Survey no longer takes a whole footer band.
                      UX 2026-09-23 (owner: desktop survey polish): desktop is one
                      40px line too, the Bookmarks / Spaces header - the template
                      name as a 13px title, then "Export" as a quiet glyph-and-word
                      (with a small caret for the linked workbook's actions) and the
                      close glyph. The 18px title and the gold EXPORT box are gone. */}
                  {/* Owner 2026-10-01 (template switcher, "hybrid" design):
                      - Phone, category list: the template name IS the sheet title,
                        a button with a bare chevron (no disc). A tap swaps the
                        category list for the list of templates (.is-switching):
                        the chevron turns up, Export gives its place to a quiet
                        Cancel.
                      - Phone, a category open (Full screen): "< Categories" stands
                        ALONE on the line (owner: "the back button must not be
                        inline with the template dropdown"); the template name is
                        not shown at that level.
                      - Desktop: the 13px rail title is a menu button; its menu
                        lists the templates (28px rows, the current one checked).
                        In category-select mode the title is the module's name and
                        the button is disabled. */}
                  <div className={mobileMode ? `mobile-survey-head${mobileAccordionOpen ? ' is-drilled' : ''}${isMobileTemplateSwitching ? ' is-switching' : ''}` : 'survey-rail__head'}>
                    {/* Phone, Full screen (owner 2026-10-01): the way back. Closes
                        everything in the accordion, which also returns the sheet
                        to Standard height. */}
                    {mobileMode && mobileAccordionOpen && (
                      <button
                        type="button"
                        className="mobile-survey-back"
                        aria-label="Back to categories"
                        onClick={collapseMobileAccordion}
                      >
                        <Icon name="chevronLeft" size={20} color="currentColor" />
                        <span>Categories</span>
                      </button>
                    )}
                    <div
                      ref={mobileMode ? undefined : templateSelectorRef}
                      className={mobileMode ? 'mobile-survey-head-title' : undefined}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {mobileMode ? (
                        !mobileAccordionOpen && (
                          <button
                            type="button"
                            ref={templateTitleButtonRef}
                            className="mobile-survey-template-button"
                            aria-label={`Template: ${selectedTemplate.name || 'Survey'}. Switch template`}
                            aria-expanded={isMobileTemplateSwitching}
                            aria-controls="survey-template-list"
                            onClick={() => {
                              if (isMobileTemplateSwitching) closeTemplateSwitcher();
                              else setIsTemplateSelectorOpen(true);
                            }}
                          >
                            <span>{selectedTemplate.name || 'Survey'}</span>
                            <Icon name="chevronDown" size={14} color="currentColor" />
                          </button>
                        )
                      ) : (
                        <h2 className="survey-rail__title">
                          <button
                            type="button"
                            ref={templateTitleButtonRef}
                            className="survey-rail__title-button"
                            aria-haspopup="menu"
                            aria-expanded={isTemplateSelectorOpen}
                            aria-controls={isTemplateSelectorOpen ? 'survey-rail-template-menu' : undefined}
                            aria-label={categorySelectModeActive
                              ? undefined
                              : `Template: ${selectedTemplate.name || 'Survey'}. Switch template`}
                            disabled={categorySelectModeActive}
                            onClick={() => {
                              if (isTemplateSelectorOpen) closeTemplateSwitcher({ focusTitle: false });
                              else setIsTemplateSelectorOpen(true);
                            }}
                          >
                            <span>
                              {categorySelectModeActive && selectedModuleId
                                ? ((selectedTemplate.modules || selectedTemplate.spaces || []).find(m => m.id === selectedModuleId)?.name || 'Survey')
                                : (selectedTemplate.name || 'Survey')}
                            </span>
                            {!categorySelectModeActive && <Icon name="chevronDown" size={10} color="currentColor" />}
                          </button>
                        </h2>
                      )}
                      {!mobileMode && isTemplateSelectorOpen && (
                        <div
                          id="survey-rail-template-menu"
                          ref={templateSwitchListRef}
                          className="survey-rail__template-menu"
                          role="menu"
                          aria-label="Switch template"
                          onKeyDown={handleTemplateMenuKeyDown}
                        >
                          {availableSurveyTemplates.map((template) => {
                            const isCurrent = template.id === selectedTemplate.id;
                            const moduleCount = ((template.modules || template.spaces) || []).length;
                            return (
                              <button
                                key={template.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={isCurrent}
                                tabIndex={isCurrent ? 0 : -1}
                                className="survey-rail__menu-item survey-rail__template-option"
                                onClick={() => switchSurveyTemplate(template)}
                              >
                                <span className="survey-rail__template-option-name">{template.name || 'Untitled template'}</span>
                                <span className="survey-rail__template-option-meta">{moduleCount} module{moduleCount === 1 ? '' : 's'}</span>
                                <span className="survey-rail__template-option-check" aria-hidden="true">
                                  {isCurrent ? <Icon name="check" size={12} color="currentColor" /> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {mobileMode && !categorySelectModeActive && selectedTemplate.linkedExcelPath && lastSyncMessage && (() => {
                        // Color the banner by the message's tone so warnings (close Excel,
                        // needs your choice, queued) and successes (synced/saved) no longer
                        // look identical to neutral info. See services/excelSyncStatus.
                        const tone = syncMessagePresentation(lastSyncMessage);
                        return (
                          <div style={{
                            marginTop: '6px',
                            fontSize: '11px',
                            color: tone.color,
                            padding: '4px 8px',
                            background: tone.background,
                            borderRadius: '4px',
                            border: tone.border
                          }}>
                            {lastSyncMessage}
                          </div>
                        );
                      })()}
                    </div>
                    {/* Spaces chunk B: the space new Survey Markers are tagged with. */}
                    {activeSpaceId && (spaces || []).some((s) => s?.id === activeSpaceId) && (
                      <span className="survey-active-space">{(spaces || []).find((s) => s?.id === activeSpaceId)?.name || 'Space'}</span>
                    )}
                    <div className={mobileMode ? 'mobile-survey-head-actions' : 'survey-rail__head-actions'}>
                      {/* Owner 2026-10-01: ONE Exit. The survey bar above the page
                          has it, so the sheet no longer repeats it as a red word. */}
                      {/* UX (mobile demo parity): 34px round export button in the sheet
                          header opening a 218px menu with 48px rows (demo
                          SurveySheet.tsx:324-348, styles.ts:2731-2775; accent gold, not
                          demo blue). Wires the SAME handlers as the desktop bottom
                          export bar: "Export Excel" = handleExportSurveyToExcel(),
                          "Sync Microsoft 365" = push to the linked workbook. */}
                      {/* Phone, choosing a template: Export steps aside for a quiet
                          Cancel (the Spaces sheet's action word, never gold). A tap
                          on a template is what switches; Cancel only leaves. */}
                      {isMobileTemplateSwitching && (
                        <button
                          type="button"
                          className="mobile-survey-cancel"
                          onClick={() => closeTemplateSwitcher()}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (mobileMode) {
                            setIsSurveyPanelCollapsed(true);
                            requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
                          } else {
                            exitSurveyMode();
                          }
                        }}
                        className={mobileMode ? 'mobile-survey-close' : 'survey-rail__head-btn survey-rail__head-btn--glyph'}
                        aria-label="Close Survey panel"
                        {...(mobileMode ? {} : tip('Exit Survey', 'below'))}
                      >
                        <Icon name="close" size={mobileMode ? 18 : 16} color="currentColor" />
                      </button>
                    </div>
                  </div>
                  {/* Desktop: the Excel sync status is one quiet line under the
                      header in its tone's colour (it was a tinted box inside it). */}
                  {!mobileMode && !categorySelectModeActive && selectedTemplate.linkedExcelPath && lastSyncMessage && (
                    <div className="survey-rail__sync" style={{ color: syncMessagePresentation(lastSyncMessage).color }}>
                      {lastSyncMessage}
                    </div>
                  )}

                  {/* UX 2026-09-23 (owner: phone Survey panel integrated, "layout B -
                      one card, divided"): on the phone everything under the header -
                      the module tabs, the categories and their Survey Markers, or a
                      Survey Marker's detail - sits in ONE rounded lighter panel whose
                      rows are parted by hairlines that reach both edges, the same
                      object as the home Documents, Projects and Templates lists. No
                      card per row. On desktop this wrapper is display: contents, so
                      the rail's layout is exactly what it was. */}
                  {/* Phone, choosing a template (owner 2026-10-01, "hybrid"):
                      the templates take the category list's place in the sheet -
                      the entry picker's own rows, with a check column; the current
                      one is gold ink with a check. A tap switches and lands on
                      the new template's category list. A filter field only from
                      15 templates. The sheet keeps its height. */}
                  {isMobileTemplateSwitching && (() => {
                    const query = templateSwitchQuery.trim().toLowerCase();
                    const showSearch = availableSurveyTemplates.length >= 15;
                    const shown = showSearch && query
                      ? availableSurveyTemplates.filter((template) => (template.name || 'Untitled template').toLowerCase().includes(query))
                      : availableSurveyTemplates;
                    return (
                      <div className="mobile-survey-picker-body mobile-survey-switch">
                        {showSearch && (
                          <label className="mobile-survey-switch-search">
                            <Icon name="search" size={14} color="currentColor" />
                            <input
                              type="search"
                              placeholder="Find a template"
                              aria-label="Find a template"
                              value={templateSwitchQuery}
                              onChange={(event) => setTemplateSwitchQuery(event.target.value)}
                            />
                          </label>
                        )}
                        <div
                          id="survey-template-list"
                          ref={templateSwitchListRef}
                          className="mobile-survey-card mobile-survey-template-list mobile-survey-switch-list"
                          role="group"
                          aria-label="Switch template"
                        >
                          {shown.length === 0 ? (
                            <div className="mobile-survey-switch-empty">No templates match</div>
                          ) : shown.map((template) => {
                            const isCurrent = template.id === selectedTemplate.id;
                            const moduleCount = ((template.modules || template.spaces) || []).length;
                            return (
                              <button
                                key={template.id}
                                type="button"
                                className="mobile-survey-template-row"
                                aria-current={isCurrent ? 'true' : undefined}
                                onClick={() => switchSurveyTemplate(template)}
                              >
                                <span className="mobile-survey-template-name">{template.name || 'Untitled template'}</span>
                                <span className="mobile-survey-template-meta">
                                  {moduleCount} module{moduleCount === 1 ? '' : 's'}
                                </span>
                                <span className="mobile-survey-switch-check" aria-hidden="true">
                                  {isCurrent ? <Icon name="check" size={16} color="currentColor" /> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  <div
                    className={mobileMode ? 'mobile-survey-card' : undefined}
                    style={mobileMode ? undefined : { display: 'contents' }}
                    hidden={isMobileTemplateSwitching || undefined}
                  >
                  {/* Module navigator. Phone: a row of module TABS pinned to the top
                      of the panel (active = bright ink with a 2px ink bar, the home
                      template editor's tabs; no gold) instead of the old boxed
                      prev / pill / next navigator. Same selectSurveyModule handler. */}
                  {/* UX 2026-09-23 (owner: desktop survey polish): desktop takes the
                      phone's module TABS too, sized for the rail (32px, 12px words,
                      active = bright ink with a 2px ink bar; no gold) instead of the
                      boxed prev / gold-edged pill / next navigator. Same
                      selectSurveyModule handler; the tab row scrolls sideways when a
                      template has more modules than fit. */}
                  {surveyModuleOptions.length > 0 && (
                    <div className={mobileMode ? 'mobile-survey-module-tabs' : 'survey-rail__tabs'} role="tablist" aria-label="Modules">
                      {surveyModuleOptions.map((module) => {
                        const isActive = module.id === selectedModuleId;
                        return (
                          <button
                            key={module.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={isActive ? 'is-active' : undefined}
                            onClick={(event) => {
                              // Bring a half-hidden tab into the row by scrolling
                              // the ROW sideways only. scrollIntoView also scrolls
                              // every ancestor that can scroll - including the
                              // phone sheet, which is overflow: hidden, so a
                              // nudge there could never be scrolled back and left
                              // the panel's rows offset under the tabs (owner
                              // 2026-10-01, "elements are colliding").
                              const tab = event.currentTarget;
                              const row = tab.parentElement;
                              if (row) {
                                const tabBox = tab.getBoundingClientRect();
                                const rowBox = row.getBoundingClientRect();
                                if (tabBox.left < rowBox.left) row.scrollLeft -= rowBox.left - tabBox.left;
                                else if (tabBox.right > rowBox.right) row.scrollLeft += tabBox.right - rowBox.right;
                              }
                              selectSurveyModule(module.id);
                            }}
                          >
                            <span>{module.name || 'Untitled module'}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* KAL-292 — rows the linked Excel sent that couldn't be matched to a
                      Survey Marker. Sits above the panel content and collapses to nothing
                      when there are none. */}
                  <ExcelUnplacedRows
                    rows={surveyUnplacedRows?.rows}
                    batchTitle={surveyUnplacedRows?.batchTitle}
                    batchNotice={surveyUnplacedRows?.batchNotice}
                    onDismiss={onDismissUnplacedRow}
                    onDismissAll={onDismissAllUnplacedRows}
                  />

                  {/* Panel content. Phone and desktop are the same tree (owner
                      2026-10-01): categories, their Survey Markers, and the open
                      Survey Marker inline - the phone's separate detail view is gone. */}
                  <div
                    ref={mobileMode ? mobileSurveyListRef : undefined}
                    className={mobileMode ? 'mobile-survey-list' : 'survey-rail__list'}
                    style={mobileMode ? undefined : { fontFamily: FONT_FAMILY }}
                    onScroll={mobileMode ? (event) => {
                      mobileListScrollRef.current = { top: event.currentTarget.scrollTop, key: mobileAccordionKey };
                    } : undefined}
                  >
                    {selectedModuleId ? (() => {
                      const module = (selectedTemplate.modules || selectedTemplate.spaces || [])?.find(m => m.id === selectedModuleId);
                      if (!module) return null;

                      // Get surveyMarkers for this module, grouped by category
                      const surveyMarkersByCategory = {};
                      Object.entries(surveyMarkers).forEach(([annotationId, surveyMarker]) => {
                        const surveyMarkerModuleId = surveyMarker.moduleId;
                        if (surveyMarkerModuleId === selectedModuleId && surveyMarker.categoryId) {
                          if (!surveyMarkersByCategory[surveyMarker.categoryId]) {
                            surveyMarkersByCategory[surveyMarker.categoryId] = [];
                          }
                          // IMPORTANT: Always use the key from surveyMarkers as the authoritative ID
                          // This ensures consistency when selecting/looking up survey markers
                          surveyMarkersByCategory[surveyMarker.categoryId].push({
                            ...surveyMarker,
                            id: annotationId  // Use the key, not surveyMarker.id
                          });
                        }
                      });

                      // Sort surveyMarkers within each category by user order, then Excel row order.
                      Object.keys(surveyMarkersByCategory).forEach(categoryId => {
                        surveyMarkersByCategory[categoryId].sort(compareSurveyMarkersForOrder);
                      });

                      // Show categories list first (before surveyMarkers)
                      const hasSurveyMarkers = Object.keys(surveyMarkersByCategory).length > 0;

                      return (
                        <div>
                          {/* Select toggle button + compact Excel EXPORT (the
                              create-category plus button lives in the Categories
                              heading row below).
                              UX (mobile demo parity): the select/copy-mode admin
                              toolbars are desktop-only — the demo's survey sheet has
                              no category admin chrome, and these desktop-scaled
                              controls crowded the 392px mobile sheet. Guarded at the
                              JSX level (not CSS-hidden) so select/copy mode can never
                              engage on mobile. */}
                          {mobileMode ? null : !copyModeActive ? (() => {
                            const categoriesForModule = module.categories || [];
                            const selectedCategoryCount = Object.keys(selectedCategories).filter(id => selectedCategories[id]).length;
                            const hasSelectedCategories = selectedCategoryCount > 0;

                            const deleteSelectedCategories = async () => {
                              const selectedCatIds = Object.keys(selectedCategories).filter(id => selectedCategories[id]);
                              if (selectedCatIds.length === 0) {
                                showToast('Please select at least one category to delete.', 'warn');
                                return;
                              }
                              // Owner ruling 2026-09-28: a locked survey item is never
                              // deleted — not by a category delete either.
                              const lockedInSelection = Object.values(surveyMarkers).some((h) => (
                                h?.moduleId === selectedModuleId
                                && selectedCatIds.includes(h?.categoryId)
                                && typeof h?.lockedBy === 'string' && h.lockedBy
                              ));
                              if (lockedInSelection) {
                                showToast('Some items in these categories are locked — unlock them first.', 'info');
                                return;
                              }
                              const confirmed = await askConfirm({
                                title: `Delete ${selectedCatIds.length} categor${selectedCatIds.length !== 1 ? 'ies' : 'y'}?`,
                                message: `Are you sure you want to delete ${selectedCatIds.length} categor${selectedCatIds.length !== 1 ? 'ies' : 'y'} and all items within?`,
                                confirmLabel: `Delete categor${selectedCatIds.length !== 1 ? 'ies' : 'y'}`,
                                danger: true,
                              });
                              if (!confirmed) {
                                return;
                              }

                              selectedCatIds.forEach(catId => {
                                const surveyMarkersInCategory = Object.entries(surveyMarkers).filter(([_, h]) => {
                                  const hModuleId = h.moduleId;
                                  return hModuleId === selectedModuleId && h.categoryId === catId;
                                });

                                surveyMarkersInCategory.forEach(([annotationId, surveyMarker]) => {
                                  if (surveyMarker.pageNumber && surveyMarker.bounds) {
                                    setSurveyMarkersToRemoveByPage(prev => ({
                                      ...prev,
                                      [surveyMarker.pageNumber]: [...(prev[surveyMarker.pageNumber] || []), surveyMarker.bounds]
                                    }));
                                  }
                                });

                                setSurveyMarkers(prev => {
                                  const updated = { ...prev };
                                  surveyMarkersInCategory.forEach(([annotationId]) => {
                                    delete updated[annotationId];
                                  });
                                  return updated;
                                });

                                const documentId = pdfFile?.id;
                                const surveyMarkerIdsToDelete = surveyMarkersInCategory.map(([id]) => id);
                                if (documentId && user?.id && documentSyncEnabled && surveyMarkerIdsToDelete.length > 0) {
                                  deleteAnnotations(documentId, surveyMarkerIdsToDelete).catch(err => {
                                    console.error('[App] Error deleting annotations from Supabase:', err);
                                  });
                                }

                                deleteCategory(selectedModuleId, catId);
                              });

                              setCategorySelectModeActive(false);
                              setCategorySelectModeForCategory(null);
                              setSelectedCategories({});
                            };

                            /* UX 2026-09-23 (owner: desktop survey polish, "cards within
                               cards, it seems like a lot"): the boxed Select button and the
                               gold EXPORT box are gone from above the list. This is now the
                               ONE "Categories" head line: the label on the left, then quiet
                               words on the right - "Select" (or, while selecting, "Done" in
                               gold, "All", "Move/Copy" and a red trash glyph) and the create
                               "+" as a bare glyph. Export moved up into the panel header. Same
                               handlers as before. */
                            return (
                              <h3 className="survey-rail__cats-head">
                                <span>Categories</span>
                                <span className="survey-rail__cats-actions">
                                  {categorySelectModeActive ? (
                                    <span className="survey-rail__cats-actions" role="toolbar" aria-label="Category selection actions">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCategorySelectModeActive(false);
                                          setCategorySelectModeForCategory(null);
                                          setSelectedCategories({});
                                        }}
                                        className="survey-rail__head-btn is-done"
                                      >
                                        Done
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newSelection = {};
                                          categoriesForModule.forEach(category => {
                                            newSelection[category.id] = true;
                                          });
                                          setSelectedCategories(newSelection);
                                        }}
                                        disabled={categoriesForModule.length === 0}
                                        className="survey-rail__head-btn"
                                      >
                                        All
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const selectedCatIds = Object.keys(selectedCategories).filter(id => selectedCategories[id]);
                                          if (selectedCatIds.length === 0) {
                                            showToast('Please select at least one category to move or copy.', 'warn');
                                            return;
                                          }
                                          showToast(`Move/Copy functionality for ${selectedCatIds.length} categories to be implemented.`, 'info');
                                        }}
                                        disabled={!hasSelectedCategories}
                                        className="survey-rail__head-btn"
                                      >
                                        Move/Copy
                                      </button>
                                      <button
                                        type="button"
                                        onClick={deleteSelectedCategories}
                                        disabled={!hasSelectedCategories}
                                        className="survey-rail__head-btn survey-rail__head-btn--glyph is-danger"
                                        {...tip('Delete', 'below')}
                                        aria-label="Delete selected categories"
                                      >
                                        <Icon name="trash" size={13} color="currentColor" />
                                      </button>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCategorySelectModeActive(true);
                                        setSelectedCategories({});
                                      }}
                                      className="survey-rail__head-btn"
                                    >
                                      Select
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={openCreateCategoryModal}
                                    className="survey-rail__head-btn survey-rail__head-btn--glyph"
                                    {...tip('Create category', 'below')}
                                    aria-label="Create category"
                                  >
                                    <Icon name="plus" size={14} color="currentColor" />
                                  </button>
                                </span>
                              </h3>
                            );
                          })() : copyModeActive ? (
                            /* UX 2026-09-23 (desktop survey polish): copy mode's actions
                               are the head line of the list - a 32px line with a hairline
                               under it, like "Categories" - not a padded block. */
                            <div style={{
                              height: '32px',
                              boxSizing: 'border-box',
                              padding: '0 12px',
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              borderBottom: '1px solid var(--border)'
                            }}>
                              {/* Select All checkbox */}
                              {(() => {
                                // IMPORTANT: Use the key from surveyMarkers as the authoritative ID
                                const allSurveyMarkerIds = Object.entries(surveyMarkers)
                                  .filter(([annotationId, h]) => {
                                    const hModuleId = h.moduleId;
                                    return hModuleId === selectedModuleId;
                                  })
                                  .map(([annotationId, h]) => annotationId);  // Use the key, not h.id
                                const moduleSelectedCount = allSurveyMarkerIds.filter(id => copiedItemSelection[id] === true).length;
                                const moduleAllSelected = moduleSelectedCount === allSurveyMarkerIds.length && allSurveyMarkerIds.length > 0;

                                return (
                                  <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    userSelect: 'none'
                                  }}>
                                    <input
                                      type="checkbox"
                                      checked={moduleAllSelected}
                                      onChange={(e) => {
                                        const newSelection = { ...copiedItemSelection };
                                        allSurveyMarkerIds.forEach(id => {
                                          if (!moduleAllSelected) {
                                            newSelection[id] = true;
                                          } else {
                                            delete newSelection[id];
                                          }
                                        });
                                        setCopiedItemSelection(newSelection);
                                      }}
                                      style={{ cursor: 'pointer' }}
                                    />
                                    <span style={{ color: 'var(--text-2)', fontSize: '13px', fontWeight: '400' }}>
                                      Select all
                                    </span>
                                  </label>
                                );
                              })()}

                              <div style={{ width: '1px', height: '16px', background: 'var(--surface-3)' }} />

                              {/* Copy to Spaces button */}
                              <button
                                onClick={() => {
                                  const selectedIds = Object.keys(copiedItemSelection).filter(id => copiedItemSelection[id]);
                                  selectedIds.forEach(id => {
                                  });
                                  if (selectedIds.length === 0) return;
                                  setShowSpaceSelection(true);
                                }}
                                disabled={!Object.values(copiedItemSelection).some(Boolean)}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: Object.values(copiedItemSelection).some(Boolean) ? 'var(--text-3)' : 'var(--text-disabled)',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = 'var(--text-2)';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = 'var(--text-3)';
                                  }
                                }}
                              >
                                Copy to Spaces
                              </button>

                              {/* Delete button */}
                              <button
                                onClick={async () => {
                                  const selectedIds = Object.keys(copiedItemSelection).filter(id => copiedItemSelection[id]);
                                  if (selectedIds.length === 0) return;

                                  // Confirm deletion
                                  const confirmed = await askConfirm({
                                    title: `Delete ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}?`,
                                    message: `Are you sure you want to delete ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}?`,
                                    confirmLabel: `Delete ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}`,
                                    danger: true,
                                  });
                                  if (!confirmed) {
                                    return;
                                  }

                                  // Capture surveyMarkers before deletion (state is async)
                                  const surveyMarkersToDelete = selectedIds.map(id => surveyMarkers[id]).filter(Boolean);

                                  // Delete surveyMarkers from surveyMarkers
                                  setSurveyMarkers(prev => {
                                    const updated = { ...prev };
                                    selectedIds.forEach(id => {
                                      delete updated[id];
                                    });

                                    // Check if all items in the current space have been deleted
                                    // If so, exit copy mode automatically
                                    if (selectedSpaceId) {
                                      const remainingSurveyMarkers = Object.entries(updated)
                                        .filter(([_, h]) => h.spaceId === selectedSpaceId);
                                      if (remainingSurveyMarkers.length === 0) {
                                        // Use setTimeout to ensure state updates are processed
                                        setTimeout(() => {
                                          setCopyModeActive(false);
                                          setCopiedItemSelection({});
                                        }, 0);
                                      }
                                    }

                                    return updated;
                                  });

                                  // Trigger removal from canvas via surveyMarkersToRemoveByPage (same as working ✕ button)
                                  surveyMarkersToDelete.forEach(surveyMarker => {
                                    const pageNum = surveyMarker.pageNumber;
                                    const bounds = surveyMarker.bounds;

                                    if (pageNum && bounds) {
                                      setSurveyMarkersToRemoveByPage(prev => ({
                                        ...prev,
                                        [pageNum]: [...(prev[pageNum] || []), bounds]
                                      }));
                                    }
                                  });

                                  // Clear the removal queue after a short delay to allow processing
                                  setTimeout(() => {
                                    surveyMarkersToDelete.forEach(surveyMarker => {
                                      const pageNum = surveyMarker.pageNumber;
                                      if (pageNum) {
                                        setSurveyMarkersToRemoveByPage(prev => {
                                          const updated = { ...prev };
                                          delete updated[pageNum];
                                          return updated;
                                        });
                                      }
                                    });
                                  }, 100);

                                  // Delete surveyMarker rectangles from PDF canvas (annotationsByPage) - keep for backward compatibility
                                  surveyMarkersToDelete.forEach(surveyMarker => {
                                    const pageNum = surveyMarker.pageNumber;
                                    if (pageNum && annotationsByPage[pageNum]) {
                                      setAnnotationsByPage(prev => {
                                        const pageAnnotations = prev[pageNum];
                                        if (!pageAnnotations || !pageAnnotations.objects) return prev;

                                        // Get the current scale for coordinate conversion
                                        const currentScale = scale;

                                        // Filter out surveyMarker rectangles that match this surveyMarker's bounds
                                        const filteredObjects = pageAnnotations.objects.filter(obj => {
                                          // Check if this is a surveyMarker rectangle (with any opacity)
                                          if (obj.type !== 'rect') return true;
                                          if (!obj.fill || typeof obj.fill !== 'string') return true;
                                          if (!obj.fill.includes('rgba')) return true;

                                          // Canvas coordinates are at canvas scale, need to normalize for comparison
                                          const objX = (obj.left || 0) / currentScale;
                                          const objY = (obj.top || 0) / currentScale;
                                          const objWidth = (obj.width || 0) / currentScale;
                                          const objHeight = (obj.height || 0) / currentScale;

                                          const bounds = surveyMarker.bounds || {};
                                          const surveyMarkerX = bounds.x || bounds.left || 0;
                                          const surveyMarkerY = bounds.y || bounds.top || 0;
                                          const surveyMarkerWidth = bounds.width || (bounds.right ? bounds.right - bounds.left : 0) || 0;
                                          const surveyMarkerHeight = bounds.height || (bounds.bottom ? bounds.bottom - bounds.top : 0) || 0;

                                          // Check if bounds match (with tolerance in normalized coordinates)
                                          const tolerance = 5 / currentScale; // Convert tolerance to normalized coordinates
                                          if (Math.abs(objX - surveyMarkerX) < tolerance &&
                                            Math.abs(objY - surveyMarkerY) < tolerance &&
                                            Math.abs(objWidth - surveyMarkerWidth) < tolerance &&
                                            Math.abs(objHeight - surveyMarkerHeight) < tolerance) {
                                            return false; // Remove this object
                                          }
                                          return true; // Keep this object
                                        });

                                        return {
                                          ...prev,
                                          [pageNum]: {
                                            ...pageAnnotations,
                                            objects: filteredObjects
                                          }
                                        };
                                      });
                                    }
                                  });

                                  // Delete associated items and annotations
                                  surveyMarkersToDelete.forEach(surveyMarker => {

                                    // Find associated item by matching name and category
                                    const categoryName = getCategoryName(selectedTemplate, surveyMarker.moduleId, surveyMarker.categoryId);
                                    const matchingItem = itemsByNameType.get(`${surveyMarker.name}\0${categoryName}`);

                                    if (matchingItem) {
                                      // Find and delete annotations for this item in this space
                                      setAnnotations(prev => {
                                        const updated = { ...prev };
                                        Object.values(updated).forEach(ann => {
                                          if (ann.itemId === matchingItem.itemId && ann.spaceId === surveyMarker.moduleId) {
                                            delete updated[ann.annotationId];
                                          }
                                        });
                                        return updated;
                                      });

                                      // Check if item has data in other modules - if not, delete the item
                                      const surveyMarkerModuleId = surveyMarker.moduleId;
                                      const moduleName = getModuleName(selectedTemplate, surveyMarkerModuleId);
                                      const dataKey = getModuleDataKey(moduleName);
                                      const item = items[matchingItem.itemId];

                                      if (item) {
                                        // Remove the module-specific data
                                        const updatedItem = { ...item };
                                        delete updatedItem[dataKey];

                                        // Check if item has any module data left
                                        const allModules = selectedTemplate?.modules || selectedTemplate?.spaces || [];
                                        const hasOtherModuleData = allModules.some(module => {
                                          const moduleId = module.id;
                                          if (moduleId === surveyMarkerModuleId) return false;
                                          const otherModuleName = getModuleName(selectedTemplate, moduleId);
                                          const otherDataKey = getModuleDataKey(otherModuleName);
                                          return updatedItem[otherDataKey] && Object.keys(updatedItem[otherDataKey]).length > 0;
                                        });

                                        if (hasOtherModuleData) {
                                          // Item exists in other modules, just remove this module's data
                                          setItems(prev => ({
                                            ...prev,
                                            [matchingItem.itemId]: updatedItem
                                          }));
                                        } else {
                                          // Item doesn't exist in other spaces, delete it entirely
                                          setItems(prev => {
                                            const updated = { ...prev };
                                            delete updated[matchingItem.itemId];
                                            return updated;
                                          });
                                        }
                                      }
                                    }
                                  });

                                  // Delete from Supabase document_annotations table
                                  const documentId = pdfFile?.id;
                                  if (documentId && user?.id && documentSyncEnabled) {
                                    deleteAnnotations(documentId, selectedIds).catch(err => {
                                      console.error('[App] Error deleting annotations from Supabase:', err);
                                    });
                                  }

                                  // Clear selection (copy mode will be automatically exited if all items in space are deleted)
                                  setCopiedItemSelection({});
                                }}
                                disabled={!Object.values(copiedItemSelection).some(Boolean)}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  color: Object.values(copiedItemSelection).some(Boolean) ? 'var(--danger-text)' : 'var(--text-disabled)',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                /* UX 2026-09-22: this is a WORD, so it takes the
                                   label red. It used to rest on --danger-press
                                   (4.45:1) and brighten to --danger (4.05:1) —
                                   both under the 4.5:1 a label needs, which is
                                   why tokens.css says "--danger IS A FILL, NOT A
                                   LABEL". --danger-text is 4.82:1 at its worst.
                                   Because the label is now already the brightest
                                   red available, the pointer is answered by the
                                   control's FILL instead: --danger-soft is the
                                   token's own "hover wash on a small remove or
                                   delete control", and the small padding above
                                   gives that wash something to sit in. */
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.background = 'var(--danger-soft)';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                Delete
                              </button>

                              <div style={{ marginLeft: 'auto' }} />

                              {/* Cancel button */}
                              <button
                                onClick={() => {
                                  setCopyModeActive(false);
                                  setCopiedItemSelection({});
                                }}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text-3)',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-2)'}
                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-3)'}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : null}

                          {/* Categories List */}
                          <div>
                            {/* Phone: its own "Categories" head line. Desktop: the head line
                                is rendered above (with Select and +); only copy mode, which
                                swaps that line for its own actions, shows this plain one. */}
                            {(mobileMode || copyModeActive) && (
                            <h3 className={mobileMode ? 'mobile-survey-categories-heading' : 'survey-rail__cats-head'}>
                              {/* Owner 2026-10-01: no "Tap category to place" hint on the
                                  phone any more - a tap opens the category, and each row
                                  carries its own "+ Place". */}
                              <span>Categories</span>
                              {!mobileMode && (
                                <button
                                  type="button"
                                  onClick={openCreateCategoryModal}
                                  className="survey-rail__head-btn survey-rail__head-btn--glyph"
                                  {...tip('Create category', 'below')}
                                  aria-label="Create category"
                                >
                                  <Icon name="plus" size={14} color="currentColor" />
                                </button>
                              )}
                            </h3>
                            )}

                            {module.categories && module.categories.length > 0 ? (
                              <SortableRearrangeList
                                ids={module.categories.map((category) => category.id)}
                                onReorder={(activeId, overId) => handleReorderSurveyCategories(selectedModuleId, activeId, overId)}
                                variableHeight
                                gap={0}
                                dropSettleMs={160}
                                suppressDropTransforms
                              >
                                {module.categories.map(category => {
                                  const categorySurveyMarkers = surveyMarkersByCategory[category.id] || [];
                                  const surveyMarkerCount = categorySurveyMarkers.length;
                                  const isExpanded = expandedCategories[category.id];
                                  const isArrowActive = isExpanded || selectedCategoryId === category.id;

                                  // Calculate category checkbox state for copy mode
                                  const categorySelectedCount = categorySurveyMarkers.filter(h => copiedItemSelection[h.id] === true).length;
                                  const categoryAllSelected = categorySelectedCount === categorySurveyMarkers.length && categorySurveyMarkers.length > 0;

                                  // Category-level selection state
                                  const isCategorySelected = selectedCategories[category.id] === true;
                                  const isCategorySelectModeActive = categorySelectModeActive;
                                  const isCategoryActive = (isCategorySelectModeActive && isCategorySelected) || selectedCategoryId === category.id;
                                  // Survey calm gold (owner 2026-10-01: "I hate all the yellow it
                                  // has on desktop"): gold only means "what a touch on the page will
                                  // do now" - the ARMED category. Desktop marks its row with a 2px
                                  // gold edge (surveyRailPanel.css .is-armed); the phone keeps gold
                                  // ink on its name. A chosen-but-not-armed or select-mode category
                                  // is neutral ink.
                                  const isCategoryArmed = surveyPlacementArmed
                                    && !isCategorySelectModeActive
                                    && selectedCategoryId === category.id;
                                  const buttonTextColor = mobileMode && isCategoryArmed ? 'var(--accent)' : 'var(--text-1)';
                                  const buttonSubTextColor = isCategoryActive ? 'var(--text-2)' : 'var(--text-3)';

                                  // Item-level selection state
                                  const isItemSelectModeActiveForCategory = itemSelectModeActive[category.id] === true;
                                  const selectedItemsForCategory = selectedItemsInCategory[category.id] || {};
                                  const itemSelectedCount = Object.values(selectedItemsForCategory).filter(Boolean).length;

                                  return (
                                    <SortableRearrangeRow
                                      key={category.id}
                                      id={category.id}
                                      // Lift the whole category above the ones after it while
                                      // one of its Survey Markers has the Entity menu open, so
                                      // the menu is never painted under the next category.
                                      wrapperStyle={{
                                        overflow: 'visible',
                                        ...(categorySurveyMarkers.some((marker) => openEntityDropdownId === `${marker.id}:entity`) ? { position: 'relative', zIndex: 40 } : {})
                                      }}
                                    >
                                      {({ attributes, listeners, isDragging }) => {
                                        const isCategorySelectable = copyModeActive || isCategorySelectModeActive;
                                        const isCategorySelectionSelected = isCategorySelectModeActive
                                          ? isCategorySelected
                                          : categoryAllSelected;
                                        const toggleCategorySelection = () => {
                                          if (isCategorySelectModeActive) {
                                            setSelectedCategories(prev => ({
                                              ...prev,
                                              [category.id]: !prev[category.id]
                                            }));
                                            return;
                                          }

                                          if (copyModeActive) {
                                            const newSelection = { ...copiedItemSelection };
                                            categorySurveyMarkers.forEach(h => {
                                              if (!categoryAllSelected) {
                                                newSelection[h.id] = true;
                                              } else {
                                                delete newSelection[h.id];
                                              }
                                            });
                                            setCopiedItemSelection(newSelection);
                                          }
                                        };

                                        return (
                                    <div
                                      className={`survey-marker-category-card${isCategoryActive ? ' is-active' : ''}${isCategoryArmed ? ' is-armed' : ''}`}
                                      style={{
                                        transition: isDragging ? 'none' : undefined
                                      }}
                                    >
                                      <div
                                        data-drag-rearrange-row
                                        className="survey-marker-category-row"
                                      >
                                        {/* UX (mobile demo parity): no drag-reorder handle or
                                            select circle on mobile — demo category rows lead
                                            straight with the name (styles.ts:3113-3126); reorder
                                            stays a desktop affordance. */}
                                        {mobileMode ? null : isCategorySelectable ? (
                                          <SurveyMarkerLeadingSelect
                                            selected={isCategorySelectionSelected}
                                            category
                                            onClick={toggleCategorySelection}
                                            title={isCategorySelectionSelected ? 'Deselect category' : 'Select category'}
                                            ariaLabel={`${isCategorySelectionSelected ? 'Deselect' : 'Select'} ${category.name || 'Untitled category'}`}
                                          />
                                        ) : (
                                          <DragRearrangeHandle
                                            {...attributes}
                                            {...listeners}
                                            isDragging={isDragging}
                                            title="Drag category to rearrange"
                                            style={{ width: undefined, height: undefined, marginLeft: 0, color: 'var(--text-3)' }}
                                          />
                                        )}

                                        <div className="survey-marker-category-body">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                // Phone (owner 2026-10-01): the row opens the
                                                // category, like desktop's accordion; placing is
                                                // the row's own "+ Place" button.
                                                if (mobileMode) {
                                                  toggleMobileCategory(category.id);
                                                  return;
                                                }
                                                if (isCategorySelectModeActive) {
                                                  toggleCategorySelection();
                                                  return;
                                                }
                                                if (copyModeActive) {
                                                  // In copy mode, don't change category selection or hide panel
                                                  return;
                                                }

                                                // Set selected category
                                                setSelectedCategoryId(category.id);
                                                // Minimize survey panel
                                                setIsSurveyPanelCollapsed(true);
                                                // Switch to surveyMarker tool
                                                setActiveTool('survey-marker');
                                              }}
                                              className="survey-marker-category-main"
                                              aria-expanded={mobileMode ? Boolean(isExpanded) : undefined}
                                              aria-label={mobileMode ? `${category.name || 'Untitled category'}, ${surveyMarkerCount} Survey Marker${surveyMarkerCount === 1 ? '' : 's'}` : undefined}
                                              style={{
                                                // A resting category name is the bright row ink of
                                                // the home lists, on the phone and (2026-09-23,
                                                // desktop survey polish) on desktop too.
                                                color: !isCategoryActive ? 'var(--text-1)' : buttonTextColor,
                                              }}
                                            >
                                              <span className="survey-marker-category-main-label">
                                                {category.name || 'Untitled category'}
                                              </span>
                                              <span
                                                className="survey-marker-category-main-count"
                                                style={{ color: buttonSubTextColor }}
                                              >
                                                {surveyMarkerCount}
                                              </span>
                                              {mobileMode && (
                                                <span
                                                  className="mobile-survey-category-chevron"
                                                  aria-hidden="true"
                                                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                                >
                                                  <Icon name="chevronDown" size={14} color="currentColor" />
                                                </span>
                                              )}
                                            </button>
                                            {mobileMode && (
                                              <button
                                                type="button"
                                                className="mobile-survey-place"
                                                aria-label={`Place a Survey Marker in ${category.name || 'Untitled category'}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  placeMobileSurveyMarker(category.id);
                                                }}
                                              >
                                                <Icon name="plus" size={13} color="currentColor" />
                                                <span>Place</span>
                                              </button>
                                            )}
                                            {/* Owner 2026-10-01 ("that Select line should get
                                                moved over"): an open category's Select is a small
                                                word in its own row, not a line of its own under it.
                                                While selecting, the toolbar line takes its place. */}
                                            {!mobileMode && isExpanded && surveyMarkerCount > 0 && !copyModeActive && !categorySelectModeActive && !isItemSelectModeActiveForCategory && (
                                              <button
                                                type="button"
                                                className="survey-marker-category-select"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setItemSelectModeActive(prev => ({
                                                    ...prev,
                                                    [category.id]: true
                                                  }));
                                                  setSelectedItemsInCategory(prev => ({
                                                    ...prev,
                                                    [category.id]: {}
                                                  }));
                                                }}
                                                aria-label={`Select Survey Markers in ${category.name || 'category'}`}
                                              >
                                                Select
                                              </button>
                                            )}
                                            {!mobileMode && surveyMarkerCount > 0 && (
                                              <button
                                                className="survey-marker-category-arrow"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setExpandedCategories(prev => ({
                                                    ...prev,
                                                    [category.id]: !prev[category.id]
                                                  }));
                                                }}
                                                aria-label={isExpanded ? `Hide Survey Markers in ${category.name || 'category'}` : `Show Survey Markers in ${category.name || 'category'}`}
                                                style={{
                                                  // Calm gold: an open chevron is neutral ink.
                                                  color: isArrowActive ? 'var(--text-2)' : 'var(--text-3)'
                                                }}
                                              >
                                                <span
                                                  style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                    transition: 'transform 0.2s ease'
                                                  }}
                                                >
                                                  {/* UX 2026-09-16 (desktop sweep): the shared
                                                      <Icon name="chevronDown" />, not a hand-written
                                                      <svg>. The path data was already byte-identical
                                                      to the shared chevron, but it drew at stroke 2.5
                                                      on the 24 grid — 167% of the house 1.5 — so the
                                                      SAME chevron painted at two weights in one app
                                                      (the Width and Line-style dropdowns render the
                                                      shared one). Same shape, house weight. */}
                                                  <Icon name="chevronDown" size={14} color="currentColor" />
                                                </span>
                                              </button>
                                            )}
                                          </div>
                                      </div>

                                      {/* Expanded surveyMarkers list */}
                                      {mobileMode && isExpanded && surveyMarkerCount === 0 && (
                                        <div className="mobile-survey-item-empty">No Survey Markers yet</div>
                                      )}
                                      {isExpanded && surveyMarkerCount > 0 && (
                                        <div className={mobileMode ? 'mobile-survey-item-list' : 'survey-rail__marker-list'}>
                                          {/* UX (mobile demo parity): the inline item Select /
                                              All / Copy / Delete toolbar is desktop-only admin
                                              chrome — not part of the demo's mobile sheet. */}
                                          {!copyModeActive && !mobileMode && !categorySelectModeActive && isItemSelectModeActiveForCategory && (
                                            <div className="survey-marker-inline-select-row">
                                              {(
                                                <div className="survey-marker-select-toolbar" role="toolbar" aria-label="Item selection actions">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setItemSelectModeActive(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[category.id];
                                                    return updated;
                                                  });
                                                  setSelectedItemsInCategory(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[category.id];
                                                    return updated;
                                                  });
                                                }}
                                                className="survey-marker-select-mode-toggle"
                                              >
                                                Done
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const newSelection = {};
                                                  categorySurveyMarkers.forEach(h => {
                                                    newSelection[h.id] = true;
                                                  });
                                                  setSelectedItemsInCategory(prev => ({
                                                    ...prev,
                                                    [category.id]: newSelection
                                                  }));
                                                }}
                                                className="survey-marker-select-action"
                                              >
                                                All
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const selectedItemIds = Object.keys(selectedItemsForCategory).filter(id => selectedItemsForCategory[id]);
                                                  if (selectedItemIds.length === 0) {
                                                    showToast('Please select at least one item to copy.', 'warn');
                                                    return;
                                                  }
                                                  // Store selected items for copy operation
                                                  setCopiedItemSelection(prev => {
                                                    const newSelection = { ...prev };
                                                    selectedItemIds.forEach(id => {
                                                      newSelection[id] = true;
                                                    });
                                                    return newSelection;
                                                  });
                                                  setShowSpaceSelection(true);
                                                }}
                                                disabled={itemSelectedCount === 0}
                                                className="survey-marker-select-action"
                                              >
                                                Copy
                                              </button>

                                              <button
                                                type="button"
                                                onClick={async () => {
                                                  const selectedItemIds = Object.keys(selectedItemsForCategory).filter(id => selectedItemsForCategory[id]);
                                                  if (selectedItemIds.length === 0) {
                                                    showToast('Please select at least one item to delete.', 'warn');
                                                    return;
                                                  }
                                                  const confirmed = await askConfirm({
                                                    title: `Delete ${selectedItemIds.length} item${selectedItemIds.length !== 1 ? 's' : ''}?`,
                                                    message: `Are you sure you want to delete ${selectedItemIds.length} item${selectedItemIds.length !== 1 ? 's' : ''}?`,
                                                    confirmLabel: `Delete ${selectedItemIds.length} item${selectedItemIds.length !== 1 ? 's' : ''}`,
                                                    danger: true,
                                                  });
                                                  if (!confirmed) {
                                                    return;
                                                  }

                                                  // Delete selected items
                                                  selectedItemIds.forEach(annotationId => {
                                                    handleDeleteSurveyMarkerItem(annotationId);
                                                  });

                                                  // Clear selection and exit item select mode if no items left
                                                  const selectedSet = new Set(selectedItemIds);
                                                  const remainingItems = categorySurveyMarkers.filter(h => !selectedSet.has(h.id));
                                                  if (remainingItems.length === 0) {
                                                    setItemSelectModeActive(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[category.id];
                                                      return updated;
                                                    });
                                                    setSelectedItemsInCategory(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[category.id];
                                                      return updated;
                                                    });
                                                  } else {
                                                    setSelectedItemsInCategory(prev => {
                                                      const updated = { ...prev };
                                                      updated[category.id] = {};
                                                      return updated;
                                                    });
                                                  }
                                                }}
                                                disabled={itemSelectedCount === 0}
                                                className="survey-marker-select-action survey-marker-select-action-icon survey-marker-select-action-danger"
                                                {...tip('Delete', 'below')}
                                                aria-label="Delete selected items"
                                              >
                                                <Icon name="trash" size={12} />
                                              </button>
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          <SortableRearrangeList
                                            ids={categorySurveyMarkers.map((surveyMarker) => surveyMarker.id)}
                                            onReorder={(activeId, overId) => reorderSurveyMarkersInCategory(categorySurveyMarkers, activeId, overId)}
                                            onDragStart={markSurveyMarkerDragStarted}
                                            onDragEnd={() => restoreSurveyMarkerAfterDrag()}
                                            onDragCancel={() => restoreSurveyMarkerAfterDrag()}
                                            variableHeight
                                            gap={0}
                                            dropSettleMs={160}
                                            suppressDropTransforms
                                          >
                                          {categorySurveyMarkers.map((surveyMarker, surveyMarkerIndex) => {
                                            const annotationId = surveyMarker.id;
                                            const isSurveyMarkerExpanded = expandedSurveyMarkers[annotationId];
                                            const baseCategoryName = category?.name?.trim() || 'Untitled Category';
                                            const fallbackName = `${baseCategoryName} ${surveyMarkerIndex + 1}`;
                                            const surveyMarkerName = surveyMarkers[annotationId]?.name || surveyMarker.name || fallbackName;
                                            const entityDropdownId = `${annotationId}:entity`;
                                            const isEntityDropdownOpenForMarker = openEntityDropdownId === entityDropdownId;
                                            const reviewMessage = surveyReviewByMarkerId[annotationId] || '';
                                            const reviewConflict = surveyConflictByMarkerId[annotationId] || null;

                                            return (
                                              <SortableRearrangeRow
                                                key={surveyMarker.id}
                                                id={surveyMarker.id}
                                                wrapperStyle={{
                                                  overflow: 'visible',
                                                  ...(isEntityDropdownOpenForMarker ? { zIndex: 30 } : {})
                                                }}
                                              >
                                                {({ attributes, listeners, isDragging }) => {
                                                  const prepareSurveyMarkerDrag = (anchorElement = null) => {
                                                    if (!isSurveyMarkerExpanded && !isEntityDropdownOpenForMarker) return;
                                                    preserveElementViewportY(anchorElement, () => {
                                                      flushSync(() => {
                                                        collapseSurveyMarkerBeforeDrag(annotationId, {
                                                          restoreAfterDrag: isSurveyMarkerExpanded
                                                        });
                                                      });
                                                    });
                                                  };
                                                  const dragListeners = {
                                                    ...(listeners || {}),
                                                    onPointerDown: (event) => {
                                                      prepareSurveyMarkerDrag(event.currentTarget);
                                                      listeners?.onPointerDown?.(event);
                                                    },
                                                    onKeyDown: (event) => {
                                                      if (event.key === ' ' || event.key === 'Enter') {
                                                        prepareSurveyMarkerDrag();
                                                      }
                                                      listeners?.onKeyDown?.(event);
                                                    }
                                                  };
                                                  const isMarkerSelectable = copyModeActive || isItemSelectModeActiveForCategory;
                                                  const isMarkerSelected = isItemSelectModeActiveForCategory
                                                    ? selectedItemsForCategory[annotationId] === true
                                                    : copiedItemSelection[annotationId] === true;
                                                  const toggleMarkerSelection = () => {
                                                    const nextSelected = !isMarkerSelected;
                                                    if (isItemSelectModeActiveForCategory) {
                                                      setSelectedItemsInCategory(prev => ({
                                                        ...prev,
                                                        [category.id]: {
                                                          ...(prev[category.id] || {}),
                                                          [annotationId]: nextSelected
                                                        }
                                                      }));
                                                      return;
                                                    }

                                                    setCopiedItemSelection(prev => {
                                                      const newSelection = { ...prev };
                                                      if (nextSelected) {
                                                        newSelection[annotationId] = true;
                                                      } else {
                                                        delete newSelection[annotationId];
                                                      }
                                                      return newSelection;
                                                    });
                                                  };
                                                  return (
                                              <div
                                                id={`highlight-item-${surveyMarker.id}`}
                                                data-drag-rearrange-row
                                                style={{
                                                // Phone (2026-09-23, layout B): a Survey Marker is a
                                                // line in the panel, no box; its hairline is drawn by
                                                // mobileSurveyPanel.css on the sortable wrapper.
                                                // Desktop (2026-09-23, desktop survey polish): the same -
                                                // a line, no box; surveyRailPanel.css draws its hairline.
                                                // A carried one lifts on the selected surface.
                                                background: mobileMode ? 'transparent' : (isDragging ? 'var(--surface-3)' : 'transparent'),
                                                border: 0,
                                                borderRadius: 0,
                                                overflow: (isEntityDropdownOpenForMarker || reviewMessage) ? 'visible' : 'hidden',
                                                flexShrink: 0,
                                                boxShadow: isDragging ? '0 10px 22px rgba(0, 0, 0, 0.34), inset 0 0 0 2px var(--focus)' : 'none',
                                                transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease'
                                              }}>
                                                {/* Phone (owner 2026-10-01): an item row is the desktop
                                                    row's content at phone size - entity dot, name, note /
                                                    media badges and checklist progress ("2/3") - and a tap
                                                    opens it INLINE below, one at a time. The desktop inline
                                                    controls below stay desktop-only. */}
                                                {mobileMode && (() => {
                                                  const { moduleData } = findMarkerMatchingItem(annotationId, selectedModuleId, category);
                                                  const rowEntityId = moduleData.entityId || surveyMarkers[annotationId]?.entityId;
                                                  const dotColor = (rowEntityId ? entitiesMap.get(rowEntityId)?.color : null)
                                                    || moduleData.entityColor
                                                    || surveyMarkers[annotationId]?.entityColor
                                                    || null;
                                                  const isOpenOnPhone = annotationId === mobileDetailMarkerId;
                                                  return (
                                                    <>
                                                      {!isOpenOnPhone && (
                                                      <button
                                                        type="button"
                                                        className="mobile-survey-item-row"
                                                        aria-label={`Open ${surveyMarkerName}`}
                                                        aria-expanded={false}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setMobileDetailDropdown(null);
                                                          // One open Survey Marker at a time.
                                                          setExpandedSurveyMarkers(isOpenOnPhone ? {} : { [annotationId]: true });
                                                        }}
                                                      >
                                                        <span className="mobile-survey-item-dot" style={{ background: dotColor || 'var(--border-strong)' }} aria-hidden="true" />
                                                        <span className="mobile-survey-item-name">{surveyMarkerName}</span>
                                                        {!(surveyMarker.bounds && surveyMarker.pageNumber) && (
                                                          <span className="mobile-survey-item-unplaced" role="img" aria-label="Not on the page">
                                                            <Icon name="pinPlus" size={14} color="currentColor" />
                                                          </span>
                                                        )}
                                                        {renderSurveyMarkerBadges(annotationId, category, 'mobile-survey-item-badges')}
                                                        <span
                                                          className="mobile-survey-item-chevron"
                                                          aria-hidden="true"
                                                          style={{ transform: isOpenOnPhone ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                                        >
                                                          <Icon name="chevronDown" size={12} color="currentColor" />
                                                        </span>
                                                      </button>
                                                      )}
                                                      {isOpenOnPhone && renderMobileOpenSurveyMarker(surveyMarker, category, surveyMarkerName, fallbackName, () => {
                                                        setMobileDetailDropdown(null);
                                                        setExpandedSurveyMarkers({});
                                                      })}
                                                    </>
                                                  );
                                                })()}
                                                {/* Owner 2026-10-01 (second pass) - ONE line per Survey
                                                    Marker, open or not, the phone's open line too:
                                                    [grip in the gutter] [entity dot = the entity menu]
                                                    [name] [media / progress] [Locate] [open chevron].
                                                    - The grip sits in the 28px gutter the category grips
                                                      use, so the dot sits under the category's name: no
                                                      wasted left space ("everything's pushed to the right").
                                                    - The separate "Entity [● Subcontractor]" line is gone:
                                                      the dot IS the entity menu (its full name in the menu,
                                                      the tooltip and the label).
                                                    - No "Add item notes" button: the open marker's note
                                                      field is the way to add a note.
                                                    - Locate: a target when the marker is on the page, an
                                                      orange pin-plus when it is not (click to place). */}
                                                {!mobileMode && (() => {
                                                  const surveyMarkerData = surveyMarkers[annotationId];
                                                  const { moduleData } = findMarkerMatchingItem(annotationId, selectedModuleId, category);
                                                  const currentEntityId = moduleData.entityId || surveyMarkerData?.entityId || '';
                                                  const currentEntity = currentEntityId ? entitiesMap.get(currentEntityId) : null;
                                                  const selectedEntityColor = currentEntity?.color || moduleData.entityColor || surveyMarkerData?.entityColor || null;
                                                  const selectedEntityName = currentEntity?.name || moduleData.entityName || surveyMarkerData?.entityName || '';
                                                  const isEntityDropdownOpen = openEntityDropdownId === entityDropdownId;
                                                  const entityOptions = [
                                                    { id: '', name: 'None', color: null },
                                                    ...((selectedTemplate?.entities || []).map(entity => ({ id: entity.id, name: entity.name, color: entity.color })))
                                                  ];
                                                  const isPlaced = Boolean(surveyMarker.bounds && surveyMarker.pageNumber);
                                                  const progress = getSurveyMarkerProgress(annotationId, category);
                                                  const { text: noteTextValue, mediaCount } = getSurveyMarkerNoteInfo(annotationId);
                                                  const entityLabel = selectedEntityName ? `Entity: ${selectedEntityName}` : 'Entity: none';
                                                  return (
                                                <div className={`survey-rail__marker-line${isSurveyMarkerExpanded ? ' is-open' : ''}`}>
                                                  {isMarkerSelectable ? (
                                                    <SurveyMarkerLeadingSelect
                                                      selected={isMarkerSelected}
                                                      onClick={toggleMarkerSelection}
                                                      title={isMarkerSelected ? 'Deselect item' : 'Select item'}
                                                      ariaLabel={`${isMarkerSelected ? 'Deselect' : 'Select'} ${surveyMarkerName}`}
                                                    />
                                                  ) : (
                                                    <DragRearrangeHandle
                                                      {...attributes}
                                                      {...dragListeners}
                                                      isDragging={isDragging}
                                                      title="Drag to rearrange"
                                                      style={{ width: undefined, height: undefined, marginLeft: 0, color: 'var(--text-3)' }}
                                                    />
                                                  )}

                                                  <div className="survey-rail__marker-main">
                                                      <div className="survey-rail__entity-wrap">
                                                        <button
                                                          type="button"
                                                          className="survey-rail__entity-btn"
                                                          aria-haspopup="listbox"
                                                          aria-expanded={isEntityDropdownOpen}
                                                          aria-label={`${entityLabel}. Change entity`}
                                                          {...tip(selectedEntityName || 'No entity', 'below')}
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenEntityDropdownId(isEntityDropdownOpen ? null : entityDropdownId);
                                                          }}
                                                        >
                                                          <span
                                                            className={`survey-rail__entity-dot${selectedEntityColor ? '' : ' is-empty'}`}
                                                            style={selectedEntityColor ? { background: selectedEntityColor } : undefined}
                                                          />
                                                          <span className="survey-rail__entity-caret" aria-hidden="true">
                                                            <Icon name="chevronDown" size={10} color="currentColor" />
                                                          </span>
                                                        </button>
                                                        {isEntityDropdownOpen && (
                                                          <div
                                                            className="survey-marker-entity-options survey-rail__entity-menu"
                                                            role="listbox"
                                                            aria-label="Entity"
                                                            onClick={(e) => e.stopPropagation()}
                                                          >
                                                            {entityOptions.map(option => {
                                                              const optionValue = option.id || '';
                                                              const isSelectedOption = currentEntityId === optionValue;
                                                              return (
                                                                <button
                                                                  key={optionValue || 'none'}
                                                                  type="button"
                                                                  className={`survey-marker-entity-option${isSelectedOption ? ' is-selected' : ''}`}
                                                                  role="option"
                                                                  aria-selected={isSelectedOption}
                                                                  onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    applyEntitySelectionForMarker(annotationId, selectedModuleId, category, optionValue);
                                                                    setOpenEntityDropdownId(null);
                                                                  }}
                                                                >
                                                                  <span
                                                                    className="survey-marker-entity-option-swatch"
                                                                    style={getEntitySwatchStyle(option.color)}
                                                                  />
                                                                  <span className="survey-marker-entity-option-label">
                                                                    {option.name}
                                                                  </span>
                                                                  <span className="survey-rail__entity-check" aria-hidden="true">
                                                                    {isSelectedOption ? <Icon name="check" size={12} color="currentColor" /> : null}
                                                                  </span>
                                                                </button>
                                                              );
                                                            })}
                                                          </div>
                                                        )}
                                                      </div>
                                                      <span className="survey-marker-name-fit" data-value={surveyMarkerName || ' '}>
                                                        <input
                                                          type="text"
                                                          size={1}
                                                          className="survey-marker-name-inline"
                                                          data-survey-marker-name-input={annotationId}
                                                          defaultValue={surveyMarkerName}
                                                          key={`${annotationId}:${surveyMarkerName}`}
                                                          {...(({ onFocus, onMouseEnter, ...renameTip }) => ({
                                                            // Owner 2026-10-01: a just-placed marker's name field is
                                                            // focused, and its "Rename" chip sat over the Entity
                                                            // control (onBlur below never hid it). No chip while
                                                            // the field is focused; focusing hides a hover chip.
                                                            ...renameTip,
                                                            onFocus: renameTip.onMouseLeave,
                                                            onMouseEnter: (e) => {
                                                              if (e.currentTarget !== e.currentTarget.ownerDocument.activeElement) onMouseEnter?.(e);
                                                            },
                                                          }))(tip('Rename Survey Marker', 'below'))}
                                                          aria-label={`Rename ${surveyMarkerName}`}
                                                          onClick={(e) => e.stopPropagation()}
                                                          onDoubleClick={(e) => e.currentTarget.select()}
                                                          onInput={(e) => {
                                                            if (justPlacedSurveyMarkerIdRef.current === String(annotationId)) {
                                                              justPlacedSurveyMarkerIdRef.current = null;
                                                            }
                                                            if (e.currentTarget.parentElement) {
                                                              e.currentTarget.parentElement.dataset.value = e.currentTarget.value || ' ';
                                                            }
                                                          }}
                                                          onBlur={(e) => {
                                                            if (justPlacedSurveyMarkerIdRef.current === String(annotationId)) {
                                                              justPlacedSurveyMarkerIdRef.current = null;
                                                            }
                                                            const nextName = (e.currentTarget.value || '').trim() || fallbackName;
                                                            e.currentTarget.value = nextName;
                                                            if (e.currentTarget.parentElement) {
                                                              e.currentTarget.parentElement.dataset.value = nextName || ' ';
                                                            }
                                                            commitSurveyMarkerName(annotationId, category.id, surveyMarkerName, nextName, fallbackName);
                                                          }}
                                                          onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                              e.currentTarget.blur();
                                                            } else if (e.key === 'Escape') {
                                                              // A Survey Marker just placed, name untouched:
                                                              // Escape takes the placement back (one Undo step).
                                                              if (
                                                                justPlacedSurveyMarkerIdRef.current === String(annotationId)
                                                                && e.currentTarget.value === surveyMarkerName
                                                                && typeof undoSurveyMarkerPlacement === 'function'
                                                              ) {
                                                                justPlacedSurveyMarkerIdRef.current = null;
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                if (undoSurveyMarkerPlacement(annotationId)) return;
                                                              }
                                                              e.currentTarget.value = surveyMarkerName;
                                                              if (e.currentTarget.parentElement) {
                                                                e.currentTarget.parentElement.dataset.value = surveyMarkerName || ' ';
                                                              }
                                                              e.currentTarget.blur();
                                                            }
                                                          }}
                                                        />
                                                      </span>
                                                      <div
                                                        className="survey-marker-expand-spacer"
                                                        aria-hidden="true"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          toggleSurveyMarkerExpanded(annotationId);
                                                        }}
                                                      />
                                                  </div>

                                                  <SurveyMarkerReviewIndicator
                                                    markerId={annotationId}
                                                    message={reviewMessage}
                                                    conflict={reviewConflict}
                                                    onKeepApp={(e) => {
                                                      e.stopPropagation();
                                                      onResolveExcelConflict && onResolveExcelConflict(annotationId, 'app');
                                                    }}
                                                    onUseExcel={(e) => {
                                                      e.stopPropagation();
                                                      onResolveExcelConflict && onResolveExcelConflict(annotationId, 'excel');
                                                    }}
                                                  />

                                                  {/* A note that exists is a small glyph on the CLOSED
                                                      line (an indicator, not a button); media count and
                                                      checklist progress as on the phone row. */}
                                                  {(noteTextValue && !isSurveyMarkerExpanded) || mediaCount > 0 || progress.total > 0 ? (
                                                    <span className="survey-rail__marker-badges">
                                                      {noteTextValue && !isSurveyMarkerExpanded ? (
                                                        <span className="survey-marker-badge" aria-label="Has a note" title="Has a note">
                                                          <Icon name="note" size={12} color="currentColor" />
                                                        </span>
                                                      ) : null}
                                                      {mediaCount > 0 ? (
                                                        <span className="survey-marker-badge" aria-label={`${mediaCount} media attachment${mediaCount === 1 ? '' : 's'}`}>
                                                          <Icon name="image" size={12} color="currentColor" />
                                                          <span>{mediaCount}</span>
                                                        </span>
                                                      ) : null}
                                                      {progress.total > 0 ? renderSurveyMarkerProgress(progress) : null}
                                                    </span>
                                                  ) : null}

                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (isPlaced) handleLocateItemOnPDF(surveyMarker);
                                                      else setPendingLocationItem(surveyMarker);
                                                    }}
                                                    className={`survey-rail__marker-action survey-rail__locate${isPlaced ? '' : ' is-unplaced'}`}
                                                    data-testid={isPlaced ? undefined : 'survey-marker-unplaced-tag'}
                                                    {...tip(isPlaced ? 'Locate on page' : 'Not on the page \u2014 click to place', 'below')}
                                                    aria-label={isPlaced ? 'Locate on page' : 'Not on the page. Place on page'}
                                                  >
                                                    <Icon name={isPlaced ? 'locate' : 'pinPlus'} size={15} color="currentColor" />
                                                  </button>

                                                  <button
                                                    type="button"
                                                    className="survey-rail__marker-action survey-rail__marker-toggle"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      toggleSurveyMarkerExpanded(annotationId);
                                                    }}
                                                    aria-expanded={Boolean(isSurveyMarkerExpanded)}
                                                    aria-label={isSurveyMarkerExpanded ? 'Collapse marker details' : 'Expand marker details'}
                                                  >
                                                    <Icon name="chevronDown" size={14} color="currentColor" />
                                                  </button>
                                                </div>
                                                  );
                                                })()}

                                                {/* Expanded checklist items — active items only.
                                                    KAL-44: archived items are rendered separately
                                                    below so new markers don't see them as active
                                                    prompts, but old responses still surface. */}
                                                {
                                                  !mobileMode && isSurveyMarkerExpanded && category.checklist && category.checklist.filter(item => item && item.archived !== true).map(item => {
                                                    const response = surveyMarkers[annotationId]?.checklistResponses?.[item.id] || {};
                                                    const isSelected = response.selection;
                                                    // Y / N / N/A: one grey well, the answers are words and
                                                    // the chosen one is lit on a plate of its hue (Yes
                                                    // green, No red, N/A gold; owner 2026-10-01) - the
                                                    // phone's rule.
                                                    return (
                                                      <div key={item.id} className="survey-rail__detail-line">
                                                        <span className="survey-rail__detail-text">
                                                          {item.text}
                                                        </span>
                                                        <div className="survey-rail__answers" role="group" aria-label={item.text || 'Checklist answer'}>
                                                          {['Y', 'N', 'N/A'].map(option => {
                                                            const isAnswer = isSelected === option;
                                                            const tone = option === 'Y' ? 'is-yes' : option === 'N' ? 'is-no' : 'is-na';
                                                            return (
                                                              <button
                                                                key={option}
                                                                type="button"
                                                                aria-pressed={isAnswer}
                                                                className={`survey-rail__answer${isAnswer ? ` is-active ${tone}` : ''}`}
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  // Shared with the mobile detail view — see
                                                                  // applyChecklistResponseSelection above (verbatim
                                                                  // re-housing of the old inline handler).
                                                                  applyChecklistResponseSelection(annotationId, selectedModuleId, category, surveyMarker.name || '', item.id, option);
                                                                }}
                                                              >
                                                                {option}
                                                              </button>
                                                            );
                                                          })}
                                                        </div>
                                                      </div>
                                                    );
                                                  })
                                                }

                                                {/* KAL-44 — Archived items section.
                                                    Items that were archived from the template
                                                    after this marker recorded a response. The
                                                    response payload stays intact under its
                                                    original item id; we render the last-known
                                                    label in a quiet section so the data is
                                                    still inspectable but isn't an active prompt
                                                    for new markers (new markers won't have a
                                                    response under that id, so this section is
                                                    empty for them). */}
                                                {/* UX (mobile demo parity): archived-checklist admin is
                                                    desktop-only — read-only historical data has no surface
                                                    in the demo's mobile sheet and crowded the 392px window.
                                                    Data stays intact; inspect on desktop. */}
                                                {
                                                  !mobileMode && isSurveyMarkerExpanded && (() => {
                                                    const responses = surveyMarkers[annotationId]?.checklistResponses || {};
                                                    const archivedItems = (category.checklist || []).filter(it => it && it.archived === true);
                                                    const archivedWithResponses = archivedItems.filter(it => Object.prototype.hasOwnProperty.call(responses, it.id));
                                                    if (archivedWithResponses.length === 0) return null;
                                                    return (
                                                      <div
                                                        data-testid={`archived-checklist-${annotationId}`}
                                                        className="survey-rail__archived"
                                                      >
                                                        <div style={{
                                                          fontSize: '10px',
                                                          color: 'var(--text-3)',
                                                          textTransform: 'uppercase',
                                                          letterSpacing: '0.6px',
                                                          marginBottom: '4px',
                                                          fontWeight: 600,
                                                        }}>
                                                          Archived ({archivedWithResponses.length})
                                                        </div>
                                                        {archivedWithResponses.map(item => {
                                                          const response = responses[item.id] || {};
                                                          const sel = response.selection;
                                                          const label = item.lastKnownLabel || item.text || 'Archived item';
                                                          return (
                                                            <div
                                                              key={item.id}
                                                              data-archived-response-id={item.id}
                                                              style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '8px',
                                                                padding: '3px 0',
                                                                opacity: 0.78,
                                                              }}
                                                            >
                                                              <span
                                                                {...tip(`Archived${item.archivedAt ? ` ${new Date(item.archivedAt).toLocaleString()}` : ''} — read-only historical response`, 'below')}
                                                                style={{
                                                                  color: 'var(--text-3)',
                                                                  fontSize: '12px',
                                                                  flex: 1,
                                                                  fontStyle: 'italic',
                                                                  textDecoration: 'line-through',
                                                                  textDecorationColor: 'var(--text-disabled)',
                                                                }}
                                                              >
                                                                {label}
                                                              </span>
                                                              <span
                                                                style={{
                                                                  minWidth: '28px',
                                                                  padding: '2px 6px',
                                                                  fontSize: '10px',
                                                                  fontWeight: 600,
                                                                  borderRadius: '3px',
                                                                  /* Same chips as the chosen Y / N / N/A answer above
                                                                     (owner 2026-10-01): Y green, N red, N/A neutral grey -
                                                                     a near-white word on a solid plate of its hue. */
                                                                  background: sel === 'Y'
                                                                    ? 'var(--success-plate)'
                                                                    : sel === 'N'
                                                                      ? 'var(--danger-plate)'
                                                                      : sel === 'N/A'
                                                                        ? 'var(--border)'
                                                                        : 'var(--surface-3)',
                                                                  color: sel === 'Y'
                                                                    ? 'var(--on-success-plate)'
                                                                    : sel === 'N'
                                                                      ? 'var(--on-danger-plate)'
                                                                      : sel === 'N/A'
                                                                        ? 'var(--text-1)'
                                                                        : 'var(--text-3)',
                                                                  textAlign: 'center',
                                                                }}
                                                              >
                                                                {sel || '—'}
                                                              </span>
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    );
                                                  })()
                                                }

                                                {/* Notes and media, inline (owner 2026-10-01,
                                                    replaces the 600px Note dialog) - the same
                                                    block the phone's open Survey Marker shows. */}
                                                {!mobileMode && isSurveyMarkerExpanded && renderSurveyMarkerNotes(annotationId, 'desktop')}
                                              </div>
                                                  );
                                                }}
                                              </SortableRearrangeRow>
                                            );
                                          })}
                                          </SortableRearrangeList>
                                        </div>
                                      )
                                      }
                                    </div>
                                        );
                                      }}
                                    </SortableRearrangeRow>
                                  );
                                })}
                              </SortableRearrangeList>
                            ) : (
                              <div style={{ color: 'var(--text-3)', fontSize: '14px', padding: '20px', textAlign: 'center' }}>
                                <div>No categories available for this space.</div>
                                {selectedTemplate && selectedModuleId && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!selectedTemplate?.id || !selectedModuleId) {
                                        showToast('Please select a template and module before creating a category.', 'warn');
                                        return;
                                      }
                                      onRequestCreateTemplate?.({
                                        mode: 'edit',
                                        templateId: selectedTemplate.id,
                                        moduleId: selectedModuleId,
                                        startAddingCategory: true
                                      });
                                    }}
                                    style={{
                                      marginTop: '12px',
                                      padding: '10px 18px',
                                      borderRadius: '20px',
                                      /* UX: rests one surface step below its
                                         own hover so the pointer gets an
                                         answer on both properties - the fill
                                         lifts --surface-2 -> --surface-3 and
                                         the edge lifts --border-strong ->
                                         --text-3 (calm gold 2026-10-01: an
                                         empty state is not gold). */
                                      border: '1px solid var(--border-strong)',
                                      background: 'var(--surface-2)',
                                      color: 'var(--text-1)',
                                      fontSize: '13px',
                                      fontWeight: 500,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '6px',
                                      transition: 'background 0.2s ease, border-color 0.2s ease'
                                    }}
                                    onMouseEnter={(event) => {
                                      event.currentTarget.style.background = 'var(--hover)';
                                      event.currentTarget.style.borderColor = 'var(--text-3)';
                                    }}
                                    onMouseLeave={(event) => {
                                      event.currentTarget.style.background = 'var(--surface-2)';
                                      event.currentTarget.style.borderColor = 'var(--border-strong)';
                                    }}
                                  >
                                    Create category
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>
                        <p>Select a space to view categories</p>
                      </div>
                    )}
                  </div>
                  </div>
                  {/* Owner 2026-10-01 ("the export button being so close to the X
                      close button for survey is just weird"): Export left the
                      header for the panel's foot - one quiet line at the bottom of
                      the Survey panel (desktop: just above the zoom / page footer;
                      phone: the sheet's last line, hidden while you type). The
                      header keeps only the template name and the X. "Export to
                      Excel" creates the workbook; with a linked workbook a "..."
                      beside it holds that workbook's actions. Same handlers. */}
                  {!isMobileTemplateSwitching && (
                    <div className={mobileMode ? 'mobile-survey-foot' : 'survey-rail__foot'}>
                      <button
                        type="button"
                        className={mobileMode ? 'mobile-survey-foot__export' : 'survey-rail__foot-export'}
                        onClick={() => handleExportSurveyToExcel()}
                        disabled={isExporting}
                        {...(mobileMode ? {} : tip('Create an Excel workbook from this survey', 'above'))}
                      >
                        {isExporting
                          ? <Spinner size={mobileMode ? 16 : 14} color="var(--text-1)" trackColor="var(--surface-3)" />
                          : <Icon name="upload" size={mobileMode ? 16 : 14} color="currentColor" />}
                        <span>{isExporting ? 'Exporting\u2026' : 'Export to Excel'}</span>
                      </button>
                      {mobileMode ? (
                        (selectedTemplate.linkedExcelPath && linkedExcelExists === true) ? (
                          <div className="mobile-survey-sheet-export-wrap" ref={mobileExportMenuRef}>
                            <button
                              type="button"
                              className={`mobile-survey-foot__more${isMobileExportMenuOpen ? ' is-open' : ''}`}
                              aria-label="Linked workbook actions"
                              aria-haspopup="menu"
                              aria-expanded={isMobileExportMenuOpen}
                              disabled={isExporting}
                              onClick={() => setIsMobileExportMenuOpen((open) => !open)}
                            >
                              <Icon name="moreHorizontal" size={18} color="currentColor" />
                            </button>
                            {isMobileExportMenuOpen && (
                              <div className="mobile-survey-sheet-export-menu" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={isExporting}
                                  onClick={() => {
                                    setIsMobileExportMenuOpen(false);
                                    handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
                                  }}
                                >
                                  <strong>Sync Microsoft 365</strong>
                                  <span>Update the shared workbook</span>
                                </button>
                              </div>
                            )}
                          </div>
                        ) : null
                      ) : (
                        <div ref={exportMenuRef} className="survey-rail__export">
                          {(selectedTemplate.linkedExcelPath && linkedExcelExists === true) && (
                            <button
                              type="button"
                              onClick={() => !isExporting && setShowExportMenu(!showExportMenu)}
                              disabled={isExporting}
                              className="survey-rail__foot-more"
                              aria-label="Linked workbook actions"
                              aria-haspopup="menu"
                              aria-expanded={showExportMenu}
                              {...tip('Linked workbook', 'above')}
                            >
                              <Icon name="moreHorizontal" size={16} color="currentColor" />
                            </button>
                          )}
                                    {showExportMenu && (
                                      <div className="survey-marker-export-compact-menu">
                          <div
                            onClick={async () => {
                              const excelPath = selectedTemplate.linkedExcelPath;
                              const isOneDrive = selectedTemplate.isOneDrive;


                              if (!excelPath) {
                                showToast('No Excel file is linked to this survey.', 'error');
                                setShowExportMenu(false);
                                return;
                              }

                              // Check if the path is actually a local file path (even if isOneDrive flag is set)
                              // Local paths start with / and contain /Users/ or /Library/ or drive letters on Windows
                              const isLocalFilePath = excelPath.startsWith('/Users/') ||
                                excelPath.startsWith('/Library/') ||
                                excelPath.match(/^[A-Za-z]:[\\/]/) || // Windows drive letter
                                excelPath.includes('/CloudStorage/'); // OneDrive sync folder

                              // For OneDrive API paths (like /Documents/file.xlsx), try to construct local sync folder path
                              if (isOneDrive && !isLocalFilePath && window.electronAPI) {
                                try {
                                  // Get home directory and find OneDrive folders
                                  const homeDir = await window.electronAPI.getHomeDir();
                                  const cloudStoragePath = `${homeDir}/Library/CloudStorage`;

                                  console.log('Looking for OneDrive file. Excel path:', excelPath);
                                  console.log('Home dir:', homeDir);
                                  console.log('CloudStorage path:', cloudStoragePath);

                                  // List CloudStorage directory to find OneDrive folders
                                  const cloudStorageContents = await window.electronAPI.listDir(cloudStoragePath);
                                  console.log('CloudStorage contents:', cloudStorageContents);

                                  const oneDriveFolders = cloudStorageContents.filter(name =>
                                    name.startsWith('OneDrive') || name.includes('OneDrive')
                                  );
                                  console.log('OneDrive folders found:', oneDriveFolders);

                                  // Build list of possible paths
                                  const possibleLocalPaths = [];

                                  // Add CloudStorage OneDrive folders
                                  for (const folder of oneDriveFolders) {
                                    possibleLocalPaths.push(`${cloudStoragePath}/${folder}${excelPath}`);
                                  }

                                  // Also try legacy OneDrive locations in home directory
                                  possibleLocalPaths.push(`${homeDir}/OneDrive${excelPath}`);
                                  possibleLocalPaths.push(`${homeDir}/OneDrive - Personal${excelPath}`);

                                  console.log('Trying these local paths:', possibleLocalPaths);

                                  let localPathFound = null;
                                  for (const localPath of possibleLocalPaths) {
                                    try {
                                      const exists = await window.electronAPI.fileExists(localPath);
                                      console.log(`Checking ${localPath}: ${exists ? 'EXISTS' : 'not found'}`);
                                      if (exists) {
                                        localPathFound = localPath;
                                        break;
                                      }
                                    } catch (e) {
                                      console.log(`Error checking ${localPath}:`, e);
                                      // Continue trying other paths
                                    }
                                  }

                                  if (localPathFound) {
                                    console.log('Found local file at:', localPathFound);
                                    // Open the local file directly
                                    const result = await window.electronAPI.openPath(localPathFound);
                                    if (result) {
                                      console.error('Failed to open local OneDrive file:', result);
                                      showToast(`Failed to open Excel file:\n${result}`, 'error');
                                    }
                                    setShowExportMenu(false);
                                    return;
                                  }

                                  // If local file not found, fall through to web approach
                                  console.log('Local OneDrive file not found, trying web approach...');
                                } catch (err) {
                                  console.error('Error searching for local OneDrive file:', err);
                                  // Fall through to web approach
                                }
                              }

                              // Handle OneDrive API files - try desktop Excel first, fall back to web
                              if (isOneDrive && !isLocalFilePath) {
                                console.log('Trying web approach for OneDrive file...');
                                console.log('graphClient available:', !!graphClient);
                                try {
                                  // Get the file's web URL from OneDrive
                                  if (graphClient) {
                                    console.log('Fetching file metadata from Graph API:', `/me/drive/root:${excelPath}`);
                                    const driveItem = await graphClient.api(`/me/drive/root:${excelPath}`).get();
                                    console.log('Drive item response:', driveItem);
                                    console.log('webUrl:', driveItem?.webUrl);
                                    console.log('downloadUrl:', driveItem?.['@microsoft.graph.downloadUrl']);

                                    // Get webUrl, or construct one from the downloadUrl/id
                                    let webUrl = driveItem?.webUrl;

                                    // If no webUrl, try to open the file directly using downloadUrl
                                    if (!webUrl && driveItem?.['@microsoft.graph.downloadUrl']) {
                                      // For personal OneDrive, construct the web URL
                                      // Format: https://onedrive.live.com/edit.aspx?cid=<driveId>&resid=<itemId>
                                      const downloadUrl = driveItem['@microsoft.graph.downloadUrl'];
                                      console.log('No webUrl, using downloadUrl to open file');

                                      // Open the download URL which should trigger Excel to open
                                      window.open(downloadUrl, '_blank');
                                      setShowExportMenu(false);
                                      return;
                                    }

                                    if (webUrl) {
                                      console.log('Opening with webUrl:', webUrl);

                                      // In Electron, use shell.openExternal to open the URL
                                      // This will open in the default browser and Excel Online can handle it
                                      if (window.electronAPI?.openExternal) {
                                        try {
                                          await window.electronAPI.openExternal(webUrl);
                                          console.log('Opened webUrl with shell.openExternal');
                                        } catch (e) {
                                          console.error('Failed to open with openExternal:', e);
                                          // Fallback to window.open
                                          window.open(webUrl, '_blank');
                                        }
                                      } else {
                                        // Not in Electron, just open in new tab
                                        window.open(webUrl, '_blank');
                                      }
                                    } else {
                                      showToast('Could not get the OneDrive file URL. Please open the file manually from OneDrive.', 'error');
                                    }
                                  } else {
                                    showToast('Please sign in to Microsoft to open OneDrive files.', 'warn');
                                  }
                                } catch (err) {
                                  console.error('Error opening OneDrive file:', err);
                                  showToast(`Error opening OneDrive file:\n${err.message}`, 'error');
                                }
                                setShowExportMenu(false);
                                return;
                              }

                              // Handle local files
                              if (window.electronAPI) {
                                try {
                                  // Check if file exists first
                                  const exists = await window.electronAPI.fileExists(excelPath);

                                  if (!exists) {
                                    showToast(`Excel file not found at:\n${excelPath}\n\nThe file may have been moved or deleted.`, 'error');
                                    setShowExportMenu(false);
                                    return;
                                  }

                                  const result = await window.electronAPI.openPath(excelPath);
                                  if (result) {
                                    // shell.openPath returns an error string if it fails, empty string on success
                                    console.error('Failed to open Excel file:', result);
                                    showToast(`Failed to open Excel file:\n${result}\n\nPath: ${excelPath}`, 'error');
                                  }
                                } catch (err) {
                                  console.error('Error opening Excel file:', err);
                                  showToast(`Error opening Excel file:\n${err.message}\n\nPath: ${excelPath}`, 'error');
                                }
                              } else {
                                showToast('This feature is only available in the desktop app.', 'error');
                              }
                              setShowExportMenu(false);
                            }}
                            role="menuitem"
                            className="survey-rail__menu-item"
                          >
                            <Icon name="document" size={14} color="currentColor" />
                            Open Excel
                          </div>
                          <div
                            onClick={() => {
                              handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
                              setShowExportMenu(false);
                            }}
                            role="menuitem"
                            className="survey-rail__menu-item"
                          >
                            <Icon name="upload" size={14} color="currentColor" />
                            Push to Excel
                          </div>
                          {/* "Pull from Excel" reads the last SAVED copy from disk, which on
                              a local file open in Excel is stale and overlaps the automatic
                              import-on-save — so it's only offered for OneDrive workbooks. */}
                          {selectedTemplate?.isOneDrive && (
                          <div
                            onClick={() => {
                              handleSyncFromExcel();
                              setShowExportMenu(false);
                            }}
                            role="menuitem"
                            className="survey-rail__menu-item"
                          >
                            <Icon name="download" size={14} color="currentColor" />
                            Pull from Excel
                          </div>
                          )}
                          {selectedTemplate?.isOneDrive && (() => {
                            // Amendment (b) capability gate: a refused verdict keeps the
                            // toggle visible but inert-with-reason. Clicking re-checks
                            // (retry); the plain-English reason comes from the shared
                            // excelSyncStatus vocabulary — never an inline literal here.
                            const gateRefused = !liveSyncEnabled && liveSyncGate && !liveSyncGate.allowed
                              && liveSyncGate.reasonCode !== 'checking';
                            const gateChecking = !liveSyncEnabled && liveSyncGate?.reasonCode === 'checking';
                            return (
                            <div
                              onClick={() => {
                                if (liveSyncSupported === false) return;
                                if (typeof onLiveSyncToggle === 'function') onLiveSyncToggle();
                              }}
                              role="menuitem"
                              className="survey-rail__menu-item"
                              style={{
                                // Calm gold (2026-10-01): a live link is the house
                                // "ok" green, beside warning amber and error red.
                                color: liveSyncEnabled && liveSyncStatus === 'connected'
                                  ? 'var(--success-text)'
                                  : liveSyncStatus === 'connecting' || gateChecking
                                    ? 'var(--warning)'
                                    : liveSyncStatus === 'error' || liveSyncSupported === false
                                      ? 'var(--danger-text)'
                                      : 'var(--text-2)',
                                cursor: liveSyncSupported === false ? 'not-allowed' : 'pointer'
                              }}
                              {...tip(
                                liveSyncSupported === false
                                  ? 'Live sync requires Microsoft 365 Business account'
                                  : gateRefused || gateChecking
                                    ? liveSyncGateStatus(liveSyncGate.reasonCode).label
                                    : liveSyncEnabled && liveSyncStatus === 'connected'
                                      ? 'Live sync is active - changes sync in real-time'
                                      : liveSyncStatus === 'connecting'
                                        ? 'Connecting to Excel...'
                                        : liveSyncStatus === 'error'
                                          ? 'Live sync error - click to retry'
                                          : 'Enable live sync for real-time Excel updates',
                                'below'
                              )}
                            >
                              <span style={{ width: '14px', textAlign: 'center', fontSize: '12px' }}>
                                {liveSyncStatus === 'connecting' || gateChecking
                                  ? '...'
                                  : liveSyncEnabled && liveSyncStatus === 'connected'
                                    ? '●'
                                    : '○'}
                              </span>
                              Live Sync
                            </div>
                            );
                          })()}
                          {selectedTemplate?.isOneDrive && (() => {
                            // Slice 4 — guided "Verify Live Sync": a READ-ONLY,
                            // step-by-step check of the whole live-sync path. The
                            // verdict (and the running state) comes from the shared
                            // excelSyncStatus vocabulary — never an inline literal.
                            const verifying = liveSyncVerify?.state === 'checking';
                            const verdict = liveSyncVerify?.state === 'done'
                              ? liveSyncVerifyStatus(liveSyncVerify.verdictCode)
                              : null;
                            const verdictColor = verdict ? SYNC_TONE_COLORS[verdict.tone]?.color : null;
                            return (
                            <div
                              onClick={() => {
                                if (verifying) return;
                                if (typeof onVerifyLiveSync === 'function') onVerifyLiveSync();
                              }}
                              role="menuitem"
                              className="survey-rail__menu-item"
                              style={{
                                color: verifying ? 'var(--warning)' : (verdictColor || 'var(--text-2)'),
                                cursor: verifying ? 'wait' : 'pointer'
                              }}
                              {...tip(
                                verifying
                                  ? liveSyncVerifyStatus('verifying').label
                                  : verdict
                                    ? verdict.label
                                    : liveSyncVerifyStatus('idle').label,
                                'below'
                              )}
                            >
                              <span style={{ width: '14px', textAlign: 'center', fontSize: '12px' }}>
                                {verifying ? '...' : verdict ? (liveSyncVerify.ready ? <Icon name="check" size={14} /> : '!') : '○'}
                              </span>
                              Verify Live Sync
                            </div>
                            );
                          })()}
                                      </div>
                                    )}
                        </div>
                      )}
                    </div>
                  )}
                  </>
                  ) : (
                    <div style={{
                      flex: 1,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--surface-1)',
                      fontFamily: FONT_FAMILY
                    }}>
                      {/* UX 2026-09-23 (owner: phone Survey panel integrated): the
                          phone header is one slim line - a one-line title, Exit
                          Survey as a quiet red word, and the standard close glyph -
                          where it was an eyebrow, an 18px title and a round plated X.
                          UX 2026-09-23 (owner: desktop survey polish, "these two
                          massive cards should not be so big. Polish it like bookmarks
                          and spaces"): desktop is the same one-line 40px header as
                          Bookmarks and Spaces, a 13px title where it was 18px. */}
                      <div className={mobileMode ? 'mobile-survey-head' : 'survey-rail__head'}>
                        {mobileMode ? (
                          <h2 className="mobile-survey-head-title">Choose a survey template</h2>
                        ) : (
                          <h2 className="survey-rail__title">Choose a survey template</h2>
                        )}
                        {mobileMode && (
                          <div className="mobile-survey-head-actions">
                          <button type="button" className="mobile-survey-exit" onClick={exitSurveyMode}>
                            Exit Survey
                          </button>
                          <button
                            type="button"
                            className="mobile-survey-close"
                            aria-label="Close Survey panel"
                            onClick={() => {
                              setIsSurveyPanelCollapsed(true);
                              requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
                            }}
                          >
                            <Icon name="close" size={18} color="currentColor" />
                          </button>
                          </div>
                        )}
                      </div>
                      <div className={mobileMode ? 'mobile-survey-picker-body' : 'survey-rail__body'}>
                        {availableSurveyTemplates.length === 0 ? (
                          <div style={{
                            minHeight: '160px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            color: 'var(--text-3)',
                            textAlign: 'center'
                          }}>
                            <Icon name="survey" size={26} color="var(--text-3)" />
                            <div style={{ color: 'var(--text-2)', fontSize: '13px', fontWeight: 600 }}>
                              No templates available
                            </div>
                          </div>
                        ) : (
                          /* UX 2026-09-23 (owner: "I don't think the templates should be
                             these different cards"): on the phone the templates are
                             lines in ONE panel - name, then its module count and a
                             chevron on the right - parted by hairlines, like the home
                             Templates list. Desktop (2026-09-23, desktop survey polish):
                             the same lines, 32px, with the hairline reaching both edges
                             of the rail - no card, no clipboard icon. */
                          <div
                            className={mobileMode ? 'mobile-survey-card mobile-survey-template-list' : undefined}
                          >
                            {availableSurveyTemplates.map(template => {
                              const modules = (template.modules || template.spaces) || [];
                              const moduleCount = modules.length;

                              return (
                                <button
                                  key={template.id}
                                  type="button"
                                  /* Phone: a 44px line with a :active pressed fill — hover
                                     styling is a dead affordance on touch, so the mouse
                                     handlers are desktop-only. */
                                  className={mobileMode ? 'mobile-survey-template-row' : 'survey-rail__template-row'}
                                  onClick={() => {
                                    onSelectSurveyTemplate?.(template);
                                  }}
                                >
                                  <span className={mobileMode ? 'mobile-survey-template-name' : 'survey-rail__template-name'}>{template.name || 'Untitled template'}</span>
                                  <span className={mobileMode ? 'mobile-survey-template-meta' : 'survey-rail__template-meta'}>
                                    {moduleCount} module{moduleCount === 1 ? '' : 's'}
                                  </span>
                                  <Icon name="chevronRight" size={mobileMode ? 14 : 12} color="currentColor" />
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}


                </>
              )}

              {/* Microsoft Reconnect Banner */}
              {!isSurveyPanelCollapsed && msNeedsReconnect && selectedTemplate?.isOneDrive && (
                <div style={{
                  padding: '10px 12px',
                  borderTop: '1px solid var(--border)',
                  background: COLORS.modal.panel,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: COLORS.modal.textPrimary, fontSize: '12px', fontWeight: 600, marginBottom: '2px', fontFamily: FONT_FAMILY }}>
                      Microsoft session expired
                    </div>
                    <div style={{ color: COLORS.modal.textMuted, fontSize: '11px', fontFamily: FONT_FAMILY }}>
                      Reconnect to sync with OneDrive
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={msLogin}
                    style={{
                      background: COLORS.modal.primaryButton,
                      border: `1px solid ${COLORS.modal.borderActive}`,
                      color: COLORS.modal.textPrimary,
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontFamily: FONT_FAMILY
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = COLORS.modal.primaryButtonHover;
                      e.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = COLORS.modal.primaryButton;
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    Reconnect
                  </button>
                </div>
              )}

            </div>
            {/* Desktop-only Create Category modal (opened by the heading-row
                plus button). Duplicate-name data comes straight from props the
                rail already receives: the selected module's categories and the
                app template list. */}
            {!mobileMode && (
              <CreateCategoryModal
                isOpen={isCreateCategoryModalOpen}
                onClose={() => setIsCreateCategoryModalOpen(false)}
                onConfirm={handleCreateCategoryConfirm}
                moduleName={activeSurveyModule?.name || ''}
                templateName={selectedTemplate?.name || ''}
                existingCategoryNames={(activeSurveyModule?.categories || []).map((category) => category?.name).filter(Boolean)}
                existingTemplateNames={availableSurveyTemplates.map((template) => template?.name).filter(Boolean)}
                templateId={selectedTemplate?.supabaseId || selectedTemplate?.id || null}
                currentSurveyId={pdfFile?.id || null}
              />
            )}

            {/* KAL-57: themed confirm dialog for the rail's three bulk-delete
                actions, replacing native confirm(). Rendered unconditionally
                (including mobile) so any delete path can await it; it renders
                nothing until a handler opens it. */}
            {confirmDialogElement}
          </>
  );
};

export default SurveySpacesRail;
