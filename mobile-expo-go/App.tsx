import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Animated,
  Easing,
  Keyboard,
  LayoutAnimation,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle as SvgCircle, Defs, G, Line, LinearGradient as SvgLinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Eraser,
  FileText,
  GripVertical,
  Hand,
  Hash,
  Highlighter,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  MapPin,
  MessageSquareText,
  Minus,
  MoreHorizontal,
  MousePointer2,
  ArrowRight,
  Pencil,
  Plus,
  PenLine,
  RectangleHorizontal,
  Search,
  Square,
  SquareDashed,
  Type,
  Video,
  Redo2,
  Undo2,
  X,
} from 'lucide-react-native';

// Shared Survey domain contract — single source of truth with the desktop app.
// Type-only import: erased at compile time, so the bundle is unchanged.
import type {
  Entity,
  ChecklistSelection,
  SurveyChecklistItem,
  SurveyCategory,
  SurveyModule,
  SurveyTemplate,
  RegionBounds,
  RegionConfig,
  SpaceConfig,
  SurveyMarkerCore,
} from '@survey/shared';
import type { ToolId, ToolCategory, HubMode, ZoomFitMode, FormatPanelMode, RegionDrawTool, RegionOperation, SyncState, ContextMenuAction, ContextMenuState, Marker, BookmarkEntry, InkMark, PageClipboard, AnnotationClipboard, PageTransformState, HistoryEntry, CounterSeries, AnnotationEditFocus, LineBorderStyle, ArrowheadStyle, EraserMode, AnnotationEditConfig } from './src/types';
import { colors, primaryTools, toolbarCategories, hubItems, pdfTextMatches, documentTitle, initialPageCount, zoomFitOptions, syncStateConfig, activeUsers, versionHistoryItems, railSubtools, toolCategoryById, annotationToolIds, formatToolTitle, desktopColorPresets, lineBorderStyleLabels, arrowheadStyleLabels, eraserModeLabels, fontSizeOptions, counterSeriesColors, annotationColorChoices, SurveyIcon, ExportIcon, VersionHistoryIcon } from './src/constants';
import { entities, surveyModules, surveyTemplates, importedPdfBookmarks, initialSpaces } from './src/data/surveyData';
import { MAX_VISIBLE_CHECKLIST_ITEMS, CHECKLIST_ITEM_HEIGHT, CHECKLIST_ITEM_GAP, SURVEY_SHEET_FIXED_HEIGHT, PANEL_MAX_CHECKLIST_WINDOW_HEIGHT, getChecklistWindowHeight, capBottomPanelHeight, summarizePages, parsePageRangeDraft } from './src/utils/pageUtils';
import { clamp, clampValue, moveArrayItem, moveItemById, moveNumberItem } from './src/utils/arrayUtils';
import { getSurveyCategoryGlyphLabel, checklistResponseKey, nextMarkerId } from './src/utils/surveyUtils';
import { normalizeHexColor, hexToRgb, rgbToHsv, hexToHsv, hsvToHex } from './src/utils/colorUtils';
import { styles } from './src/styles';
import { BottomActionBar } from './src/components/BottomActionBar';
import { VersionHistoryDrawer } from './src/components/VersionHistoryDrawer';
import { ActiveUsersDrawer } from './src/components/ActiveUsersDrawer';
import { FloorPlan } from './src/components/FloorPlan';
import { RegionOverlay } from './src/components/RegionOverlay';
import { FloatingContextMenu } from './src/components/FloatingContextMenu';
import { FormatColorSwatch, FormatNumberInput, FormatMenuButton, FormatDropdownButton, TextAlignmentOption, TextAlignmentSvg, annotationEditSectionLabel } from './src/components/format/FormatPrimitives';
import { HubTray } from './src/components/hub/HubTray';
import { HubTab } from './src/components/hub/HubTab';
import { BookmarkRow } from './src/components/hub/BookmarkRow';
import { PageThumb } from './src/components/hub/PageThumb';
import { MiniPagePreview } from './src/components/hub/MiniPagePreview';
import { SpacesDrawer } from './src/components/spaces/SpacesDrawer';
import { SpaceRow } from './src/components/spaces/SpaceRow';
import { SpacePageRegionRow } from './src/components/spaces/SpacePageRegionRow';
import { RegionRow } from './src/components/spaces/RegionRow';
import { AnnotationEditPanel } from './src/components/format/AnnotationEditPanel';
import { AnnotationFormattingBar } from './src/components/format/AnnotationFormattingBar';
import { SurveySetupSheet } from './src/components/survey/SurveySetupSheet';
import { SurveySheet } from './src/components/survey/SurveySheet';



export default function App() {
  return (
    <SafeAreaProvider>
      <SurveyMobileShell />
    </SafeAreaProvider>
  );
}

