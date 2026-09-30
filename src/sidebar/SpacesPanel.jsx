/**
 * SpacesPanel.jsx — sidebar panel for managing "Spaces" (named page groups with
 * regions and per-page annotation visibility).
 *
 * Default-exports the SpacesPanel component; internal SpaceSortableCard renders
 * each space as one divided list row (2026-09-23: no cards, desktop and phone)
 * with expand, inline rename, toggle, page-range add (parsePageRangeInput),
 * region rename/edit, and canvas/survey annotation-visibility
 * toggles (gated on the Pro `features` flags). Cards reorder via dnd-kit
 * SortableRearrangeList with optimistic ordering and frame-capture debug hooks.
 */
import React, { useState, useCallback, useRef } from 'react';
import Icon from '../Icons';
import { parsePageRangeInput, sanitizePageRangeInput } from '../utils/pageRangeParser';
import DragRearrangeHandle from '../reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from '../reorder/SortableRearrangeList';
import { moveItem } from '../reorder/flatReorderUtils.js';
import {
  getPageVisibilityControlMode,
  PAGE_VISIBILITY_CONTROL_MODE
} from '../utils/annotationVisibilityRules';
import { showToast } from '../utils/toast';
import { useTooltip } from '../components/Tooltip';
import { watchLightPopover } from '../components/dismissRules.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const animateSpaceLayoutChanges = () => false;

