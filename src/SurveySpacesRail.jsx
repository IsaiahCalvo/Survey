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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Icon from './Icons';
import CreateCategoryModal from './components/CreateCategoryModal';
import EntityIndicator from './components/EntityIndicator';
import Spinner from './components/Spinner';
import { useTooltip } from './components/Tooltip';
import DragRearrangeHandle from './reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from './reorder/SortableRearrangeList';
import { moveItemById } from './reorder/flatReorderUtils.js';
import { COLORS } from './theme';
import reviewWarningIcon from './assets/review-warning.svg';
import { SYNC_TONE_COLORS, liveSyncGateStatus, liveSyncVerifyStatus, syncMessagePresentation } from './services/excelSyncStatus';
import { compareSurveyMarkersForOrder } from './utils/surveyMarkerOrdering';
import { resolveSurveyModuleStep } from './utils/surveyModuleNav';
import { showToast } from './utils/toast';
import { useConfirmDialog } from './components/dialogPrompts';
import { useMobileSheetMotion } from './mobile/useMobileSheetMotion';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Capture pointerdown: the page layer preventDefaults pointerdown while a
// creation tool is armed, which suppresses the compatibility mousedown these
// rail menus used to wait on. Consume page-surface dismiss so it does not
// start a rubber-band (same contract as Pages context / AppShell exclusive layer).
const dismissOnOutsidePageAwarePointerDown = (event, isInside, close) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (isInside(target)) return;
  close();
  const onPageSurface = target?.closest?.('[data-svg-annotation-layer]')
    || target?.closest?.('.survey-pdfjs-page-div')
    || target?.closest?.('.textLayer');
  if (onPageSurface) {
    event.preventDefault();
    event.stopPropagation();
  }
};

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
        {selected && <span className="survey-marker-leading-checkmark">✓</span>}
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
              ×
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
  checkpointSurveyCategoryDelete = null,
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
  setNoteDialogContent,
  setNoteDialogOpen,
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
  addHistoryCheckpoint = null,
}) => {
  // KAL-65: rail controls use the app's instant shared tooltip, never a native
  // title= (the OS tooltip takes ~1.5s and is styled by the OS, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  // KAL-57: themed replacement for the native confirm() that gated the three
  // bulk-delete actions in this rail (categories, copied items, category
  // items). Promise-based so each handler keeps its original
  // `if (!confirmed) return;` shape and nothing deletes before the user answers.
  const [askConfirm, confirmDialogElement] = useConfirmDialog();
  const [isSurveyPanelCollapsed, setIsSurveyPanelCollapsed] = useState(true);
  const [openEntityDropdownId, setOpenEntityDropdownId] = useState(null);
  const [isModuleSelectorOpen, setIsModuleSelectorOpen] = useState(false);
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
  // Mobile-only export menu in the sheet header (demo SurveySheet.tsx:324-348);
  // desktop keeps its bottom EXPORT bar untouched.
  const [isMobileExportMenuOpen, setIsMobileExportMenuOpen] = useState(false);
  // Mobile-only Survey Marker detail view state (demo SurveySheet.tsx):
  // which small dropdown is open inside the detail view, and the in-sheet
  // notes editor takeover with its local drafts (committed only on Save,
  // mirroring the desktop Note dialog's draft-then-save behavior).
  const [mobileDetailDropdown, setMobileDetailDropdown] = useState(null); // 'entity' | 'markerItem' | null
  const [mobileNotesEditorOpen, setMobileNotesEditorOpen] = useState(false);
  const [mobileNoteDraft, setMobileNoteDraft] = useState({ text: '', photos: [], videos: [] });
  // Desktop-only Create Category flow: the plus button in the "Categories"
  // heading row and the empty-module text button both open CreateCategoryModal
  // (the old route called onRequestCreateTemplate start-adding, which only
  // reseeds entities after KAL-82 removed the template-editor modal).
  // Persistence lives in PDFViewer via addCategoryToCurrentTemplate /
  // addCategoryAsNewTemplate.
  const [isCreateCategoryModalOpen, setIsCreateCategoryModalOpen] = useState(false);
  const [railIconHover, setRailIconHover] = useState(null);
  const moduleSelectorRef = useRef(null);
  const templateSelectorRef = useRef(null);
  const mobileExportMenuRef = useRef(null);
  const surveyMarkerDragRestoreRef = useRef(null);
  const availableSurveyTemplates = Array.isArray(surveyTemplates) ? surveyTemplates : [];
  const pickSurveyTemplate = (template) => {
    setIsTemplateSelectorOpen(false);
    if (!template || template.id === selectedTemplate?.id) return;
    onSelectSurveyTemplate?.(template);
  };
  const surveyModuleOptions = selectedTemplate ? ((selectedTemplate.modules || selectedTemplate.spaces) || []) : [];
  const selectedModuleIndex = surveyModuleOptions.findIndex((module) => module.id === selectedModuleId);
  const activeSurveyModule = selectedModuleIndex >= 0 ? surveyModuleOptions[selectedModuleIndex] : null;
  const previousModuleAction = resolveSurveyModuleStep({
    modules: surveyModuleOptions,
    selectedModuleId,
    direction: 'previous',
  });
  const nextModuleAction = resolveSurveyModuleStep({
    modules: surveyModuleOptions,
    selectedModuleId,
    direction: 'next',
  });
  const canSelectPreviousModule = previousModuleAction.kind === 'select';
  const canSelectNextModule = nextModuleAction.kind === 'select';

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
  // UX (mobile demo parity): when exactly one Survey Marker is flagged expanded
  // on mobile, the sheet swaps its category list for a marker DETAIL view
  // (demo SurveySheet.tsx). Selection rides the existing expandedSurveyMarkers
  // state — the same state PDFViewer already sets when a placed Survey Marker
  // is tapped or a newly placed one commits — so no new plumbing is needed.
  const mobileDetailMarkerId = mobileMode
    ? (Object.keys(expandedSurveyMarkers || {}).find((id) => expandedSurveyMarkers[id] && surveyMarkers?.[id]) || null)
    : null;
  const mobileDetailMarker = mobileDetailMarkerId
    ? { ...surveyMarkers[mobileDetailMarkerId], id: mobileDetailMarkerId }
    : null;
  const mobileDetailModule = mobileDetailMarker
    ? (surveyModuleOptions.find((module) => module.id === mobileDetailMarker.moduleId) || null)
    : null;
  const mobileDetailCategory = mobileDetailModule
    ? ((mobileDetailModule.categories || []).find((category) => category.id === mobileDetailMarker.categoryId) || null)
    : null;
  const mobileDetailChecklist = mobileDetailCategory
    ? (mobileDetailCategory.checklist || []).filter((item) => item && item.archived !== true)
    : [];
  // Demo pageUtils.ts:1-12 — detail sheet = 314px fixed body + a checklist
  // window of 36px rows with 5px gaps, max 4 visible before it scrolls.
  const mobileChecklistVisibleCount = Math.min(4, Math.max(1, mobileDetailChecklist.length));
  const mobileChecklistWindowHeight = (mobileChecklistVisibleCount * 36) + ((mobileChecklistVisibleCount - 1) * 5);
  const mobileSurveyPanelBaseHeight = mobileDetailMarker
    ? 314 + mobileChecklistWindowHeight
    : selectedTemplate
      ? 392
      : 154 + Math.max(availableSurveyTemplates.length, 1) * 48;

  // Phase F (motion & feel): the survey sheet gets the same finger-follow drag +
  // velocity dismiss (dy>82 or vy>0.65) + spring-back + slide-down exit as the
  // hub/spaces sheets, replacing the old flat 48px touchend delta. Demo
  // SurveySetupSheet.tsx:51-96 / inv-demo §17. The real collapse still re-runs
  // the layout-driven zoom after the sheet finishes sliding down.
  // P2-35(b): ignore a stale delayed hide if the sheet reopens while the
  // close timer is in flight. Drag-dismiss still hides — ignore is armed
  // only when `closing` is already true.
  const ignoreNextSurveyHideRef = useRef(false);
  const afterSurveyHideRef = useRef(null);
  const collapseSurveySheet = useCallback(() => {
    if (ignoreNextSurveyHideRef.current) {
      ignoreNextSurveyHideRef.current = false;
      afterSurveyHideRef.current = null;
      return;
    }
    const afterHide = afterSurveyHideRef.current;
    afterSurveyHideRef.current = null;
    setIsSurveyPanelCollapsed(true);
    afterHide?.();
    requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
  }, [applyLayoutDrivenZoom]);
  const {
    motionStyle: surveySheetMotionStyle,
    dragHandlers: surveySheetDragHandlers,
    requestClose: requestSurveySheetClose,
    resetMotion: resetSurveySheetMotion,
    closing: surveySheetClosing,
  } = useMobileSheetMotion(collapseSurveySheet);

  const markSurveySheetOpen = useCallback(() => {
    if (surveySheetClosing) {
      ignoreNextSurveyHideRef.current = true;
      afterSurveyHideRef.current = null;
    }
    resetSurveySheetMotion?.();
  }, [resetSurveySheetMotion, surveySheetClosing]);

  const dismissSurveySheet = useCallback(() => {
    if (isSurveyPanelCollapsed) return;
    ignoreNextSurveyHideRef.current = false;
    if (!mobileMode) {
      setIsSurveyPanelCollapsed(true);
      requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
      return;
    }
    requestSurveySheetClose();
  }, [applyLayoutDrivenZoom, isSurveyPanelCollapsed, mobileMode, requestSurveySheetClose]);

  const selectSurveyModule = (moduleId) => {
    if (!moduleId || moduleId === selectedModuleId) {
      setIsModuleSelectorOpen(false);
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
    }
    setIsModuleSelectorOpen(false);
  };

  const exitSurveyMode = () => {
    const doExit = () => {
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
      setIsSurveyPanelCollapsed(true);
    };
    if (mobileMode && !isSurveyPanelCollapsed) {
      afterSurveyHideRef.current = doExit;
      dismissSurveySheet();
      return;
    }
    doExit();
  };

  useEffect(() => {
    if (showSurveyPanel) {
      markSurveySheetOpen();
      setIsSurveyPanelCollapsed(false);
    }
    // Only the survey-mode flag should expand. markSurveySheetOpen identity
    // churn (mobile closing=true) must not re-expand or arm ignoreNextSurveyHide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSurveyPanel]);

  useEffect(() => {
    if (expandRequestKey > 0) {
      markSurveySheetOpen();
      setIsSurveyPanelCollapsed(false);
    }
    // Only the key should re-open. markSurveySheetOpen identity churn
    // (mobile closing=true) must not re-expand or arm ignoreNextSurveyHide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandRequestKey]);

  useEffect(() => {
    if (collapseRequestKey > 0) dismissSurveySheet();
    // Only the key should trigger a chrome-driven close. dismissSurveySheet
    // identity churn (collapsed flag) must not re-fire the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseRequestKey]);

  useEffect(() => {
    if (!isModuleSelectorOpen) return undefined;

    const handlePointerDown = (event) => {
      dismissOnOutsidePageAwarePointerDown(
        event,
        (target) => !!moduleSelectorRef.current?.contains(target),
        () => setIsModuleSelectorOpen(false),
      );
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setIsModuleSelectorOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isModuleSelectorOpen]);

  useEffect(() => {
    if (!isTemplateSelectorOpen) return undefined;

    const handlePointerDown = (event) => {
      dismissOnOutsidePageAwarePointerDown(
        event,
        (target) => !!templateSelectorRef.current?.contains(target),
        () => setIsTemplateSelectorOpen(false),
      );
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setIsTemplateSelectorOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isTemplateSelectorOpen]);

  useEffect(() => {
    if (!isMobileExportMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      dismissOnOutsidePageAwarePointerDown(
        event,
        (target) => !!mobileExportMenuRef.current?.contains(target),
        () => setIsMobileExportMenuOpen(false),
      );
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setIsMobileExportMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isMobileExportMenuOpen]);

  useEffect(() => {
    if (!showExportMenu) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setShowExportMenu(false);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [showExportMenu, setShowExportMenu]);

  useEffect(() => {
    if (isSurveyPanelCollapsed) setIsMobileExportMenuOpen(false);
  }, [isSurveyPanelCollapsed]);

  // Reset detail-local UI whenever the selected Survey Marker changes so the
  // notes takeover / dropdowns never carry over to another marker.
  useEffect(() => {
    setMobileDetailDropdown(null);
    setMobileNotesEditorOpen(false);
  }, [mobileDetailMarkerId]);

  // UX (mobile demo parity): collapsing the sheet clears the marker selection
  // so the next open starts on the category list — mirrors the demo survey
  // dock button clearing the selected marker before opening the setup sheet
  // (demo App.tsx:389-393).
  useEffect(() => {
    if (mobileMode && isSurveyPanelCollapsed) {
      setExpandedSurveyMarkers((prev) => (Object.keys(prev || {}).length ? {} : prev));
      setMobileNotesEditorOpen(false);
      setMobileDetailDropdown(null);
    }
  }, [mobileMode, isSurveyPanelCollapsed, setExpandedSurveyMarkers]);

  // Outside-tap / Escape close the detail view's entity / sibling-marker
  // dropdowns. Capture-Escape so survey undo-Esc does not pop a place.
  useEffect(() => {
    if (!mobileDetailDropdown) return undefined;
    const handlePointerDown = (event) => {
      dismissOnOutsidePageAwarePointerDown(
        event,
        (target) => !!target?.closest?.('.mobile-survey-detail-dropdown-wrap'),
        () => setMobileDetailDropdown(null),
      );
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMobileDetailDropdown(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [mobileDetailDropdown]);

  useEffect(() => {
    if (typeof onCollapseChange === 'function') {
      onCollapseChange(isSurveyPanelCollapsed);
    }
  }, [isSurveyPanelCollapsed, onCollapseChange]);

  useEffect(() => {
    if (!openEntityDropdownId) return undefined;
    const closeEntityDropdown = (event) => {
      dismissOnOutsidePageAwarePointerDown(
        event,
        (target) => !!target?.closest?.('.survey-marker-entity-select-wrap'),
        () => setOpenEntityDropdownId(null),
      );
    };
    const closeEntityDropdownOnEscape = (event) => {
      if (event.key === 'Escape') setOpenEntityDropdownId(null);
    };
    document.addEventListener('pointerdown', closeEntityDropdown, true);
    document.addEventListener('keydown', closeEntityDropdownOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeEntityDropdown, true);
      document.removeEventListener('keydown', closeEntityDropdownOnEscape, true);
    };
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

  // DEV / ?testPdf= seam: Excel-imported unlocated items are leftover-18.
  // Playwright seeds one local marker without bounds so Set location is reachable.
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
    window.__e2eSurveyMarkers = {
      get: () => surveyMarkers,
      patch: (updater) => {
        setSurveyMarkers((prev) => (
          typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }
        ));
      },
    };
    window.__e2eSurveyItemOrder = {
      get: (categoryId) => Object.entries(surveyMarkers)
        .filter(([, marker]) => !categoryId || marker.categoryId === categoryId)
        .map(([id, marker]) => ({
          id,
          name: marker.name,
          surveyMarkerOrder: marker.surveyMarkerOrder ?? null,
          categoryId: marker.categoryId,
        }))
        .sort((a, b) => compareSurveyMarkersForOrder(
          { ...surveyMarkers[a.id], id: a.id },
          { ...surveyMarkers[b.id], id: b.id },
        )),
    };
    return () => {
      try { delete window.__e2eSurveyMarkers; } catch { /* ignore */ }
      try { delete window.__e2eSurveyItemOrder; } catch { /* ignore */ }
    };
  }, [surveyMarkers, setSurveyMarkers]);

  // DEV / ?testPdf= seam: read stored module category order after rail
  // drag-reorder (selectedTemplate, not the static seed array).
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
    window.__e2eSurveyCategoryOrder = {
      get: (moduleId) => {
        const modules = selectedTemplate?.modules || selectedTemplate?.spaces || [];
        const module = (moduleId && modules.find((m) => m.id === moduleId))
          || modules.find((m) => m.id === selectedModuleId)
          || modules[0];
        return (module?.categories || []).map((category) => ({
          id: category.id,
          name: category.name,
        }));
      },
    };
    return () => {
      try { delete window.__e2eSurveyCategoryOrder; } catch { /* ignore */ }
    };
  }, [selectedTemplate, selectedModuleId]);

  const pendingLocationArmedRef = useRef(false);
  const beginSetLocationOnPdf = (marker) => {
    if (!marker) return;
    pendingLocationArmedRef.current = true;
    setPendingLocationItem(marker);
    setActiveCategoryDropdown('survey');
    setActiveTool('survey-marker');
    if (marker.categoryId) {
      setSelectedCategoryId(marker.categoryId);
    }
  };
  const locateOrSetSurveyMarker = (marker) => {
    if (marker?.bounds && marker?.pageNumber) {
      handleLocateItemOnPDF(marker);
      return;
    }
    beginSetLocationOnPdf(marker);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (!pendingLocationArmedRef.current) return;
      pendingLocationArmedRef.current = false;
      setPendingLocationItem(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPendingLocationItem]);

  const commitSurveyMarkerName = (annotationId, categoryId, previousName, nextRawName, fallbackName) => {
    const nextName = (nextRawName || '').trim() || fallbackName;
    const oldName = (previousName || '').trim() || fallbackName;
    if (!annotationId || nextName === oldName) return;

    const currentMarker = surveyMarkers[annotationId] || {};
    if (typeof addHistoryCheckpoint === 'function') {
      addHistoryCheckpoint('survey-marker:rename', { annotationId });
    }
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
  const applyEntitySelectionForMarker = (annotationId, markerModuleId, category, entityId) => {
    const { matchingItem, moduleData, dataKey } = findMarkerMatchingItem(annotationId, markerModuleId, category);
    const entities = selectedTemplate?.entities || [];
    const entity = entityId ? entities.find(e => e.id === entityId) : null;
    const previousEntityId = moduleData.entityId || surveyMarkers[annotationId]?.entityId || '';
    const nextEntityId = entity?.id || '';
    if (previousEntityId === nextEntityId) return;

    // Sibling of survey-marker:rename — without this, Ctrl+Z pops the
    // highlight:create place instead of restoring the prior entity.
    if (typeof addHistoryCheckpoint === 'function') {
      addHistoryCheckpoint('survey-marker:entity', { annotationId, entityId: nextEntityId || null });
    }

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

  // Verbatim re-housing of the desktop checklist Y/N/N-A click handler
  // (previously inline in the expanded marker row) so the mobile detail view
  // and the desktop row share one implementation, including the KAL-44
  // auto-"Complete"-entity behavior when every active item is Y or N/A.
  const applyChecklistResponseSelection = (annotationId, markerModuleId, category, markerRowName, checklistItemId, option) => {
    setSurveyMarkers(prev => {
      const updated = {
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
      };

      // Check if all checklist items are Y or N/A.
      // KAL-44: archived items don't gate auto-complete; only
      // active items count toward "all complete".
      const updatedSurveyMarker = updated[annotationId];
      const activeChecklist = (category.checklist || []).filter(it => it && it.archived !== true);
      if (updatedSurveyMarker && activeChecklist.length > 0 && selectedTemplate && selectedSpaceId) {
        const allItemsComplete = activeChecklist.every(checklistItem => {
          const response = updatedSurveyMarker.checklistResponses?.[checklistItem.id];
          const selection = response?.selection;
          return selection === 'Y' || selection === 'N/A';
        });

        // Find the item associated with this surveyMarker
        const surveyMarkerData = updated[annotationId];
        const categoryName = getCategoryName(selectedTemplate, markerModuleId, category.id);
        const surveyMarkerName = surveyMarkerData?.name || markerRowName || '';
        const matchingItem = itemsByNameType.get(`${surveyMarkerName}\0${categoryName}`);

        // Get module-specific data
        const moduleName = getModuleName(selectedTemplate, markerModuleId);
        const dataKey = getModuleDataKey(moduleName);
        const moduleData = matchingItem?.[dataKey] || {};

        // If all items are Y or N/A, automatically set entity to "Complete"
        if (allItemsComplete) {
          // Find the "Complete" entity
          const entities = selectedTemplate.entities || [];
          const completeEntity = entities.find(e =>
            e.name.toLowerCase().includes('complete')
          );

          if (completeEntity) {
            const entityColor = normalizeSurveyMarkerColor(completeEntity.color) || completeEntity.color || hexToRgba('#E3D1FB', DEFAULT_SURVEY_MARKER_OPACITY);
            // Update item's module-specific data with Complete entity status
            if (matchingItem) {
              const updatedItem = {
                ...matchingItem,
                [dataKey]: {
                  ...moduleData,
                  entityId: completeEntity.id,
                  entityName: completeEntity.name,
                  entityColor: entityColor
                }
              };

              setItems(prev2 => ({
                ...prev2,
                [matchingItem.itemId]: updatedItem
              }));

              // Update all annotations for this item in this module with the new color
              setAnnotations(prev2 => {
                const updatedAnns = { ...prev2 };
                Object.values(updatedAnns).forEach(ann => {
                  const annModuleId = ann.moduleId || ann.spaceId; // Support legacy spaceId
                  if (ann.itemId === matchingItem.itemId && annModuleId === markerModuleId) {
                    updatedAnns[ann.annotationId] = {
                      ...ann,
                      entityId: completeEntity.id,
                      entityName: completeEntity.name,
                      entityColor: entityColor
                    };
                  }
                });
                return updatedAnns;
              });

              // Update surveyMarker color on PDF
              if (surveyMarkerData?.pageNumber && surveyMarkerData?.bounds) {
                setNewSurveyMarkersByPage(prev2 => {
                  const pageSurveyMarkers = prev2[surveyMarkerData.pageNumber] || [];
                  // Remove any existing surveyMarker with this annotationId or same bounds (regardless of needsEntity or color)
                  const filtered = pageSurveyMarkers.filter(h => {
                    // Keep surveyMarkers that don't match by ID or bounds
                    const hasMatchingId = h.annotationId === annotationId;
                    const hasMatchingBounds = h.x === surveyMarkerData.bounds.x &&
                      h.y === surveyMarkerData.bounds.y &&
                      h.width === surveyMarkerData.bounds.width &&
                      h.height === surveyMarkerData.bounds.height;
                    // Remove if it matches by ID or bounds
                    return !hasMatchingId && !hasMatchingBounds;
                  });
                  return {
                    ...prev2,
                    [surveyMarkerData.pageNumber]: [
                      ...filtered,
                      {
                        ...surveyMarkerData.bounds,
                        color: entityColor,
                        annotationId: annotationId
                      }
                    ]
                  };
                });
              }
            }

            // Update survey marker annotation with Complete entity status
            updated[annotationId] = {
              ...updated[annotationId],
              entityId: completeEntity.id,
              entityName: completeEntity.name,
              entityColor: entityColor
            };
          }
        } else {
          // Not all items are Y or N/A - remove entity status (set to None)
          if (matchingItem) {
            const updatedItem = {
              ...matchingItem,
              [dataKey]: {
                ...moduleData,
                entityId: undefined,
                entityName: undefined,
                entityColor: undefined
              }
            };

            setItems(prev2 => ({
              ...prev2,
              [matchingItem.itemId]: updatedItem
            }));

            // Update all annotations for this item in this space
            setAnnotations(prev2 => {
              const updatedAnns = { ...prev2 };
              Object.values(updatedAnns).forEach(ann => {
                if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
                  updatedAnns[ann.annotationId] = {
                    ...ann,
                    entityId: undefined,
                    entityName: undefined,
                    entityColor: undefined
                  };
                }
              });
              return updatedAnns;
            });

            // Update surveyMarker on PDF - revert to "needs entity" state (transparent with dashed outline)
            if (surveyMarkerData?.pageNumber && surveyMarkerData?.bounds) {
              setNewSurveyMarkersByPage(prev2 => {
                const pageSurveyMarkers = prev2[surveyMarkerData.pageNumber] || [];
                // Remove any existing surveyMarker with this annotationId or same bounds (regardless of needsEntity or color)
                const filtered = pageSurveyMarkers.filter(h => {
                  // Keep surveyMarkers that don't match by ID or bounds
                  const hasMatchingId = h.annotationId === annotationId;
                  const hasMatchingBounds = h.x === surveyMarkerData.bounds.x &&
                    h.y === surveyMarkerData.bounds.y &&
                    h.width === surveyMarkerData.bounds.width &&
                    h.height === surveyMarkerData.bounds.height;
                  // Remove if it matches by ID or bounds
                  return !hasMatchingId && !hasMatchingBounds;
                });
                // Add "needs entity" surveyMarker (transparent with dashed outline)
                return {
                  ...prev2,
                  [surveyMarkerData.pageNumber]: [
                    ...filtered,
                    {
                      ...surveyMarkerData.bounds,
                      needsEntity: true,
                      annotationId: annotationId
                    }
                  ]
                };
              });
            }
          }

          // Update survey marker annotation to remove entity status
          updated[annotationId] = {
            ...updated[annotationId],
            entityId: undefined,
            entityName: undefined,
            entityColor: undefined
          };
        }
      }

      return updated;
    });
  };

  // Photo/Video-only notes still count as a saved note. The Add/Edit
  // chrome used to key off note.text, so an attachments-only Save left
  // the button labeled Add.
  const noteHasContent = (note) => Boolean(
    (typeof note?.text === 'string' && note.text.trim())
    || (Array.isArray(note?.photos) && note.photos.length)
    || (Array.isArray(note?.videos) && note.videos.length)
  );

  // ——— Mobile in-sheet notes editor (demo SurveySheet.tsx:191-283) ———
  const openMobileNotesEditor = () => {
    const note = surveyMarkers?.[mobileDetailMarkerId]?.note || {};
    setMobileNoteDraft({
      text: note.text || '',
      photos: Array.isArray(note.photos) ? note.photos : [],
      videos: Array.isArray(note.videos) ? note.videos : []
    });
    setMobileDetailDropdown(null);
    setMobileNotesEditorOpen(true);
  };

  // Same write as the desktop Note dialog's Save (PDFViewer Note Dialog):
  // patch the marker's `note` through setSurveyMarkers so persistence and
  // sync see the identical operation.
  const saveMobileNotes = () => {
    const annotationId = mobileDetailMarkerId;
    if (!annotationId) return;
    setSurveyMarkers(prev => ({
      ...prev,
      [annotationId]: {
        ...(prev[annotationId] || {}),
        note: {
          text: mobileNoteDraft.text,
          photos: mobileNoteDraft.photos,
          videos: mobileNoteDraft.videos
        }
      }
    }));
    setMobileNotesEditorOpen(false);
  };

  // Reuses the desktop Note dialog's FileReader/dataUrl attachment shape
  // ({ name, dataUrl }) so saved attachments render in both editors.
  const addMobileNoteMedia = (kind, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    Promise.all(files.map(file => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve({ name: file.name, dataUrl: event.target.result });
      reader.readAsDataURL(file);
    }))).then(media => {
      setMobileNoteDraft(prev => ({ ...prev, [kind]: [...prev[kind], ...media] }));
    });
  };

  const surveyMarkerRowActionStyle = {
    width: '22px',
    height: '22px',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 0.2s, color 0.2s',
    marginLeft: 0,
    flex: '0 0 22px',
    transform: 'none',
    boxShadow: 'none'
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
      borderColor: exactColor ? 'rgba(255, 255, 255, 0.58)' : '#5a6473',
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

    // Sibling of survey-marker:rename / :entity — without this, Ctrl+Z
    // pops the last place instead of restoring the prior rail order.
    if (typeof addHistoryCheckpoint === 'function') {
      addHistoryCheckpoint('survey-marker:reorder', { activeId, overId });
    }

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
  }, [addHistoryCheckpoint, setSurveyMarkers]);

  return (
          <>
            {mobileMode && !isSurveyPanelCollapsed && (
              <button
                type="button"
                className="mobile-pdf-sheet-backdrop"
                aria-label="Close Survey panel"
                onClick={dismissSurveySheet}
              />
            )}
            {/* Panel */}
            {/* UX 2026-05-29: the right rail starts at the same y-coordinate as
                chrome-sub-toolbar-host. It overlays the right edge of that strip
                instead of pushing or sitting below it, mirroring the left rail's
                top collapse row. */}
            <div
              className={`${mobileMode ? 'mobile-pdf-sheet ' : ''}${isSurveyPanelCollapsed ? 'is-collapsed' : ''}`}
              style={{
                '--mobile-sheet-height': mobileMode
                  ? `calc(${mobileSurveyPanelBaseHeight}px + var(--mobile-bottom-inset))`
                  : undefined,
                position: mobileMode ? 'fixed' : 'absolute',
                top: mobileMode ? 'auto' : 0,
                right: 0,
                bottom: mobileMode ? 0 : 'auto',
                left: mobileMode ? 0 : 'auto',
                height: mobileMode ? 'var(--mobile-sheet-height)' : '100%',
                width: mobileMode ? '100%' : (isSurveyPanelCollapsed ? '48px' : '320px'),
                background: '#12151c',
                borderLeft: mobileMode ? 'none' : '1px solid #2a3140',
                zIndex: mobileMode ? 6500 : 1,
                display: 'flex',
                flexDirection: 'column',
	                animation: 'slideInRight 0.3s ease-out',
                transition: 'width 0.2s ease, right 0.2s ease, top 0.2s ease, height 0.2s ease',
                // Phase F: finger-follow / spring-back / slide-down exit (mobile
                // sheet only; the .mobile-pdf-sheet CSS !important keyframe still
                // owns the slide-in, this only drives drag/close transforms).
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
                    borderBottom: '1px solid #2a3140',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    background: '#12151c',
                    flexShrink: 0
                  }}>
                    <button
                      type="button"
                      onClick={() => {
                        markSurveySheetOpen();
                        setIsSurveyPanelCollapsed(false);
                        requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
                      }}
                      aria-label="Expand Survey panel"
                      style={{ background: 'transparent', border: 'none', color: '#8d96a6', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#2a3140'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Icon name="chevronLeft" size={16} color="#8d96a6" />
                    </button>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '8px',
                    gap: '4px',
                    background: '#12151c',
                    position: 'relative',
                    flex: 1
                  }}>
                    <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setRailIconHover(null);
                          markSurveySheetOpen();
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
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: showSurveyPanel ? '#d8a84e' : '#8d96a6',
                          cursor: 'pointer',
                          padding: '10px',
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
                          setRailIconHover('survey');
                          e.currentTarget.style.background = '#181c24';
                        }}
                        onMouseLeave={(e) => {
                          setRailIconHover(null);
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <Icon
                          name="survey"
                          size={20}
                          color="currentColor"
                          style={{ width: '20px', height: '20px', flexShrink: 0 }}
                        />
                      </button>
                      {railIconHover === 'survey' && (
                        <div style={{ position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '8px', background: '#181c24', color: '#e8e2d4', padding: '6px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid #2a3140', whiteSpace: 'nowrap', fontFamily: FONT_FAMILY, pointerEvents: 'none', zIndex: 10000, boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)' }}>
                          Survey
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {!isSurveyPanelCollapsed && (
                <>
                  {/* Collapse row: mirrors the left rail's top strip. */}
                  <div
                    className={mobileMode ? 'mobile-pdf-sheet__handle mobile-pdf-sheet__handle--wide' : undefined}
                    onTouchStart={mobileMode ? surveySheetDragHandlers.onTouchStart : undefined}
                    onTouchMove={mobileMode ? surveySheetDragHandlers.onTouchMove : undefined}
                    onTouchEnd={mobileMode ? surveySheetDragHandlers.onTouchEnd : undefined}
                    onTouchCancel={mobileMode ? surveySheetDragHandlers.onTouchCancel : undefined}
                    style={{
                      height: '35px',
                      padding: '0 8px',
                      borderBottom: '1px solid #2a3140',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      background: '#12151c',
                      flexShrink: 0
                    }}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        // Phase F: mobile collapse slides the sheet down first;
                        // desktop collapses immediately (no bottom-sheet motion).
                        // Expand and Collapse share the same 35px header slot.
                        // The second click of a double-click on Expand lands on
                        // this button (detail === 2) and would immediately
                        // re-collapse — ignore that rebound, keep a later
                        // single click as Collapse.
                        if (event.detail > 1) return;
                        dismissSurveySheet();
                      }}
                      aria-label="Collapse Survey panel"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgb(153, 153, 153)',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#2a3140'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Icon name={mobileMode ? 'chevronDown' : 'chevronRight'} size={16} color="#8d96a6" />
                    </button>
                  </div>

                  {selectedTemplate && showSurveyPanel ? (
                  <>
                  {/* Template title lives below the rail tabs, not in the collapse row. */}
                  <div style={{
                    padding: '12px 12px 10px',
                    borderBottom: '1px solid #2a3140',
                    background: '#12151c',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flexShrink: 0
                  }}>
                    <div
                      ref={templateSelectorRef}
                      className={mobileMode ? 'mobile-survey-sheet-title' : undefined}
                      style={{ flex: 1, minWidth: 0, position: 'relative' }}
                    >
                      {mobileMode ? <span className="mobile-survey-sheet-eyebrow">Survey template</span> : null}
                      {mobileMode ? (
                        <button
                          type="button"
                          className="mobile-survey-template-button"
                          aria-label="Choose survey template"
                          aria-haspopup="listbox"
                          aria-expanded={isTemplateSelectorOpen}
                          onClick={() => setIsTemplateSelectorOpen((open) => !open)}
                        >
                          <span>{selectedTemplate.name || 'Survey'}</span>
                          <Icon name="chevronDown" size={13} color="currentColor" />
                        </button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <h2
                          style={{
                            flex: 1,
                            minWidth: 0,
                            margin: 0,
                            fontSize: '18px',
                            fontWeight: '600',
                            color: '#f4f1ea',
                            fontFamily: FONT_FAMILY,
                            letterSpacing: '-0.2px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {categorySelectModeActive && selectedModuleId
                            ? ((selectedTemplate.modules || selectedTemplate.spaces || []).find(m => m.id === selectedModuleId)?.name || 'Survey')
                            : (selectedTemplate.name || 'Survey')}
                        </h2>
                        <button
                          type="button"
                          aria-label="Choose survey template"
                          aria-haspopup="listbox"
                          aria-expanded={isTemplateSelectorOpen}
                          onClick={() => setIsTemplateSelectorOpen((open) => !open)}
                          style={{
                            flex: '0 0 auto',
                            width: '28px',
                            height: '28px',
                            padding: 0,
                            borderRadius: '6px',
                            border: isTemplateSelectorOpen ? '1px solid #d8a84e' : '1px solid #3a4252',
                            background: isTemplateSelectorOpen ? '#2a3140' : '#1f2430',
                            color: '#e8e2d4',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Icon name="chevronDown" size={13} color="currentColor" />
                        </button>
                        </div>
                      )}
                      {isTemplateSelectorOpen && (
                        <div
                          className={mobileMode ? 'mobile-survey-template-menu' : undefined}
                          role="listbox"
                          aria-label="Choose survey template"
                          style={mobileMode ? undefined : {
                            position: 'absolute',
                            left: 0,
                            top: 'calc(100% + 7px)',
                            zIndex: 40,
                            width: '100%',
                            padding: '4px',
                            display: 'grid',
                            gap: '2px',
                            color: '#f2f2f2',
                            background: '#1b1f25',
                            border: '1px solid #3a4250',
                            borderRadius: '7px',
                            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)'
                          }}
                        >
                          {availableSurveyTemplates.length === 0 ? (
                            <div style={{
                              padding: '10px 9px',
                              color: '#8d96a6',
                              fontSize: '12px',
                              fontWeight: 600
                            }}>
                              No templates available
                            </div>
                          ) : availableSurveyTemplates.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              role="option"
                              aria-selected={template.id === selectedTemplate.id}
                              className={template.id === selectedTemplate.id ? 'is-active' : ''}
                              onClick={() => pickSurveyTemplate(template)}
                              style={mobileMode ? undefined : {
                                minHeight: '34px',
                                padding: '0 9px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '8px',
                                color: template.id === selectedTemplate.id ? '#d8a84e' : '#f2f2f2',
                                background: template.id === selectedTemplate.id ? '#2a2218' : 'transparent',
                                border: 0,
                                borderRadius: '5px',
                                fontSize: '12px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                fontFamily: FONT_FAMILY
                              }}
                            >
                              <span>{template.name || 'Untitled Template'}</span>
                              {template.id === selectedTemplate.id ? <Icon name="check" size={13} color="currentColor" /> : null}
                            </button>
                          ))}
                        </div>
                      )}
                      {!categorySelectModeActive && selectedTemplate.linkedExcelPath && lastSyncMessage && (() => {
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
                    <div className={mobileMode ? 'mobile-survey-sheet-header-actions' : undefined}>
                      {/* UX (mobile demo parity): 34px round export button in the sheet
                          header opening a 218px menu with 48px rows (demo
                          SurveySheet.tsx:324-348, styles.ts:2731-2775; accent gold, not
                          demo blue). Wires the SAME handlers as the desktop bottom
                          export bar: "Export Excel" = handleExportSurveyToExcel(),
                          "Sync Microsoft 365" = push to the linked workbook. */}
                      {mobileMode && (
                        <div className="mobile-survey-sheet-export-wrap" ref={mobileExportMenuRef}>
                          <button
                            type="button"
                            className={`mobile-survey-sheet-export${isMobileExportMenuOpen ? ' is-open' : ''}`}
                            aria-label="Export survey data"
                            aria-haspopup="menu"
                            aria-expanded={isMobileExportMenuOpen}
                            disabled={isExporting}
                            onClick={() => setIsMobileExportMenuOpen((open) => !open)}
                          >
                            {isExporting
                              ? <Spinner size={14} color="#f2f2f2" trackColor="rgba(255,255,255,0.3)" />
                              : <Icon name="upload" size={17} color="currentColor" />}
                          </button>
                          {isMobileExportMenuOpen && (
                            <div className="mobile-survey-sheet-export-menu" role="menu" aria-label="Export survey data">
                              <button
                                type="button"
                                role="menuitem"
                                disabled={isExporting}
                                onClick={() => {
                                  setIsMobileExportMenuOpen(false);
                                  handleExportSurveyToExcel();
                                }}
                              >
                                <strong>Export Excel</strong>
                                <span>Create workbook from survey data</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={isExporting || !selectedTemplate.linkedExcelPath || linkedExcelExists !== true}
                                onClick={() => {
                                  setIsMobileExportMenuOpen(false);
                                  handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
                                }}
                              >
                                <strong>Sync Microsoft 365</strong>
                                <span>Update the shared workbook location</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (mobileMode) {
                            dismissSurveySheet();
                          } else {
                            exitSurveyMode();
                          }
                        }}
                        className="btn btn-icon btn-icon-sm"
                        aria-label="Close Survey panel"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#e8e2d4',
                          padding: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Module navigator */}
                  {surveyModuleOptions.length > 0 && (
                    <div className={mobileMode ? 'mobile-survey-module-row' : undefined} style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #2a3140',
                      background: '#12151c',
                      flexShrink: 0
                    }}>
                      <div
                        ref={moduleSelectorRef}
                        style={{
                          position: 'relative',
                          display: 'grid',
                          gridTemplateColumns: '32px minmax(0, 1fr) 32px',
                          gap: '6px',
                          alignItems: 'center'
                        }}
                      >
                        <button
                          type="button"
                          disabled={!canSelectPreviousModule}
                          aria-label="Previous module"
                          onClick={() => {
                            if (previousModuleAction.kind === 'select') {
                              selectSurveyModule(previousModuleAction.moduleId);
                            }
                          }}
                          style={{
                            height: '30px',
                            borderRadius: '6px',
                            border: canSelectPreviousModule ? '1px solid #3a4252' : '1px solid #1f2430',
                            background: canSelectPreviousModule ? '#1f2430' : '#12151c',
                            color: canSelectPreviousModule ? '#e8e2d4' : '#5a6473',
                            cursor: canSelectPreviousModule ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0
                          }}
                        >
                          <Icon name="chevronLeft" size={14} />
                        </button>

                        <button
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={isModuleSelectorOpen}
                          onClick={() => setIsModuleSelectorOpen((open) => !open)}
                          style={{
                            height: '30px',
                            minWidth: 0,
                            borderRadius: '6px',
                            border: '1px solid #d8a84e',
                            background: '#202832',
                            color: '#f4f1ea',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            padding: '0 10px',
                            cursor: 'pointer',
                            fontFamily: FONT_FAMILY,
                            fontSize: '12px',
                            fontWeight: 700
                          }}
                        >
                          <span style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0
                          }}>
                            {activeSurveyModule?.name || 'Select module'}
                          </span>
                          <Icon name="chevronDown" size={12} />
                        </button>

                        <button
                          type="button"
                          disabled={!canSelectNextModule}
                          aria-label="Next module"
                          onClick={() => {
                            if (nextModuleAction.kind === 'select') {
                              selectSurveyModule(nextModuleAction.moduleId);
                            }
                          }}
                          style={{
                            height: '30px',
                            borderRadius: '6px',
                            border: canSelectNextModule ? '1px solid #3a4252' : '1px solid #1f2430',
                            background: canSelectNextModule ? '#1f2430' : '#12151c',
                            color: canSelectNextModule ? '#e8e2d4' : '#5a6473',
                            cursor: canSelectNextModule ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0
                          }}
                        >
                          <Icon name="chevronRight" size={14} />
                        </button>

                        {isModuleSelectorOpen && (
                          <div
                            role="listbox"
                            aria-label="Choose survey module"
                            style={{
                              position: 'absolute',
                              top: '36px',
                              left: '38px',
                              right: '38px',
                              zIndex: 20,
                              background: '#1F2228',
                              border: '1px solid #3A4250',
                              borderRadius: '6px',
                              padding: '4px',
                              boxShadow: '0 10px 24px rgba(0, 0, 0, 0.32)',
                              maxHeight: '190px',
                              overflowY: 'auto'
                            }}
                          >
                            {surveyModuleOptions.map(module => {
                              const isActive = module.id === selectedModuleId;
                              return (
                                <button
                                  key={module.id}
                                  type="button"
                                  role="option"
                                  aria-selected={isActive}
                                  onClick={() => selectSurveyModule(module.id)}
                                  style={{
                                    width: '100%',
                                    minHeight: '28px',
                                    border: 'none',
                                    borderRadius: '4px',
                                    background: isActive ? '#17324D' : 'transparent',
                                    color: isActive ? '#fff' : '#e8e2d4',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '8px',
                                    padding: '5px 8px',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    fontFamily: FONT_FAMILY,
                                    fontSize: '12px',
                                    fontWeight: isActive ? 700 : 500
                                  }}
                                >
                                  <span style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}>
                                    {module.name}
                                  </span>
                                  {isActive && <Icon name="check" size={12} />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
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

                  {/* Panel Content */}
                  {/* UX (mobile demo parity): when a Survey Marker is selected on
                      mobile, the sheet swaps the category list for a marker DETAIL
                      view — mobile-scaled re-housing of the desktop expanded-row
                      controls (rename, entity picker, sibling nav, locate, notes,
                      checklist) modeled on demo SurveySheet.tsx:285-568 /
                      styles.ts:2870-3401. Same handlers + store writes as the
                      desktop rows; the desktop rail is unchanged. */}
                  {mobileDetailMarker ? (() => {
                    const annotationId = mobileDetailMarker.id;
                    const detailCategory = mobileDetailCategory;
                    const detailModuleId = mobileDetailMarker.moduleId;
                    const { moduleData } = findMarkerMatchingItem(annotationId, detailModuleId, detailCategory);
                    const currentEntityId = moduleData.entityId || mobileDetailMarker.entityId;
                    const currentEntity = currentEntityId ? entitiesMap.get(currentEntityId) : null;
                    const detailEntityColor = currentEntity?.color || moduleData.entityColor || mobileDetailMarker.entityColor || null;
                    const detailEntityName = currentEntity?.name || moduleData.entityName || mobileDetailMarker.entityName || 'None';
                    const entityOptions = [
                      { id: '', name: 'None', color: null },
                      ...((selectedTemplate?.entities || []).map(entity => ({ id: entity.id, name: entity.name, color: entity.color })))
                    ];
                    // Sibling nav: every Survey Marker of this category in this
                    // module, in rail order (demo SurveySheet.tsx:459-491).
                    const siblingMarkers = Object.entries(surveyMarkers)
                      .filter(([, marker]) => marker.moduleId === detailModuleId && marker.categoryId === mobileDetailMarker.categoryId)
                      .map(([id, marker]) => ({ ...marker, id }))
                      .sort(compareSurveyMarkersForOrder);
                    const siblingIndex = siblingMarkers.findIndex(marker => marker.id === annotationId);
                    const canSwitchSibling = siblingMarkers.length > 1;
                    const baseCategoryName = detailCategory?.name?.trim() || 'Untitled Category';
                    const fallbackName = `${baseCategoryName} ${siblingIndex >= 0 ? siblingIndex + 1 : siblingMarkers.length + 1}`;
                    const detailMarkerName = mobileDetailMarker.name || fallbackName;
                    const hasNoteText = noteHasContent(surveyMarkers[annotationId]?.note);
                    const imageGlyph = (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.5-3.5L6 23" />
                      </svg>
                    );
                    const videoGlyph = (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2" y="6" width="14" height="12" rx="2" />
                        <path d="m22 8-6 4 6 4V8Z" />
                      </svg>
                    );

                    if (mobileNotesEditorOpen) {
                      // UX (mobile demo parity): full-sheet notes takeover instead of
                      // the 600px desktop Note modal — multiline input, Photo/Video
                      // pickers, attachment rows with remove, Cancel/Save footer
                      // (demo SurveySheet.tsx:191-283; Save accent is the app's gold,
                      // not demo blue, per the parity color rule).
                      return (
                        <div className="mobile-survey-detail mobile-survey-notes">
                          <div className="mobile-survey-notes-title">
                            <span className="mobile-survey-detail-label">Survey Marker notes</span>
                            <span className="mobile-survey-notes-name">{detailMarkerName}</span>
                          </div>
                          <div className="mobile-survey-notes-scroll">
                            <div className="mobile-survey-notes-card">
                              <textarea
                                aria-label="Survey Marker notes"
                                value={mobileNoteDraft.text}
                                onChange={(e) => setMobileNoteDraft(prev => ({ ...prev, text: e.target.value }))}
                                placeholder="Add details..."
                              />
                            </div>
                            <div className="mobile-survey-notes-card">
                              <div className="mobile-survey-notes-attach-header">
                                <span className="mobile-survey-detail-label">Attachments</span>
                                <div className="mobile-survey-notes-upload-row">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    id={`mobile-note-photos-${annotationId}`}
                                    onChange={(e) => {
                                      addMobileNoteMedia('photos', e.target.files);
                                      e.target.value = '';
                                    }}
                                  />
                                  <label htmlFor={`mobile-note-photos-${annotationId}`} className="mobile-survey-notes-upload">
                                    {imageGlyph}
                                    <span>Photo</span>
                                  </label>
                                  <input
                                    type="file"
                                    accept="video/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    id={`mobile-note-videos-${annotationId}`}
                                    onChange={(e) => {
                                      addMobileNoteMedia('videos', e.target.files);
                                      e.target.value = '';
                                    }}
                                  />
                                  <label htmlFor={`mobile-note-videos-${annotationId}`} className="mobile-survey-notes-upload">
                                    {videoGlyph}
                                    <span>Video</span>
                                  </label>
                                </div>
                              </div>
                              {mobileNoteDraft.photos.map((photo, index) => (
                                <div key={`photo-${index}`} className="mobile-survey-notes-attachment">
                                  <span className="mobile-survey-notes-thumb">{imageGlyph}</span>
                                  <span className="mobile-survey-notes-attachment-name">{photo?.name || 'Photo'}</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${photo?.name || 'photo'}`}
                                    onClick={() => setMobileNoteDraft(prev => ({ ...prev, photos: prev.photos.filter((_, itemIndex) => itemIndex !== index) }))}
                                  >
                                    <Icon name="close" size={13} />
                                  </button>
                                </div>
                              ))}
                              {mobileNoteDraft.videos.map((video, index) => (
                                <div key={`video-${index}`} className="mobile-survey-notes-attachment">
                                  <span className="mobile-survey-notes-thumb">{videoGlyph}</span>
                                  <span className="mobile-survey-notes-attachment-name">{video?.name || 'Video'}</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${video?.name || 'video'}`}
                                    onClick={() => setMobileNoteDraft(prev => ({ ...prev, videos: prev.videos.filter((_, itemIndex) => itemIndex !== index) }))}
                                  >
                                    <Icon name="close" size={13} />
                                  </button>
                                </div>
                              ))}
                              {!mobileNoteDraft.photos.length && !mobileNoteDraft.videos.length && (
                                <span className="mobile-survey-notes-empty">No attachments.</span>
                              )}
                            </div>
                          </div>
                          <div className="mobile-survey-notes-footer">
                            <button type="button" className="mobile-survey-notes-cancel" onClick={() => setMobileNotesEditorOpen(false)}>
                              Cancel
                            </button>
                            <button type="button" className="mobile-survey-notes-save" onClick={saveMobileNotes}>
                              Save
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="mobile-survey-detail">
                        <span className="mobile-survey-detail-label">Category</span>
                        {/* Category re-assign is DEFERRED: the new side has no existing
                            mutation that moves a Survey Marker between categories
                            (item/Excel linkage is keyed by category), so this field is
                            read-only for now — demo SurveySheet.tsx:396-425 offers a
                            dropdown. Do not wire a raw categoryId patch here. */}
                        <div className="mobile-survey-detail-field is-static">
                          <span>{detailCategory?.name || 'No category'}</span>
                          {detailCategory ? (
                            <span className="mobile-survey-detail-field-meta">{mobileDetailChecklist.length}</span>
                          ) : null}
                        </div>

                        <span className="mobile-survey-detail-label">Category item</span>
                        <div className="mobile-survey-detail-tools mobile-survey-detail-dropdown-wrap">
                          <button
                            type="button"
                            className="mobile-survey-detail-swatch-btn"
                            aria-label="Choose Survey Marker entity"
                            aria-haspopup="listbox"
                            aria-expanded={mobileDetailDropdown === 'entity'}
                            onClick={() => setMobileDetailDropdown(prev => (prev === 'entity' ? null : 'entity'))}
                          >
                            <span
                              className="mobile-survey-detail-swatch"
                              style={{ background: detailEntityColor || 'transparent' }}
                            />
                          </button>
                          <div className="mobile-survey-detail-name-wrap">
                            <input
                              type="text"
                              className="mobile-survey-detail-name"
                              defaultValue={detailMarkerName}
                              key={`${annotationId}:${detailMarkerName}`}
                              aria-label={`Rename ${detailMarkerName}`}
                              placeholder="Category item"
                              onFocus={() => setMobileDetailDropdown(null)}
                              onBlur={(e) => {
                                const nextName = (e.currentTarget.value || '').trim() || fallbackName;
                                e.currentTarget.value = nextName;
                                commitSurveyMarkerName(annotationId, mobileDetailMarker.categoryId, detailMarkerName, nextName, fallbackName);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                  e.currentTarget.value = detailMarkerName;
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="mobile-survey-detail-name-dd"
                              aria-label="Choose Survey Marker"
                              aria-haspopup="listbox"
                              aria-expanded={mobileDetailDropdown === 'markerItem'}
                              aria-disabled={!canSwitchSibling}
                              disabled={!canSwitchSibling}
                              onClick={() => {
                                if (!canSwitchSibling) return;
                                setMobileDetailDropdown(prev => (prev === 'markerItem' ? null : 'markerItem'));
                              }}
                            >
                              <Icon name="chevronDown" size={13} />
                            </button>
                            {canSwitchSibling && mobileDetailDropdown === 'markerItem' && (
                              <div className="mobile-survey-detail-menu" role="listbox" aria-label="Survey Markers in this category">
                                {siblingMarkers.map(sibling => (
                                  <button
                                    key={sibling.id}
                                    type="button"
                                    role="option"
                                    aria-selected={sibling.id === annotationId}
                                    className={sibling.id === annotationId ? 'is-active' : ''}
                                    onClick={() => {
                                      // Same-id close is a no-op (already the detail marker).
                                      if (sibling.id !== annotationId) {
                                        setExpandedSurveyMarkers({ [sibling.id]: true });
                                      }
                                      setMobileDetailDropdown(null);
                                    }}
                                  >
                                    <span>{sibling.name || 'Untitled Survey Marker'}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="mobile-survey-detail-icon-btn"
                            aria-label="Jump to this Survey Marker"
                            onClick={() => {
                              locateOrSetSurveyMarker(mobileDetailMarker);
                            }}
                          >
                            <Icon name="search" size={15} />
                          </button>
                          <button
                            type="button"
                            className={`mobile-survey-detail-icon-btn${hasNoteText ? ' has-note' : ''}`}
                            aria-label={hasNoteText ? 'Edit Survey Marker notes' : 'Add Survey Marker notes'}
                            onClick={openMobileNotesEditor}
                          >
                            <Icon name="pen" size={14} />
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
                                      applyEntitySelectionForMarker(annotationId, detailModuleId, detailCategory, option.id);
                                      setMobileDetailDropdown(null);
                                    }}
                                  >
                                    <span
                                      className="mobile-survey-detail-entity-dot"
                                      style={{
                                        background: option.color || 'transparent',
                                        borderColor: option.color ? 'rgba(255, 255, 255, 0.4)' : '#5a6473'
                                      }}
                                    />
                                    <span>{option.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="mobile-survey-detail-check-header">
                          <span className="mobile-survey-detail-label">Checklist</span>
                          {/* Demo caption reads "Court: {entity}" — a demo-sample domain
                              term; the product term is Entity (vocabulary rule). */}
                          <span className="mobile-survey-detail-assigned">Entity: {detailEntityName}</span>
                        </div>
                        {detailCategory ? (
                          <div className="mobile-survey-detail-checklist" style={{ height: `${mobileChecklistWindowHeight}px` }}>
                            {mobileDetailChecklist.length ? mobileDetailChecklist.map(item => {
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
                                        onClick={() => applyChecklistResponseSelection(annotationId, detailModuleId, detailCategory, mobileDetailMarker.name || '', item.id, option)}
                                      >
                                        {option}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            }) : (
                              <div className="mobile-survey-detail-empty" style={{ height: `${mobileChecklistWindowHeight}px` }}>No checklist items</div>
                            )}
                          </div>
                        ) : (
                          <div className="mobile-survey-detail-empty" style={{ height: `${mobileChecklistWindowHeight}px` }}>Choose category first</div>
                        )}
                      </div>
                    );
                  })() : (
                  <div style={{
                    flex: categorySelectModeActive ? '1 1 auto' : 1,
                    overflowY: 'auto',
                    padding: '12px 10px',
                    fontFamily: FONT_FAMILY,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0
                  }}>
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
                              const confirmed = await askConfirm({
                                title: `Delete ${selectedCatIds.length} categor${selectedCatIds.length !== 1 ? 'ies' : 'y'}?`,
                                message: `Are you sure you want to delete ${selectedCatIds.length} categor${selectedCatIds.length !== 1 ? 'ies' : 'y'} and all items within?`,
                                confirmLabel: `Delete categor${selectedCatIds.length !== 1 ? 'ies' : 'y'}`,
                                danger: true,
                              });
                              if (!confirmed) {
                                return;
                              }

                              // Checkpoint before the marker wipe + definition drop so
                              // one undo restores both. Sibling of survey-marker:rename.
                              if (typeof checkpointSurveyCategoryDelete === 'function') {
                                checkpointSurveyCategoryDelete(selectedCatIds);
                              } else if (typeof addHistoryCheckpoint === 'function') {
                                addHistoryCheckpoint('survey-marker:category-delete', { categoryIds: selectedCatIds });
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

                                // Same pending-preview strip as handleSurveyMarkerDeleted.
                                // Leaving newSurveyMarkersByPage intact keeps the SVG overlay
                                // after the store row is gone.
                                setNewSurveyMarkersByPage(prev => {
                                  const updated = { ...prev };
                                  let changed = false;
                                  surveyMarkersInCategory.forEach(([annotationId, surveyMarker]) => {
                                    const pageNumber = surveyMarker?.pageNumber;
                                    if (!pageNumber || !Array.isArray(updated[pageNumber])) return;
                                    const next = updated[pageNumber].filter((preview) => (
                                      preview?.annotationId !== annotationId
                                    ));
                                    if (next.length !== updated[pageNumber].length) {
                                      updated[pageNumber] = next;
                                      changed = true;
                                    }
                                  });
                                  return changed ? updated : prev;
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

                            return (
                              <div className="survey-marker-category-action-row">
                                <div className="survey-marker-category-action-strip">
                                  {categorySelectModeActive ? (
                                    <div className="survey-marker-select-toolbar" role="toolbar" aria-label="Category selection actions">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCategorySelectModeActive(false);
                                          setCategorySelectModeForCategory(null);
                                          setSelectedCategories({});
                                        }}
                                        className="survey-marker-select-mode-toggle"
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
                                        className="survey-marker-select-action"
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
                                        className="survey-marker-select-action"
                                      >
                                        Move/Copy
                                      </button>
                                      <button
                                        type="button"
                                        onClick={deleteSelectedCategories}
                                        disabled={!hasSelectedCategories}
                                        className="survey-marker-select-action survey-marker-select-action-icon survey-marker-select-action-danger"
                                        {...tip('Delete', 'below')}
                                        aria-label="Delete selected categories"
                                      >
                                        <Icon name="trash" size={12} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCategorySelectModeActive(true);
                                        setSelectedCategories({});
                                      }}
                                      className="survey-marker-category-select-button"
                                    >
                                      Select
                                    </button>
                                  )}
                                </div>
                                {/* Compact survey Excel EXPORT — moved up from the old
                                    bottom-pinned bar (the panel bottom is being taken over
                                    by the zoom cluster; long survey content scrolls beneath
                                    it). Same handlers and menu items as before; the menu now
                                    opens DOWNWARD because its anchor sits near the top of
                                    the panel instead of at the bottom. Height is locked to
                                    24px to match .survey-marker-category-create-button. */}
                                {(() => {
                                  // Always show the Excel actions chevron so Open /
                                  // Update can fail-closed when no linkedExcelPath.
                                  // Hiding the menu made those items uninspectable;
                                  // Push-without-a-path would have downloaded a new
                                  // workbook (a write). Distinct from leftover-18
                                  // X-06 silent writeback.
                                  const linkedExcelReady = Boolean(selectedTemplate.linkedExcelPath) && linkedExcelExists === true;
                                  return (
                                  <div ref={exportMenuRef} className="survey-marker-export-compact-cluster">
                                    <button
                                      type="button"
                                      onClick={() => handleExportSurveyToExcel()} // Default action: Export new
                                      disabled={isExporting}
                                      className="survey-marker-export-compact-button"
                                    >
                                      {isExporting ? 'EXPORTING...' : 'EXPORT'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => !isExporting && setShowExportMenu(!showExportMenu)}
                                      disabled={isExporting}
                                      className="survey-marker-export-compact-chevron"
                                      aria-label="Excel actions"
                                      aria-haspopup="menu"
                                      aria-expanded={showExportMenu}
                                    >
                                      {isExporting ? (
                                        <Spinner size={12} color="#15110a" trackColor="rgba(0,0,0,0.25)" />
                                      ) : (
                                        <Icon name={showExportMenu ? "chevronUp" : "chevronDown"} size={14} />
                                      )}
                                    </button>

                                    {showExportMenu && (
                                      <div className="survey-marker-export-compact-menu" role="menu" aria-label="Excel actions">
                          <div
                            role="menuitem"
                            aria-label="Open linked"
                            aria-disabled={!linkedExcelReady}
                            onClick={async () => {
                              const excelPath = selectedTemplate.linkedExcelPath;
                              const isOneDrive = selectedTemplate.isOneDrive;


                              if (!excelPath || linkedExcelExists !== true) {
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
                            style={{
                              padding: '12px 16px',
                              color: '#f4f1ea',
                              fontSize: '14px',
                              cursor: linkedExcelReady ? 'pointer' : 'not-allowed',
                              opacity: linkedExcelReady ? 1 : 0.5,
                              borderBottom: '1px solid #3a4252',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => {
                              if (linkedExcelReady) e.currentTarget.style.background = '#3a4252';
                            }}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="document" size={16} />
                            Open Excel
                          </div>
                          <div
                            role="menuitem"
                            aria-label="Update existing"
                            aria-disabled={!linkedExcelReady}
                            onClick={() => {
                              if (!selectedTemplate.linkedExcelPath || linkedExcelExists !== true) {
                                showToast('No Excel file is linked to this survey.', 'error');
                                setShowExportMenu(false);
                                return;
                              }
                              handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
                              setShowExportMenu(false);
                            }}
                            style={{
                              padding: '12px 16px',
                              color: '#f4f1ea',
                              fontSize: '14px',
                              cursor: linkedExcelReady ? 'pointer' : 'not-allowed',
                              opacity: linkedExcelReady ? 1 : 0.5,
                              borderBottom: '1px solid #3a4252',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => {
                              if (linkedExcelReady) e.currentTarget.style.background = '#3a4252';
                            }}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="upload" size={16} />
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
                            style={{
                              padding: '12px 16px',
                              color: '#f4f1ea',
                              fontSize: '14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid #3a4252',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#3a4252'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="download" size={16} />
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
                              style={{
                                padding: '12px 16px',
                                color: liveSyncEnabled && liveSyncStatus === 'connected'
                                  ? '#3498db'
                                  : liveSyncStatus === 'connecting' || gateChecking
                                    ? '#f39c12'
                                    : liveSyncStatus === 'error' || liveSyncSupported === false
                                      ? '#d95a56'
                                      : '#fff',
                                fontSize: '14px',
                                cursor: liveSyncSupported === false ? 'not-allowed' : 'pointer',
                                opacity: liveSyncSupported === false ? 0.6 : gateRefused ? 0.75 : 1,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                              onMouseEnter={(e) => {
                                if (liveSyncSupported !== false) {
                                  e.currentTarget.style.background = '#3a4252';
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                              }}
                              {...tip(
                                liveSyncSupported === false
                                  ? 'Live sync requires Microsoft 365 Business account'
                                  : gateRefused || gateChecking
                                    ? liveSyncGateStatus(liveSyncGate.reasonCode).label
                                    : liveSyncEnabled && liveSyncStatus === 'connected'
                                      ? 'Live sync is connected. Automatic writeback is off — use Push to update Excel.'
                                      : liveSyncStatus === 'connecting'
                                        ? 'Connecting to Excel...'
                                        : liveSyncStatus === 'error'
                                          ? 'Live sync error - click to retry'
                                          : 'Connect a workbook session. Automatic writeback is off — use Push to update Excel.',
                                'below'
                              )}
                            >
                              <span style={{ fontSize: '14px' }}>
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
                              style={{
                                padding: '12px 16px',
                                color: verifying ? '#f39c12' : (verdictColor || '#fff'),
                                fontSize: '14px',
                                cursor: verifying ? 'wait' : 'pointer',
                                borderTop: '1px solid #3a4252',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#3a4252'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              {...tip(
                                verifying
                                  ? liveSyncVerifyStatus('verifying').label
                                  : verdict
                                    ? verdict.label
                                    : liveSyncVerifyStatus('idle').label,
                                'below'
                              )}
                            >
                              <span style={{ fontSize: '14px' }}>
                                {verifying ? '...' : verdict ? (liveSyncVerify.ready ? '✓' : '!') : '○'}
                              </span>
                              Verify Live Sync
                            </div>
                            );
                          })()}
                                      </div>
                                    )}
                                  </div>
                                  );
                                })()}
                              </div>
                            );
                          })() : copyModeActive ? (
                            <div style={{
                              marginBottom: '12px',
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              paddingBottom: '8px',
                              borderBottom: '1px solid #2a3140'
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
                                    <span style={{ color: '#e8e2d4', fontSize: '13px', fontWeight: '400' }}>
                                      Select all
                                    </span>
                                  </label>
                                );
                              })()}

                              <div style={{ width: '1px', height: '16px', background: '#3a4252' }} />

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
                                  color: Object.values(copiedItemSelection).some(Boolean) ? '#8d96a6' : '#5a6473',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#e8e2d4';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#8d96a6';
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
                                  color: Object.values(copiedItemSelection).some(Boolean) ? '#c84c49' : '#5a6473',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#c84c49';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#c84c49';
                                  }
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
                                  color: '#8d96a6',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#e8e2d4'}
                                onMouseLeave={(e) => e.currentTarget.style.color = '#8d96a6'}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : null}

                          {/* Categories List */}
                          <div style={{ marginBottom: '20px' }}>
                            <h3 className={mobileMode ? 'mobile-survey-categories-heading' : undefined} style={{
                              fontSize: '13px',
                              fontWeight: '600',
                              color: '#e8e2d4',
                              margin: '0 2px 8px',
                              fontFamily: FONT_FAMILY,
                              // Desktop: the heading row hosts the create-category plus
                              // button, right-aligned (moved down from the Select row).
                              ...(mobileMode ? null : {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                              })
                            }}>
                              {/* Vocabulary rule: "Survey Marker" in full on mobile copy —
                                  never bare "marker"/"highlight". Mobile copy unchanged. */}
                              <span>{mobileMode ? 'Select category' : 'Categories'}</span>
                              {mobileMode ? <small>Tap category to place a Survey Marker</small> : null}
                              {/* Same button look/size as before (shared
                                  .survey-marker-category-create-button class); it now opens
                                  CreateCategoryModal instead of the removed template-editor
                                  route that left it doing nothing. */}
                              {!mobileMode && (
                                <button
                                  type="button"
                                  onClick={openCreateCategoryModal}
                                  className="survey-marker-category-create-button"
                                  {...tip('Create category', 'below')}
                                  aria-label="Create category"
                                >
                                  <Icon name="plus" size={14} />
                                </button>
                              )}
                            </h3>

                            {module.categories && module.categories.length > 0 ? (
                              <SortableRearrangeList
                                ids={module.categories.map((category) => category.id)}
                                onReorder={(activeId, overId) => handleReorderSurveyCategories(selectedModuleId, activeId, overId)}
                                variableHeight
                                gap={6}
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
                                  const buttonTextColor = isCategoryActive ? '#d8a84e' : '#e8e2d4';
                                  const buttonSubTextColor = isCategoryActive ? '#d8a84e' : '#8d96a6';

                                  // Item-level selection state
                                  const isItemSelectModeActiveForCategory = itemSelectModeActive[category.id] === true;
                                  const selectedItemsForCategory = selectedItemsInCategory[category.id] || {};
                                  const itemSelectedCount = Object.values(selectedItemsForCategory).filter(Boolean).length;

                                  return (
                                    <SortableRearrangeRow
                                      key={category.id}
                                      id={category.id}
                                      wrapperStyle={{ overflow: 'visible' }}
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
                                      className={`survey-marker-category-card${isCategoryActive ? ' is-active' : ''}`}
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
                                            style={{ width: 24, height: 24, marginLeft: 0 }}
                                          />
                                        )}

                                        <div className="survey-marker-category-body">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
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
                                                // Minimize survey panel (animated on mobile)
                                                dismissSurveySheet();
                                                // Switch to surveyMarker tool
                                                setActiveTool('survey-marker');
                                              }}
                                              className="survey-marker-category-main"
                                              style={{
                                                color: buttonTextColor,
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
                                            </button>
                                            {surveyMarkerCount > 0 && (
                                              <button
                                                className="survey-marker-category-arrow"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setExpandedCategories(prev => ({
                                                    ...prev,
                                                    [category.id]: !prev[category.id]
                                                  }));
                                                }}
                                                style={{
                                                  color: isArrowActive ? '#d8a84e' : '#fff'
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
                                                  <svg
                                                    width="16"
                                                    height="16"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    style={{ width: '14px', height: '14px' }}
                                                  >
                                                    <path
                                                      d="M6 9L12 15L18 9"
                                                      stroke="currentColor"
                                                      strokeWidth="2.5"
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                    />
                                                  </svg>
                                                </span>
                                              </button>
                                            )}
                                          </div>
                                      </div>

                                      {/* Expanded surveyMarkers list */}
                                      {isExpanded && surveyMarkerCount > 0 && (
                                        <div style={{
                                          marginTop: '5px',
                                          padding: '0 0 1px',
                                          background: 'transparent',
                                          border: '1px solid transparent',
                                          borderRadius: '4px'
                                        }}>
                                          {/* UX (mobile demo parity): the inline item Select /
                                              All / Copy / Delete toolbar is desktop-only admin
                                              chrome — not part of the demo's mobile sheet. */}
                                          {!copyModeActive && !mobileMode && (
                                            <div
                                              className={`survey-marker-inline-select-row${categorySelectModeActive ? ' is-placeholder' : ''}`}
                                              aria-hidden={categorySelectModeActive ? 'true' : undefined}
                                            >
                                              {categorySelectModeActive ? null : !isItemSelectModeActiveForCategory ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setItemSelectModeActive(prev => ({
                                                      ...prev,
                                                      [category.id]: true
                                                    }));
                                                    setSelectedItemsInCategory(prev => ({
                                                      ...prev,
                                                      [category.id]: {}
                                                    }));
                                                  }}
                                                  className="survey-marker-select-mode-toggle"
                                                >
                                                  Select
                                                </button>
                                              ) : (
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
                                            gap={5}
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
                                                background: mobileMode ? '#171b22' : (isDragging ? 'rgba(216, 168, 78, 0.12)' : 'transparent'),
                                                border: mobileMode ? '1px solid #303743' : '1px solid #3a4252',
                                                borderRadius: mobileMode ? '6px' : '4px',
                                                overflow: (isEntityDropdownOpenForMarker || reviewMessage) ? 'visible' : 'hidden',
                                                flexShrink: 0,
                                                boxShadow: isDragging ? '0 10px 22px rgba(0, 0, 0, 0.34), inset 0 0 0 1px rgba(216, 168, 78, 0.3)' : 'none',
                                                transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease'
                                              }}>
                                                {/* UX (mobile demo parity): expanded-category item rows are
                                                    plain tap rows — entity dot + name — that open the marker
                                                    DETAIL view (demo SurveySetupSheet.tsx:221-243,
                                                    styles.ts:3155-3165). The desktop inline controls below
                                                    stay desktop-only. */}
                                                {mobileMode && (() => {
                                                  const { moduleData } = findMarkerMatchingItem(annotationId, selectedModuleId, category);
                                                  const rowEntityId = moduleData.entityId || surveyMarkers[annotationId]?.entityId;
                                                  const dotColor = (rowEntityId ? entitiesMap.get(rowEntityId)?.color : null)
                                                    || moduleData.entityColor
                                                    || surveyMarkers[annotationId]?.entityColor
                                                    || null;
                                                  return (
                                                    <button
                                                      type="button"
                                                      className="mobile-survey-item-row"
                                                      aria-label={`Open ${surveyMarkerName}`}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        // Exclusive expansion drives the detail view.
                                                        setExpandedSurveyMarkers({ [annotationId]: true });
                                                      }}
                                                    >
                                                      <span className="mobile-survey-item-dot" style={{ background: dotColor || '#5a6473' }} aria-hidden="true" />
                                                      <span className="mobile-survey-item-name">{surveyMarkerName}</span>
                                                      <Icon name="chevronRight" size={12} color="#8d96a6" />
                                                    </button>
                                                  );
                                                })()}
                                                {/* SurveyMarker header - clickable to expand */}
                                                {!mobileMode && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                  {/* UX (mobile demo parity): marker rows lose the
                                                      desktop drag handle / select circle on mobile —
                                                      demo item rows are plain tap rows
                                                      (styles.ts:3155-3165). */}
                                                  {mobileMode ? null : isMarkerSelectable ? (
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
                                                      style={{ width: 22, height: 24, marginLeft: 0 }}
                                                    />
                                                  )}

                                                  <div style={{
                                                    flex: 1,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '7px',
                                                    padding: '4px 5px 4px 6px',
                                                    minWidth: 0
                                                  }}>

                                                      {(() => {
                                                        // Get entity entity for indicator - data-driven from category item's entity field
                                                        let indicatorColor = null;
                                                        let indicatorTooltip = null;
                                                        if (selectedTemplate && selectedModuleId) {
                                                          const surveyMarkerData = surveyMarkers[annotationId];
                                                          const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                          const surveyMarkerName = surveyMarkerData?.name || surveyMarker.name || '';
                                                          const matchingItem = itemsByNameType.get(`${surveyMarkerName}\0${categoryName}`);

                                                          // Try to get entityId from item's module data first, then from surveyMarkerData
                                                          let entityId = null;
                                                          if (matchingItem) {
                                                            const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                            const dataKey = getModuleDataKey(moduleName);
                                                            const moduleData = matchingItem[dataKey] || {};
                                                            entityId = moduleData.entityId;
                                                          }
                                                          // Fallback to surveyMarkerData if not found in item
                                                          if (!entityId && surveyMarkerData?.entityId) {
                                                            entityId = surveyMarkerData.entityId;
                                                          }

                                                          if (entityId) {
                                                            const entity = entitiesMap.get(entityId);
                                                            if (entity) {
                                                              // Use the exact color from entity.color without transformation
                                                              indicatorColor = entity.color;
                                                              indicatorTooltip = entity.name;
                                                            }
                                                          }
                                                        }

                                                        return (
                                                          <EntityIndicator
                                                            color={indicatorColor}
                                                            size={16}
                                                            tooltipText={indicatorTooltip}
                                                          />
                                                        );
                                                      })()}
                                                      <button
                                                        type="button"
                                                        className="survey-marker-expand-toggle"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          toggleSurveyMarkerExpanded(annotationId);
                                                        }}
                                                        {...tip(isSurveyMarkerExpanded ? 'Collapse' : 'Expand', 'below')}
                                                        aria-label={isSurveyMarkerExpanded ? 'Collapse marker details' : 'Expand marker details'}
                                                        style={{
                                                          width: '18px',
                                                          height: '20px',
                                                          padding: 0,
                                                          background: 'transparent',
                                                          border: 0,
                                                          color: isSurveyMarkerExpanded ? '#d8a84e' : '#8d96a6',
                                                          cursor: 'pointer',
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          justifyContent: 'center',
                                                          flexShrink: 0,
                                                          transform: isSurveyMarkerExpanded ? 'rotate(90deg)' : 'none',
                                                          transition: 'color 0.15s ease, transform 0.15s ease'
                                                        }}
                                                      >
                                                        <Icon name="chevronRight" size={12} />
                                                      </button>
                                                      <span className="survey-marker-name-fit" data-value={surveyMarkerName || ' '}>
                                                        <input
                                                          type="text"
                                                          size={1}
                                                          className="survey-marker-name-inline"
                                                          defaultValue={surveyMarkerName}
                                                          key={`${annotationId}:${surveyMarkerName}`}
                                                          {...tip('Rename Survey Marker', 'below')}
                                                          aria-label={`Rename ${surveyMarkerName}`}
                                                          onClick={(e) => e.stopPropagation()}
                                                          onDoubleClick={(e) => e.currentTarget.select()}
                                                          onInput={(e) => {
                                                            if (e.currentTarget.parentElement) {
                                                              e.currentTarget.parentElement.dataset.value = e.currentTarget.value || ' ';
                                                            }
                                                          }}
                                                          onBlur={(e) => {
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
                                                        {...tip(isSurveyMarkerExpanded ? 'Collapse' : 'Expand', 'below')}
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

                                                  {/* Item-level Notes button */}
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const surveyMarkerData = surveyMarkers[annotationId];
                                                      const existingNote = surveyMarkerData?.note;

                                                      if (existingNote) {
                                                        setNoteDialogContent({
                                                          text: existingNote.text || '',
                                                          photos: existingNote.photos || [],
                                                          videos: existingNote.videos || []
                                                        });
                                                      } else {
                                                        setNoteDialogContent({ text: '', photos: [], videos: [] });
                                                      }

                                                      // For item-level notes, we only need the annotationId
                                                      setNoteDialogOpen(annotationId);
                                                    }}
                                                    style={{
                                                      ...surveyMarkerRowActionStyle,
                                                      background: 'transparent',
                                                      border: 'none',
                                                      color: noteHasContent(surveyMarkers[annotationId]?.note) ? '#d8a84e' : '#8d96a6',
                                                      opacity: 0.78
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.opacity = '1';
                                                      e.currentTarget.style.background = '#3a4252';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.opacity = '0.78';
                                                      e.currentTarget.style.background = 'transparent';
                                                    }}
                                                    {...tip(noteHasContent(surveyMarkers[annotationId]?.note) ? "Edit item notes" : "Add item notes", 'below')}
                                                    aria-label={noteHasContent(surveyMarkers[annotationId]?.note) ? "Edit item notes" : "Add item notes"}
                                                  >
                                                    <Icon name="pen" size={13} />
                                                  </button>

                                                  {/* Locate Button (Magnifying Glass) */}
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      locateOrSetSurveyMarker(surveyMarker);
                                                    }}
                                                    style={{
                                                      ...surveyMarkerRowActionStyle,
                                                      background: 'transparent',
                                                      border: 'none',
                                                      color: (surveyMarker.bounds && surveyMarker.pageNumber) ? '#d8a84e' : '#F5A623', // Blue if located, Orange if not
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.background = '#3a4252';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.background = 'transparent';
                                                    }}
                                                    {...tip(surveyMarker.bounds && surveyMarker.pageNumber ? "Jump to this Survey Marker" : "Set location on PDF", 'below')}
                                                    aria-label={surveyMarker.bounds && surveyMarker.pageNumber ? "Jump to this Survey Marker" : "Set location on PDF"}
                                                  >
                                                    <Icon name="search" size={14} />
                                                  </button>

                                                </div>
                                                )}

                                                {/* Entity selector */}
                                                {
                                                  !mobileMode && isSurveyMarkerExpanded && selectedTemplate && selectedModuleId && (() => {
                                                    // Find the item associated with this surveyMarker
                                                    const surveyMarkerData = surveyMarkers[annotationId];
                                                    const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                    const surveyMarkerName = surveyMarkerData?.name || surveyMarker.name || '';
                                                    const matchingItem = itemsByNameType.get(`${surveyMarkerName}\0${categoryName}`);

                                                    // Get module-specific data
                                                    const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                    const dataKey = getModuleDataKey(moduleName);
                                                    const moduleData = matchingItem?.[dataKey] || {};

                                                    // Get current entity status from item's module-specific data (preferred) or from survey marker annotation (legacy)
                                                    const currentEntityId = moduleData.entityId || surveyMarkerData?.entityId;
                                                    const entities = selectedTemplate?.entities || [];
                                                    const currentEntity = currentEntityId ? entities.find(entity => entity.id === currentEntityId) : null;
                                                    const selectedEntityColor = currentEntity?.color || moduleData.entityColor || surveyMarkerData?.entityColor;
                                                    const selectedEntityName = currentEntity?.name || moduleData.entityName || surveyMarkerData?.entityName || 'None';
                                                    const isEntityDropdownOpen = openEntityDropdownId === entityDropdownId;
                                                    const entityOptions = [
                                                      { id: '', name: 'None', color: null },
                                                      ...entities.map(entity => ({
                                                        id: entity.id,
                                                        name: entity.name,
                                                        color: entity.color
                                                      }))
                                                    ];
                                                    // Delegates to the shared helper (see applyEntitySelectionForMarker
                                                    // above) so the mobile detail view and this desktop row perform
                                                    // byte-identical store writes.
                                                    const handleEntitySelection = (entityId) => {
                                                      applyEntitySelectionForMarker(annotationId, selectedModuleId, category, entityId);
                                                    };

                                                    return (
                                                      <div style={{
                                                        padding: '6px 8px',
                                                        background: '#2a3140',
                                                        borderTop: '1px solid #3a4252',
                                                        marginTop: '0'
                                                      }}>
                                                        <div className="survey-marker-entity-row">
                                                          <span className="survey-marker-entity-label">
                                                            Entity
                                                          </span>
                                                          <div className="survey-marker-entity-select-wrap">
                                                            <button
                                                              type="button"
                                                              className="survey-marker-entity-trigger"
                                                              aria-haspopup="listbox"
                                                              aria-expanded={isEntityDropdownOpen}
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenEntityDropdownId(isEntityDropdownOpen ? null : entityDropdownId);
                                                              }}
                                                            >
                                                              <span className="survey-marker-entity-trigger-content">
                                                                <span
                                                                  className="survey-marker-entity-swatch"
                                                                  style={getEntitySwatchStyle(selectedEntityColor)}
                                                                />
                                                                <span className="survey-marker-entity-trigger-label">
                                                                  {selectedEntityName}
                                                                </span>
                                                              </span>
                                                              <span className={`survey-marker-entity-caret${isEntityDropdownOpen ? ' is-open' : ''}`}>
                                                                <Icon name="chevronDown" size={12} />
                                                              </span>
                                                            </button>
                                                            {isEntityDropdownOpen && (
                                                              <div
                                                                className="survey-marker-entity-options"
                                                                role="listbox"
                                                                aria-label="Entity"
                                                                onClick={(e) => e.stopPropagation()}
                                                              >
                                                                {entityOptions.map(option => {
                                                                  const optionValue = option.id || '';
                                                                  const isSelectedOption = (currentEntityId || '') === optionValue;
                                                                  return (
                                                                    <button
                                                                      key={optionValue || 'none'}
                                                                      type="button"
                                                                      className={`survey-marker-entity-option${isSelectedOption ? ' is-selected' : ''}`}
                                                                      role="option"
                                                                      aria-selected={isSelectedOption}
                                                                      onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleEntitySelection(optionValue);
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
                                                                    </button>
                                                                  );
                                                                })}
                                                              </div>
                                                            )}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })()
                                                }

                                                {/* Expanded checklist items — active items only.
                                                    KAL-44: archived items are rendered separately
                                                    below so new markers don't see them as active
                                                    prompts, but old responses still surface. */}
                                                {
                                                  !mobileMode && isSurveyMarkerExpanded && category.checklist && category.checklist.filter(item => item && item.archived !== true).map(item => {
                                                    const response = surveyMarkers[annotationId]?.checklistResponses?.[item.id] || {};
                                                    const isSelected = response.selection;
                                                    return (
                                                      <div key={item.id} style={{
                                                        padding: '6px 8px',
                                                        background: '#2a3140',
                                                        borderTop: '1px solid #3a4252',
                                                        marginTop: '0'
                                                      }}>
                                                        <div style={{
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          gap: '8px',
                                                          marginBottom: '4px',
                                                          flexWrap: 'wrap'
                                                        }}>
                                                          <span style={{
                                                            color: '#e8e2d4',
                                                            fontSize: '12px',
                                                            flex: '1',
                                                            minWidth: '150px'
                                                          }}>
                                                            {item.text}
                                                          </span>
                                                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                                            {['Y', 'N', 'N/A'].map(option => (
                                                              <button
                                                                key={option}
                                                                type="button"
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  // Shared with the mobile detail view — see
                                                                  // applyChecklistResponseSelection above (verbatim
                                                                  // re-housing of the old inline handler).
                                                                  applyChecklistResponseSelection(annotationId, selectedModuleId, category, surveyMarker.name || '', item.id, option);
                                                                }}
                                                                style={{
                                                                  minWidth: '28px',
                                                                  padding: '4px 6px',
                                                                  fontSize: '11px',
                                                                  fontWeight: '400',
                                                                  border: 'none',
                                                                  borderRadius: '3px',
                                                                  cursor: 'pointer',
                                                                  background: isSelected === option
                                                                    ? option === 'Y'
                                                                      ? '#B8E6D4'
                                                                      : option === 'N'
                                                                        ? '#FFB3BA'
                                                                        : '#5a6473'
                                                                    : '#D3D3D3',
                                                                  color: isSelected === option ? '#FFFFFF' : '#2a3140',
                                                                  transition: 'all 0.2s ease'
                                                                }}
                                                              >
                                                                {option}
                                                              </button>
                                                            ))}
                                                          </div>
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
                                                        style={{
                                                          padding: '6px 8px',
                                                          background: '#1f2430',
                                                          borderTop: '2px solid #5a6473',
                                                          marginTop: '0',
                                                        }}
                                                      >
                                                        <div style={{
                                                          fontSize: '10px',
                                                          color: '#8d96a6',
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
                                                                  color: '#8d96a6',
                                                                  fontSize: '12px',
                                                                  flex: 1,
                                                                  fontStyle: 'italic',
                                                                  textDecoration: 'line-through',
                                                                  textDecorationColor: '#5a6473',
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
                                                                  background: sel === 'Y'
                                                                    ? '#7aa78f'
                                                                    : sel === 'N'
                                                                      ? '#a77a7a'
                                                                      : sel
                                                                        ? '#5a6473'
                                                                        : '#3a4252',
                                                                  color: sel ? '#FFFFFF' : '#8d96a6',
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
                              <div style={{ color: '#8d96a6', fontSize: '14px', padding: '20px', textAlign: 'center' }}>
                                <div>No categories available for this space.</div>
                                {!mobileMode && selectedTemplate && selectedModuleId && (
                                  <button
                                    type="button"
                                    className="survey-marker-empty-module-create-button"
                                    aria-label="Create category for empty module"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openCreateCategoryModal();
                                    }}
                                    style={{
                                      marginTop: '12px',
                                      padding: '10px 18px',
                                      borderRadius: '20px',
                                      border: '1px solid #d8a84e',
                                      background: '#1f2430',
                                      color: '#f4f1ea',
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
                                      event.currentTarget.style.background = '#2a3140';
                                      event.currentTarget.style.borderColor = '#5AA0F2';
                                    }}
                                    onMouseLeave={(event) => {
                                      event.currentTarget.style.background = '#1f2430';
                                      event.currentTarget.style.borderColor = '#d8a84e';
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
                      <div style={{ textAlign: 'center', padding: '40px', color: '#8d96a6' }}>
                        <p>Select a space to view categories</p>
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
                      background: '#12151c',
                      fontFamily: FONT_FAMILY
                    }}>
                      <div className={mobileMode ? 'mobile-survey-picker-header' : undefined} style={{
                        padding: '12px 12px 10px',
                        borderBottom: '1px solid #2a3140',
                        background: '#12151c',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        flexShrink: 0
                      }}>
                        <div className={mobileMode ? 'mobile-survey-sheet-title' : undefined} style={{ flex: 1, minWidth: 0 }}>
                        {mobileMode ? <span className="mobile-survey-sheet-eyebrow">Survey template</span> : null}
                        <h2 style={{
                          flex: 1,
                          minWidth: 0,
                          margin: 0,
                          fontSize: '18px',
                          fontWeight: '600',
                          color: '#f4f1ea',
                          fontFamily: FONT_FAMILY,
                          letterSpacing: '-0.2px'
                        }}>
                          Choose survey template
                        </h2>
                        </div>
                        {mobileMode && (
                          <button
                            type="button"
                            className="mobile-survey-picker-close"
                            aria-label="Close Survey panel"
                            onClick={dismissSurveySheet}
                          >
                            <Icon name="close" size={18} color="currentColor" />
                          </button>
                        )}
                      </div>
                      <div style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: 'auto',
                        padding: '12px 10px',
                        color: '#e8e2d4'
                      }}>
                        {availableSurveyTemplates.length === 0 ? (
                          <div style={{
                            minHeight: '160px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            color: '#8d96a6',
                            textAlign: 'center'
                          }}>
                            <Icon name="survey" size={26} color="#8d96a6" />
                            <div style={{ color: '#e8e2d4', fontSize: '13px', fontWeight: 600 }}>
                              No templates available
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {availableSurveyTemplates.map(template => {
                              const modules = (template.modules || template.spaces) || [];
                              const moduleCount = modules.length;

                              return (
                                <button
                                  key={template.id}
                                  type="button"
                                  /* UX (mobile demo parity): 42px rows with a :active pressed
                                     state (demo styles.ts:2694-2705) — hover styling is a dead
                                     affordance on touch, so the mouse handlers are desktop-only. */
                                  className={mobileMode ? 'mobile-survey-template-row' : undefined}
                                  onClick={() => {
                                    onSelectSurveyTemplate?.(template);
                                  }}
                                  style={{
                                    width: '100%',
                                    minHeight: '58px',
                                    textAlign: 'left',
                                    padding: '10px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #3a4252',
                                    background: '#181c24',
                                    color: '#e8e2d4',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontFamily: FONT_FAMILY,
                                    transition: 'background 0.15s ease, border-color 0.15s ease'
                                  }}
                                  onMouseEnter={mobileMode ? undefined : (event) => {
                                    event.currentTarget.style.background = '#2a3140';
                                    event.currentTarget.style.borderColor = '#d8a84e';
                                  }}
                                  onMouseLeave={mobileMode ? undefined : (event) => {
                                    event.currentTarget.style.background = '#181c24';
                                    event.currentTarget.style.borderColor = '#3a4252';
                                  }}
                                >
                                  <Icon name="template" size={18} color="#e8e2d4" />
                                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    <span style={{
                                      color: '#e8e2d4',
                                      fontSize: '13px',
                                      fontWeight: 600,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap'
                                    }}>
                                      {template.name || 'Untitled template'}
                                    </span>
                                    <span style={{ color: '#8d96a6', fontSize: '11px', fontWeight: 500 }}>
                                      {moduleCount} module{moduleCount === 1 ? '' : 's'}
                                    </span>
                                  </span>
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
                  borderTop: '1px solid #2a3140',
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

              {mobileMode && !isSurveyPanelCollapsed && (
                <div className="mobile-survey-exit-footer">
                  <button type="button" onClick={exitSurveyMode}>Exit Survey</button>
                </div>
              )}
            </div>
            {/* Desktop-only Create Category modal (opened by the heading-row
                plus button and the empty-module start-adding button).
                Duplicate-name data comes straight from props the rail already
                receives: the selected module's categories and the app
                template list. */}
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
