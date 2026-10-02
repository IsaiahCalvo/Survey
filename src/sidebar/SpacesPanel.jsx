/**
 * SpacesPanel.jsx — sidebar panel for managing "Spaces" (named page groups with
 * regions and per-page annotation visibility).
 *
 * Default-exports the SpacesPanel component; internal SpaceSortableCard renders
 * each space as a card (owner 2026-10-02: the layout he had before the
 * 2026-09-23 one-list rewrite, cleaned up): grip, page count, fold arrow,
 * click-to-rename name, switch and delete; open, an "Add pages" field
 * (parsePageRangeInput) with a quiet [+], then one card per page ("region")
 * with page number, outline switch, name, edit areas, marks bulb and remove.
 * SpacesExportPanel is the "Export <space>" menu (desktop) / sheet (phone).
 * Cards reorder via dnd-kit SortableRearrangeList with optimistic ordering and
 * frame-capture debug hooks.
 */
import React, { useState, useCallback, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
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
import SectionIconButton from '../components/SectionIconButton.jsx';
import { watchLightPopover } from '../components/dismissRules.js';
import AnchoredPopover from '../components/AnchoredPopover';
import { useConfirmDialog } from '../components/dialogPrompts';
import {
  buildDeleteSpaceConfirm,
  buildRemovePageConfirm,
  formatSpaceCountLabel,
} from '../utils/spaceCascadeImpact.js';

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
  mobileMode = false,
}) {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  const [editingRegionId, setEditingRegionId] = useState(null);
  const [editingRegionValue, setEditingRegionValue] = useState('');
  // The name the field opened with: committing it unchanged is not a rename
  // (owner 2026-10-02: only a real change is saved).
  const editingRegionStartRef = useRef('');
  const editingRegionInputRef = useRef(null);
  const spaceNameInputRef = useRef(null);
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

    if (labelToSave !== editingRegionStartRef.current.trim()) {
      onRenameRegion?.(space.id, pageId, labelToSave);
    }
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
    // Spaces chunk A: render the field and focus it inside the tap itself -
    // iOS only raises the keyboard for a focus() made in the user's gesture,
    // and the rAF focus below came a frame too late for that.
    editingRegionStartRef.current = currentLabel || '';
    flushSync(() => {
      setEditingRegionId(pageId);
      setEditingRegionValue(currentLabel);
    });
    editingRegionInputRef.current?.focus();
    editingRegionInputRef.current?.select();
  }, []);

  const commitSpaceName = useCallback((input) => {
    if (!input) return;
    const fallbackName = space.name?.trim() || 'Space';
    const nextName = (input.value || '').trim() || fallbackName;
    input.value = nextName;
    if (input.parentElement) {
      input.parentElement.dataset.value = nextName || ' ';
    }
    // Only a real change is a rename (owner 2026-10-02). A refused rename
    // (duplicate name, no permission) leaves space.name, and so this
    // uncontrolled input's key, unchanged: put the real name back instead of
    // leaving the refused text showing as a second "Space 2".
    if (nextName !== space.name && onRenameSpace?.(space.id, nextName) !== true) {
      input.value = space.name || '';
      if (input.parentElement) {
        input.parentElement.dataset.value = space.name || ' ';
      }
    }
  }, [onRenameSpace, space.id, space.name]);

  /*
   * Owner 2026-10-02 ("I want it back to the way I had it, except slightly
   * cleaner"): the card layout from before the 2026-09-23 one-list rewrite
   * (1e9ce63) and the 2026-10-01 more-menu row (35aaa23), with every later
   * behaviour fix kept (empty-space guard, honest delete confirms, rename only
   * on a real change, refused rename restores, iOS keyboard focus, drag).
   *   - a space is a CARD: grip · page count · fold arrow · name (click to
   *     rename) · switch · delete;
   *   - open, it shows "Add pages (e.g. 3, 6-9, 12)" with a quiet [+] joined
   *     to the field, then one small card per page ("region"): page number
   *     (goes to the page) · outline switch · name (click to rename) · edit
   *     areas · light bulb (survey icon in survey mode) · remove;
   *   - cleaner than before: numbers are plain small muted figures (no
   *     circles), switches turn ON in the app's calm neutral ink (the Survey
   *     "Reuse" switch), never gold; the [+] is grey, never a gold square.
   * Sizes: the .spaces-panel custom properties in styles.css (desktop rows
   * 32) and mobilePdfViewer.css (phone rows 44).
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
  // Spaces chunk A: the row counts PAGES (it counted drawn areas, so a space
  // listing two pages could read 0); the full "3 pages · 2 areas" is its name.
  const regionCountLabel = formatSpaceCountLabel(pageCount, regionCount);
  // A space with no pages would hide every page: it cannot be turned on until
  // it has some (an active one can always be turned off).
  const isSwitchBlocked = !isActive && pageCount === 0;
  const spaceSwitchLabel = isActive ? 'Turn off space' : (isSwitchBlocked ? 'Add pages first' : 'Turn on space');
  const toggleThisSpace = () => {
    if (isSwitchBlocked) {
      if (!isExpanded) onToggleExpand(space.id);
      showToast(`Add pages to ${space.name || 'this space'} first.`, 'info');
      return;
    }
    onToggleSpace?.(space.id, !isActive);
  };
  const switchKeyDown = (handler) => (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }
  };
  const spaceName = space.name || 'Space';

  return (
    <div
      data-space-sortable-row-id={space.id}
      className={`space-card${isExpanded ? ' is-expanded' : ''}${isDragging ? ' is-dragging' : ''}${isActive ? ' is-active' : ''}`}
    >
      <div data-drag-rearrange-row className="space-card__block">
        <div
          className="space-card__head"
          aria-expanded={isExpanded}
          onClick={() => onToggleExpand(space.id)}
        >
          <DragRearrangeHandle
            {...dragHandleProps}
            className="space-card__grip"
            data-space-drag-handle
            isDragging={isDragging}
            title="Drag to rearrange"
            onClick={(e) => e.stopPropagation()}
            style={{ width: undefined, height: undefined, color: 'var(--text-3)' }}
          />

          {/* The page count, a plain muted figure (no circle). Its name and
              tooltip say "3 pages · 2 areas". */}
          <span
            className="space-card__count"
            data-space-meta
            aria-label={regionCountLabel}
            {...tip(regionCountLabel, 'below')}
          >
            {pageCount}
          </span>

          <button
            type="button"
            className="space-card__chevron"
            aria-label={isExpanded ? `Fold ${spaceName}` : `Open ${spaceName}`}
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(space.id);
            }}
          >
            <Icon name="chevronRight" size={12} color="currentColor" />
          </button>

          {/* Click to rename (the layout the owner had). Enter or a click
              away saves; Escape puts the name back; an unchanged or refused
              name is not saved. */}
          <span className="space-card__name-fit" data-value={space.name || ' '}>
            <input
              ref={spaceNameInputRef}
              type="text"
              size={1}
              className="space-card__name"
              defaultValue={space.name}
              key={`${space.id}:${space.name}`}
              aria-label={`Rename ${spaceName}`}
              {...tip('Click to rename', 'below')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onInput={(e) => {
                if (e.currentTarget.parentElement) {
                  e.currentTarget.parentElement.dataset.value = e.currentTarget.value || ' ';
                }
              }}
              onBlur={(e) => commitSpaceName(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.value = space.name || '';
                  if (e.currentTarget.parentElement) {
                    e.currentTarget.parentElement.dataset.value = space.name || ' ';
                  }
                  e.currentTarget.blur();
                }
              }}
            />
          </span>

          <span className="space-card__fill" aria-hidden="true" />

          <div
            role="switch"
            tabIndex={0}
            aria-checked={isActive}
            aria-disabled={isSwitchBlocked || undefined}
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
            className="space-card__icon space-card__delete"
            data-glyph-only=""
            aria-label={`Delete ${spaceName}`}
            {...tip('Delete space', 'below')}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(space.id);
            }}
          >
            <Icon name="trash" size={14} color="currentColor" />
          </button>
        </div>

        {isExpanded && (
          <div className="space-card__body">
            <div className="space-card__add">
              <input
                type="text"
                className="space-card__add-input"
                value={pageInputValue}
                placeholder="Add pages (e.g. 3, 6-9, 12)"
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
              {/* Quiet grey, joined to the field - never a gold square. */}
              <button
                type="button"
                className="space-card__add-go"
                data-glyph-only=""
                aria-label="Add pages"
                {...tip('Add pages', 'below')}
                onClick={(e) => {
                  e.stopPropagation();
                  onAssignPages(space.id);
                }}
              >
                <Icon name="plus" size={14} color="currentColor" />
              </button>
            </div>
            {pageError && (
              <div className="space-card__error" role="alert">
                {pageError}
              </div>
            )}

            {pageCount === 0 ? (
              <div className="space-card__empty">No pages added yet.</div>
            ) : (
              <ul className="space-card__regions">
                {space.assignedPages
                  ?.slice()
                  .sort((a, b) => (a.pageId || 0) - (b.pageId || 0))
                  .map((page) => {
                    const regionLabel = typeof page.label === 'string' && page.label.trim().length > 0
                      ? page.label.trim()
                      : `Region ${page.pageId}`;
                    const isEditingRegion = editingRegionId === page.pageId;

                    // Region outline (the hatching outside the drawn areas).
                    const hasOverlayProps = onToggleRegionOverlay && getRegionOverlayEnabled && isRegionOverlayToggleEnabled;
                    const isOverlayEnabled = hasOverlayProps ? getRegionOverlayEnabled(space.id, page.pageId, page) : false;
                    const isOverlayToggleEnabled = hasOverlayProps ? isRegionOverlayToggleEnabled(space.id, page.pageId, page) : false;
                    const overlayLabel = !hasOverlayProps
                      ? 'Outline not available here'
                      : !isActive
                        ? 'Turn the space on to show its outline'
                        : !isOverlayToggleEnabled
                          ? 'Draw an area first to show its outline'
                          : (isOverlayEnabled ? 'Hide the outline' : 'Show the outline');
                    const toggleOverlay = () => {
                      if (!isOverlayToggleEnabled) return;
                      onToggleRegionOverlay?.(space.id, page.pageId);
                    };

                    // KAL-313 / history F1 (2026-06-11): the region-edit entry
                    // point. Without it the Region Selection Tool — and the
                    // commit-time region-delete journaling — is unreachable.
                    const isActiveRegionEdit =
                      isRegionSelectionActive &&
                      regionSelectionPage === page.pageId &&
                      activeSpaceId === space.id;
                    const areaCount = Array.isArray(page.regions) ? page.regions.length : 0;
                    const regionEditLabel = isActiveRegionEdit
                      ? 'Stop editing areas'
                      : (areaCount > 0 ? `Edit the areas on page ${page.pageId}` : `Draw an area on page ${page.pageId}`);

                    // One visible control, separate canvas/survey features in code.
                    const hasVisibility = Boolean(getVisibilityState && onToggleVisibility);
                    const visibilityState = hasVisibility ? getVisibilityState(space.id, page.pageId) : true;
                    const isVisibilityDisabled = !isActive || activeSpaceId === null;
                    const visibilityLabel = isVisibilityDisabled
                      ? 'Turn the space on to show or hide marks'
                      : isSurveyVisibilityContext
                        ? (visibilityState ? 'Hide survey markers' : 'Show survey markers')
                        : (visibilityState ? 'Hide marks' : 'Show marks');

                    return (
                      <li key={page.pageId} className={`space-region-card${isActiveRegionEdit ? ' is-editing' : ''}`}>
                        <button
                          type="button"
                          className="spaces-region__page"
                          {...tip(`Go to page ${page.pageId}`, 'below')}
                          aria-label={`Go to page ${page.pageId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onNavigateToPage?.(page.pageId);
                          }}
                        >
                          {page.pageId}
                        </button>

                        <div
                          role="switch"
                          tabIndex={isOverlayToggleEnabled ? 0 : -1}
                          aria-checked={Boolean(isOverlayToggleEnabled && isOverlayEnabled)}
                          aria-disabled={!isOverlayToggleEnabled || undefined}
                          aria-label={overlayLabel}
                          className="spaces-switch spaces-switch--sm"
                          {...tip(overlayLabel, 'below')}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleOverlay();
                          }}
                          onKeyDown={switchKeyDown(toggleOverlay)}
                        >
                          <span className="spaces-switch__knob" />
                        </div>

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
                              // No onFocus stopPropagation: the window focusin
                              // listener in mobile/keyboardViewport.js is what
                              // lifts the field above the phone keyboard.
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
                              className="spaces-region__label"
                              {...tip('Click to rename', 'below')}
                              aria-label={`Rename ${regionLabel}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleRegionEditClick(page.pageId, regionLabel);
                              }}
                            >
                              {regionLabel}
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          className={`space-card__icon spaces-region__edit${isActiveRegionEdit ? ' is-on' : ''}`}
                          data-glyph-only=""
                          aria-pressed={isActiveRegionEdit}
                          aria-label={regionEditLabel}
                          {...tip(regionEditLabel, 'below')}
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
                          <Icon name="regionEdit" size={14} color="currentColor" />
                        </button>

                        {hasVisibility && (
                          <button
                            type="button"
                            className={`space-card__icon spaces-region__marks${visibilityState ? ' is-on' : ''}`}
                            data-glyph-only=""
                            aria-pressed={Boolean(visibilityState)}
                            aria-disabled={isVisibilityDisabled || undefined}
                            aria-label={visibilityLabel}
                            {...tip(visibilityLabel, 'below')}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (isVisibilityDisabled) return;
                              onToggleVisibility(space.id, page.pageId, !visibilityState);
                            }}
                          >
                            {isSurveyVisibilityContext ? (
                              <Icon name="survey" size={14} color="currentColor" />
                            ) : (
                              <Icon name={visibilityState ? 'lightbulbOn' : 'lightbulbOff'} size={14} color="currentColor" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          className="space-card__icon space-card__delete"
                          data-glyph-only=""
                          aria-label={`Remove page ${page.pageId} from ${spaceName}`}
                          {...tip('Remove from space', 'below')}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemovePage(space.id, page.pageId);
                          }}
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

/*
 * Spaces chunk B: "Export <space>" - which space, then CSV or PDF pages. The
 * desktop shows it as a menu under Export; the phone as its own small sheet
 * (portalled above the Spaces sheet), never the desktop popover.
 */
function SpacesExportPanel({ spaces, spaceId, onSpaceChange, onExportCSV, onExportPDF, onClose }) {
  const target = spaces.find((space) => space.id === spaceId) || null;
  const title = `Export ${target?.name || 'space'}`;
  return (
    <>
      <div className="spaces-export__head">
        <strong>{title}</strong>
        {onClose ? (
          <button type="button" className="spaces-export__close tertiary" onClick={onClose}>Cancel</button>
        ) : null}
      </div>
      <div className="spaces-export__label">Space</div>
      <div className="spaces-export__spaces" role="radiogroup" aria-label="Space to export">
        {spaces.map((space) => {
          const chosen = space.id === spaceId;
          const pages = space.assignedPages?.length || 0;
          return (
            <button
              key={space.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              className={`spaces-export__space${chosen ? ' is-chosen' : ''}`}
              onClick={() => onSpaceChange(space.id)}
            >
              <span>{space.name || 'Space'}</span>
              <small>{pages} {pages === 1 ? 'page' : 'pages'}</small>
              {chosen ? <Icon name="check" size={14} color="currentColor" /> : <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="spaces-export__actions">
        <button
          type="button"
          className="spaces-export__action"
          disabled={!target}
          onClick={() => onExportCSV(target.id)}
        >
          <span>CSV</span>
          <small>One row per mark in this space</small>
        </button>
        <button
          type="button"
          className="spaces-export__action"
          disabled={!target}
          onClick={() => onExportPDF(target.id)}
        >
          <span>PDF Pages</span>
          <small>Exports base PDF pages only; app annotations are not embedded.</small>
        </button>
      </div>
    </>
  );
}

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
  // Spaces chunk A: counts what a page removal / space delete would delete
  // (PDFViewer.getSpaceRemovalImpact), for the confirm.
  getSpaceRemovalImpact = null,
  // Phone: the space whose areas were just edited opens again with the sheet.
  initiallyExpandedSpaceId = null,
  // Spaces chunk B: a ref owned by PDFSidebar (which outlives this panel) that
  // remembers which spaces are open, so closing and reopening the phone sheet
  // (or the desktop panel) brings them back as they were.
  expandedSpacesStoreRef = null,
}) => {
  const tip = useTooltip();
  const [askConfirm, confirmDialogElement] = useConfirmDialog();
  const [expandedSpaces, setExpandedSpaces] = useState(() => new Set([
    ...(expandedSpacesStoreRef?.current || []),
    ...(initiallyExpandedSpaceId ? [initiallyExpandedSpaceId] : []),
  ]));
  React.useEffect(() => {
    if (expandedSpacesStoreRef) expandedSpacesStoreRef.current = expandedSpaces;
  }, [expandedSpaces, expandedSpacesStoreRef]);
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [isRearrangingSpaces, setIsRearrangingSpaces] = useState(false);
  const [optimisticSpaceIds, setOptimisticSpaceIds] = useState(() => spaces.map(space => space.id));
  // Spaces chunk B: the space the Export menu / sheet is open for (null =
  // closed).
  const [exportSpaceId, setExportSpaceId] = useState(null);
  const isSpacesExportMenuOpen = exportSpaceId !== null;
  const spacesExportMenuRef = useRef(null);

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
    // The phone sheet has its own backdrop (a blocking window, R4).
    if (!isSpacesExportMenuOpen || mobileMode) return undefined;
    // Light popover — shared dismiss rules R1/R2/R5 (src/components/dismissRules.js).
    return watchLightPopover({
      contains: (target) => Boolean(
        !spacesExportAnchorRef.current
        || spacesExportAnchorRef.current.contains(target)
        || spacesExportMenuRef.current?.contains(target)
      ),
      close: () => setExportSpaceId(null),
    });
  }, [isSpacesExportMenuOpen, mobileMode]);

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
      // The space row itself carries aria-expanded.
      const expandButton = node.querySelector('.space-card__head[aria-expanded]');

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
      // The space row itself carries aria-expanded.
      const expandButton = node.querySelector('.space-card__head[aria-expanded]');
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

  // Spaces chunk A: deleting a space also deletes what was placed in it (the
  // cascade), so the confirm says so, with counts. Undo restores it all.
  const handleDelete = useCallback((spaceId) => {
    if (!requireSpaceManagement()) return;
    const space = (spaces || []).find((entry) => entry?.id === spaceId);
    const impact = getSpaceRemovalImpact?.(spaceId, null) || null;
    askConfirm(buildDeleteSpaceConfirm({
      spaceName: space?.name,
      pageCount: space?.assignedPages?.length || 0,
      impact,
    })).then((confirmed) => {
      if (confirmed && onSpaceDelete) onSpaceDelete(spaceId);
    });
  }, [askConfirm, getSpaceRemovalImpact, onSpaceDelete, requireSpaceManagement, spaces]);

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

  // Spaces chunk A: an active space with no pages (the viewer's "No pages in
  // ..." card sends the user here) opens on its Add pages field.
  const activeSpaceIsEmpty = Boolean(activeSpaceId) && (spaces || []).some((space) => (
    space?.id === activeSpaceId && (space.assignedPages?.length || 0) === 0
  ));
  React.useEffect(() => {
    if (!activeSpaceIsEmpty) return;
    setExpandedSpaces((prev) => (prev.has(activeSpaceId) ? prev : new Set(prev).add(activeSpaceId)));
  }, [activeSpaceId, activeSpaceIsEmpty]);

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

  // Spaces chunk A: removing a page also deletes the marks placed in this
  // space on it and its drawn areas - ask first when there is any, with the
  // counts. A bare page assignment goes without a question (one Undo step).
  const handleRemovePage = useCallback((spaceId, pageId) => {
    if (!requireSpaceManagement()) return;
    if (!onSpaceRemovePage) return;
    const space = (spaces || []).find((entry) => entry?.id === spaceId);
    const prompt = buildRemovePageConfirm({
      spaceName: space?.name,
      pageId,
      impact: getSpaceRemovalImpact?.(spaceId, [pageId]) || null,
    });
    if (!prompt) {
      onSpaceRemovePage(spaceId, pageId);
      return;
    }
    askConfirm(prompt).then((confirmed) => {
      if (confirmed) onSpaceRemovePage(spaceId, pageId);
    });
  }, [askConfirm, getSpaceRemovalImpact, onSpaceRemovePage, requireSpaceManagement, spaces]);

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
  const activeSpace = activeSpaceId ? orderedSpaces.find((space) => space.id === activeSpaceId) || null : null;

  // Chunk B: Export opens on a chosen space (the row's `⋯` passes its own;
  // the header's Export the selected / active / open / first one) and the
  // menu lets you pick another.
  const openSpacesExport = useCallback((spaceId) => {
    if (!spaceId) return;
    if (!features?.excelExport) {
      showToast('Exporting spaces is a Pro feature.', 'error');
      return;
    }
    setExportSpaceId(spaceId);
  }, [features?.excelExport]);
  const runSpacesExport = (kind, spaceId) => {
    setExportSpaceId(null);
    if (kind === 'csv') onExportSpaceCSV?.(spaceId);
    else onExportSpacePDF?.(spaceId);
  };
  const exportPanel = isSpacesExportMenuOpen ? (
    <SpacesExportPanel
      spaces={orderedSpaces}
      spaceId={exportSpaceId}
      onSpaceChange={setExportSpaceId}
      onExportCSV={(spaceId) => runSpacesExport('csv', spaceId)}
      onExportPDF={(spaceId) => runSpacesExport('pdf', spaceId)}
      onClose={mobileMode ? () => setExportSpaceId(null) : null}
    />
  ) : null;

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
        background: 'var(--panel-bg)'
      }}
    >
      {/* UX 2026-09-23 (owner): the Bookmarks header pattern - [+ Add] on the
          left and [Export] on the right, quiet words of equal weight.
          Spaces chunk B: the phone header is the Survey sheet's - a "Spaces"
          title, then Add, the export glyph and a neutral "Done" (it leaves
          Spaces mode and closes the sheet, as the red "Exit Spaces / Regions"
          link at the foot of the list did). The desktop header gains an
          "Exit space" chip while a space is on.
          Owner 2026-10-02: section header actions are ICONS ("The icons
          looked way better"), right-aligned, Add last - the [Select] [Add]
          order of every list header: [Export] [Add] (desktop: after the
          Exit space chip; phone: before Done). */}
      <div className="spaces-panel__head">
        {mobileMode && <h2 className="spaces-panel__heading">Spaces</h2>}

        {!mobileMode && <span className="spaces-panel__head-fill" aria-hidden="true" />}

        {!mobileMode && activeSpace && (
          <button
            type="button"
            className="spaces-panel__exit-chip"
            onClick={() => handleExitSpace(activeSpace.id)}
            {...tip(`Turn off ${activeSpace.name || 'the space'} and show every page`, 'below')}
            aria-label={`Exit ${activeSpace.name || 'space'}`}
          >
            <span>Exit space</span>
            <Icon name="close" size={10} color="currentColor" />
          </button>
        )}

        <div
          ref={spacesExportAnchorRef}
          className="spaces-panel__export-anchor"
          onClick={(e) => e.stopPropagation()}
        >
          <SectionIconButton
            phone={mobileMode}
            action="export"
            icon="upload"
            className="spaces-panel__head-icon spaces-panel__head-icon--export"
            label={exportSpaceLabel}
            aria-haspopup={mobileMode ? 'dialog' : 'menu'}
            aria-expanded={isSpacesExportMenuOpen}
            disabled={!spacesExportTarget}
            onClick={() => {
              if (!spacesExportTarget) return;
              if (isSpacesExportMenuOpen) {
                setExportSpaceId(null);
                return;
              }
              openSpacesExport(spacesExportTarget.id);
            }}
          />
          {!mobileMode && exportPanel && (
            <AnchoredPopover getAnchor={() => spacesExportAnchorRef.current} gap={2} zIndex={7000}>
              <div ref={spacesExportMenuRef} className="spaces-export spaces-export--menu" role="menu" aria-label={`Export ${orderedSpaces.find((space) => space.id === exportSpaceId)?.name || 'space'}`}>
                {exportPanel}
              </div>
            </AnchoredPopover>
          )}
        </div>

        <SectionIconButton
          phone={mobileMode}
          action="add"
          className="spaces-panel__head-icon spaces-panel__head-icon--add"
          label={createSpaceLabel}
          onClick={handleCreateSpace}
        />

        {typeof onExitSpacesAction === 'function' && (
          <button
            type="button"
            className="spaces-panel__done tertiary"
            onClick={onExitSpacesAction}
          >
            Done
          </button>
        )}
      </div>

      {/* Spaces List — one card per space (owner 2026-10-02). */}
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
            gap={mobileMode ? 8 : 6}
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
                      mobileMode={mobileMode}
                    />
                  )}
                </SortableRearrangeRow>
              );
            })}
          </SortableRearrangeList>
        )}
      </div>
      {/* Rendered on <body>, above the phone sheet (z 6500): inside the sheet a
          fixed overlay is caught by the sheet's transform. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'relative', zIndex: 7000 }}>
          {confirmDialogElement}
          {/* Chunk B (phone): Export is its own small sheet over the Spaces
              sheet, standing on the dock like every phone sheet. */}
          {mobileMode && exportPanel && (
            <>
              <button
                type="button"
                className="spaces-export-sheet__backdrop"
                aria-label="Close export"
                onClick={() => setExportSpaceId(null)}
              />
              <div className="spaces-export spaces-export-sheet" role="dialog" aria-label={`Export ${orderedSpaces.find((space) => space.id === exportSpaceId)?.name || 'space'}`}>
                {exportPanel}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default SpacesPanel;