const SpaceSortableCard = React.memo(function SpaceSortableCard({
  space,
  dragHandleProps,
  isDragging = false,
  isRearranging = false,
  isActive,
  isSelected,
  isExpanded,
  pageCount,
  regionCount,
  pageInputValue,
  pageError,
  onToggleExpand,
  onRenameSpace,
  onDelete,
  onPageInputChange,
  onAssignPages,
  onRenameRegion,
  onRemovePage,
  onNavigateToPage,
  onExitSpace,
  onToggleSpace,
  onRequestRegionEdit = null,
  onCancelRegionEdit = null,
  isRegionSelectionActive = false,
  regionSelectionPage = null,
  getCanvasAnnotationVisibilityState = null,
  onToggleCanvasAnnotations = null,
  getSurveyAnnotationVisibilityState = null,
  onToggleSurveyAnnotations = null,
  activeSpaceId = null,
  onToggleRegionOverlay = null,
  getRegionOverlayEnabled = null,
  isRegionOverlayToggleEnabled = null,
  showSurveyPanel = false,
  selectedModuleId = null,
}) {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  const [editingRegionId, setEditingRegionId] = useState(null);
  const [editingRegionValue, setEditingRegionValue] = useState('');
  const editingRegionInputRef = useRef(null);
  React.useEffect(() => {
    if (!isExpanded) {
      setEditingRegionId(null);
      setEditingRegionValue('');
    }
  }, [isExpanded]);
  React.useEffect(() => {
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, [space.id]);

  const commitRegionRename = useCallback((pageId) => {

    if (editingRegionId !== pageId) {

      return;
    }
    const labelToSave = editingRegionValue.trim();

    onRenameRegion?.(space.id, pageId, labelToSave);
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, [editingRegionId, editingRegionValue, onRenameRegion, space.id]);


  const cancelRegionRename = useCallback(() => {
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, []);

  React.useEffect(() => {
    if (editingRegionId === null) return;
    requestAnimationFrame(() => {
      editingRegionInputRef.current?.focus();
      editingRegionInputRef.current?.select();
    });
  }, [editingRegionId]);

  const handleRegionEditClick = useCallback((pageId, currentLabel) => {
    setEditingRegionId(pageId);
    setEditingRegionValue(currentLabel);
  }, []);

  const commitSpaceName = useCallback((input) => {
    if (!input) return;
    const fallbackName = space.name?.trim() || 'Space';
    const nextName = (input.value || '').trim() || fallbackName;
    input.value = nextName;
    if (input.parentElement) {
      input.parentElement.dataset.value = nextName || ' ';
    }
    if (nextName !== space.name) {
      // A refused rename (duplicate name, no permission) leaves space.name, and
      // so this uncontrolled input's key, unchanged: put the real name back
      // instead of leaving the refused text showing as a second "Space 2".
      if (onRenameSpace?.(space.id, nextName) !== true) {
        input.value = space.name || '';
        if (input.parentElement) {
          input.parentElement.dataset.value = space.name || ' ';
        }
      }
    }
  }, [onRenameSpace, space.id, space.name]);


  /*
   * UX 2026-09-23 (owner: "everything is so bulky ... some shit that doesn't
   * even align ... the hitbox should be invisible"; then "not individual cards;
   * like documents, projects and templates; dividers but integrated within the
   * panel", desktop AND phone). One design on both, sized per platform by the
   * .spaces-list block in styles.css (desktop) and mobilePdfViewer.css (phone):
   *   - a space is a ROW, parted from the next space by a hairline that reaches
   *     both edges of the panel; no bordered card, no shadow, no card per region;
   *   - its pages ("Region N") are indented LINES under it, like a to-do list
   *     nested under its parent;
   *   - every row shares the same right-hand columns, so the switches, the
   *     trash cans, the lightbulbs and the region count each sit on one x;
   *   - every control is a glyph or a word with an invisible tap pad (44px on
   *     the phone). Nothing paints a plate on hover or press: glyphs tighten
   *     (states.css data-glyph-only), words darken their ink.
   * Reference: the phone home "layout B — one card, divided" (src/home/hub.css).
   * The grip is a plain grip; the fold arrow sits beside it (owner
   * 2026-09-23), turning from right to down as the space opens.
   */
  const visibilityControlMode = getPageVisibilityControlMode({ showSurveyPanel, selectedModuleId });
  const isSurveyVisibilityContext =
    activeSpaceId !== null && visibilityControlMode === PAGE_VISIBILITY_CONTROL_MODE.SURVEY;
  const getVisibilityState = isSurveyVisibilityContext
    ? getSurveyAnnotationVisibilityState
    : getCanvasAnnotationVisibilityState;
  const onToggleVisibility = isSurveyVisibilityContext
    ? onToggleSurveyAnnotations
    : onToggleCanvasAnnotations;
  const regionCountLabel = `${regionCount} region${regionCount !== 1 ? 's' : ''}`;
  const spaceSwitchLabel = isActive ? 'Turn off space' : 'Turn on space';
  const toggleThisSpace = () => onToggleSpace?.(space.id, !isActive);
  const switchKeyDown = (handler) => (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }
  };

  return (
    <div
      data-space-sortable-row-id={space.id}
      className={`spaces-item${isExpanded ? ' is-expanded' : ''}${isDragging ? ' is-dragging' : ''}`}
    >
      <div data-drag-rearrange-row className="spaces-item__block">
        <div
          className="spaces-item__row"
          aria-expanded={isExpanded}
          onClick={() => onToggleExpand(space.id)}
        >
          <DragRearrangeHandle
            {...dragHandleProps}
            className="spaces-item__grip"
            data-space-drag-handle
            isDragging={isDragging}
            title="Drag to rearrange"
            onClick={() => onToggleExpand(space.id)}
            style={{ width: undefined, height: undefined, color: 'var(--text-3)' }}
          />

          {/* Owner 2026-09-23: the fold arrow is back, between the grip and
              the name, in the gap that was already there (nothing moves).
              Right when folded, down when open. */}
          <button
            type="button"
            className="spaces-item__chevron"
            aria-label={isExpanded ? `Fold ${space.name || 'space'}` : `Open ${space.name || 'space'}`}
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(space.id);
            }}
          >
            <Icon name="chevronRight" size={12} color="currentColor" />
          </button>

          <span className="spaces-item__name-fit" data-value={space.name || ' '}>
            <input
              type="text"
              size={1}
              className="spaces-item__name"
              defaultValue={space.name}
              key={`${space.id}:${space.name}`}
              {...tip('Click to rename', 'below')}
              aria-label={`Rename ${space.name || 'Space'}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.currentTarget.select();
              }}
              onInput={(e) => {
                if (e.currentTarget.parentElement) {
                  e.currentTarget.parentElement.dataset.value = e.currentTarget.value || ' ';
                }
              }}
              onBlur={(e) => {
                tip('Click to rename', 'below').onBlur(e);
                commitSpaceName(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.currentTarget.value = space.name || '';
                  if (e.currentTarget.parentElement) {
                    e.currentTarget.parentElement.dataset.value = space.name || ' ';
                  }
                  e.currentTarget.blur();
                }
              }}
            />
          </span>

          <span className="spaces-item__fill" aria-hidden="true" />

          {/* Region count: quiet ink in the lightbulb column, no circle. */}
          <span
            className="spaces-item__count"
            {...tip(regionCountLabel, 'below')}
            aria-label={regionCountLabel}
          >
            {regionCount}
          </span>

          <div
            role="switch"
            tabIndex={0}
            aria-checked={isActive}
            aria-label={spaceSwitchLabel}
            className="spaces-switch"
            {...tip(spaceSwitchLabel, 'below')}
            onClick={(e) => {
              e.stopPropagation();
              toggleThisSpace();
            }}
            onKeyDown={switchKeyDown(toggleThisSpace)}
          >
            <span className="spaces-switch__knob" />
          </div>

          <button
            type="button"
            className="spaces-item__icon spaces-item__delete"
            {...tip('Delete', 'below')}
            aria-label="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(space.id);
            }}
          >
            <Icon name="trash" size={14} color="currentColor" />
          </button>
        </div>

        {isExpanded && (
          <div className="spaces-item__body">
            <div className="spaces-item__add">
              <input
                type="text"
                className="spaces-item__add-input"
                value={pageInputValue}
                placeholder="Add pages, e.g. 3, 6-9"
                aria-label="Add pages (e.g. 3, 6-9, 12)"
                onChange={(e) => onPageInputChange(space.id, sanitizePageRangeInput(e.target.value))}
                inputMode="numeric"
                pattern="[0-9,-]*"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAssignPages(space.id);
                  }
                }}
              />
              {/* A word, not a gold square. It turns gold only once there is
                  something to add; empty, it rests in quiet ink. */}
              <button
                type="button"
                className={`spaces-item__add-go tertiary${pageInputValue ? ' has-value' : ''}`}
                aria-label="Add pages"
                onClick={(e) => {
                  e.stopPropagation();
                  onAssignPages(space.id);
                }}
              >
                Add
              </button>
            </div>
            {pageError && (
              <div className="spaces-item__error" role="alert">
                {pageError}
              </div>
            )}

            {pageCount === 0 ? (
              <div className="spaces-item__empty">No pages added yet.</div>
            ) : (
              <ul className="spaces-item__regions">
                {space.assignedPages
                  ?.slice()
                  .sort((a, b) => (a.pageId || 0) - (b.pageId || 0))
                  .map((page) => {
                    const regionLabel = typeof page.label === 'string' && page.label.trim().length > 0
                      ? page.label.trim()
                      : `Region ${page.pageId}`;
                    const isEditingRegion = editingRegionId === page.pageId;

                    // Region overlay switch — always shown, dimmed when it cannot act.
                    const hasOverlayProps = onToggleRegionOverlay && getRegionOverlayEnabled && isRegionOverlayToggleEnabled;
                    const isOverlayEnabled = hasOverlayProps ? getRegionOverlayEnabled(space.id, page.pageId, page) : false;
                    const isOverlayToggleEnabled = hasOverlayProps ? isRegionOverlayToggleEnabled(space.id, page.pageId, page) : false;
                    const overlayLabel = !hasOverlayProps
                      ? 'Overlay toggle'
                      : !isActive
                        ? 'Enable space to toggle overlay'
                        : !isOverlayToggleEnabled
                          ? 'Define regions first to enable overlay'
                          : (isOverlayEnabled ? 'Hide overlay for this region' : 'Show overlay for this region');
                    const toggleOverlay = () => {
                      if (!isOverlayToggleEnabled || !onToggleRegionOverlay) return;
                      onToggleRegionOverlay(space.id, page.pageId);
                    };

                    // KAL-313 / history F1 (2026-06-11): the region-edit entry
                    // point. Without it the Region Selection Tool — and the
                    // commit-time region-delete journaling — is unreachable.
                    const isActiveRegionEdit =
                      isRegionSelectionActive &&
                      regionSelectionPage === page.pageId &&
                      activeSpaceId === space.id;
                    const regionEditLabel = isActiveRegionEdit ? 'Exit region edit' : 'Edit region areas on the page';

                    // One visible control on screen, but separate canvas/survey features in code.
                    const hasVisibility = Boolean(getVisibilityState && onToggleVisibility);
                    const visibilityState = hasVisibility ? getVisibilityState(space.id, page.pageId) : false;
                    const isVisibilityDisabled = !isActive || activeSpaceId === null;
                    const visibilityLabel = !isVisibilityDisabled
                      ? (isSurveyVisibilityContext
                        ? (visibilityState ? 'Hide survey annotations' : 'Show survey annotations')
                        : (visibilityState ? 'Hide canvas annotations' : 'Show canvas annotations'))
                      : 'Toggle is only available when a space is active';

                    return (
                      <li key={page.pageId} className="spaces-region">
                        <button
                          type="button"
                          className="spaces-region__page tertiary"
                          {...tip(`Go to page ${page.pageId}`, 'below')}
                          aria-label={`Go to page ${page.pageId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onNavigateToPage?.(page.pageId);
                          }}
                        >
                          <span>{page.pageId}</span>
                        </button>

                        <div className="spaces-region__name">
                          {isEditingRegion ? (
                            <input
                              ref={editingRegionInputRef}
                              type="text"
                              value={editingRegionValue}
                              aria-label="Region name"
                              onChange={(e) => setEditingRegionValue(e.target.value)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              onFocus={(e) => e.stopPropagation()}
                              onBlur={() => {
                                if (isRegionSelectionActive) return;
                                commitRegionRename(page.pageId);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRegionRename(page.pageId);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  cancelRegionRename();
                                }
                              }}
                              className="spaces-region__name-input"
                            />
                          ) : (
                            <button
                              type="button"
                              className="spaces-region__label tertiary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleRegionEditClick(page.pageId, regionLabel);
                              }}
                              {...tip('Click to rename', 'below')}
                              aria-label="Click to rename"
                            >
                              {regionLabel}
                            </button>
                          )}
                        </div>

                        {/* UX 2026-09-17 (owner ruling): region-edit ON turns the
                            pencil gold and leaves its chrome alone. */}
                        <button
                          type="button"
                          className={`spaces-item__icon spaces-region__edit${isActiveRegionEdit ? ' is-editing' : ''}`}
                          {...tip(regionEditLabel, 'below')}
                          aria-label={regionEditLabel}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isActiveRegionEdit) {
                              onCancelRegionEdit?.(space.id, page.pageId);
                            } else {
                              onRequestRegionEdit?.(space.id, page.pageId);
                            }
                          }}
                        >
                          <Icon name="edit" size={14} color="currentColor" />
                        </button>

                        {hasVisibility ? (
                          <button
                            type="button"
                            className={`spaces-item__icon spaces-region__visibility${visibilityState ? ' is-on' : ''}`}
                            disabled={isVisibilityDisabled}
                            {...tip(visibilityLabel, 'below')}
                            aria-label={visibilityLabel}
                            onClick={(e) => {
                              const now = Date.now();
                              const lastClick = parseInt(e.currentTarget.dataset.lastClick || '0', 10);
                              if (now - lastClick < 300) {
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                              }
                              e.currentTarget.dataset.lastClick = now.toString();
                              if (isVisibilityDisabled) return;
                              e.stopPropagation();
                              onToggleVisibility(space.id, page.pageId, !visibilityState);
                            }}
                          >
                            {isSurveyVisibilityContext ? (
                              <Icon name="survey" size={14} />
                            ) : (
                              <Icon name={visibilityState ? 'lightbulbOn' : 'lightbulbOff'} size={14} color="currentColor" />
                            )}
                          </button>
                        ) : (
                          <span className="spaces-item__icon" aria-hidden="true" />
                        )}

                        <div
                          role="switch"
                          tabIndex={isOverlayToggleEnabled ? 0 : -1}
                          aria-checked={Boolean(isOverlayToggleEnabled && isOverlayEnabled)}
                          aria-disabled={!isOverlayToggleEnabled}
                          aria-label={overlayLabel}
                          className="spaces-switch"
                          {...tip(overlayLabel, 'below')}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleOverlay();
                          }}
                          onKeyDown={switchKeyDown(toggleOverlay)}
                        >
                          <span className="spaces-switch__knob" />
                        </div>

                        <button
                          type="button"
                          className="spaces-item__icon spaces-item__delete"
                          {...tip('Delete', 'below')}
                          aria-label="Delete"
                          onClick={() => onRemovePage(space.id, page.pageId)}
                        >
                          <Icon name="trash" size={14} color="currentColor" />
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const SpacesPanel = ({
  spaces,
  activeSpaceId,
  onSpaceCreate,
  onSpaceUpdate,
  onSpaceDelete,
  onSetActiveSpace,
  onExitSpaceMode,
  onRequestRegionEdit,
  onCancelRegionEdit,
  onSpaceAssignPages,
  onSpaceRenamePage,
  onSpaceRemovePage,
  onNavigateToPage = null,
  onReorderSpaces,
  onExportSpaceCSV,
  onExportSpacePDF,
  isRegionSelectionActive = false,
  regionSelectionPage = null,
  numPages,
  features,
  canManageSpaces = false,
  getCanvasAnnotationVisibilityState = null,
  onToggleCanvasAnnotations = null,
  getSurveyAnnotationVisibilityState = null,
  onToggleSurveyAnnotations = null,
  externalSelectedSpaceId = null,
  onToggleRegionOverlay = null,
  getRegionOverlayEnabled = null,
  isRegionOverlayToggleEnabled = null,
  showSurveyPanel = false,
  selectedModuleId = null,
  mobileMode = false,
  mobilePanelVisible = false,
  onMobilePanelMetricsChange = null,
  // Phone only: exits space mode and closes the sheet (PDFSidebar owns both).
  onExitSpacesAction = null,
}) => {
  const tip = useTooltip();
  const [expandedSpaces, setExpandedSpaces] = useState(() => new Set());
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [isRearrangingSpaces, setIsRearrangingSpaces] = useState(false);
  const [optimisticSpaceIds, setOptimisticSpaceIds] = useState(() => spaces.map(space => space.id));
  const [isSpacesExportMenuOpen, setIsSpacesExportMenuOpen] = useState(false);

  // Sync external selectedSpaceId prop with internal state
  React.useEffect(() => {
    // Always sync when external changes, even if it's the same value (handles re-renders)
    if (externalSelectedSpaceId !== null) {
      if (externalSelectedSpaceId !== selectedSpaceId) {
        setSelectedSpaceId(externalSelectedSpaceId);
      }
    }
    // Don't clear internal state when external becomes null - user might have manually selected
    // This ensures the exit button stays visible during region editing even if external state is cleared
  }, [externalSelectedSpaceId]); // Only depend on externalSelectedSpaceId to avoid infinite loop

  // Additional effect to restore state if it gets cleared but external is still set
  // This handles cases where internal state is cleared by other means (e.g., space updates)
  React.useEffect(() => {
    if (externalSelectedSpaceId !== null && selectedSpaceId === null) {
      setSelectedSpaceId(externalSelectedSpaceId);
    }
  }, [selectedSpaceId, externalSelectedSpaceId]);
  const [pageInputs, setPageInputs] = useState({});
  const [pageErrors, setPageErrors] = useState({});
  const previousSpaceIdsRef = useRef(new Set(spaces.map(space => space.id)));
  const spacesReorderDebugSessionRef = useRef(null);
  const spacesReorderMoveCountRef = useRef(0);

  // 2026-07-12 (demo parity defect #4): report the panel's MEASURED natural
  // height so the mobile spaces sheet hugs its real content, instead of the
  // sheet predicting row heights that drifted from these restyled desktop
  // rows. expandedPageRows is kept as the pre-measurement fallback signal.
  const mobilePanelRootRef = useRef(null);
  const mobileSpacesListRef = useRef(null);
  React.useEffect(() => {
    if (!mobileMode || typeof onMobilePanelMetricsChange !== 'function') return;
    // Skip while hidden (display:none tab) — rects read 0 there; the effect
    // re-runs when mobilePanelVisible flips true and measures real layout.
    if (!mobilePanelVisible) return;
    const expandedPageRows = spaces.reduce((sum, space) => {
      const pageCount = Array.isArray(space.assignedPages)
        ? space.assignedPages.length
        : (Array.isArray(space.pages) ? space.pages.length : 0);
      return sum + (expandedSpaces.has(space.id) ? Math.max(1, pageCount) : 0);
    }, 0);
    // Measure synchronously — the DOM is committed by the time effects run,
    // and requestAnimationFrame stalls entirely in backgrounded/paused
    // WebViews, which would leave the sheet stuck on the fallback height.
    const rootEl = mobilePanelRootRef.current;
    const listEl = mobileSpacesListRef.current;
    let contentHeight = null;
    if (rootEl && listEl) {
      const rootH = rootEl.getBoundingClientRect().height;
      const listH = listEl.getBoundingClientRect().height;
      const listStyles = window.getComputedStyle(listEl);
      const listPadY = (parseFloat(listStyles.paddingTop) || 0) + (parseFloat(listStyles.paddingBottom) || 0);
      // Natural height of the list content: the sortable wrapper stretches
      // to minHeight:100%, so measure first-row top -> last-row bottom
      // (includes gaps); the empty-state block is naturally sized.
      const inner = listEl.firstElementChild;
      let listContentH = 0;
      if (inner) {
        const rows = inner.children;
        if (rows.length > 0) {
          listContentH = rows[rows.length - 1].getBoundingClientRect().bottom
            - rows[0].getBoundingClientRect().top;
        } else {
          listContentH = inner.getBoundingClientRect().height;
        }
      }
      // (rootH - listH) = the panel chrome above the list (header row),
      // independent of whatever height the sheet imposed on the list.
      const natural = (rootH - listH) + listPadY + listContentH;
      if (Number.isFinite(natural) && natural > 0) contentHeight = Math.ceil(natural);
    }
    onMobilePanelMetricsChange({ expandedPageRows, contentHeight });
  }, [expandedSpaces, mobileMode, mobilePanelVisible, onMobilePanelMetricsChange, spaces]);
  const spacesDropFrameCaptureRef = useRef(null);
  const spacesExportAnchorRef = useRef(null);

  React.useEffect(() => {
    if (!isSpacesExportMenuOpen) return undefined;
    // Light popover — shared dismiss rules R1/R2/R5 (src/components/dismissRules.js).
    return watchLightPopover({
      contains: (target) => !spacesExportAnchorRef.current || spacesExportAnchorRef.current.contains(target),
      close: () => setIsSpacesExportMenuOpen(false),
    });
  }, [isSpacesExportMenuOpen]);

  const captureSpacesDropFrame = useCallback((label, details = {}) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const sampleStyle = (node) => {
      if (!node) return null;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        x: Number(rect.x.toFixed(1)),
        y: Number(rect.y.toFixed(1)),
        width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        opacity: style.opacity,
        transform: style.transform,
        transition: style.transition,
        background: style.backgroundColor,
        border: style.border,
        boxShadow: style.boxShadow,
        overflow: style.overflow,
        visibility: style.visibility,
        display: style.display,
      };
    };

    const rows = Array.from(document.querySelectorAll('[data-space-sortable-row-id]')).map((node) => {
      const wrapper = node.closest('[data-sortable-rearrange-item]');
      const card = node.querySelector('[data-drag-rearrange-row]');
      const header = card?.firstElementChild || null;
      // 2026-09-23: the row itself carries aria-expanded (no separate expand button).
      const expandButton = node.querySelector('.spaces-item__row[aria-expanded]');

      return {
        id: node.getAttribute('data-space-sortable-row-id'),
        text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        expanded: expandButton?.getAttribute('aria-expanded') === 'true',
        wrapper: sampleStyle(wrapper),
        rowRoot: sampleStyle(node),
        card: sampleStyle(card),
        header: sampleStyle(header),
      };
    });

    const frame = {
      label,
      time: Number(performance.now().toFixed(1)),
      details,
      rows,
    };

    const capture = spacesDropFrameCaptureRef.current;
    if (capture) {
      capture.frames.push(frame);
    }

    return frame;
  }, []);

  const summarizeSpacesDropCapture = useCallback((capture) => {
    const frames = capture?.frames || [];
    const firstFrame = frames[0];
    const lastFrame = frames[frames.length - 1];
    const beforeRows = new Map((firstFrame?.rows || []).map((row) => [row.id, row]));
    const changedRows = (lastFrame?.rows || []).map((afterRow) => {
      const beforeRow = beforeRows.get(afterRow.id);
      if (!beforeRow) return null;
      return {
        id: afterRow.id,
        text: afterRow.text,
        expanded: afterRow.expanded,
        wrapperYDelta: Number(((afterRow.wrapper?.y ?? 0) - (beforeRow.wrapper?.y ?? 0)).toFixed(1)),
        cardYDelta: Number(((afterRow.card?.y ?? 0) - (beforeRow.card?.y ?? 0)).toFixed(1)),
        wrapperTransform: {
          before: beforeRow.wrapper?.transform,
          after: afterRow.wrapper?.transform,
        },
        wrapperTransition: {
          before: beforeRow.wrapper?.transition,
          after: afterRow.wrapper?.transition,
        },
        cardBackground: {
          before: beforeRow.card?.background,
          after: afterRow.card?.background,
        },
        headerBackground: {
          before: beforeRow.header?.background,
          after: afterRow.header?.background,
        },
        boxShadow: {
          before: beforeRow.card?.boxShadow,
          after: afterRow.card?.boxShadow,
        },
      };
    }).filter(Boolean).filter((row) => (
      row.wrapperYDelta !== 0 ||
      row.cardYDelta !== 0 ||
      row.wrapperTransform.before !== row.wrapperTransform.after ||
      row.wrapperTransition.before !== row.wrapperTransition.after ||
      row.cardBackground.before !== row.cardBackground.after ||
      row.headerBackground.before !== row.headerBackground.after ||
      row.boxShadow.before !== row.boxShadow.after
    ));

    return {
      startedAt: capture?.startedAt,
      event: capture?.event,
      frameCount: frames.length,
      firstFrame: firstFrame?.label,
      lastFrame: lastFrame?.label,
      changedRows,
    };
  }, []);

  const startSpacesDropFrameCapture = useCallback((event = {}) => {
    if (typeof window === 'undefined') return;

    const capture = {
      startedAt: new Date().toISOString(),
      event,
      frames: [],
    };
    spacesDropFrameCaptureRef.current = capture;
    captureSpacesDropFrame('before-drop-commit', event);

    let frameCount = 0;
    const captureNextFrame = () => {
      frameCount += 1;
      captureSpacesDropFrame(`raf-${frameCount}`, event);
      if (frameCount < 10) {
        window.requestAnimationFrame(captureNextFrame);
        return;
      }

      window.setTimeout(() => {
        captureSpacesDropFrame('after-120ms', event);
        window.__spacesDropFrameCaptures = window.__spacesDropFrameCaptures || [];
        window.__spacesDropFrameCaptures.push(capture);
        window.__copySpacesDropFrames = () => JSON.stringify({
          latest: window.__spacesDropFrameCaptures?.[window.__spacesDropFrameCaptures.length - 1] || null,
          captures: window.__spacesDropFrameCaptures || [],
        }, null, 2);
        const summary = summarizeSpacesDropCapture(capture);
        console.info('[SPACES_DROP_SUMMARY]', JSON.stringify(summary, null, 2));
        console.info('[SPACES_DROP_FRAMES]', window.__copySpacesDropFrames());
        spacesDropFrameCaptureRef.current = null;
      }, 120);
    };

    window.requestAnimationFrame(captureNextFrame);
  }, [captureSpacesDropFrame, summarizeSpacesDropCapture]);

  const recordSpacesReorderDebug = useCallback((type, details = {}) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const rows = Array.from(document.querySelectorAll('[data-space-sortable-row-id]')).map((node) => {
      if (!node.closest('[data-sortable-rearrange-list]')) return null;
      const item = node.querySelector('[data-sortable-rearrange-item]') || node;
      const rect = item.getBoundingClientRect();
      const outerRect = node.getBoundingClientRect();
      // 2026-09-23: the row itself carries aria-expanded.
      const expandButton = node.querySelector('.spaces-item__row[aria-expanded]');
      const style = window.getComputedStyle(node);

      return {
        id: node.getAttribute('data-space-sortable-row-id'),
        text: (item.innerText || node.innerText || '').replace(/\s+/g, ' ').trim(),
        expanded: expandButton?.getAttribute('aria-expanded') === 'true',
        y: Number(rect.y.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        outerY: Number(outerRect.y.toFixed(1)),
        outerHeight: Number(outerRect.height.toFixed(1)),
        transform: style.transform,
        transition: style.transition,
      };
    }).filter(Boolean);

    const session = spacesReorderDebugSessionRef.current || {
      startedAt: new Date().toISOString(),
      events: [],
    };
    session.events.push({
      type,
      time: Math.round(performance.now()),
      details,
      rows,
      expandedSpaceIds: Array.from(expandedSpaces),
    });
    spacesReorderDebugSessionRef.current = session;

    window.__spacesReorderDebugSessions = window.__spacesReorderDebugSessions || [];
    window.__spacesReorderDebugSessions[window.__spacesReorderDebugSessions.length - 1] = session;
    window.__copySpacesReorderDebug = () => JSON.stringify({
      latest: window.__spacesReorderDebugSessions?.[window.__spacesReorderDebugSessions.length - 1] || null,
      sessions: window.__spacesReorderDebugSessions || [],
    }, null, 2);
  }, [expandedSpaces]);

  const requireSpaceManagement = useCallback(() => {
    if (!canManageSpaces) {
      showToast('Your plan or document access does not allow editing Spaces or Regions.', 'error');
      return false;
    }
    return true;
  }, [canManageSpaces]);

  const handleCreateSpace = useCallback(() => {
    if (!requireSpaceManagement()) return;
    // Next UNUSED number, not the count: after a delete, `Space ${length + 1}`
    // can equal a surviving space's name ("Space 2") and the create was refused
    // with a duplicate-name toast (owner's phone report 2026-09-30).
    const takenNames = new Set((spaces || []).map((space) => (
      typeof space?.name === 'string' ? space.name.trim().toLowerCase() : ''
    )));
    let counter = (spaces || []).length + 1;
    while (takenNames.has(`space ${counter}`)) counter += 1;
    const name = `Space ${counter}`;
    if (onSpaceCreate) {
      onSpaceCreate({
        name,
        assignedPages: []
      });
    }
  }, [requireSpaceManagement, spaces, onSpaceCreate]);

  const handleRenameSpace = useCallback((spaceId, nextName) => {
    if (!requireSpaceManagement()) return;
    const name = nextName?.trim();
    if (!name) return false;
    // Same rule as PDFViewer's handleSpaceUpdate (which keeps the final say);
    // checked here too so the row knows to put the old name back.
    const lowered = name.toLowerCase();
    if ((spaces || []).some((space) => space?.id !== spaceId
      && typeof space?.name === 'string' && space.name.trim().toLowerCase() === lowered)) {
      showToast('A space with this name already exists. Please choose a different name.', 'error');
      return false;
    }
    if (spaceId && onSpaceUpdate) {
      onSpaceUpdate(spaceId, { name });
    }
    return true;
  }, [onSpaceUpdate, requireSpaceManagement, spaces]);

  const handleDelete = useCallback((spaceId) => {
    if (!requireSpaceManagement()) return;
    if (window.confirm('Delete this space? This will not delete the pages, only the space assignment.')) {
      if (onSpaceDelete) {
        onSpaceDelete(spaceId);
      }
    }
  }, [onSpaceDelete, requireSpaceManagement]);

  const handleToggleExpand = useCallback((spaceId) => {
    setExpandedSpaces(prev => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
      }
      return next;
    });
  }, []);

  const handleExitSpace = useCallback((spaceId) => {
    if (selectedSpaceId === spaceId) {
      setSelectedSpaceId(null);
    }
    if (activeSpaceId === spaceId && onExitSpaceMode) {
      onExitSpaceMode();
    }
  }, [selectedSpaceId, activeSpaceId, onExitSpaceMode]);

  const handleToggleSpace = useCallback((spaceId, shouldActivate) => {
    if (shouldActivate) {
      // Turn on: activate the space
      setSelectedSpaceId(spaceId);
      if (onSetActiveSpace) {
        onSetActiveSpace(spaceId);
      }
    } else {
      // Turn off: deactivate the space
      if (selectedSpaceId === spaceId) {
        setSelectedSpaceId(null);
      }
      if (activeSpaceId === spaceId && onExitSpaceMode) {
        onExitSpaceMode();
      }
    }
  }, [selectedSpaceId, activeSpaceId, onSetActiveSpace, onExitSpaceMode]);

  const handlePageInputChange = useCallback((spaceId, value) => {
    setPageInputs(prev => ({
      ...prev,
      [spaceId]: value
    }));
    setPageErrors(prev => ({
      ...prev,
      [spaceId]: null
    }));
  }, []);

  const handleAssignPages = useCallback((spaceId) => {
    if (!requireSpaceManagement()) return;
    const rawInput = (pageInputs[spaceId] || '').trim();
    const { pages, errors } = parsePageRangeInput(rawInput, {
      min: 1,
      max: typeof numPages === 'number' && numPages > 0 ? numPages : Infinity
    });

    if (errors.length > 0) {
      setPageErrors(prev => ({
        ...prev,
        [spaceId]: errors.join(' ')
      }));
      return;
    }

    if (pages.length === 0) {
      setPageErrors(prev => ({
        ...prev,
        [spaceId]: 'Enter one or more page numbers.'
      }));
      return;
    }

    if (onSpaceAssignPages) {
      onSpaceAssignPages(spaceId, pages);
    }

    setPageInputs(prev => ({
      ...prev,
      [spaceId]: ''
    }));
    setPageErrors(prev => ({
      ...prev,
      [spaceId]: null
    }));
  }, [pageInputs, numPages, onSpaceAssignPages, requireSpaceManagement]);

  React.useEffect(() => {
    const previousIds = previousSpaceIdsRef.current;
    const currentIds = new Set(spaces.map(space => space.id));
    const newlyAddedIds = spaces
      .map(space => space.id)
      .filter((spaceId) => spaceId != null && !previousIds.has(spaceId));

    if (newlyAddedIds.length > 0) {
      setExpandedSpaces(prev => {
        const next = new Set(prev);
        newlyAddedIds.forEach(id => next.add(id));
        return next;
      });
    }

    previousSpaceIdsRef.current = currentIds;
  }, [spaces]);

  React.useEffect(() => {
    setOptimisticSpaceIds(spaces.map(space => space.id));
  }, [spaces]);

  const orderedSpaces = React.useMemo(() => {
    const byId = new Map(spaces.map(space => [space.id, space]));
    const seen = new Set();
    const ordered = optimisticSpaceIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((space) => {
        if (seen.has(space.id)) return false;
        seen.add(space.id);
        return true;
      });

    spaces.forEach((space) => {
      if (!seen.has(space.id)) {
        ordered.push(space);
      }
    });

    return ordered;
  }, [optimisticSpaceIds, spaces]);

  const handleRemovePage = useCallback((spaceId, pageId) => {
    if (!requireSpaceManagement()) return;
    if (!onSpaceRemovePage) return;
    onSpaceRemovePage(spaceId, pageId);
  }, [onSpaceRemovePage, requireSpaceManagement]);

  const handleRenameRegion = useCallback((spaceId, pageId, label) => {
    if (!requireSpaceManagement()) return;
    onSpaceRenamePage?.(spaceId, pageId, label);
  }, [onSpaceRenamePage, requireSpaceManagement]);

  const handleRequestRegionEdit = useCallback((spaceId, pageId) => {
    if (!requireSpaceManagement()) return;
    onRequestRegionEdit?.(spaceId, pageId);
  }, [onRequestRegionEdit, requireSpaceManagement]);

  const handleSpaceReorder = useCallback((activeId, overId) => {
    if (!requireSpaceManagement()) return;
    if (activeId === overId) return;
    if (!onReorderSpaces) return;
    const fromIndex = spaces.findIndex(space => space.id === activeId);
    const toIndex = spaces.findIndex(space => space.id === overId);
    if (fromIndex === -1 || toIndex === -1) return;
    recordSpacesReorderDebug('reorder', { activeId, overId, fromIndex, toIndex });
    setOptimisticSpaceIds((prevIds) => {
      const currentIds = orderedSpaces.map(space => space.id);
      const ids = prevIds.length === currentIds.length && currentIds.every((id) => prevIds.includes(id))
        ? prevIds
        : currentIds;
      const optimisticFromIndex = ids.indexOf(activeId);
      const optimisticToIndex = ids.indexOf(overId);
      const nextIds = moveItem(ids, optimisticFromIndex, optimisticToIndex);
      return nextIds === ids ? ids : nextIds;
    });
    onReorderSpaces(fromIndex, toIndex);
  }, [onReorderSpaces, orderedSpaces, recordSpacesReorderDebug, requireSpaceManagement, spaces]);

  const handleSpaceDragStart = useCallback(({ activeId }) => {
    setIsRearrangingSpaces(true);
    spacesReorderMoveCountRef.current = 0;
    spacesReorderDebugSessionRef.current = {
      startedAt: new Date().toISOString(),
      events: [],
    };
    if (typeof window !== 'undefined') {
      window.__spacesReorderDebugSessions = window.__spacesReorderDebugSessions || [];
      window.__spacesReorderDebugSessions.push(spacesReorderDebugSessionRef.current);
    }
    recordSpacesReorderDebug('drag-start', { activeId, wasExpanded: expandedSpaces.has(activeId) });
  }, [expandedSpaces, recordSpacesReorderDebug]);

  const handleSpaceDragMove = useCallback(({ activeId, overId, delta }) => {
    spacesReorderMoveCountRef.current += 1;
    if (spacesReorderMoveCountRef.current > 1 && spacesReorderMoveCountRef.current % 4 !== 0) return;
    recordSpacesReorderDebug('drag-move', { activeId, overId, delta });
  }, [recordSpacesReorderDebug]);

  const restoreCollapsedSpaceAfterDrag = useCallback((event = {}) => {
    recordSpacesReorderDebug('drag-settle', event);

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setIsRearrangingSpaces(false);
      }, 180);
      try {
        window.localStorage.setItem('spacesReorderDebugLatest', window.__copySpacesReorderDebug?.() || '');
        console.info('[SPACES_REORDER_DEBUG]', window.__copySpacesReorderDebug?.());
      } catch {
        // Best-effort debugging only.
      }
    } else {
      setIsRearrangingSpaces(false);
    }
  }, [recordSpacesReorderDebug]);

  const expandedSpaceId = Array.from(expandedSpaces)[0] || null;
  const spacesExportTargetId = selectedSpaceId || activeSpaceId || expandedSpaceId || orderedSpaces[0]?.id || null;
  const spacesExportTarget = orderedSpaces.find((space) => space.id === spacesExportTargetId) || null;
  const createSpaceLabel = canManageSpaces ? 'Create space' : 'Upgrade to Pro to create spaces';
  const exportSpaceLabel = spacesExportTarget ? `Export ${spacesExportTarget.name || 'space'}` : 'Create a space to export';

  return (
    <div
      ref={mobilePanelRootRef}
      className={`spaces-panel${mobileMode ? ' mobile-spaces-panel' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: mobileMode ? 'auto' : '100%',
        flex: mobileMode ? 1 : undefined,
        minHeight: 0,
        fontFamily: FONT_FAMILY,
        background: mobileMode ? 'var(--surface-2)' : 'var(--surface-1)'
      }}
    >
      {/* UX 2026-09-23 (owner): the Bookmarks header pattern — [+ Add] on the
          far left and [Export] on the far
          right. One slim row; both buttons are quiet words of equal weight (no
          gold square, no outlined square) with the same edge gap. */}
      <div className="spaces-panel__head">
        <button
          type="button"
          className="spaces-panel__head-btn spaces-panel__head-btn--add tertiary"
          onClick={handleCreateSpace}
          {...tip(createSpaceLabel, 'below')}
          aria-label={createSpaceLabel}
        >
          <Icon name="plus" size={14} color="currentColor" />
          <span>Add</span>
        </button>

        {/* Owner 2026-09-23: nothing in the middle - the tab above names the
            panel and the list below says when there are no spaces. */}

        <div
          ref={spacesExportAnchorRef}
          className="spaces-panel__export-anchor"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Future: replace this compact menu with a custom Spaces export panel that lets users choose which space to export. */}
          <button
            type="button"
            className="spaces-panel__head-btn spaces-panel__head-btn--export tertiary"
            {...tip(exportSpaceLabel, 'below')}
            aria-label={exportSpaceLabel}
            aria-expanded={isSpacesExportMenuOpen}
            disabled={!spacesExportTarget}
            onClick={() => {
              if (!spacesExportTarget) return;
              if (!features?.excelExport) {
                showToast('Exporting spaces is a Pro feature.', 'error');
                return;
              }
              setIsSpacesExportMenuOpen((open) => !open);
            }}
          >
            <Icon name="upload" size={14} color="currentColor" />
            <span>Export</span>
          </button>
          {isSpacesExportMenuOpen && spacesExportTarget && (
            <div className="spaces-header-export-menu" role="menu">
              <button
                type="button"
                className="spaces-header-export-menu-button"
                onClick={() => {
                  setIsSpacesExportMenuOpen(false);
                  onExportSpaceCSV?.(spacesExportTarget.id);
                }}
              >
                CSV
              </button>
              <button
                type="button"
                className="spaces-header-export-menu-button"
                {...tip('Exports base PDF pages only; app annotations are not embedded.', 'below')}
                onClick={() => {
                  setIsSpacesExportMenuOpen(false);
                  onExportSpacePDF?.(spacesExportTarget.id);
                }}
              >
                PDF Pages
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Spaces List — one divided list, no cards. */}
      <div ref={mobileSpacesListRef} className="spaces-list">
        {spaces.length === 0 ? (
          <div className="spaces-list__empty">
            No spaces yet. Create a space to filter pages by visibility.
          </div>
        ) : (
          <SortableRearrangeList
            ids={orderedSpaces.map(space => space.id)}
            onReorder={handleSpaceReorder}
            onDragStart={handleSpaceDragStart}
            onDragMove={handleSpaceDragMove}
            onBeforeDragEnd={startSpacesDropFrameCapture}
            onDragEnd={restoreCollapsedSpaceAfterDrag}
            onDragCancel={restoreCollapsedSpaceAfterDrag}
            variableHeight
            gap={0}
          >
            {orderedSpaces.map((space) => {
              const isActive = activeSpaceId === space.id;
              const isSelected = selectedSpaceId === space.id;
              const isExpanded = expandedSpaces.has(space.id);
              const pageCount = space.assignedPages?.length || 0;
              const regionCount = space.assignedPages?.reduce((sum, p) => sum + (p.regions?.length || 0), 0) || 0;
              return (
                <SortableRearrangeRow
                  key={space.id}
                  id={space.id}
                  disabled={!canManageSpaces || !onReorderSpaces}
                  animateLayoutChanges={animateSpaceLayoutChanges}
                  draggingOpacity={1}
                  transition={null}
                >
                  {({ attributes, listeners, isDragging }) => (
                    <SpaceSortableCard
                      space={space}
                      dragHandleProps={{ ...attributes, ...listeners }}
                      isDragging={isDragging}
                      isRearranging={isRearrangingSpaces}
                      isActive={isActive}
                      isSelected={isSelected}
                      isExpanded={isExpanded}
                      pageCount={pageCount}
                      regionCount={regionCount}
                      pageInputValue={pageInputs[space.id] || ''}
                      pageError={pageErrors[space.id]}
                      onToggleExpand={handleToggleExpand}
                      onRenameSpace={handleRenameSpace}
                      onDelete={handleDelete}
                      onExitSpace={handleExitSpace}
                      onToggleSpace={handleToggleSpace}
                      onPageInputChange={handlePageInputChange}
                      onAssignPages={handleAssignPages}
                      onRenameRegion={handleRenameRegion}
                      onRemovePage={handleRemovePage}
                      onNavigateToPage={onNavigateToPage}
                      onRequestRegionEdit={handleRequestRegionEdit}
                      onCancelRegionEdit={onCancelRegionEdit}
                      isRegionSelectionActive={isRegionSelectionActive}
                      regionSelectionPage={regionSelectionPage}
                      getCanvasAnnotationVisibilityState={getCanvasAnnotationVisibilityState}
                      onToggleCanvasAnnotations={onToggleCanvasAnnotations}
                      getSurveyAnnotationVisibilityState={getSurveyAnnotationVisibilityState}
                      onToggleSurveyAnnotations={onToggleSurveyAnnotations}
                      activeSpaceId={activeSpaceId}
                      onToggleRegionOverlay={onToggleRegionOverlay}
                      getRegionOverlayEnabled={getRegionOverlayEnabled}
                      isRegionOverlayToggleEnabled={isRegionOverlayToggleEnabled}
                      showSurveyPanel={showSurveyPanel}
                      selectedModuleId={selectedModuleId}
                    />
                  )}
                </SortableRearrangeRow>
              );
            })}
          </SortableRearrangeList>
        )}
        {/* Phone: "Exit Spaces / Regions" is a quiet red word at the end of
            the list, not a bordered button in its own footer band. */}
        {typeof onExitSpacesAction === 'function' && (
          <button
            type="button"
            className="spaces-list__exit tertiary"
            onClick={onExitSpacesAction}
          >
            Exit Spaces / Regions
          </button>
        )}
      </div>
    </div>
  );
};

export default SpacesPanel;