function SurveyMobileShell() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const railWidth = 44;
  const topBarHeight = insets.top + 34;
  const subBarHeight = 0;
  const bottomInset = Math.max(insets.bottom, 10);
  const bottomActionHeight = 52 + bottomInset;
  const pageWidth = Math.min(width - railWidth - 18, 390);
  const pageHeight = Math.round(pageWidth * 1.42);
  const [activeTool, setActiveTool] = useState<ToolId>('pan');
  const [activeCategory, setActiveCategory] = useState<ToolCategory | null>(null);
  const [formatPanelMode, setFormatPanelMode] = useState<FormatPanelMode>('presets');
  const [lastToolByCategory, setLastToolByCategory] = useState<Record<ToolCategory, ToolId>>({
    draw: 'pen',
    shape: 'rect',
    review: 'text',
  });
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveyKeepCategoryActive, setSurveyKeepCategoryActive] = useState(false);
  const [surveyPlacementMode, setSurveyPlacementMode] = useState<'category' | 'entity'>('category');
  const [lastSurveyEntityId, setLastSurveyEntityId] = useState<string | null>(null);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [activeUsersOpen, setActiveUsersOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('synced');
  const manualSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hubMode, setHubMode] = useState<HubMode>('pages');
  const [zoomFitMode, setZoomFitMode] = useState<ZoomFitMode>('fitPage');
  const [pageControlOpen, setPageControlOpen] = useState(false);
  const [annotationEditConfig, setAnnotationEditConfig] = useState<AnnotationEditConfig | null>(null);
  const [annotationEditDismissRequest, setAnnotationEditDismissRequest] = useState(0);
  const [pageDraft, setPageDraft] = useState('1');
  const pageControlAnim = useRef(new Animated.Value(0)).current;
  const titleRevealAnim = useRef(new Animated.Value(0)).current;
  const [searchValue, setSearchValue] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSurveyTemplateId, setSelectedSurveyTemplateId] = useState<string | null>(null);
  const selectedSurveyTemplate = surveyTemplates.find((template) => template.id === selectedSurveyTemplateId) ?? null;
  const activeSurveyModules = selectedSurveyTemplate?.modules ?? [];
  const surveyEntities = selectedSurveyTemplate?.entities ?? entities;
  const [pageOrder, setPageOrder] = useState<number[]>(() => Array.from({ length: initialPageCount }, (_, index) => index + 1));
  const totalPages = pageOrder.length;
  const [pageClipboard, setPageClipboard] = useState<PageClipboard | null>(null);
  const [annotationClipboard, setAnnotationClipboard] = useState<AnnotationClipboard | null>(null);
  const [pageTransforms, setPageTransforms] = useState<Record<number, PageTransformState>>({});
  const currentPageOrdinal = Math.max(1, pageOrder.indexOf(currentPage) + 1);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(importedPdfBookmarks);
  const [spaces, setSpaces] = useState<SpaceConfig[]>(initialSpaces);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>('space-floors-1-5');
  const [activeRegionId, setActiveRegionId] = useState<string | null>('region-floor-1-customer');
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [regionDrawTool, setRegionDrawTool] = useState<RegionDrawTool>('rectangular');
  const [regionOperation, setRegionOperation] = useState<RegionOperation>('add');
  const [regionFullPageConfirmOpen, setRegionFullPageConfirmOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([
    {
      id: 1,
      name: 'Camera C-103',
      notes: 'Cable above lobby ceiling needs confirmation.',
      page: 1,
      x: 0.32,
      y: 0.3,
      moduleId: 'install',
      categoryId: 'camera-install',
      entity: 'sub',
      checklistResponses: { 'cable-pulled': { selection: 'Y' } },
      done: { 'camera-install:Cable pulled': true },
    },
    {
      id: 2,
      name: 'Camera C-104',
      notes: '',
      page: 1,
      x: 0.62,
      y: 0.54,
      moduleId: 'install',
      categoryId: 'camera-install',
      entity: 'my-company',
      checklistResponses: {},
      done: {},
    },
  ]);
  const [inkMarks, setInkMarks] = useState<InkMark[]>([
    { id: 101, page: 1, x: 0.2, y: 0.68 },
    { id: 102, page: 1, x: 0.25, y: 0.7 },
  ]);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(2);
  const [surveyMode, setSurveyMode] = useState(true);
  const [lastSurveySelection, setLastSurveySelection] = useState({
    moduleId: 'install',
    categoryId: 'camera-install',
  });
  const [lastCategoryByModule, setLastCategoryByModule] = useState<Record<string, string>>({
    install: 'camera-install',
    commission: 'camera-commission',
  });

  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) ?? null;
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? null;
  const activeRegion = activeSpace?.regions.find((region) => region.id === activeRegionId) ?? null;
  const spacesModeActive = Boolean(activeSpaceId || activeRegionId);
  const spacesPageRows = spaces.reduce((sum, space) => sum + (space.expanded ? Math.max(1, space.pages.length) : 0), 0);
  const setupModuleIndex = Math.max(0, activeSurveyModules.findIndex((module) => module.id === lastSurveySelection.moduleId));
  const setupModule = activeSurveyModules[setupModuleIndex] ?? activeSurveyModules[0];
  const setupCategoryId = setupModule
    ? (setupModule.categories.some((category) => category.id === lastCategoryByModule[setupModule.id])
      ? lastCategoryByModule[setupModule.id]
      : setupModule.categories[0]?.id ?? null)
    : null;
  const selectedModuleIndex = Math.max(0, activeSurveyModules.findIndex((module) => module.id === selectedMarker?.moduleId));
  const selectedModule = activeSurveyModules[selectedModuleIndex] ?? activeSurveyModules[0];
  const surveyToolbarModule = activeSurveyModules.find((module) => module.id === lastSurveySelection.moduleId) ?? activeSurveyModules[0] ?? null;
  const selectedCategory = selectedModule?.categories.find((category) => category.id === selectedMarker?.categoryId) ?? null;
  const selectedChecklist = selectedCategory?.checklist ?? [];
  const checklistWindowHeight = getChecklistWindowHeight(selectedChecklist.length);
  const maxBottomPanelHeight = Math.min(
    SURVEY_SHEET_FIXED_HEIGHT + PANEL_MAX_CHECKLIST_WINDOW_HEIGHT + bottomInset,
    height - topBarHeight - subBarHeight - 18
  );
  const surveyPanelHeight = capBottomPanelHeight(SURVEY_SHEET_FIXED_HEIGHT + checklistWindowHeight, bottomInset, maxBottomPanelHeight);
  const surveySetupPanelHeight = capBottomPanelHeight(
    selectedSurveyTemplate ? 392 : 154 + surveyTemplates.length * 48,
    bottomInset,
    maxBottomPanelHeight
  );
  const spacesPanelHeight = capBottomPanelHeight(
    Math.max(238, 106 + spaces.length * 54 + spacesPageRows * 50),
    bottomInset,
    maxBottomPanelHeight
  );
  const versionHistoryPanelHeight = capBottomPanelHeight(264, bottomInset, maxBottomPanelHeight);
  const activeUsersPanelHeight = capBottomPanelHeight(276, bottomInset, maxBottomPanelHeight);
  const hubPanelHeight = capBottomPanelHeight(
    hubMode === 'pages' ? 310 : hubMode === 'search' ? (searchValue.trim() ? 232 : 292) : Math.min(286, 84 + Math.max(bookmarks.length, 1) * 42),
    bottomInset,
    maxBottomPanelHeight
  );
  const selectedEntity = surveyEntities.find((entity) => entity.id === selectedMarker?.entity) ?? null;
  const surveyToolbarVisible = surveyMode && Boolean(selectedSurveyTemplate) && (activeTool === 'survey' || activeTool === 'pan' || activeTool === 'select');
  const regionEditActive = Boolean(editingRegionId && activeRegion);
  const regionToolbarVisible = regionEditActive && activeTool === 'region';
  const formatBarVisible = annotationToolIds.includes(activeTool) || surveyToolbarVisible || regionToolbarVisible;
  const visibleMarkers = surveyMode
    ? markers.filter((marker) => {
        if (marker.page !== currentPage) return false;
        if (activeSpace && !activeSpace.pages.includes(marker.page)) return false;
        if (!activeRegion || activeRegion.page !== marker.page || !activeRegion.showSurveyAnnotations) return true;
        return (
          marker.x >= activeRegion.bounds.x &&
          marker.x <= activeRegion.bounds.x + activeRegion.bounds.width &&
          marker.y >= activeRegion.bounds.y &&
          marker.y <= activeRegion.bounds.y + activeRegion.bounds.height
        );
      })
    : [];
  const visibleInkMarks = surveyMode ? [] : inkMarks.filter((mark) => mark.page === currentPage);
  const pageOffset = useMemo(() => ({ x: (width - railWidth - pageWidth) / 2, y: 58 }), [width, pageWidth]);
  const syncStateInfo = syncStateConfig[syncState];

  useEffect(() => {
    return () => {
      if (manualSyncTimerRef.current) clearTimeout(manualSyncTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pageOrder.includes(currentPage) && pageOrder[0]) {
      setCurrentPage(pageOrder[0]);
    }
  }, [currentPage, pageOrder]);

  useEffect(() => {
    setFormatPanelMode('presets');
    setAnnotationEditConfig(null);
  }, [activeTool]);

  function handleManualSyncPress() {
    if (manualSyncTimerRef.current) clearTimeout(manualSyncTimerRef.current);
    setSyncState('syncing');
    manualSyncTimerRef.current = setTimeout(() => {
      setSyncState('synced');
      manualSyncTimerRef.current = null;
    }, 1200);
  }

  function animatePanelTransition() {
    LayoutAnimation.configureNext({
      duration: 170,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
  }

  function dismissPageControl() {
    if (!pageControlOpen) return;
    applyPageDraft();
    Keyboard.dismiss();
    pageControlAnim.stopAnimation();
    Animated.timing(pageControlAnim, {
      toValue: 0,
      duration: 130,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setPageControlOpen(false));
  }

  function closePanels() {
    animatePanelTransition();
    Keyboard.dismiss();
    setContextMenu(null);
    setSurveyOpen(false);
    setSpacesOpen(false);
    setHubOpen(false);
    setVersionHistoryOpen(false);
    setActiveUsersOpen(false);
    if (annotationEditConfig) {
      setAnnotationEditDismissRequest((request) => request + 1);
    }
    dismissPageControl();
  }

  function openSurveyPanel() {
    animatePanelTransition();
    setSpacesOpen(false);
    setHubOpen(false);
    setVersionHistoryOpen(false);
    setActiveUsersOpen(false);
    setAnnotationEditConfig(null);
    dismissPageControl();
    setSurveyOpen(true);
  }

  function openSpacesPanel() {
    animatePanelTransition();
    setSurveyOpen(false);
    setHubOpen(false);
    setVersionHistoryOpen(false);
    setActiveUsersOpen(false);
    setAnnotationEditConfig(null);
    dismissPageControl();
    setSpacesOpen(true);
  }

  function openVersionHistoryPanel() {
    animatePanelTransition();
    setSurveyOpen(false);
    setSpacesOpen(false);
    setHubOpen(false);
    setActiveUsersOpen(false);
    setAnnotationEditConfig(null);
    dismissPageControl();
    setVersionHistoryOpen(true);
  }

  function openActiveUsersPanel() {
    animatePanelTransition();
    setSurveyOpen(false);
    setSpacesOpen(false);
    setHubOpen(false);
    setVersionHistoryOpen(false);
    setAnnotationEditConfig(null);
    dismissPageControl();
    setActiveUsersOpen(true);
  }

  function toggleSpacesPanel() {
    if (spacesOpen) {
      setSpacesOpen(false);
      return;
    }
    openSpacesPanel();
  }

  function openSelectedSurveyPanel() {
    setSurveyMode(true);
    setSelectedMarkerId(null);
    openSurveyPanel();
  }

  function toggleHub() {
    animatePanelTransition();
    setSurveyOpen(false);
    setSpacesOpen(false);
    setVersionHistoryOpen(false);
    setActiveUsersOpen(false);
    setAnnotationEditConfig(null);
    dismissPageControl();
    setHubOpen((open) => !open);
  }

  function selectHubMode(mode: HubMode) {
    setHubMode(mode);
  }

  function openPageControl() {
    animatePanelTransition();
    setSurveyOpen(false);
    setSpacesOpen(false);
    setHubOpen(false);
    setVersionHistoryOpen(false);
    setActiveUsersOpen(false);
    setAnnotationEditConfig(null);
    setPageDraft(String(currentPageOrdinal));
    setPageControlOpen(true);
    pageControlAnim.stopAnimation();
    pageControlAnim.setValue(0);
    Animated.timing(pageControlAnim, {
      toValue: 1,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  function openAnnotationEditPanel(config: AnnotationEditConfig) {
    animatePanelTransition();
    setSurveyOpen(false);
    setSpacesOpen(false);
    setHubOpen(false);
    setVersionHistoryOpen(false);
    setActiveUsersOpen(false);
    dismissPageControl();
    setAnnotationEditConfig(config);
  }

  function handleTitlePress() {
    openPageControl();
    if (documentTitle.length <= 18) return;
    titleRevealAnim.stopAnimation();
    titleRevealAnim.setValue(0);
    Animated.sequence([
      Animated.timing(titleRevealAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(titleRevealAnim, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }

  function applyPageDraft() {
    const parsed = Number.parseInt(pageDraft, 10);
    if (Number.isFinite(parsed)) {
      const nextIndex = clamp(parsed, 1, totalPages) - 1;
      setCurrentPage(pageOrder[nextIndex] ?? pageOrder[0] ?? currentPage);
    } else {
      setPageDraft(String(currentPageOrdinal));
    }
  }

  function commitPageJump() {
    applyPageDraft();
    dismissPageControl();
  }

  function exitSurveyMode() {
    setSurveyMode(false);
    setSurveyOpen(false);
    setSelectedSurveyTemplateId(null);
    if (activeTool === 'survey') setActiveTool('select');
  }

  function exitRegionMode() {
    setActiveSpaceId(null);
    setActiveRegionId(null);
    setEditingRegionId(null);
    setRegionFullPageConfirmOpen(false);
    setContextMenu(null);
    setSpacesOpen(false);
    if (activeTool === 'region') setActiveTool('select');
  }

  function activateSpace(spaceId: string | null) {
    const space = spaces.find((item) => item.id === spaceId);
    if (!space) {
      setActiveSpaceId(null);
      setActiveRegionId(null);
      return;
    }
    setActiveSpaceId(space.id);
    setActiveRegionId(null);
    if (space.pages.length && !space.pages.includes(currentPage)) {
      setCurrentPage(space.pages[0]);
    }
  }

  function toggleSpaceActive(spaceId: string) {
    if (activeSpaceId === spaceId && !activeRegionId) {
      setActiveSpaceId(null);
      setEditingRegionId(null);
      return;
    }
    activateSpace(spaceId);
  }

  function activateRegion(spaceId: string, regionId: string) {
    const space = spaces.find((item) => item.id === spaceId);
    const region = space?.regions.find((item) => item.id === regionId);
    if (!space || !region) return;
    setActiveSpaceId(space.id);
    setActiveRegionId(region.id);
    setCurrentPage(region.page);
  }

  function toggleRegionActive(spaceId: string, regionId: string) {
    if (activeSpaceId === spaceId && activeRegionId === regionId) {
      setActiveRegionId(null);
      setEditingRegionId(null);
      return;
    }
    activateRegion(spaceId, regionId);
  }

  function updateSpace(spaceId: string, patch: Partial<SpaceConfig>) {
    setSpaces((current) => current.map((space) => (space.id === spaceId ? { ...space, ...patch } : space)));
  }

  function updateRegion(spaceId: string, regionId: string, patch: Partial<RegionConfig>) {
    setSpaces((current) => current.map((space) => (
      space.id === spaceId
        ? { ...space, regions: space.regions.map((region) => (region.id === regionId ? { ...region, ...patch } : region)) }
        : space
    )));
  }

  function assignSpacePages(spaceId: string, pages: number[]) {
    if (!pages.length) return;
    updateSpace(spaceId, { pages });
    if (activeSpaceId === spaceId && !pages.includes(currentPage)) {
      setCurrentPage(pages[0]);
    }
  }

  function createSpace() {
    const createdAt = Date.now();
    const nextSpace: SpaceConfig = {
      id: `space-${createdAt}`,
      name: `Space ${spaces.length + 1}`,
      pages: [currentPage],
      expanded: true,
      regions: [],
    };
    setSpaces((current) => [...current, nextSpace]);
    setActiveSpaceId(nextSpace.id);
    setActiveRegionId(null);
  }

  function deleteSpace(spaceId: string) {
    setSpaces((current) => current.filter((space) => space.id !== spaceId));
    if (activeSpaceId === spaceId) setActiveSpaceId(null);
    if (editingRegionId && spaces.find((space) => space.id === spaceId)?.regions.some((region) => region.id === editingRegionId)) {
      setEditingRegionId(null);
    }
    setActiveRegionId((regionId) => {
      const deleting = spaces.find((space) => space.id === spaceId)?.regions.some((region) => region.id === regionId);
      return deleting ? null : regionId;
    });
  }

  function createRegion(spaceId?: string, pageOverride = currentPage) {
    const targetSpace = spaces.find((space) => space.id === (spaceId ?? activeSpaceId)) ?? spaces[0];
    if (!targetSpace) {
      const createdAt = Date.now();
      const nextRegion: RegionConfig = {
        id: `region-${createdAt}`,
        name: 'Region 1',
        page: pageOverride,
        bounds: { x: 0.2, y: 0.22, width: 0.5, height: 0.3 },
        surveyBound: surveyMode,
        showCanvasAnnotations: !surveyMode,
        showSurveyAnnotations: surveyMode,
      };
      const nextSpace: SpaceConfig = {
        id: `space-${createdAt}`,
        name: 'Space 1',
        pages: [pageOverride],
        expanded: true,
        regions: [nextRegion],
      };
      setSpaces([nextSpace]);
      setActiveSpaceId(nextSpace.id);
      setActiveRegionId(nextRegion.id);
      setEditingRegionId(nextRegion.id);
      setActiveTool('region');
      return;
    }
    const nextRegion: RegionConfig = {
      id: `region-${Date.now()}`,
      name: `Region ${targetSpace.regions.length + 1}`,
      page: pageOverride,
      bounds: { x: 0.2, y: 0.22, width: 0.5, height: 0.3 },
      surveyBound: surveyMode,
      showCanvasAnnotations: !surveyMode,
      showSurveyAnnotations: surveyMode,
    };
    setSpaces((current) => current.map((space) => (
      space.id === targetSpace.id
        ? { ...space, expanded: true, pages: space.pages.includes(pageOverride) ? space.pages : [...space.pages, pageOverride].sort((a, b) => a - b), regions: [...space.regions, nextRegion] }
        : space
    )));
    setActiveSpaceId(targetSpace.id);
    setActiveRegionId(nextRegion.id);
    setEditingRegionId(nextRegion.id);
    setActiveTool('region');
  }

  function deleteRegion(spaceId: string, regionId: string) {
    setSpaces((current) => current.map((space) => (
      space.id === spaceId ? { ...space, regions: space.regions.filter((region) => region.id !== regionId) } : space
    )));
    if (activeRegionId === regionId) setActiveRegionId(null);
    if (editingRegionId === regionId) setEditingRegionId(null);
    setRegionFullPageConfirmOpen(false);
    setContextMenu(null);
  }

  function confirmRegionEdits() {
    setEditingRegionId(null);
    setRegionFullPageConfirmOpen(false);
    setContextMenu(null);
    if (activeTool === 'region') setActiveTool('select');
  }

  function cancelRegionEdits() {
    setEditingRegionId(null);
    setRegionFullPageConfirmOpen(false);
    setContextMenu(null);
    if (activeTool === 'region') setActiveTool('select');
  }

  function requestFullPageRegion() {
    setContextMenu(null);
    setRegionFullPageConfirmOpen(true);
  }

  function applyFullPageRegion() {
    if (!activeSpace || !activeRegion) return;
    const page = activeRegion.page;
    setSpaces((current) => current.map((space) => {
      if (space.id !== activeSpace.id) return space;
      const fullPageRegion = {
        ...activeRegion,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        shapeType: 'rectangular',
      } as RegionConfig;
      return {
        ...space,
        regions: [
          ...space.regions.filter((region) => region.page !== page || region.id === activeRegion.id).map((region) => (
            region.id === activeRegion.id ? fullPageRegion : region
          )),
        ],
      };
    }));
    setRegionFullPageConfirmOpen(false);
  }

  function openRegionContextMenu(region: RegionConfig) {
    if (!activeSpace) return;
    const menuWidth = 154;
    const regionCenterX = railWidth + pageOffset.x + (region.bounds.x + region.bounds.width / 2) * pageWidth;
    const regionCenterY = topBarHeight + pageOffset.y + (region.bounds.y + region.bounds.height / 2) * pageHeight;
    setActiveRegionId(region.id);
    setContextMenu({
      id: `region:${region.id}`,
      title: region.name || 'Region',
      x: clamp(regionCenterX - menuWidth / 2, railWidth + 8, width - menuWidth - 8),
      y: clamp(regionCenterY + 14, topBarHeight + 42, height - 210),
      actions: [
        {
          id: 'delete',
          label: 'Delete',
          destructive: true,
          onPress: () => deleteRegion(activeSpace.id, region.id),
        },
      ],
    });
  }

  function copyPageContents(sourcePage: number, targetPage: number) {
    setMarkers((current) => {
      const sourceMarkers = current.filter((marker) => marker.page === sourcePage);
      if (!sourceMarkers.length) return current;
      let nextId = nextMarkerId(current);
      const copiedMarkers = sourceMarkers.map((marker) => ({
        ...marker,
        id: nextId++,
        page: targetPage,
        name: `${marker.name} Copy`,
      }));
      return [...current, ...copiedMarkers];
    });
    setInkMarks((current) => {
      const sourceMarks = current.filter((mark) => mark.page === sourcePage);
      if (!sourceMarks.length) return current;
      const baseId = Date.now();
      return [
        ...current,
        ...sourceMarks.map((mark, index) => ({
          ...mark,
          id: baseId + index,
          page: targetPage,
        })),
      ];
    });
  }

  function insertCopiedPageAfter(sourcePage: number, targetPage: number) {
    const newPage = Math.max(0, ...pageOrder) + 1;
    setPageOrder((current) => {
      const targetIndex = current.indexOf(targetPage);
      const next = [...current];
      next.splice(targetIndex >= 0 ? targetIndex + 1 : next.length, 0, newPage);
      return next;
    });
    copyPageContents(sourcePage, newPage);
    setCurrentPage(newPage);
  }

  function duplicatePage(page: number) {
    insertCopiedPageAfter(page, page);
    setContextMenu(null);
  }

  function deletePage(page: number) {
    setPageOrder((current) => {
      if (current.length <= 1) return current;
      const index = current.indexOf(page);
      const next = current.filter((item) => item !== page);
      if (currentPage === page) {
        setCurrentPage(next[Math.min(Math.max(index, 0), next.length - 1)] ?? next[0]);
      }
      return next;
    });
    setMarkers((current) => current.filter((marker) => marker.page !== page));
    setInkMarks((current) => current.filter((mark) => mark.page !== page));
    setPageTransforms((current) => {
      const next = { ...current };
      delete next[page];
      return next;
    });
    setContextMenu(null);
  }

  function pastePageAfter(targetPage: number) {
    if (!pageClipboard) return;
    if (pageClipboard.mode === 'cut') {
      setPageOrder((current) => {
        if (!current.includes(pageClipboard.page) || pageClipboard.page === targetPage) return current;
        const withoutSource = current.filter((page) => page !== pageClipboard.page);
        const targetIndex = withoutSource.indexOf(targetPage);
        const next = [...withoutSource];
        next.splice(targetIndex >= 0 ? targetIndex + 1 : next.length, 0, pageClipboard.page);
        return next;
      });
      setCurrentPage(pageClipboard.page);
      setPageClipboard(null);
    } else {
      insertCopiedPageAfter(pageClipboard.page, targetPage);
    }
    setContextMenu(null);
  }

  function rotatePage(page: number) {
    setPageTransforms((current) => {
      const existing = current[page] ?? { rotation: 0, mirrorHorizontal: false, mirrorVertical: false };
      return { ...current, [page]: { ...existing, rotation: (existing.rotation + 90) % 360 } };
    });
    setContextMenu(null);
  }

  function mirrorPage(page: number, axis: 'horizontal' | 'vertical') {
    setPageTransforms((current) => {
      const existing = current[page] ?? { rotation: 0, mirrorHorizontal: false, mirrorVertical: false };
      return {
        ...current,
        [page]: {
          ...existing,
          mirrorHorizontal: axis === 'horizontal' ? !existing.mirrorHorizontal : existing.mirrorHorizontal,
          mirrorVertical: axis === 'vertical' ? !existing.mirrorVertical : existing.mirrorVertical,
        },
      };
    });
    setContextMenu(null);
  }

  function resetPageTransform(page: number) {
    setPageTransforms((current) => {
      const next = { ...current };
      delete next[page];
      return next;
    });
    setContextMenu(null);
  }

  function openPageContextMenu(page: number, anchorX: number, anchorY: number) {
    const menuWidth = 188;
    const displayPage = Math.max(1, pageOrder.indexOf(page) + 1);
    setContextMenu({
      id: `page:${page}`,
      title: `Page ${displayPage}`,
      width: menuWidth,
      x: clamp(anchorX - menuWidth + 18, 8, width - menuWidth - 8),
      y: clamp(anchorY - 172, topBarHeight + 8, height - 330),
      actions: [
        { id: 'cut', label: 'Cut', onPress: () => { setPageClipboard({ page, mode: 'cut' }); setContextMenu(null); } },
        { id: 'copy', label: 'Copy', onPress: () => { setPageClipboard({ page, mode: 'copy' }); setContextMenu(null); } },
        { id: 'paste', label: 'Paste', disabled: !pageClipboard, onPress: () => pastePageAfter(page) },
        { id: 'duplicate', label: 'Duplicate', onPress: () => duplicatePage(page) },
        { id: 'rotate', label: 'Rotate', onPress: () => rotatePage(page) },
        { id: 'mirror-horizontal', label: 'Mirror Horizontally', onPress: () => mirrorPage(page, 'horizontal') },
        { id: 'mirror-vertical', label: 'Mirror Vertically', onPress: () => mirrorPage(page, 'vertical') },
        { id: 'reset', label: 'Reset', onPress: () => resetPageTransform(page) },
        { id: 'delete', label: 'Delete', destructive: true, disabled: pageOrder.length <= 1, onPress: () => deletePage(page) },
      ],
    });
  }

  function moveInkMarkZOrder(markId: number, direction: 'front' | 'forward' | 'backward' | 'back') {
    setInkMarks((current) => {
      const index = current.findIndex((mark) => mark.id === markId);
      if (index < 0) return current;
      if (direction === 'front') return moveArrayItem(current, index, current.length - 1);
      if (direction === 'back') return moveArrayItem(current, index, 0);
      if (direction === 'forward') return moveArrayItem(current, index, clamp(index + 1, 0, current.length - 1));
      return moveArrayItem(current, index, clamp(index - 1, 0, current.length - 1));
    });
    setContextMenu(null);
  }

  function pasteAnnotationAt(page: number, x: number, y: number) {
    if (!annotationClipboard) return;
    const nextMark: InkMark = {
      ...annotationClipboard.item,
      id: Date.now(),
      page,
      x: clamp(x, 0.04, 0.96),
      y: clamp(y, 0.04, 0.96),
    };
    setInkMarks((current) => [...current, nextMark]);
    if (annotationClipboard.mode === 'cut') setAnnotationClipboard(null);
    setContextMenu(null);
  }

  function openAnnotationContextMenu(mark: InkMark) {
    const menuWidth = 176;
    const anchorX = railWidth + pageOffset.x + mark.x * pageWidth;
    const anchorY = topBarHeight + pageOffset.y + mark.y * pageHeight;
    setContextMenu({
      id: `annotation:${mark.id}`,
      title: 'Annotation',
      width: menuWidth,
      x: clamp(anchorX - menuWidth / 2, railWidth + 8, width - menuWidth - 8),
      y: clamp(anchorY + 12, topBarHeight + 42, height - 330),
      actions: [
        {
          id: 'cut',
          label: 'Cut',
          onPress: () => {
            setAnnotationClipboard({ item: mark, mode: 'cut' });
            setInkMarks((current) => current.filter((item) => item.id !== mark.id));
            setContextMenu(null);
          },
        },
        { id: 'copy', label: 'Copy', onPress: () => { setAnnotationClipboard({ item: mark, mode: 'copy' }); setContextMenu(null); } },
        { id: 'paste', label: 'Paste', disabled: !annotationClipboard, onPress: () => pasteAnnotationAt(mark.page, mark.x + 0.04, mark.y + 0.04) },
        { id: 'delete', label: 'Delete', destructive: true, onPress: () => { setInkMarks((current) => current.filter((item) => item.id !== mark.id)); setContextMenu(null); } },
        { id: 'bring-front', label: 'Bring to Front', onPress: () => moveInkMarkZOrder(mark.id, 'front') },
        { id: 'bring-forward', label: 'Bring Forward', onPress: () => moveInkMarkZOrder(mark.id, 'forward') },
        { id: 'send-backward', label: 'Send Backward', onPress: () => moveInkMarkZOrder(mark.id, 'backward') },
        { id: 'send-back', label: 'Send to Back', onPress: () => moveInkMarkZOrder(mark.id, 'back') },
      ],
    });
  }

  function openCanvasContextMenu(event: GestureResponderEvent) {
    if (!annotationClipboard) return;
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;
    const menuWidth = 154;
    setContextMenu({
      id: `canvas:${currentPage}`,
      title: 'Page',
      width: menuWidth,
      x: clamp(pageX - menuWidth / 2, railWidth + 8, width - menuWidth - 8),
      y: clamp(pageY + 12, topBarHeight + 42, height - 150),
      actions: [
        {
          id: 'paste',
          label: 'Paste',
          onPress: () => pasteAnnotationAt(currentPage, locationX / pageWidth, locationY / pageHeight),
        },
      ],
    });
  }

  function movePage(page: number, delta: number) {
    setPageOrder((current) => moveNumberItem(current, page, delta));
  }

  function moveSpace(spaceId: string, delta: number) {
    setSpaces((current) => moveItemById(current, spaceId, delta));
  }

  function moveRegion(spaceId: string, regionId: string, delta: number) {
    setSpaces((current) => current.map((space) => (
      space.id === spaceId ? { ...space, regions: moveItemById(space.regions, regionId, delta) } : space
    )));
  }

  function resolveCategoryId(moduleId: string, preferredCategoryId?: string | null, modules = activeSurveyModules.length ? activeSurveyModules : surveyModules) {
    const module = modules.find((item) => item.id === moduleId) ?? modules[0];
    if (!module) return null;
    const preferred = module.categories.find((category) => category.id === preferredCategoryId);
    return preferred?.id ?? module.categories[0]?.id ?? null;
  }

  function rememberSurveySelection(moduleId: string, categoryId: string | null) {
    if (!categoryId) return;
    setLastSurveySelection({ moduleId, categoryId });
    setLastCategoryByModule((current) => ({ ...current, [moduleId]: categoryId }));
  }

  function openSurvey(markerId: number) {
    setSelectedMarkerId(markerId);
    const marker = markers.find((item) => item.id === markerId);
    if (marker) {
      setCurrentPage(marker.page);
      const inferredTemplate = selectedSurveyTemplate
        ?? surveyTemplates.find((template) => template.modules.some((module) => module.id === marker.moduleId))
        ?? surveyTemplates[0]
        ?? null;
      const templateModules = inferredTemplate?.modules ?? surveyModules;
      if (!selectedSurveyTemplate && inferredTemplate) setSelectedSurveyTemplateId(inferredTemplate.id);
      const moduleExists = templateModules.some((module) => module.id === marker.moduleId);
      const moduleId = moduleExists ? marker.moduleId : lastSurveySelection.moduleId;
      const categoryId = marker.categoryId ? resolveCategoryId(moduleId, marker.categoryId, templateModules) : null;
      if (categoryId) rememberSurveySelection(moduleId, categoryId);
      if (moduleId !== marker.moduleId || categoryId !== marker.categoryId) {
        updateMarker(marker.id, { moduleId, categoryId });
      }
    }
    openSurveyPanel();
  }

  function updateMarker(markerId: number, patch: Partial<Marker>) {
    setMarkers((current) => current.map((marker) => (marker.id === markerId ? { ...marker, ...patch } : marker)));
  }

  function selectSurveyTemplate(templateId: string) {
    const template = surveyTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const nextModule = template.modules[0] ?? surveyModules[0];
    const nextCategoryId = nextModule.categories[0]?.id ?? null;
    setSelectedSurveyTemplateId(template.id);
    setLastSurveySelection({ moduleId: nextModule.id, categoryId: nextCategoryId });
    setLastCategoryByModule((current) => ({ ...current, [nextModule.id]: nextCategoryId ?? '' }));
    setSurveyPlacementMode('category');
    setLastSurveyEntityId(null);
    setSurveyMode(true);
    if (!selectedMarker) {
      setActiveTool('survey');
      setActiveCategory(null);
    }
    if (selectedMarker) {
      updateMarker(selectedMarker.id, {
        moduleId: nextModule.id,
        categoryId: nextCategoryId,
      });
    }
  }

  function selectSurveySetupModule(moduleId: string) {
    const module = activeSurveyModules.find((item) => item.id === moduleId) ?? activeSurveyModules[0];
    const categoryId = module?.categories.some((category) => category.id === lastCategoryByModule[module.id])
      ? lastCategoryByModule[module.id]
      : module?.categories[0]?.id ?? null;
    if (module) rememberSurveySelection(module.id, categoryId);
  }

  function selectSurveyToolbarModule(moduleId: string) {
    selectSurveySetupModule(moduleId);
    setSurveyMode(true);
    setSelectedMarkerId(null);
    setActiveCategory(null);
    setSurveyPlacementMode('category');
    setLastSurveyEntityId(null);
    setActiveTool('survey');
  }

  function commitSurveyCategorySelection(moduleId: string, categoryId: string) {
    rememberSurveySelection(moduleId, categoryId);
    setSurveyMode(true);
    setSelectedMarkerId(null);
    setActiveCategory(null);
    setSurveyPlacementMode('category');
    setLastSurveyEntityId(null);
    setActiveTool('survey');
  }

  function startSurveyCategoryPlacement(moduleId: string, categoryId: string) {
    commitSurveyCategorySelection(moduleId, categoryId);
    setSurveyOpen(false);
  }

  function selectSurveyRailCategory(categoryId: string) {
    if (!surveyToolbarModule) return;
    commitSurveyCategorySelection(surveyToolbarModule.id, categoryId);
    setSurveyOpen(false);
  }

  function selectSurveyRailEntity(entityId: string) {
    setLastSurveyEntityId(entityId);
    setSurveyPlacementMode('entity');
    setSurveyMode(true);
    setSelectedMarkerId(null);
    setActiveCategory(null);
    setActiveTool('survey');
    setSurveyOpen(false);
  }

  function moveBookmark(bookmarkId: string, delta: number) {
    setBookmarks((current) => {
      const ordered = [...current].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex((bookmark) => bookmark.id === bookmarkId);
      if (index < 0) return current;
      const nextIndex = clamp(index + delta, 0, ordered.length - 1);
      if (nextIndex === index) return current;
      const [moved] = ordered.splice(index, 1);
      ordered.splice(nextIndex, 0, moved);
      return ordered.map((bookmark, order) => ({ ...bookmark, order }));
    });
  }

  function handleToolPress(toolId: ToolId) {
    Keyboard.dismiss();
    dismissPageControl();
    setContextMenu(null);
    if (toolId === 'survey') {
      setSurveyMode(true);
      setActiveCategory(null);
    }
    if (toolId === 'region') {
      const targetSpace = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null;
      if (targetSpace) {
        setActiveSpaceId(targetSpace.id);
        if (!activeRegionId && targetSpace.regions[0]) setActiveRegionId(targetSpace.regions[0].id);
      }
      setActiveCategory(null);
      setRegionFullPageConfirmOpen(false);
      openSpacesPanel();
    }
    if (toolId === 'pan' || toolId === 'select') {
      setActiveCategory(null);
    }
    const category = toolCategoryById[toolId] ?? null;
    if (category) {
      setActiveCategory(category);
      setLastToolByCategory((current) => ({ ...current, [category]: toolId }));
    }
    setActiveTool(toolId);
  }

  function handleCategoryPress(categoryId: ToolCategory) {
    const category = toolbarCategories.find((item) => item.id === categoryId);
    if (!category) return;
    const nextTool = lastToolByCategory[categoryId] ?? category.defaultTool;
    setActiveCategory(categoryId);
    setActiveTool(nextTool);
  }

  function isCategoryActive(categoryId: ToolCategory) {
    return activeCategory === categoryId || toolCategoryById[activeTool] === categoryId;
  }

  function handleUndo() {
    setUndoStack((current) => {
      const next = current.slice(0, -1);
      const entry = current[current.length - 1];
      if (!entry) return current;
      if (entry.type === 'marker') {
        setMarkers((items) => items.filter((marker) => marker.id !== entry.item.id));
        if (selectedMarkerId === entry.item.id) setSelectedMarkerId(null);
      } else {
        setInkMarks((items) => items.filter((mark) => mark.id !== entry.item.id));
      }
      setRedoStack((redo) => [...redo, entry]);
      return next;
    });
  }

  function handleRedo() {
    setRedoStack((current) => {
      const next = current.slice(0, -1);
      const entry = current[current.length - 1];
      if (!entry) return current;
      if (entry.type === 'marker') {
        setMarkers((items) => [...items, entry.item]);
        setSelectedMarkerId(entry.item.id);
      } else {
        setInkMarks((items) => [...items, entry.item]);
      }
      setUndoStack((undo) => [...undo, entry]);
      return next;
    });
  }

  function handlePagePress(event: any) {
    const { locationX, locationY } = event.nativeEvent;
    Keyboard.dismiss();
    setFormatPanelMode('presets');
    if (activeTool === 'survey') {
      if (!selectedSurveyTemplate) {
        openSelectedSurveyPanel();
        return;
      }
      const next: Marker = {
        id: nextMarkerId(markers),
        name: `Camera C-${String(103 + nextMarkerId(markers)).padStart(3, '0')}`,
        notes: '',
        page: currentPage,
        x: clamp(locationX / pageWidth, 0.05, 0.95),
        y: clamp(locationY / pageHeight, 0.05, 0.95),
        moduleId: lastSurveySelection.moduleId,
        categoryId: surveyPlacementMode === 'category'
          ? resolveCategoryId(lastSurveySelection.moduleId, lastSurveySelection.categoryId)
          : null,
        entity: surveyPlacementMode === 'entity' ? lastSurveyEntityId : null,
        checklistResponses: {},
        done: {},
      };
      setMarkers((current) => [...current, next]);
      setUndoStack((current) => [...current, { type: 'marker', item: next }]);
      setRedoStack([]);
      openSurvey(next.id);
      if (!surveyKeepCategoryActive) {
        setActiveTool('pan');
        setActiveCategory(null);
        setSurveyPlacementMode('category');
        setLastSurveyEntityId(null);
      }
      return;
    }
    if (activeTool === 'region') {
      const targetSpace = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null;
      const targetRegion = targetSpace?.regions.find((region) => region.id === (editingRegionId ?? activeRegionId)) ?? targetSpace?.regions[0] ?? null;
      if (!targetSpace || !targetRegion) {
        createRegion(targetSpace?.id);
        openSpacesPanel();
        return;
      }
      if (regionOperation === 'subtract') {
        const shrinkFactor = regionDrawTool === 'freehand' ? 0.84 : 0.72;
        const nextWidth = Math.max(0.08, targetRegion.bounds.width * shrinkFactor);
        const nextHeight = Math.max(0.08, targetRegion.bounds.height * shrinkFactor);
        const nextBounds = {
          x: clamp(targetRegion.bounds.x + (targetRegion.bounds.width - nextWidth) / 2, 0, 1 - nextWidth),
          y: clamp(targetRegion.bounds.y + (targetRegion.bounds.height - nextHeight) / 2, 0, 1 - nextHeight),
          width: nextWidth,
          height: nextHeight,
        };
        updateRegion(targetSpace.id, targetRegion.id, { bounds: nextBounds });
        return;
      }
      const nextSize = regionDrawTool === 'freehand'
        ? { width: Math.max(0.16, targetRegion.bounds.width * 0.82), height: Math.max(0.16, targetRegion.bounds.height * 0.82) }
        : { width: targetRegion.bounds.width, height: targetRegion.bounds.height };
      const nextBounds = {
        x: clamp(locationX / pageWidth - nextSize.width / 2, 0.03, 0.97 - nextSize.width),
        y: clamp(locationY / pageHeight - nextSize.height / 2, 0.03, 0.97 - nextSize.height),
        width: nextSize.width,
        height: nextSize.height,
      };
      updateRegion(targetSpace.id, targetRegion.id, { page: currentPage, bounds: nextBounds });
      activateRegion(targetSpace.id, targetRegion.id);
      return;
    }
    if (['pen', 'highlighter', 'rect', 'ellipse', 'line', 'arrow', 'counter', 'text', 'callout'].includes(activeTool)) {
      const next: InkMark = {
        id: Date.now(),
        page: currentPage,
        x: clamp(locationX / pageWidth, 0.04, 0.96),
        y: clamp(locationY / pageHeight, 0.04, 0.96),
      };
      setInkMarks((current) => [...current, next]);
      setUndoStack((current) => [...current, { type: 'ink', item: next }]);
      setRedoStack([]);
      return;
    }
    if (activeTool === 'select') {
      return;
    }
  }

  const pageNavigationControl = (
    <View style={styles.pageZoomTools}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Jump to page and choose fit mode"
        style={[styles.pageZoomButton, pageControlOpen && styles.pageZoomButtonActive]}
        onPress={openPageControl}
      >
        {pageControlOpen ? (
          <TextInput
            value={pageDraft}
            autoFocus
            selectTextOnFocus
            keyboardType="number-pad"
            returnKeyType="done"
            onChangeText={(value) => setPageDraft(value.replace(/[^0-9]/g, '').slice(0, 3))}
            onSubmitEditing={commitPageJump}
            style={styles.pageZoomInput}
          />
        ) : (
          <Text style={styles.pageZoomText}>{currentPageOrdinal}</Text>
        )}
        <Text style={styles.pageZoomText}>/ {totalPages}</Text>
        <ChevronDown color={pageControlOpen ? colors.blue : colors.muted} size={13} />
      </Pressable>
      {pageControlOpen ? (
        <Animated.View
          style={[
            styles.pageZoomMenu,
            {
              opacity: pageControlAnim,
              transform: [
                {
                  translateY: pageControlAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-4, 0],
                  }),
                },
                {
                  scale: pageControlAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.97, 1],
                  }),
                },
              ],
            },
          ]}
        >
          {zoomFitOptions.map((option) => {
            const active = option.id === zoomFitMode;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                style={[styles.pageZoomMenuItem, active && styles.pageZoomMenuItemActive]}
                onPress={() => {
                  applyPageDraft();
                  setZoomFitMode(option.id);
                  dismissPageControl();
                }}
              >
                <Text style={[styles.pageZoomMenuText, active && styles.pageZoomMenuTextActive]}>{option.label}</Text>
                {active ? <Check color={colors.blue} size={15} strokeWidth={2.4} /> : null}
              </Pressable>
            );
          })}
        </Animated.View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.topBar, { height: topBarHeight, paddingTop: insets.top }]}>
        <View style={styles.topLeftGroup}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to home" style={styles.topBackButton}>
            <ChevronLeft color={colors.text} size={22} strokeWidth={2.2} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="PDF title. Tap to show page navigation."
            style={styles.titlePill}
            onPress={handleTitlePress}
          >
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.titleText,
                {
                  transform: [
                    {
                      translateX: titleRevealAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -52],
                      }),
                    },
                  ],
                },
              ]}
            >
              {documentTitle}
            </Animated.Text>
          </Pressable>
        </View>
        <View style={styles.topCenterGroup}>
          {pageNavigationControl}
        </View>
        <View style={styles.historyTools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo"
            disabled={undoStack.length === 0}
            style={[styles.historyButton, undoStack.length === 0 && styles.historyButtonDisabled]}
            onPress={handleUndo}
          >
            <Undo2 color={undoStack.length ? colors.text : colors.faint} size={17} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Redo"
            disabled={redoStack.length === 0}
            style={[styles.historyButton, redoStack.length === 0 && styles.historyButtonDisabled]}
            onPress={handleRedo}
          >
            <Redo2 color={redoStack.length ? colors.text : colors.faint} size={17} />
          </Pressable>
        </View>
      </View>

      <View style={styles.workArea}>
        <View style={[styles.rail, { width: railWidth, paddingBottom: bottomActionHeight + 28 }]}>
          {primaryTools.map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <Pressable
                key={tool.id}
                accessibilityRole="button"
                accessibilityLabel={tool.label}
                style={[styles.railButton, active && styles.railButtonActive]}
                onPress={() => handleToolPress(tool.id)}
              >
                <Icon color={active ? colors.blue : colors.text} size={20} strokeWidth={2.2} />
              </Pressable>
            );
          })}
          <View style={styles.railDivider} />
          {toolbarCategories.map((category) => {
            const Icon = category.icon;
            const active = isCategoryActive(category.id);
            return (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityLabel={category.label}
                style={[styles.railButton, active && styles.railButtonActive]}
                onPress={() => handleCategoryPress(category.id)}
              >
                <Icon color={active ? colors.blue : colors.text} size={20} strokeWidth={2.2} />
              </Pressable>
            );
          })}
          {activeCategory ? (
            <>
              <View style={styles.railSubDivider} />
              <View style={styles.railSubToolbar}>
                {railSubtools[activeCategory].map((tool) => {
                  const Icon = tool.icon;
                  const active = activeTool === tool.id;
                  return (
                    <Pressable
                      key={tool.id}
                      accessibilityRole="button"
                      accessibilityLabel={tool.label}
                      style={[styles.railSubButton, active && styles.railSubButtonActive]}
                      onPress={() => handleToolPress(tool.id)}
                    >
                      <Icon color={active ? colors.blue : colors.text} size={18} strokeWidth={2.15} />
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          {regionEditActive ? (
            <>
              <View style={styles.railSubDivider} />
              <View style={styles.railSubToolbar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Rectangular region"
                  style={[styles.railSubButton, regionDrawTool === 'rectangular' && styles.railSubButtonActive]}
                  onPress={() => {
                    setRegionDrawTool('rectangular');
                    setActiveTool('region');
                    setRegionFullPageConfirmOpen(false);
                  }}
                >
                  <RectangleHorizontal color={regionDrawTool === 'rectangular' ? colors.blue : colors.text} size={18} strokeWidth={2.15} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Freehand region"
                  style={[styles.railSubButton, regionDrawTool === 'freehand' && styles.railSubButtonActive]}
                  onPress={() => {
                    setRegionDrawTool('freehand');
                    setActiveTool('region');
                    setRegionFullPageConfirmOpen(false);
                  }}
                >
                  <PenLine color={regionDrawTool === 'freehand' ? colors.blue : colors.text} size={18} strokeWidth={2.15} />
                </Pressable>
                <View style={styles.railSubMiniDivider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Additive region mode"
                  style={[styles.railSubButton, regionOperation === 'add' && styles.railSubButtonActive]}
                  onPress={() => {
                    setRegionOperation('add');
                    setActiveTool('region');
                    setRegionFullPageConfirmOpen(false);
                  }}
                >
                  <Plus color={regionOperation === 'add' ? colors.blue : colors.text} size={18} strokeWidth={2.2} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Subtractive region mode"
                  style={[styles.railSubButton, regionOperation === 'subtract' && styles.railSubButtonActive]}
                  onPress={() => {
                    setRegionOperation('subtract');
                    setActiveTool('region');
                    setRegionFullPageConfirmOpen(false);
                  }}
                >
                  <Minus color={regionOperation === 'subtract' ? colors.blue : colors.text} size={18} strokeWidth={2.2} />
                </Pressable>
              </View>
            </>
          ) : null}
          {surveyMode && selectedSurveyTemplate && surveyToolbarModule && !regionEditActive ? (
            <>
              <View style={styles.railSubDivider} />
              <View style={styles.railSurveyCategoryToolbar}>
                {surveyToolbarModule.categories.map((category) => {
                  const active = activeTool === 'survey' && surveyPlacementMode === 'category' && lastSurveySelection.categoryId === category.id;
                  const glyph = getSurveyCategoryGlyphLabel(category.name);
                  return (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Survey category ${category.name}`}
                      style={[styles.railSurveyCategoryButton, active && styles.railSurveyCategoryButtonActive]}
                      onPress={() => selectSurveyRailCategory(category.id)}
                    >
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        style={[styles.railSurveyCategoryText, active && styles.railSurveyCategoryTextActive]}
                      >
                        {glyph}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.railSubDivider} />
              <View style={styles.railSurveyEntityToolbar}>
                {surveyEntities.map((entity) => {
                  const active = activeTool === 'survey' && surveyPlacementMode === 'entity' && lastSurveyEntityId === entity.id;
                  return (
                    <Pressable
                      key={entity.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Survey entity ${entity.name}`}
                      style={[styles.railSurveyEntityButton, active && styles.railSurveyEntityButtonActive]}
                      onPress={() => selectSurveyRailEntity(entity.id)}
                    >
                      <View style={[styles.railSurveyEntitySwatch, { backgroundColor: entity.color }]} />
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          <View style={styles.railSpacer} />
          <View style={styles.railFooterTools}>
            <Pressable accessibilityRole="button" accessibilityLabel="More document options" style={styles.railFooterMenuButton}>
              <MoreHorizontal color={colors.text} size={20} />
            </Pressable>
            <View style={styles.railFooterButtonStack}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${syncStateInfo.label}. Tap to sync now.`}
                style={styles.syncStatusButton}
                onPress={handleManualSyncPress}
              >
                <View style={[styles.syncStatusCircle, { backgroundColor: syncStateInfo.color }]} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open version history"
                style={[styles.railFooterButton, versionHistoryOpen && styles.railButtonActive]}
                onPress={openVersionHistoryPanel}
              >
                <VersionHistoryIcon color={versionHistoryOpen ? colors.blue : colors.text} size={21} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${activeUsers.length} active users`}
                style={[styles.activeUsersButton, activeUsersOpen && styles.railButtonActive]}
                onPress={openActiveUsersPanel}
              >
                <View style={styles.userAvatar}>
                  <Text style={styles.userAvatarText}>{activeUsers[0]?.initials ?? 'U'}</Text>
                </View>
                {activeUsers.length > 1 ? (
                  <View style={styles.userCountBadge}>
                    <Text style={styles.userCountText}>+{activeUsers.length - 1}</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.documentScroll}
          contentContainerStyle={[
            styles.documentContent,
            {
              minHeight: Math.max(height - topBarHeight - subBarHeight - bottomActionHeight, pageHeight + 96),
              paddingLeft: pageOffset.x,
              paddingTop: pageOffset.y,
              paddingBottom: bottomActionHeight + 22,
            },
          ]}
        >
          <Pressable
            style={[styles.page, { width: pageWidth, height: pageHeight }]}
            onPress={handlePagePress}
            delayLongPress={360}
            onLongPress={(event) => {
              if (activeTool === 'pan' || activeTool === 'select') {
                openCanvasContextMenu(event);
              }
            }}
          >
            <FloorPlan pageWidth={pageWidth} pageHeight={pageHeight} />
            {activeRegion && activeRegion.page === currentPage ? (
              <RegionOverlay
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                region={activeRegion}
                editing={editingRegionId === activeRegion.id}
                onPress={() => {
                  setActiveRegionId(activeRegion.id);
                  if (activeTool === 'select') setEditingRegionId(activeRegion.id);
                }}
                onLongPress={() => openRegionContextMenu(activeRegion)}
              />
            ) : null}
            {visibleInkMarks.map((mark) => (
              <Pressable
                key={mark.id}
                accessibilityRole="button"
                accessibilityLabel="Annotation"
                hitSlop={10}
                style={[
                  styles.inkDot,
                  {
                    left: mark.x * pageWidth - 5,
                    top: mark.y * pageHeight - 5,
                  },
                ]}
                delayLongPress={320}
                onLongPress={(event) => {
                  event.stopPropagation();
                  openAnnotationContextMenu(mark);
                }}
                onPress={(event) => {
                  event.stopPropagation();
                }}
              />
            ))}
            {visibleMarkers.map((marker) => {
              const entity = entities.find((item) => item.id === marker.entity);
              const selected = marker.id === selectedMarkerId;
              return (
                <Pressable
                  key={marker.id}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Open survey marker ${marker.name}`}
                  hitSlop={8}
                  style={[
                    styles.marker,
                    {
                      left: marker.x * pageWidth - 13,
                      top: marker.y * pageHeight - 13,
                      backgroundColor: entity?.color ?? colors.yellow,
                      borderColor: selected ? colors.blue : colors.ink,
                    },
                  ]}
                  onPress={(event) => {
                    event.stopPropagation();
                    openSurvey(marker.id);
                  }}
                >
                  <Text style={styles.markerText}>{marker.id}</Text>
                </Pressable>
              );
            })}
          </Pressable>

        </ScrollView>
      </View>

      {contextMenu ? (
        <FloatingContextMenu menu={contextMenu} onDismiss={() => setContextMenu(null)} />
      ) : null}

      <AnnotationFormattingBar
        activeTool={activeTool}
        visible={formatBarVisible}
        surveyToolbarActive={surveyToolbarVisible}
        regionToolbarActive={regionToolbarVisible}
        regionFullPageConfirmOpen={regionFullPageConfirmOpen}
        mode={formatPanelMode}
        setMode={setFormatPanelMode}
        railWidth={railWidth}
        topOffset={topBarHeight}
        surveyModules={activeSurveyModules}
        selectedSurveyModuleId={surveyToolbarModule?.id ?? null}
        onSelectSurveyModule={selectSurveyToolbarModule}
        surveyKeepCategoryActive={surveyKeepCategoryActive}
        setSurveyKeepCategoryActive={setSurveyKeepCategoryActive}
        onRegionConfirm={confirmRegionEdits}
        onRegionCancel={cancelRegionEdits}
        onRegionFullPage={requestFullPageRegion}
        onRegionFullPageConfirm={applyFullPageRegion}
        onRegionFullPageCancel={() => setRegionFullPageConfirmOpen(false)}
        onOpenEditPanel={openAnnotationEditPanel}
      />

      {(surveyOpen || spacesOpen || hubOpen || versionHistoryOpen || activeUsersOpen || pageControlOpen || annotationEditConfig) ? (
        <Pressable style={[styles.dismissLayer, pageControlOpen && styles.popoverDismissLayer]} onPress={closePanels} />
      ) : null}

      {!surveyOpen && !spacesOpen && !versionHistoryOpen && !activeUsersOpen && !annotationEditConfig ? (
        <>
          {hubOpen ? (
            <HubTray
              hubMode={hubMode}
              setHubMode={selectHubMode}
              currentPage={currentPage}
              currentPageOrdinal={currentPageOrdinal}
              setCurrentPage={setCurrentPage}
              markers={markers}
              inkMarks={inkMarks}
              bookmarks={bookmarks}
              pageOrder={pageOrder}
              totalPages={totalPages}
              pageTransforms={pageTransforms}
              pageClipboard={pageClipboard}
              onMoveBookmark={moveBookmark}
              onMovePage={movePage}
              onOpenPageMenu={openPageContextMenu}
              openSurvey={openSurvey}
              searchValue={searchValue}
              setSearchValue={setSearchValue}
              close={() => setHubOpen(false)}
              panelHeight={hubPanelHeight}
              bottomInset={bottomInset}
            />
          ) : null}
          {!hubOpen ? (
            <BottomActionBar
              openSpaces={toggleSpacesPanel}
              openSurvey={openSelectedSurveyPanel}
              toggleHub={toggleHub}
              hubMode={hubMode}
              hubOpen={hubOpen}
              spacesModeActive={spacesModeActive}
              surveyModeActive={surveyMode}
              bottomInset={bottomInset}
            />
          ) : null}
        </>
      ) : null}

      {spacesOpen ? (
        <SpacesDrawer
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          activeRegionId={activeRegionId}
          editingRegionId={editingRegionId}
          panelHeight={spacesPanelHeight}
          bottomInset={bottomInset}
          totalPages={totalPages}
          surveyMode={surveyMode}
          onToggleSpace={toggleSpaceActive}
          onToggleRegion={toggleRegionActive}
          onUpdateSpace={updateSpace}
          onUpdateRegion={updateRegion}
          onAssignPages={assignSpacePages}
          onCreateSpace={createSpace}
          onDeleteSpace={deleteSpace}
          onCreateRegion={createRegion}
          onMoveSpace={moveSpace}
          onLocatePage={setCurrentPage}
          onEditRegion={(spaceId, regionId) => {
            activateRegion(spaceId, regionId);
            setEditingRegionId(regionId);
            setActiveTool('region');
          }}
          onExitRegion={exitRegionMode}
          onClose={() => setSpacesOpen(false)}
        />
      ) : null}

      {versionHistoryOpen ? (
        <VersionHistoryDrawer
          panelHeight={versionHistoryPanelHeight}
          bottomInset={bottomInset}
          onClose={() => setVersionHistoryOpen(false)}
        />
      ) : null}

      {activeUsersOpen ? (
        <ActiveUsersDrawer
          panelHeight={activeUsersPanelHeight}
          bottomInset={bottomInset}
          onClose={() => setActiveUsersOpen(false)}
        />
      ) : null}

      {annotationEditConfig ? (
        <AnnotationEditPanel
          config={annotationEditConfig}
          panelHeight={maxBottomPanelHeight}
          bottomInset={bottomInset}
          dismissRequest={annotationEditDismissRequest}
          onClose={() => setAnnotationEditConfig(null)}
        />
      ) : null}

      {surveyOpen && selectedMarker ? (
        <SurveySheet
          marker={selectedMarker}
          markers={markers}
          entityName={selectedEntity?.name ?? 'Unassigned'}
          template={selectedSurveyTemplate}
          templates={surveyTemplates}
          selectedTemplateId={selectedSurveyTemplateId}
          onSelectTemplate={selectSurveyTemplate}
          modules={activeSurveyModules}
          entities={surveyEntities}
          moduleIndex={selectedModuleIndex}
          activeCategory={selectedCategory}
          checklistItems={selectedChecklist}
          lastCategoryByModule={lastCategoryByModule}
          rememberSurveySelection={rememberSurveySelection}
          updateMarker={updateMarker}
          sheetHeight={surveyPanelHeight}
          checklistWindowHeight={checklistWindowHeight}
          bottomInset={bottomInset}
          onSelectMarker={openSurvey}
          onLocateMarker={(marker) => {
            setCurrentPage(marker.page);
            setSurveyOpen(false);
          }}
          onExitSurvey={exitSurveyMode}
          onClose={() => setSurveyOpen(false)}
        />
      ) : null}
      {surveyOpen && !selectedMarker ? (
        <SurveySetupSheet
          template={selectedSurveyTemplate}
          templates={surveyTemplates}
          selectedTemplateId={selectedSurveyTemplateId}
          onSelectTemplate={selectSurveyTemplate}
          modules={activeSurveyModules}
          moduleIndex={setupModuleIndex}
          selectedCategoryId={setupCategoryId}
          markers={markers}
          sheetHeight={surveySetupPanelHeight}
          bottomInset={bottomInset}
          onSelectModule={selectSurveySetupModule}
          onSelectMarker={openSurvey}
          onPlaceCategory={startSurveyCategoryPlacement}
          onExitSurvey={exitSurveyMode}
          onClose={() => setSurveyOpen(false)}
        />
      ) : null}
    </View>
  );
}


