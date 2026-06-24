import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
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

type ToolId =
  | 'pan'
  | 'select'
  | 'survey'
  | 'region'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'counter'
  | 'text'
  | 'callout';
type ToolCategory = 'draw' | 'shape' | 'review';
type HubMode = 'pages' | 'search' | 'bookmarks';
type ZoomFitMode = 'fitPage' | 'fitWidth' | 'fitHeight';
type FormatPanelMode = 'presets' | 'text';
type RegionDrawTool = 'rectangular' | 'freehand';
type RegionOperation = 'add' | 'subtract';

type ContextMenuAction = {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

type ContextMenuState = {
  id: string;
  title: string;
  x: number;
  y: number;
  width?: number;
  actions: ContextMenuAction[];
};

type SurveyCategory = {
  id: string;
  name: string;
  checklist: SurveyChecklistItem[];
};

type SurveyChecklistItem = {
  id: string;
  text: string;
  archived?: boolean;
};

type SurveyModule = {
  id: string;
  name: string;
  categories: SurveyCategory[];
};

type ChecklistSelection = 'Y' | 'N' | 'N/A';

type Entity = {
  id: string;
  name: string;
  color: string;
};

type Marker = {
  id: number;
  name: string;
  notes: string;
  photos?: string[];
  videos?: string[];
  page: number;
  x: number;
  y: number;
  moduleId: string;
  categoryId: string | null;
  entity: string | null;
  checklistResponses: Record<string, { selection?: ChecklistSelection; note?: string }>;
  done: Record<string, boolean>;
};

type SurveyTemplate = {
  id: string;
  name: string;
  modules: SurveyModule[];
  entities: Entity[];
};

type BookmarkEntry = {
  id: string;
  title: string;
  page: number | null;
  type: 'folder' | 'bookmark';
  parentId?: string | null;
  depth: number;
  order: number;
  sourceId?: string;
  markerId?: number;
};

type RegionBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RegionConfig = {
  id: string;
  name: string;
  page: number;
  bounds: RegionBounds;
  surveyBound: boolean;
  showCanvasAnnotations: boolean;
  showSurveyAnnotations: boolean;
};

type SpaceConfig = {
  id: string;
  name: string;
  pages: number[];
  expanded: boolean;
  regions: RegionConfig[];
};

type InkMark = {
  id: number;
  page: number;
  x: number;
  y: number;
};

type PageClipboard = {
  page: number;
  mode: 'copy' | 'cut';
};

type AnnotationClipboard = {
  item: InkMark;
  mode: 'copy' | 'cut';
};

type PageTransformState = {
  rotation: number;
  mirrorHorizontal: boolean;
  mirrorVertical: boolean;
};

type HistoryEntry =
  | { type: 'marker'; item: Marker }
  | { type: 'ink'; item: InkMark };

type CounterSeries = {
  seriesId: string;
  label: string;
  color: string;
  count: number;
};

const colors = {
  bg: '#101114',
  chrome: '#1E1E1E',
  rail: '#20242C',
  panel: '#24272D',
  panel2: '#2D2D2D',
  line: '#3A3A3A',
  text: '#F2F2F2',
  muted: '#A8B0BF',
  faint: '#6F7785',
  blue: '#4A90E2',
  green: '#28A745',
  yellow: '#D8A84E',
  red: '#DC3545',
  page: '#FAFAF8',
  ink: '#252A31',
};

function SurveyIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 12H15" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M9 8H15" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M9 16H12" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke={color} strokeWidth={1.5} />
      <Path d="M12 3V6" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M21 12H18" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M12 18V21" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M6 12H3" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

function ExportIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 15V4" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M8 8L12 4L16 8" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 13V18C5 19.1046 5.89543 20 7 20H17C18.1046 20 19 19.1046 19 18V13" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

function VersionHistoryIcon({ color, size = 21 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12C19 15.866 15.866 19 12 19C9.73476 19 7.72111 17.924 6.44154 16.255" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M5 7V12H10" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 8.5V12.3L14.5 14" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const primaryTools: Array<{ id: ToolId; label: string; icon: React.ComponentType<any> }> = [
  { id: 'pan', label: 'Pan', icon: Hand },
  { id: 'select', label: 'Select', icon: MousePointer2 },
];

const toolbarCategories: Array<{ id: ToolCategory; label: string; icon: React.ComponentType<any>; defaultTool: ToolId }> = [
  { id: 'draw', label: 'Draw', icon: Pencil, defaultTool: 'pen' },
  { id: 'shape', label: 'Shapes', icon: RectangleHorizontal, defaultTool: 'rect' },
  { id: 'review', label: 'Text', icon: Type, defaultTool: 'text' },
];

const hubItems: Array<{ id: HubMode; label: string; icon: React.ComponentType<any> }> = [
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
];

const pdfTextMatches = [
  { id: 'lobby', page: 1, title: 'LOBBY', excerpt: 'Lobby room label on Floor 1 Plan' },
  { id: 'office', page: 1, title: 'OFFICE', excerpt: 'Office room label on Floor 1 Plan' },
  { id: 'retail', page: 1, title: 'RETAIL', excerpt: 'Retail space label on Floor 1 Plan' },
  { id: 'idf', page: 1, title: 'IDF', excerpt: 'IDF room label on Floor 1 Plan' },
  { id: 'region', page: 1, title: 'Region', excerpt: 'Region annotation label on Floor 1 Plan' },
];

const documentTitle = 'Floor 1 Plan';
const initialPageCount = 2;

const zoomFitOptions: Array<{ id: ZoomFitMode; label: string }> = [
  { id: 'fitPage', label: 'Fit Page' },
  { id: 'fitWidth', label: 'Fit Width' },
  { id: 'fitHeight', label: 'Fit Height' },
];

type SyncState = 'synced' | 'syncing' | 'offline';

const syncStateConfig: Record<SyncState, { label: string; color: string }> = {
  synced: { label: 'Up to date', color: '#2bbd7e' },
  syncing: { label: 'Syncing now...', color: '#f5a524' },
  offline: { label: 'Offline', color: '#ef4444' },
};

const activeUsers = [
  { id: 'isaiah', initials: 'IC', name: 'Isaiah', role: 'Document owner', status: 'Viewing Floor 1' },
  { id: 'pm', initials: 'PM', name: 'Project Manager', role: 'Project manager', status: 'Online' },
  { id: 'field', initials: 'FS', name: 'Field Surveyor', role: 'Field surveyor', status: 'Online' },
];

const versionHistoryItems = [
  { id: 'sync', title: 'Online sync active', meta: 'Microsoft 365 workbook ready' },
  { id: 'marker', title: 'Camera C-104 updated', meta: 'Isaiah changed checklist status' },
  { id: 'region', title: 'Region filter enabled', meta: 'Floor 1 customer area' },
];

const railSubtools: Record<ToolCategory, Array<{ id: ToolId; label: string; icon: React.ComponentType<any> }>> = {
  draw: [
    { id: 'pen', label: 'Pen', icon: PenLine },
    { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
    { id: 'eraser', label: 'Eraser', icon: Eraser },
  ],
  shape: [
    { id: 'rect', label: 'Rectangle', icon: Square },
    { id: 'ellipse', label: 'Ellipse', icon: Circle },
    { id: 'line', label: 'Line', icon: Minus },
    { id: 'arrow', label: 'Arrow', icon: ArrowRight },
    { id: 'counter', label: 'Counter', icon: Hash },
  ],
  review: [
    { id: 'text', label: 'Text', icon: Type },
    { id: 'callout', label: 'Callout', icon: MessageSquareText },
  ],
};

const toolCategoryById: Partial<Record<ToolId, ToolCategory>> = {
  pen: 'draw',
  highlighter: 'draw',
  eraser: 'draw',
  rect: 'shape',
  ellipse: 'shape',
  line: 'shape',
  arrow: 'shape',
  counter: 'shape',
  text: 'review',
  callout: 'review',
};

const annotationToolIds: ToolId[] = ['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'line', 'arrow', 'counter', 'text', 'callout'];

const formatToolTitle: Partial<Record<ToolId, string>> = {
  pen: 'Pen',
  highlighter: 'Highlighter',
  eraser: 'Eraser',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  counter: 'Counter',
  text: 'Text',
  callout: 'Callout',
};

const desktopColorPresets = ['#ff0000', '#4A90E2', '#27C07D', '#F4D35E', '#ffffff', '#1e293b'];

function getSurveyCategoryGlyphLabel(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const label = parts.length > 1
    ? parts.slice(0, 2).map((part) => part[0]).join('')
    : parts[0].slice(0, 2);
  return label.toUpperCase();
}
const lineBorderStyleLabels = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  cloud: 'Cloud',
} as const;
const arrowheadStyleLabels = {
  none: 'None',
  solidTriangle: 'Solid Triangle',
  vShape: 'V-Shape',
  openCircle: 'Open Circle',
  openTriangle: 'Open Triangle',
  horizontalLine: 'Horizontal Line',
} as const;
const eraserModeLabels = {
  partial: 'Partial Erase',
  entire: 'Full Stroke',
} as const;
const fontSizeOptions = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '40', '48', '56', '64', '72'];
const counterSeriesColors = ['#ff0000', '#4A90E2', '#27C07D', '#F4D35E', '#C7A7FF', '#FF8A3D'];
const annotationColorChoices = Array.from(new Set([...desktopColorPresets, ...counterSeriesColors, '#000000']));

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string) {
  const clean = value.trim().replace(/\s/g, '').replace(/^#?/, '#');
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean.toUpperCase() : null;
}

function hexToRgb(value: string) {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  const raw = hex.slice(1);
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    h: hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hexToHsv(value: string) {
  const rgb = hexToRgb(value);
  return rgb ? rgbToHsv(rgb.r, rgb.g, rgb.b) : { h: 0, s: 1, v: 1 };
}

function hsvToHex(h: number, s: number, v: number) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clampValue(s, 0, 1);
  const value = clampValue(v, 0, 1);
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) [red, green, blue] = [chroma, x, 0];
  else if (hue < 120) [red, green, blue] = [x, chroma, 0];
  else if (hue < 180) [red, green, blue] = [0, chroma, x];
  else if (hue < 240) [red, green, blue] = [0, x, chroma];
  else if (hue < 300) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return `#${[red, green, blue].map((channel) => (
    Math.round((channel + match) * 255).toString(16).padStart(2, '0')
  )).join('')}`.toUpperCase();
}

type AnnotationEditFocus = 'fill' | 'stroke' | 'text';
type LineBorderStyle = keyof typeof lineBorderStyleLabels;
type ArrowheadStyle = keyof typeof arrowheadStyleLabels;
type EraserMode = keyof typeof eraserModeLabels;

type AnnotationEditConfig = {
  tool: ToolId;
  focus: AnnotationEditFocus;
  sections: AnnotationEditFocus[];
  fillColor: string;
  strokeColor: string;
  fontColor: string;
  setFillColor: (value: string) => void;
  setStrokeColor: (value: string) => void;
  setFontColor: (value: string) => void;
  strokeWidthValue: string;
  setStrokeWidthValue: (value: string) => void;
  eraserSizeValue: string;
  setEraserSizeValue: (value: string) => void;
  eraserMode: EraserMode;
  setEraserMode: React.Dispatch<React.SetStateAction<EraserMode>>;
  lineBorderStyle: LineBorderStyle;
  setLineBorderStyle: (value: LineBorderStyle) => void;
  cloudIntensity: string;
  setCloudIntensity: (value: string) => void;
  arrowheadStyle: ArrowheadStyle;
  setArrowheadStyle: (value: ArrowheadStyle) => void;
  fontSize: string;
  setFontSize: (value: string) => void;
  bold: boolean;
  setBold: React.Dispatch<React.SetStateAction<boolean>>;
  italic: boolean;
  setItalic: React.Dispatch<React.SetStateAction<boolean>>;
  underline: boolean;
  setUnderline: React.Dispatch<React.SetStateAction<boolean>>;
  strike: boolean;
  setStrike: React.Dispatch<React.SetStateAction<boolean>>;
  alignmentIndex: number;
  setAlignmentIndex: React.Dispatch<React.SetStateAction<number>>;
  counterSeriesLabel?: string;
};

const entities: Entity[] = [
  { id: 'my-company', name: 'My Company', color: '#CBDCFF' },
  { id: 'sub', name: 'Subcontractor', color: '#FFF5C3' },
  { id: 'gc', name: 'GC', color: '#E3D1FB' },
  { id: 'complete', name: '100% Complete', color: '#B2FFB2' },
];

const surveyModules: SurveyModule[] = [
  {
    id: 'install',
    name: 'Install',
    categories: [
      {
        id: 'camera-install',
        name: 'Cameras',
        checklist: [
          { id: 'cable-pulled', text: 'Cable pulled' },
          { id: 'camera-installed', text: 'Camera installed' },
          { id: 'aimed-focused', text: 'Aimed and focused' },
          { id: 'mounted-plan-location', text: 'Mounted at plan location' },
        ],
      },
      {
        id: 'door-install',
        name: 'Doors',
        checklist: [
          { id: 'reader-wired', text: 'Reader wired' },
          { id: 'lock-installed', text: 'Lock installed' },
          { id: 'door-contact-landed', text: 'Door contact landed' },
          { id: 'cable-labeled', text: 'Cable labeled' },
        ],
      },
      {
        id: 'headend-install',
        name: 'Headend',
        checklist: [
          { id: 'panel-mounted', text: 'Panel mounted' },
          { id: 'power-landed', text: 'Power landed' },
          { id: 'network-patched', text: 'Network patched' },
          { id: 'enclosure-labeled', text: 'Enclosure labeled' },
        ],
      },
    ],
  },
  {
    id: 'commission',
    name: 'Commission',
    categories: [
      {
        id: 'camera-commission',
        name: 'Cameras',
        checklist: [
          { id: 'online-vms', text: 'Online in VMS' },
          { id: 'recording-confirmed', text: 'Recording confirmed' },
          { id: 'view-named', text: 'View named correctly' },
          { id: 'customer-signoff', text: 'Customer sign-off captured' },
          { id: 'aim-accepted', text: 'Aim accepted' },
        ],
      },
      {
        id: 'door-commission',
        name: 'Doors',
        checklist: [
          { id: 'unlock-tested', text: 'Unlock tested' },
          { id: 'forced-open-tested', text: 'Forced-open alarm tested' },
          { id: 'access-level-verified', text: 'Access level verified' },
          { id: 'rex-tested', text: 'Rex tested' },
        ],
      },
      {
        id: 'headend-commission',
        name: 'Headend',
        checklist: [
          { id: 'controller-online', text: 'Controller online' },
          { id: 'backup-confirmed', text: 'Backup confirmed' },
          { id: 'time-sync-verified', text: 'Time sync verified' },
        ],
      },
    ],
  },
];

const surveyTemplates: SurveyTemplate[] = [
  {
    id: 'security-field-survey',
    name: 'Security Field Survey',
    modules: surveyModules,
    entities,
  },
  {
    id: 'closeout-survey',
    name: 'Closeout Punch Survey',
    modules: surveyModules,
    entities,
  },
];

const importedPdfBookmarks: BookmarkEntry[] = [
  { id: 'outline-floor-1', title: 'Floor 1', page: 1, type: 'folder', depth: 0, order: 0, sourceId: 'pdf-outline:floor-1' },
  { id: 'outline-customer-area', title: 'Customer area', page: 1, type: 'bookmark', parentId: 'outline-floor-1', depth: 1, order: 1, sourceId: 'pdf-outline:customer-area' },
  { id: 'outline-idf', title: 'IDF', page: 1, type: 'bookmark', parentId: 'outline-floor-1', depth: 1, order: 2, sourceId: 'pdf-outline:idf' },
  { id: 'outline-floor-2', title: 'Floor 2', page: 2, type: 'bookmark', depth: 0, order: 3, sourceId: 'pdf-outline:floor-2' },
];

const initialSpaces: SpaceConfig[] = [
  {
    id: 'space-floors-1-5',
    name: 'Floors 1-5',
    pages: [1, 2],
    expanded: true,
    regions: [
      {
        id: 'region-floor-1-customer',
        name: 'Floor 1 - Customer area',
        page: 1,
        bounds: { x: 0.17, y: 0.2, width: 0.52, height: 0.31 },
        surveyBound: true,
        showCanvasAnnotations: false,
        showSurveyAnnotations: true,
      },
    ],
  },
];

const MAX_VISIBLE_CHECKLIST_ITEMS = 4;
const CHECKLIST_ITEM_HEIGHT = 36;
const CHECKLIST_ITEM_GAP = 5;
const SURVEY_SHEET_FIXED_HEIGHT = 314;
const PANEL_MAX_CHECKLIST_WINDOW_HEIGHT =
  (MAX_VISIBLE_CHECKLIST_ITEMS * CHECKLIST_ITEM_HEIGHT) +
  ((MAX_VISIBLE_CHECKLIST_ITEMS - 1) * CHECKLIST_ITEM_GAP);

function getChecklistWindowHeight(itemCount: number) {
  const visibleCount = Math.min(MAX_VISIBLE_CHECKLIST_ITEMS, Math.max(1, itemCount));
  return (visibleCount * CHECKLIST_ITEM_HEIGHT) + ((visibleCount - 1) * CHECKLIST_ITEM_GAP);
}

function capBottomPanelHeight(contentHeight: number, bottomInset: number, maxHeight: number) {
  return Math.min(maxHeight, Math.ceil(contentHeight + bottomInset));
}

function summarizePages(pages: number[]) {
  if (!pages.length) return 'No pages';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 1) return `Page ${sorted[0]}`;
  const consecutive = sorted.every((page, index) => index === 0 || page === sorted[index - 1] + 1);
  return consecutive ? `Pages ${sorted[0]}-${sorted[sorted.length - 1]}` : `Pages ${sorted.join(', ')}`;
}

function parsePageRangeDraft(value: string, maxPage: number) {
  const pages = new Set<number>();
  const errors: string[] = [];
  value.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (start > end) {
        errors.push(`${part} is backwards.`);
        return;
      }
      for (let page = start; page <= end; page += 1) {
        if (page < 1 || page > maxPage) errors.push(`${page} is outside this PDF.`);
        else pages.add(page);
      }
      return;
    }
    const page = Number.parseInt(part, 10);
    if (!Number.isFinite(page) || String(page) !== part) {
      errors.push(`${part} is not a page.`);
      return;
    }
    if (page < 1 || page > maxPage) errors.push(`${page} is outside this PDF.`);
    else pages.add(page);
  });
  return { pages: [...pages].sort((a, b) => a - b), error: errors[0] ?? null };
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function moveItemById<T extends { id: string }>(items: T[], id: string, delta: number) {
  const fromIndex = items.findIndex((item) => item.id === id);
  if (fromIndex < 0) return items;
  return moveArrayItem(items, fromIndex, clamp(fromIndex + delta, 0, items.length - 1));
}

function moveNumberItem(items: number[], value: number, delta: number) {
  const fromIndex = items.indexOf(value);
  if (fromIndex < 0) return items;
  return moveArrayItem(items, fromIndex, clamp(fromIndex + delta, 0, items.length - 1));
}

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

function HubTray({
  hubMode,
  setHubMode,
  currentPage,
  currentPageOrdinal,
  setCurrentPage,
  markers,
  inkMarks,
  bookmarks,
  pageOrder,
  totalPages,
  pageTransforms,
  pageClipboard,
  onMoveBookmark,
  onMovePage,
  onOpenPageMenu,
  openSurvey,
  searchValue,
  setSearchValue,
  close,
  panelHeight,
  bottomInset,
}: {
  hubMode: HubMode;
  setHubMode: (mode: HubMode) => void;
  currentPage: number;
  currentPageOrdinal: number;
  setCurrentPage: (page: number) => void;
  markers: Marker[];
  inkMarks: InkMark[];
  bookmarks: BookmarkEntry[];
  pageOrder: number[];
  totalPages: number;
  pageTransforms: Record<number, PageTransformState>;
  pageClipboard: PageClipboard | null;
  onMoveBookmark: (bookmarkId: string, delta: number) => void;
  onMovePage: (page: number, delta: number) => void;
  onOpenPageMenu: (page: number, anchorX: number, anchorY: number) => void;
  openSurvey: (markerId: number) => void;
  searchValue: string;
  setSearchValue: (value: string) => void;
  close: () => void;
  panelHeight: number;
  bottomInset: number;
}) {
  const normalizedSearch = searchValue.trim().toLowerCase();
  const searchResults = normalizedSearch
    ? pdfTextMatches.filter((match) => `${match.title} ${match.excerpt}`.toLowerCase().includes(normalizedSearch))
    : [];

  return (
    <View style={[styles.hubTray, { height: panelHeight, paddingBottom: bottomInset + 14 }]}>
      <View style={styles.hubGrabber} />
      <View style={styles.hubTabs}>
        <HubTab mode="pages" activeMode={hubMode} setHubMode={setHubMode} icon={FileText} label="Pages" />
        <HubTab mode="search" activeMode={hubMode} setHubMode={setHubMode} icon={Search} label="Search" />
        <HubTab mode="bookmarks" activeMode={hubMode} setHubMode={setHubMode} icon={Bookmark} label="Bookmarks" />
        <Pressable accessibilityRole="button" accessibilityLabel="Close document hub" style={styles.hubClose} onPress={close}>
          <X color={colors.text} size={16} />
        </Pressable>
      </View>

      {hubMode === 'pages' ? (
        <>
          <View style={styles.pageCounterRow}>
            <View style={styles.pageCounterPill}>
              <Text style={styles.pageCounterValue}>{currentPageOrdinal}</Text>
            </View>
            <Text style={styles.pageCounterMeta}>/ {totalPages} pages</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pageThumbScroller}
            contentContainerStyle={styles.pageThumbTrack}
          >
            {pageOrder.map((page, index) => (
              <PageThumb
                key={page}
                page={page}
                displayNumber={index + 1}
                active={currentPage === page}
                markers={markers.filter((marker) => marker.page === page)}
                inkMarks={inkMarks.filter((mark) => mark.page === page)}
                transformState={pageTransforms[page]}
                clipboardActive={pageClipboard?.page === page}
                onMove={onMovePage}
                onOpenMenu={onOpenPageMenu}
                onPress={() => setCurrentPage(page)}
              />
            ))}
          </ScrollView>
          <View style={styles.hubActionPill}>
            <Pressable accessibilityRole="button" accessibilityLabel="Add page" style={styles.hubActionButton}>
              <Plus color={colors.text} size={16} />
              <Text style={styles.hubActionText}>Add</Text>
            </Pressable>
            <View style={styles.hubActionDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel="Paste page" style={styles.hubActionButton}>
              <Copy color={colors.text} size={15} />
              <Text style={styles.hubActionText}>Paste</Text>
            </Pressable>
            <View style={styles.hubActionDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel="Select pages" style={styles.hubActionButton}>
              <Check color={colors.text} size={16} />
              <Text style={styles.hubActionText}>Select</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {hubMode === 'search' ? (
        <>
          <View style={styles.searchBox}>
            <Search color={colors.muted} size={17} />
            <TextInput
              value={searchValue}
              onChangeText={setSearchValue}
              placeholder="Search text"
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
            />
          </View>
          {normalizedSearch ? (
            <ScrollView style={styles.resultList}>
              {searchResults.length > 0 ? (
                searchResults.map((match) => (
                  <Pressable key={match.id} style={styles.resultRow} onPress={() => setCurrentPage(match.page)}>
                    <Text style={styles.resultTitle}>{match.title}</Text>
                    <Text style={styles.resultMeta}>Page {match.page} · {match.excerpt}</Text>
                  </Pressable>
                ))
              ) : (
                <View style={styles.searchEmptyState}>
                  <Search color={colors.green} size={44} />
                  <Text style={styles.searchEmptyTitle}>No text matches</Text>
                  <Text style={styles.searchEmptyMeta}>Try another word from the PDF.</Text>
                </View>
              )}
            </ScrollView>
          ) : (
            <View style={styles.searchEmptyState}>
              <Search color={colors.green} size={54} />
              <Text style={styles.searchEmptyTitle}>Looking for a specific word?</Text>
              <Text style={styles.searchEmptyMeta}>Search visible PDF text and jump to the matching page.</Text>
            </View>
          )}
        </>
      ) : null}

      {hubMode === 'bookmarks' ? (
        <View style={styles.bookmarkList}>
          <ScrollView style={styles.bookmarkRows} contentContainerStyle={styles.bookmarkRowsContent} showsVerticalScrollIndicator={bookmarks.length > 4}>
            {bookmarks.length ? (
              [...bookmarks].sort((a, b) => a.order - b.order).map((bookmark, index, ordered) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  first={index === 0}
                  last={index === ordered.length - 1}
                  onMove={onMoveBookmark}
                  onPress={() => {
                    if (bookmark.markerId) {
                      openSurvey(bookmark.markerId);
                      return;
                    }
                    if (bookmark.page) setCurrentPage(bookmark.page);
                  }}
                />
              ))
            ) : (
              <View style={styles.bookmarkEmpty}>
                <Bookmark color={colors.muted} size={20} />
                <Text style={styles.bookmarkEmptyText}>No bookmarks yet</Text>
              </View>
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function HubTab({
  mode,
  activeMode,
  setHubMode,
  icon: Icon,
  label,
}: {
  mode: HubMode;
  activeMode: HubMode;
  setHubMode: (mode: HubMode) => void;
  icon: React.ComponentType<any>;
  label: string;
}) {
  const active = mode === activeMode;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.hubTab, active && styles.hubTabActive]} onPress={() => setHubMode(mode)}>
      <Icon color={active ? colors.green : colors.muted} size={19} />
    </Pressable>
  );
}

function BookmarkRow({
  bookmark,
  first,
  last,
  onMove,
  onPress,
}: {
  bookmark: BookmarkEntry;
  first: boolean;
  last: boolean;
  onMove: (bookmarkId: string, delta: number) => void;
  onPress: () => void;
}) {
  const dragProgressRef = useRef(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7,
        onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const rowStep = 38;
          const delta = Math.trunc((gesture.dy - dragProgressRef.current) / rowStep);
          if (!delta) return;
          dragProgressRef.current += delta * rowStep;
          onMove(bookmark.id, delta);
        },
        onPanResponderRelease: () => {
          dragProgressRef.current = 0;
        },
        onPanResponderTerminate: () => {
          dragProgressRef.current = 0;
        },
      }),
    [bookmark.id, onMove]
  );

  return (
    <View style={[styles.bookmarkItem, { marginLeft: bookmark.depth * 14 }]} {...panResponder.panHandlers}>
      <View style={styles.bookmarkDragHandle}>
        <GripVertical color={colors.faint} size={15} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open bookmark ${bookmark.title}`}
        style={styles.bookmarkOpenArea}
        onPress={onPress}
      >
        <View style={styles.bookmarkIconBubble}>
          {bookmark.type === 'folder' ? <Layers color="#8FB7FF" size={13} /> : <Bookmark color={colors.muted} size={13} />}
        </View>
        <View style={styles.bookmarkCopy}>
          <Text numberOfLines={1} style={styles.bookmarkTitle}>{bookmark.title}</Text>
          <Text style={styles.resultMeta}>{bookmark.page ? `Page ${bookmark.page}` : 'Folder'} · PDF outline</Text>
        </View>
      </Pressable>
      <View style={styles.bookmarkMoveButtons}>
        <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move bookmark up" style={[styles.bookmarkMoveButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMove(bookmark.id, -1)}>
          <ChevronLeft color={first ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
        <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move bookmark down" style={[styles.bookmarkMoveButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMove(bookmark.id, 1)}>
          <ChevronRight color={last ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
      </View>
    </View>
  );
}

function PageThumb({
  page,
  displayNumber,
  active,
  markers,
  inkMarks,
  transformState,
  clipboardActive,
  onMove,
  onOpenMenu,
  onPress,
}: {
  page: number;
  displayNumber: number;
  active: boolean;
  markers: Marker[];
  inkMarks: InkMark[];
  transformState?: PageTransformState;
  clipboardActive: boolean;
  onMove: (page: number, delta: number) => void;
  onOpenMenu: (page: number, anchorX: number, anchorY: number) => void;
  onPress: () => void;
}) {
  const dragProgressRef = useRef(0);
  const dragEnabledRef = useRef(false);
  const suppressPressRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const previewTransform = transformState ?? { rotation: 0, mirrorHorizontal: false, mirrorVertical: false };

  function resetDragState() {
    dragProgressRef.current = 0;
    dragEnabledRef.current = false;
    setDragging(false);
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => dragEnabledRef.current && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onMoveShouldSetPanResponderCapture: (_, gesture) => dragEnabledRef.current && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          const step = 88;
          const delta = Math.trunc((gesture.dx - dragProgressRef.current) / step);
          if (!delta) return;
          dragProgressRef.current += delta * step;
          onMove(page, delta);
        },
        onPanResponderRelease: resetDragState,
        onPanResponderTerminate: resetDragState,
      }),
    [onMove, page]
  );

  return (
    <View style={[styles.pageCard, active && styles.pageCardActive, dragging && styles.pageCardDragging]} {...panResponder.panHandlers}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open page ${displayNumber}`}
        style={styles.pageCardPressArea}
        delayLongPress={320}
        onLongPress={() => {
          dragEnabledRef.current = true;
          suppressPressRef.current = true;
          setDragging(true);
        }}
        onPress={() => {
          if (suppressPressRef.current) {
            suppressPressRef.current = false;
            return;
          }
          onPress();
        }}
      >
        <View
          style={[
            styles.pagePreviewPaper,
            {
              transform: [
                { rotate: `${previewTransform.rotation}deg` },
                { scaleX: previewTransform.mirrorHorizontal ? -1 : 1 },
                { scaleY: previewTransform.mirrorVertical ? -1 : 1 },
              ],
            },
          ]}
        >
          <MiniPagePreview page={page} markers={markers} inkMarks={inkMarks} />
        </View>
      </Pressable>
      <View style={styles.pageCardBadge}>
        <Text style={styles.pageCardBadgeText}>{displayNumber}</Text>
      </View>
      {clipboardActive ? <View style={styles.pageClipboardBadge}><Copy color={colors.green} size={11} /></View> : null}
      {active ? <View style={styles.pageActiveRail} /> : null}
      {dragging ? (
        <View style={styles.pageDragHandle}>
          <GripVertical color={colors.green} size={15} style={{ transform: [{ rotate: '90deg' }] }} />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Page ${displayNumber} actions`}
        hitSlop={8}
        style={styles.pageCardMore}
        onPress={(event) => {
          event.stopPropagation();
          onOpenMenu(page, event.nativeEvent.pageX, event.nativeEvent.pageY);
        }}
      >
        <MoreHorizontal color={colors.muted} size={18} style={{ transform: [{ rotate: '90deg' }] }} />
      </Pressable>
    </View>
  );
}

function MiniPagePreview({ page, markers, inkMarks }: { page: number; markers: Marker[]; inkMarks: InkMark[] }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 92 112">
      <Rect x={0} y={0} width={92} height={112} fill="#FAFAF8" />
      {page === 1 ? (
        <>
          <Rect x={15} y={18} width={62} height={64} fill="none" stroke="#303640" strokeWidth={1.6} />
          <Line x1={39} y1={18} x2={39} y2={53} stroke="#303640" strokeWidth={1.6} />
          <Line x1={15} y1={53} x2={77} y2={53} stroke="#303640" strokeWidth={1.6} />
          <Line x1={58} y1={53} x2={58} y2={82} stroke="#303640" strokeWidth={1.6} />
          <Rect x={20} y={24} width={42} height={33} fill="rgba(74,144,226,0.16)" stroke="#4A90E2" strokeWidth={1.2} />
          <TextSvg x={24} y={33} value="LOBBY" />
          <TextSvg x={52} y={37} value="OFFICE" />
          <TextSvg x={26} y={70} value="RETAIL" />
          <TextSvg x={64} y={70} value="IDF" />
          {inkMarks.map((mark) => (
            <SvgCircle key={mark.id} cx={mark.x * 92} cy={mark.y * 112} r={1.9} fill="#DC3545" />
          ))}
          {markers.map((marker) => {
            const entity = entities.find((item) => item.id === marker.entity);
            return (
              <G key={marker.id}>
                <SvgCircle cx={marker.x * 92} cy={marker.y * 112} r={4.4} fill={entity?.color ?? '#FFF5C3'} stroke="#303640" strokeWidth={0.9} />
              </G>
            );
          })}
        </>
      ) : (
        <>
          <Rect x={18} y={22} width={56} height={68} fill="none" stroke="#303640" strokeWidth={1.4} />
          <Line x1={18} y1={49} x2={74} y2={49} stroke="#303640" strokeWidth={1.4} />
          <Line x1={47} y1={22} x2={47} y2={90} stroke="#303640" strokeWidth={1.4} />
          <TextSvg x={25} y={38} value="FLOOR 2" />
        </>
      )}
    </Svg>
  );
}

function TextSvg({ x, y, value }: { x: number; y: number; value: string }) {
  return (
    <SvgText x={x} y={y} fill="#68707A" fontSize={4.5} fontWeight="800">
      {value}
    </SvgText>
  );
}

function AnnotationFormattingBar({
  activeTool,
  visible,
  surveyToolbarActive,
  regionToolbarActive,
  regionFullPageConfirmOpen,
  mode,
  setMode,
  railWidth,
  topOffset,
  surveyModules,
  selectedSurveyModuleId,
  onSelectSurveyModule,
  surveyKeepCategoryActive,
  setSurveyKeepCategoryActive,
  onRegionConfirm,
  onRegionCancel,
  onRegionFullPage,
  onRegionFullPageConfirm,
  onRegionFullPageCancel,
  onOpenEditPanel,
}: {
  activeTool: ToolId;
  visible: boolean;
  surveyToolbarActive: boolean;
  regionToolbarActive: boolean;
  regionFullPageConfirmOpen: boolean;
  mode: FormatPanelMode;
  setMode: React.Dispatch<React.SetStateAction<FormatPanelMode>>;
  railWidth: number;
  topOffset: number;
  surveyModules: SurveyModule[];
  selectedSurveyModuleId: string | null;
  onSelectSurveyModule: (moduleId: string) => void;
  surveyKeepCategoryActive: boolean;
  setSurveyKeepCategoryActive: React.Dispatch<React.SetStateAction<boolean>>;
  onRegionConfirm: () => void;
  onRegionCancel: () => void;
  onRegionFullPage: () => void;
  onRegionFullPageConfirm: () => void;
  onRegionFullPageCancel: () => void;
  onOpenEditPanel: (config: AnnotationEditConfig) => void;
}) {
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [fillColor, setFillColor] = useState('#ff0000');
  const [fontColor, setFontColor] = useState('#1e293b');
  const [strokeWidthValue, setStrokeWidthValue] = useState('3');
  const [eraserSizeValue, setEraserSizeValue] = useState('16');
  const [eraserMode, setEraserMode] = useState<keyof typeof eraserModeLabels>('partial');
  const [counterSeriesList, setCounterSeriesList] = useState<CounterSeries[]>([
    { seriesId: 'count-1', label: 'Count 1', color: '#ff0000', count: 2 },
  ]);
  const [activeCounterSeriesId, setActiveCounterSeriesId] = useState('count-1');
  const [counterSeriesMenuOpen, setCounterSeriesMenuOpen] = useState(false);
  const [lineBorderStyle, setLineBorderStyle] = useState<keyof typeof lineBorderStyleLabels>('solid');
  const [cloudIntensity, setCloudIntensity] = useState('2');
  const [arrowheadStyle, setArrowheadStyle] = useState<keyof typeof arrowheadStyleLabels>('solidTriangle');
  const [fontSize, setFontSize] = useState('16');
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [strike, setStrike] = useState(false);
  const [alignmentIndex, setAlignmentIndex] = useState(0);
  const [openFormatDropdown, setOpenFormatDropdown] = useState<'surveyModule' | 'eraserMode' | 'lineStyle' | 'arrowhead' | 'fontSize' | null>(null);
  const strokeOnly = ['pen', 'highlighter', 'arrow', 'line'].includes(activeTool);
  const fillAndBorder = ['rect', 'ellipse', 'text', 'callout'].includes(activeTool);
  const isCounter = activeTool === 'counter';
  const supportsWidth = ['pen', 'highlighter', 'arrow', 'line', 'rect', 'ellipse', 'text', 'callout', 'counter'].includes(activeTool) || activeTool === 'eraser';
  const supportsStyle = ['arrow', 'line', 'rect', 'ellipse', 'text', 'callout'].includes(activeTool);
  const styleOptions: LineBorderStyle[] = activeTool === 'rect' ? ['solid', 'dashed', 'dotted', 'cloud'] : ['solid', 'dashed', 'dotted'];
  const supportsText = activeTool === 'text' || activeTool === 'callout';
  const isEraserTool = activeTool === 'eraser';
  const activeCounterSeries = counterSeriesList.find((series) => series.seriesId === activeCounterSeriesId) ?? counterSeriesList[0];
  const selectedSurveyModule = surveyModules.find((module) => module.id === selectedSurveyModuleId) ?? surveyModules[0] ?? null;
  const surveyModuleOptions = surveyModules.map((module) => ({
    value: module.id,
    label: module.name || 'Untitled Module',
  }));
  const eraserModeOptions = (Object.keys(eraserModeLabels) as EraserMode[]).map((value) => ({ value, label: eraserModeLabels[value] }));
  const lineStyleOptions = styleOptions.map((value) => ({ value, label: lineBorderStyleLabels[value] }));
  const arrowheadOptions = (Object.keys(arrowheadStyleLabels) as ArrowheadStyle[]).map((value) => ({ value, label: arrowheadStyleLabels[value] }));

  useEffect(() => {
    setOpenFormatDropdown(null);
  }, [activeTool]);

  useEffect(() => {
    if (!isCounter) {
      setCounterSeriesMenuOpen(false);
    }
  }, [isCounter]);

  function setActiveCounterSeries(series: CounterSeries) {
    setActiveCounterSeriesId(series.seriesId);
    setFillColor(series.color);
    setCounterSeriesMenuOpen(false);
  }

  function createCounterSeries() {
    const index = counterSeriesList.length;
    const nextSeries = {
      seriesId: `count-${index + 1}`,
      label: `Count ${index + 1}`,
      color: counterSeriesColors[index % counterSeriesColors.length],
      count: 0,
    };
    setCounterSeriesList((current) => [...current, nextSeries]);
    setActiveCounterSeries(nextSeries);
  }

  function updateCounterFillColor(nextColor: string) {
    setFillColor(nextColor);
    if (activeCounterSeries) {
      setCounterSeriesList((current) => current.map((series) => (
        series.seriesId === activeCounterSeries.seriesId
          ? { ...series, color: nextColor }
          : series
      )));
    }
  }

  function closeFormatterMenus() {
    setCounterSeriesMenuOpen(false);
    setOpenFormatDropdown(null);
  }

  function openEditPanel(focus: AnnotationEditFocus) {
    const sections: AnnotationEditFocus[] = [];
    if (fillAndBorder || isCounter) sections.push('fill');
    if (strokeOnly || fillAndBorder || isCounter) sections.push('stroke');
    if (supportsText) sections.push('text');

    Keyboard.dismiss();
    closeFormatterMenus();
    onOpenEditPanel({
      tool: activeTool,
      focus,
      sections: sections.includes(focus) ? sections : [focus, ...sections],
      fillColor,
      strokeColor,
      fontColor,
      setFillColor: isCounter ? updateCounterFillColor : setFillColor,
      setStrokeColor,
      setFontColor,
      strokeWidthValue,
      setStrokeWidthValue,
      eraserSizeValue,
      setEraserSizeValue,
      eraserMode,
      setEraserMode,
      lineBorderStyle,
      setLineBorderStyle,
      cloudIntensity,
      setCloudIntensity,
      arrowheadStyle,
      setArrowheadStyle,
      fontSize,
      setFontSize,
      bold,
      setBold,
      italic,
      setItalic,
      underline,
      setUnderline,
      strike,
      setStrike,
      alignmentIndex,
      setAlignmentIndex,
      counterSeriesLabel: activeCounterSeries?.label,
    });
  }

  function toggleFormatDropdown(key: 'surveyModule' | 'eraserMode' | 'lineStyle' | 'arrowhead' | 'fontSize') {
    Keyboard.dismiss();
    setCounterSeriesMenuOpen(false);
    setOpenFormatDropdown((current) => (current === key ? null : key));
  }

  if (!visible) return null;

  return (
    <View style={[styles.annotationFormatLayer, { left: railWidth, top: topOffset }]} pointerEvents="box-none">
      <View style={styles.annotationFormatBar}>
        <View style={styles.annotationFormatCenter}>
          {regionToolbarActive ? (
            regionFullPageConfirmOpen ? (
              <>
                <Text numberOfLines={1} style={styles.regionConfirmText}>Make region full page?</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Confirm full page region" style={[styles.regionFormatButton, styles.regionFormatButtonPrimary]} onPress={onRegionFullPageConfirm}>
                  <Check color="#FFFFFF" size={15} strokeWidth={2.6} />
                  <Text style={styles.regionFormatButtonTextPrimary}>Confirm</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel full page region" style={styles.regionFormatButton} onPress={onRegionFullPageCancel}>
                  <X color={colors.text} size={15} strokeWidth={2.4} />
                  <Text style={styles.regionFormatButtonText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Confirm region edits" style={[styles.regionFormatButton, styles.regionFormatButtonPrimary]} onPress={onRegionConfirm}>
                  <Check color="#FFFFFF" size={15} strokeWidth={2.6} />
                  <Text style={styles.regionFormatButtonTextPrimary}>Confirm</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Set region to full page" style={styles.regionFormatButton} onPress={onRegionFullPage}>
                  <Square color={colors.text} size={15} strokeWidth={2.2} />
                  <Text style={styles.regionFormatButtonText}>Full Page</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel region edits" style={styles.regionFormatButton} onPress={onRegionCancel}>
                  <X color={colors.text} size={15} strokeWidth={2.4} />
                  <Text style={styles.regionFormatButtonText}>Cancel</Text>
                </Pressable>
              </>
            )
          ) : surveyToolbarActive ? (
            <>
              {selectedSurveyModule ? (
                <FormatDropdownButton
                  label={selectedSurveyModule.name || 'Untitled Module'}
                  minWidth={138}
                  open={openFormatDropdown === 'surveyModule'}
                  options={surveyModuleOptions}
                  value={selectedSurveyModule.id}
                  onToggle={() => toggleFormatDropdown('surveyModule')}
                  onSelect={(value) => {
                    onSelectSurveyModule(value);
                    setOpenFormatDropdown(null);
                  }}
                />
              ) : (
                <View style={styles.surveyModuleEmptyPill}>
                  <Text style={styles.surveyModuleEmptyText}>No modules</Text>
                </View>
              )}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: surveyKeepCategoryActive }}
                accessibilityLabel="Keep survey category active"
                style={[styles.formatKeepActiveButton, surveyKeepCategoryActive && styles.formatKeepActiveButtonActive]}
                onPress={() => setSurveyKeepCategoryActive((value) => !value)}
              >
                <View style={[styles.formatKeepActiveBox, surveyKeepCategoryActive && styles.formatKeepActiveBoxActive]}>
                  {surveyKeepCategoryActive ? <Check color="#FFFFFF" size={10} strokeWidth={3} /> : null}
                </View>
                <Text style={[styles.formatKeepActiveText, surveyKeepCategoryActive && styles.formatKeepActiveTextActive]}>Keep active</Text>
              </Pressable>
            </>
          ) : isEraserTool ? (
            <>
              <FormatDropdownButton
                label={eraserModeLabels[eraserMode]}
                minWidth={104}
                open={openFormatDropdown === 'eraserMode'}
                options={eraserModeOptions}
                value={eraserMode}
                onToggle={() => toggleFormatDropdown('eraserMode')}
                onSelect={(value) => {
                  setEraserMode(value);
                  setOpenFormatDropdown(null);
                }}
              />
              <FormatNumberInput accessibilityLabel="Eraser size" value={eraserSizeValue} onChangeText={setEraserSizeValue} onFocusInput={closeFormatterMenus} />
            </>
          ) : (
            <>
              {strokeOnly ? (
                <FormatColorSwatch
                  accessibilityLabel="Color"
                  mode="stroke"
                  strokeColor={strokeColor}
                  fillColor={strokeColor}
                  onPress={() => openEditPanel('stroke')}
                />
              ) : null}
              {isCounter ? (
                <FormatColorSwatch
                  accessibilityLabel="Counter colors"
                  mode="counter"
                  strokeColor={strokeColor}
                  fillColor={fillColor}
                  onPress={() => openEditPanel('fill')}
                />
              ) : null}
              {isCounter ? (
                <View style={styles.counterSeriesMenuAnchor}>
                  <FormatMenuButton
                    label={activeCounterSeries?.label || 'Counter Series'}
                    onPress={() => {
                      Keyboard.dismiss();
                      setOpenFormatDropdown(null);
                      setCounterSeriesMenuOpen((open) => !open);
                    }}
                    minWidth={94}
                  />
                  {counterSeriesMenuOpen ? (
                    <View style={styles.counterSeriesDropdown}>
                      <Text style={styles.counterSeriesHeader}>Counter Series</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="New count"
                        style={styles.counterSeriesRow}
                        onPress={createCounterSeries}
                      >
                        <Text style={styles.counterSeriesLabel}>+ New Count</Text>
                      </Pressable>
                      {counterSeriesList.length > 0 ? <Text style={styles.counterSeriesSubheader}>Continue Count</Text> : null}
                      {counterSeriesList.map((series) => {
                        const active = series.seriesId === activeCounterSeries?.seriesId;
                        return (
                          <Pressable
                            key={series.seriesId}
                            accessibilityRole="button"
                            accessibilityLabel={series.label}
                            accessibilityState={{ selected: active }}
                            style={[styles.counterSeriesRow, active && styles.counterSeriesRowActive]}
                            onPress={() => setActiveCounterSeries(series)}
                          >
                            <View style={[styles.counterSeriesDot, { backgroundColor: series.color }]} />
                            <Text style={styles.counterSeriesLabel}>{series.label}</Text>
                            <Text style={styles.counterSeriesCount}>{series.count}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {fillAndBorder ? (
                <FormatColorSwatch
                  accessibilityLabel="Color"
                  mode="fillBorder"
                  strokeColor={strokeColor}
                  fillColor={fillColor}
                  onPress={() => openEditPanel('fill')}
                />
              ) : null}
              {supportsWidth ? (
                <FormatNumberInput accessibilityLabel="Width" value={strokeWidthValue} onChangeText={setStrokeWidthValue} onFocusInput={closeFormatterMenus} />
              ) : null}
              {supportsStyle ? (
                <FormatDropdownButton
                  label={lineBorderStyleLabels[lineBorderStyle]}
                  minWidth={82}
                  open={openFormatDropdown === 'lineStyle'}
                  options={lineStyleOptions}
                  value={lineBorderStyle}
                  onToggle={() => toggleFormatDropdown('lineStyle')}
                  onSelect={(value) => {
                    setLineBorderStyle(value);
                    setOpenFormatDropdown(null);
                  }}
                />
              ) : null}
              {activeTool === 'rect' && lineBorderStyle === 'cloud' ? (
                <View style={styles.bumpControl}>
                  <Text style={styles.bumpLabel}>Bump</Text>
                  <FormatNumberInput accessibilityLabel="Cloud bump size" value={cloudIntensity} onChangeText={setCloudIntensity} onFocusInput={closeFormatterMenus} />
                </View>
              ) : null}
              {(activeTool === 'arrow' || activeTool === 'callout') ? (
                <FormatDropdownButton
                  label={arrowheadStyleLabels[arrowheadStyle]}
                  minWidth={124}
                  open={openFormatDropdown === 'arrowhead'}
                  options={arrowheadOptions}
                  value={arrowheadStyle}
                  onToggle={() => toggleFormatDropdown('arrowhead')}
                  onSelect={(value) => {
                    setArrowheadStyle(value);
                    setOpenFormatDropdown(null);
                  }}
                />
              ) : null}
              {supportsText ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Text formatting"
                  style={styles.formatTextModeButton}
                  onPress={() => {
                    setMode('presets');
                    closeFormatterMenus();
                    openEditPanel('text');
                  }}
                >
                  <Text style={styles.formatPillText}>Aa</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function FormatColorSwatch({
  mode,
  strokeColor,
  fillColor,
  accessibilityLabel,
  onPress,
}: {
  mode: 'stroke' | 'fillBorder' | 'counter';
  strokeColor: string;
  fillColor: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.contextColorSwatch,
        mode === 'fillBorder' && { borderWidth: 2, borderColor: strokeColor },
      ]}
      onPress={onPress}
    >
      <View style={styles.checkerCellOne} />
      <View style={styles.checkerCellTwo} />
      <View style={[styles.contextColorFill, { backgroundColor: fillColor }]} />
      {mode === 'counter' ? <Text style={[styles.counterSwatchText, { color: strokeColor }]}>1</Text> : null}
    </Pressable>
  );
}

function FormatNumberInput({
  value,
  onChangeText,
  accessibilityLabel,
  onFocusInput,
}: {
  value: string;
  onChangeText: (value: string) => void;
  accessibilityLabel: string;
  onFocusInput?: () => void;
}) {
  const fallbackValueRef = useRef(value || '0');
  const draftValueRef = useRef(value);

  useEffect(() => {
    draftValueRef.current = value;
    if (value !== '') fallbackValueRef.current = value;
  }, [value]);

  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      keyboardType="number-pad"
      value={value}
      selectTextOnFocus
      returnKeyType="done"
      onFocus={() => {
        onFocusInput?.();
        fallbackValueRef.current = value || fallbackValueRef.current;
        draftValueRef.current = value;
      }}
      onChangeText={(next) => {
        if (next === '' || /^\d+$/.test(next)) {
          draftValueRef.current = next;
          onChangeText(next);
        }
      }}
      onBlur={() => {
        if (draftValueRef.current === '') {
          onChangeText(fallbackValueRef.current);
        } else {
          fallbackValueRef.current = draftValueRef.current;
        }
      }}
      onSubmitEditing={() => Keyboard.dismiss()}
      style={styles.desktopNumberInput}
    />
  );
}

function FormatMenuButton({ label, onPress, minWidth }: { label: string; onPress: () => void; minWidth: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.desktopMenuButton, { minWidth }]} onPress={onPress}>
      <Text style={styles.desktopMenuButtonText} numberOfLines={1}>{label}</Text>
      <ChevronDown color="#aaa" size={10} strokeWidth={2.4} />
    </Pressable>
  );
}

function FormatDropdownButton<T extends string>({
  label,
  minWidth,
  open,
  options,
  value,
  onToggle,
  onSelect,
}: {
  label: string;
  minWidth: number;
  open: boolean;
  options: Array<{ value: T; label: string }>;
  value: T;
  onToggle: () => void;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={[styles.formatDropdownAnchor, { width: minWidth }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        style={[styles.desktopMenuButton, { width: minWidth }]}
        onPress={onToggle}
      >
        <Text style={styles.desktopMenuButtonText} numberOfLines={1}>{label}</Text>
        <ChevronDown color="#aaa" size={10} strokeWidth={2.4} />
      </Pressable>
      {open ? (
        <View style={[styles.formatDropdownMenu, { width: minWidth }]}>
          <ScrollView style={styles.formatDropdownScroll} showsVerticalScrollIndicator={options.length > 4}>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: active }}
                  style={[styles.formatDropdownRow, active && styles.formatDropdownRowActive]}
                  onPress={() => onSelect(option.value)}
                >
                  <Text style={[styles.formatDropdownText, active && styles.formatDropdownTextActive]} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {active ? <Check color={colors.blue} size={13} strokeWidth={2.4} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function AnnotationEditPanel({
  config,
  panelHeight,
  bottomInset,
  dismissRequest,
  onClose,
}: {
  config: AnnotationEditConfig;
  panelHeight: number;
  bottomInset: number;
  dismissRequest: number;
  onClose: () => void;
}) {
  const slideY = useRef(new Animated.Value(panelHeight + bottomInset)).current;
  const openedOnceRef = useRef(false);
  const handledDismissRequestRef = useRef(dismissRequest);
  const initialTextEditTab = config.focus === 'text' ? 'text' : 'shape';
  const [activeSection, setActiveSection] = useState<AnnotationEditFocus>(config.focus);
  const [activeTextEditTab, setActiveTextEditTab] = useState<'shape' | 'text'>(initialTextEditTab);
  const [fillColor, setFillColorLocal] = useState(config.fillColor);
  const [strokeColor, setStrokeColorLocal] = useState(config.strokeColor);
  const [fontColor, setFontColorLocal] = useState(config.fontColor);
  const [strokeWidth, setStrokeWidthLocal] = useState(config.strokeWidthValue);
  const [eraserSize, setEraserSizeLocal] = useState(config.eraserSizeValue);
  const [eraserMode, setEraserModeLocal] = useState<EraserMode>(config.eraserMode);
  const [lineStyle, setLineStyleLocal] = useState<LineBorderStyle>(config.lineBorderStyle);
  const [cloudIntensity, setCloudIntensityLocal] = useState(config.cloudIntensity);
  const [arrowheadStyle, setArrowheadStyleLocal] = useState<ArrowheadStyle>(config.arrowheadStyle);
  const [fontSize, setFontSizeLocal] = useState(config.fontSize);
  const [bold, setBoldLocal] = useState(config.bold);
  const [italic, setItalicLocal] = useState(config.italic);
  const [underline, setUnderlineLocal] = useState(config.underline);
  const [strike, setStrikeLocal] = useState(config.strike);
  const [alignmentIndex, setAlignmentIndexLocal] = useState(config.alignmentIndex);
  const [openEditDropdown, setOpenEditDropdown] = useState<'lineStyle' | 'arrowhead' | null>(null);
  const [gradientPickerSection, setGradientPickerSection] = useState<AnnotationEditFocus | null>(null);
  const [gradientHexDraft, setGradientHexDraft] = useState('');
  const [gradientOpacity, setGradientOpacity] = useState(100);
  const [gradientSquareSize, setGradientSquareSize] = useState({ width: 1, height: 1 });
  const [gradientHueWidth, setGradientHueWidth] = useState(1);
  const [gradientOpacityWidth, setGradientOpacityWidth] = useState(1);
  const toolTitle = formatToolTitle[config.tool] ?? 'Annotation';
  const widthTools: ToolId[] = ['pen', 'highlighter', 'arrow', 'line', 'rect', 'ellipse', 'text', 'callout', 'counter', 'eraser'];
  const styleTools: ToolId[] = ['arrow', 'line', 'rect', 'ellipse', 'text', 'callout'];
  const supportsWidth = widthTools.includes(config.tool);
  const supportsStyle = styleTools.includes(config.tool);
  const supportsText = config.tool === 'text' || config.tool === 'callout';
  const supportsShapeTextTabs = supportsText;
  const lineStyleOptions: LineBorderStyle[] = config.tool === 'rect' ? ['solid', 'dashed', 'dotted', 'cloud'] : ['solid', 'dashed', 'dotted'];
  const arrowheadOptions = Object.keys(arrowheadStyleLabels) as ArrowheadStyle[];
  const activePanelLabel = supportsShapeTextTabs
    ? activeTextEditTab === 'text' ? 'Text' : 'Shape'
    : annotationEditSectionLabel(activeSection, config.tool);
  const pickerPanelLabel = gradientPickerSection ? annotationEditSectionLabel(gradientPickerSection, config.tool) : activePanelLabel;
  const annotationPanelHeight = useMemo(() => {
    const headerChrome = 58;
    const tabsChrome = supportsShapeTextTabs && !gradientPickerSection ? 46 : 0;
    const scrollChrome = 12 + Math.max(bottomInset, 10) + 12;
    const colorCardHeight = (hasTabs: boolean, compact = false) => (
      hasTabs ? 148 : compact ? 88 : 104
    );
    const splitControlHeight = config.tool === 'eraser' ? 112 : 82;
    const textControlsHeight = 82 + 10 + 114;
    const gradientTabsHeight = colorPickerTabsForCurrentMode()?.length ? 46 : 0;

    let contentHeight = headerChrome + tabsChrome + scrollChrome;
    if (gradientPickerSection) {
      contentHeight += gradientTabsHeight + 176 + 28 + 28 + 1 + 48 + 42 + 60;
      return Math.min(panelHeight, contentHeight);
    }

    if (supportsText && activeTextEditTab === 'shape') {
      contentHeight += colorCardHeight(true);
    } else if (supportsText && activeTextEditTab === 'text') {
      contentHeight += colorCardHeight(false, true);
    } else {
      contentHeight += colorCardHeight(config.sections.length > 1);
    }

    if ((supportsWidth || supportsStyle) && (!supportsShapeTextTabs || activeTextEditTab === 'shape')) {
      contentHeight += 10 + splitControlHeight;
    }

    if (config.tool === 'arrow' || (config.tool === 'callout' && activeTextEditTab === 'shape')) {
      contentHeight += 10 + 70;
    }

    if (supportsText && activeTextEditTab === 'text') {
      contentHeight += 10 + textControlsHeight;
    }

    return Math.min(panelHeight, contentHeight);
  }, [
    activeTextEditTab,
    bottomInset,
    config.sections.length,
    config.tool,
    gradientPickerSection,
    panelHeight,
    supportsShapeTextTabs,
    supportsStyle,
    supportsText,
    supportsWidth,
  ]);

  useEffect(() => {
    setActiveSection(config.focus);
    setActiveTextEditTab(config.focus === 'text' ? 'text' : 'shape');
    setFillColorLocal(config.fillColor);
    setStrokeColorLocal(config.strokeColor);
    setFontColorLocal(config.fontColor);
    setStrokeWidthLocal(config.strokeWidthValue);
    setEraserSizeLocal(config.eraserSizeValue);
    setEraserModeLocal(config.eraserMode);
    setLineStyleLocal(config.lineBorderStyle);
    setCloudIntensityLocal(config.cloudIntensity);
    setArrowheadStyleLocal(config.arrowheadStyle);
    setFontSizeLocal(config.fontSize);
    setBoldLocal(config.bold);
    setItalicLocal(config.italic);
    setUnderlineLocal(config.underline);
    setStrikeLocal(config.strike);
    setAlignmentIndexLocal(config.alignmentIndex);
    setOpenEditDropdown(null);
    setGradientPickerSection(null);
    setGradientHexDraft('');
    setGradientOpacity(100);
  }, [config]);

  const closeWithAnimation = () => {
    Animated.timing(slideY, {
      toValue: annotationPanelHeight + bottomInset,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) slideY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 82 || gesture.vy > 0.65) {
            closeWithAnimation();
            return;
          }
          Animated.spring(slideY, {
            toValue: 0,
            damping: 24,
            stiffness: 260,
            mass: 0.75,
            useNativeDriver: true,
          }).start();
        },
      }),
    [slideY, annotationPanelHeight, bottomInset]
  );

  useEffect(() => {
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    slideY.setValue(annotationPanelHeight + bottomInset);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideY, annotationPanelHeight, bottomInset]);

  useEffect(() => {
    if (dismissRequest === handledDismissRequestRef.current) return;
    handledDismissRequestRef.current = dismissRequest;
    Animated.timing(slideY, {
      toValue: annotationPanelHeight + bottomInset,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [dismissRequest, slideY, annotationPanelHeight, bottomInset, onClose]);

  function applyColor(section: AnnotationEditFocus, value: string) {
    if (section === 'stroke') {
      setOpenEditDropdown(null);
      setStrokeColorLocal(value);
      config.setStrokeColor(value);
      return;
    }
    if (section === 'text') {
      setOpenEditDropdown(null);
      setFontColorLocal(value);
      config.setFontColor(value);
      return;
    }
    setOpenEditDropdown(null);
    setFillColorLocal(value);
    config.setFillColor(value);
  }

  function applyStrokeWidth(value: string) {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setStrokeWidthLocal(value);
    config.setStrokeWidthValue(value);
  }

  function applyEraserSize(value: string) {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setEraserSizeLocal(value);
    config.setEraserSizeValue(value);
  }

  function applyFontSize(value: string) {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setFontSizeLocal(value);
    config.setFontSize(value);
  }

  const horizontalAlignment = alignmentIndex % 3;
  const verticalAlignment = Math.floor(alignmentIndex / 3);
  const horizontalAlignmentOptions = [
    { value: 0, label: 'Left' },
    { value: 1, label: 'Center' },
    { value: 2, label: 'Right' },
  ];
  const verticalAlignmentOptions = [
    { value: 0, label: 'Top' },
    { value: 1, label: 'Center' },
    { value: 2, label: 'Bottom' },
  ];

  function applyTextAlignment(nextHorizontal: number, nextVertical: number) {
    const next = (nextVertical * 3) + nextHorizontal;
    setAlignmentIndexLocal(next);
    config.setAlignmentIndex(next);
  }

  function colorForSection(section: AnnotationEditFocus) {
    if (section === 'stroke') return strokeColor;
    if (section === 'text') return fontColor;
    return fillColor;
  }

  function openGradientPicker(section: AnnotationEditFocus) {
    setActiveSection(section);
    setOpenEditDropdown(null);
    setGradientPickerSection(section);
    setGradientHexDraft(colorForSection(section).toUpperCase());
  }

  function applyGradientHex(section: AnnotationEditFocus, value: string) {
    const normalized = normalizeHexColor(value);
    setGradientHexDraft(value.toUpperCase());
    if (!normalized) return;
    applyColor(section, normalized);
    setGradientHexDraft(normalized);
  }

  function commitGradientHex(section: AnnotationEditFocus) {
    const normalized = normalizeHexColor(gradientHexDraft);
    if (normalized) {
      applyColor(section, normalized);
      setGradientHexDraft(normalized);
      return;
    }
    setGradientHexDraft(colorForSection(section).toUpperCase());
  }

  function colorPickerTabsForCurrentMode() {
    if (supportsText && activeTextEditTab === 'shape') return ['fill', 'stroke'] as AnnotationEditFocus[];
    if (!supportsShapeTextTabs && config.sections.length > 1) return config.sections;
    return undefined;
  }

  function pickGradientSquare(section: AnnotationEditFocus, event: GestureResponderEvent) {
    const hsv = hexToHsv(colorForSection(section));
    const saturation = clampValue(event.nativeEvent.locationX / gradientSquareSize.width, 0, 1);
    const value = clampValue(1 - (event.nativeEvent.locationY / gradientSquareSize.height), 0, 1);
    const nextColor = hsvToHex(hsv.h, saturation, value);
    applyColor(section, nextColor);
    setGradientHexDraft(nextColor);
  }

  function pickGradientHue(section: AnnotationEditFocus, event: GestureResponderEvent) {
    const hsv = hexToHsv(colorForSection(section));
    const hue = clampValue(event.nativeEvent.locationX / gradientHueWidth, 0, 1) * 360;
    const nextColor = hsvToHex(hue, hsv.s, hsv.v);
    applyColor(section, nextColor);
    setGradientHexDraft(nextColor);
  }

  function pickGradientOpacity(event: GestureResponderEvent) {
    setGradientOpacity(Math.round(clampValue(event.nativeEvent.locationX / gradientOpacityWidth, 0, 1) * 100));
  }

  function renderGradientColorPicker(section: AnnotationEditFocus) {
    const sectionColor = colorForSection(section);
    const sectionLabel = annotationEditSectionLabel(section, config.tool);
    const hsv = hexToHsv(sectionColor);
    const hueColor = hsvToHex(hsv.h, 1, 1);
    const tabSections = colorPickerTabsForCurrentMode();
    const hueThumbLeft = gradientHueWidth * clampValue(hsv.h / 360, 0, 1);
    const saturationLeft = gradientSquareSize.width * clampValue(hsv.s, 0, 1);
    const valueTop = gradientSquareSize.height * (1 - clampValue(hsv.v, 0, 1));
    const opacityWidth = gradientOpacityWidth * (gradientOpacity / 100);

    return (
      <View style={styles.gradientPickerContent}>
        {tabSections && tabSections.length > 1 ? (
          <View style={styles.annotationColorTabs}>
            {tabSections.map((tabSection, index) => {
              const active = tabSection === section;
              return (
                <React.Fragment key={`gradient-${tabSection}`}>
                  {index > 0 ? <View style={styles.annotationColorTabsDivider} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${annotationEditSectionLabel(tabSection, config.tool)} color`}
                    accessibilityState={{ selected: active }}
                    style={[styles.annotationColorTab, active && styles.annotationColorTabActive]}
                    onPress={() => openGradientPicker(tabSection)}
                  >
                    <View style={[styles.annotationEditTabSwatch, { backgroundColor: colorForSection(tabSection) }]} />
                    <Text style={[styles.annotationColorTabText, active && styles.annotationColorTabTextActive]}>
                      {annotationEditSectionLabel(tabSection, config.tool)}
                    </Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={`${sectionLabel} saturation and brightness`}
          onLayout={(event) => setGradientSquareSize(event.nativeEvent.layout)}
          onPress={(event) => pickGradientSquare(section, event)}
          style={styles.gradientPickerSquare}
        >
          <Svg width="100%" height="100%" viewBox="0 0 320 176" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
            <Defs>
              <SvgLinearGradient id={`sat-${section}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" />
                <Stop offset="1" stopColor={hueColor} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`val-${section}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000000" stopOpacity="1" />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="320" height="176" fill={`url(#sat-${section})`} />
            <Rect x="0" y="0" width="320" height="176" fill={`url(#val-${section})`} />
          </Svg>
          <View style={[styles.gradientPickerThumb, { left: saturationLeft, top: valueTop }]} />
        </Pressable>

        <View style={styles.gradientPickerRow}>
          <Text style={styles.gradientPickerLabel}>HUE</Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`${sectionLabel} hue`}
            onLayout={(event) => setGradientHueWidth(event.nativeEvent.layout.width)}
            onPress={(event) => pickGradientHue(section, event)}
            style={styles.gradientHueTrack}
          >
            <Svg width="100%" height="100%" viewBox="0 0 320 16" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinearGradient id={`hue-${section}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#FF0000" />
                  <Stop offset="0.17" stopColor="#FFFF00" />
                  <Stop offset="0.33" stopColor="#00FF00" />
                  <Stop offset="0.5" stopColor="#00FFFF" />
                  <Stop offset="0.67" stopColor="#0000FF" />
                  <Stop offset="0.83" stopColor="#FF00FF" />
                  <Stop offset="1" stopColor="#FF0000" />
                </SvgLinearGradient>
              </Defs>
              <Rect x="0" y="0" width="320" height="16" rx="8" fill={`url(#hue-${section})`} />
            </Svg>
            <View style={[styles.gradientHueThumb, { left: hueThumbLeft }]} />
          </Pressable>
          <Text style={styles.gradientPickerValue}>{Math.round(hsv.h)}°</Text>
        </View>

        <View style={styles.gradientPickerRow}>
          <Text style={styles.gradientPickerLabel}>OPACITY</Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`${sectionLabel} opacity`}
            onLayout={(event) => setGradientOpacityWidth(event.nativeEvent.layout.width)}
            onPress={pickGradientOpacity}
            style={styles.gradientOpacityTrack}
          >
            <View style={[styles.gradientOpacityFill, { width: opacityWidth }]} />
            <View style={[styles.gradientOpacityThumb, { left: opacityWidth }]} />
          </Pressable>
          <Text style={styles.gradientPickerValue}>{gradientOpacity}%</Text>
        </View>

        <View style={styles.gradientPickerDivider} />

        <View style={styles.gradientPickerInputRow}>
          <View style={[styles.gradientPickerPreview, { backgroundColor: sectionColor }]} />
          <TextInput
            accessibilityLabel={`${sectionLabel} hex color`}
            autoCapitalize="characters"
            autoCorrect={false}
            value={gradientHexDraft || sectionColor.toUpperCase()}
            onChangeText={(value) => applyGradientHex(section, value)}
            onBlur={() => commitGradientHex(section)}
            style={styles.gradientPickerHexInput}
          />
          <View style={styles.gradientPickerOpacityInput}>
            <TextInput
              accessibilityLabel={`${sectionLabel} opacity percent`}
              keyboardType="number-pad"
              value={String(gradientOpacity)}
              onChangeText={(value) => {
                if (value !== '' && !/^\d+$/.test(value)) return;
                setGradientOpacity(value === '' ? 100 : clampValue(Number(value), 0, 100));
              }}
              style={styles.gradientPickerOpacityTextInput}
            />
            <Text style={styles.gradientPickerPercentText}>%</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to annotation settings"
          style={styles.gradientPickerDoneButton}
          onPress={() => {
            Keyboard.dismiss();
            setGradientPickerSection(null);
            setGradientHexDraft('');
          }}
        >
          <Text style={styles.gradientPickerDoneText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  function renderColorCard(section: AnnotationEditFocus, compact = false, tabSections?: AnnotationEditFocus[]) {
    const sectionColor = colorForSection(section);
    const sectionLabel = annotationEditSectionLabel(section, config.tool);

    return (
      <View style={[styles.annotationEditCard, compact && styles.annotationEditCardCompact]} key={`${section}-color-card`}>
        {tabSections && tabSections.length > 1 ? (
          <View style={styles.annotationColorTabs}>
            {tabSections.map((tabSection, index) => {
              const active = tabSection === section;
              return (
                <React.Fragment key={tabSection}>
                  {index > 0 ? <View style={styles.annotationColorTabsDivider} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${annotationEditSectionLabel(tabSection, config.tool)} color`}
                    accessibilityState={{ selected: active }}
                    style={[styles.annotationColorTab, active && styles.annotationColorTabActive]}
                    onPress={() => {
                      setActiveSection(tabSection);
                      setOpenEditDropdown(null);
                    }}
                  >
                    <View style={[styles.annotationEditTabSwatch, { backgroundColor: colorForSection(tabSection) }]} />
                    <Text style={[styles.annotationColorTabText, active && styles.annotationColorTabTextActive]}>
                      {annotationEditSectionLabel(tabSection, config.tool)}
                    </Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        ) : null}
        <View style={styles.annotationEditCardHeader}>
          <View>
            <Text style={styles.annotationEditLabel}>{sectionLabel} color</Text>
            <Text style={styles.annotationEditValue}>{sectionColor.toUpperCase()}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${sectionLabel} color picker`}
            hitSlop={8}
            style={styles.annotationEditSwatchButton}
            onPress={() => openGradientPicker(section)}
          >
            <View
              style={[
                styles.annotationEditLargeSwatch,
                compact && styles.annotationEditCompactSwatch,
                { backgroundColor: sectionColor, borderColor: section === 'fill' ? strokeColor : '#454B56' },
              ]}
            />
          </Pressable>
        </View>
        <View style={styles.annotationColorGrid}>
          {annotationColorChoices.map((color) => {
            const active = color.toLowerCase() === sectionColor.toLowerCase();
            return (
              <Pressable
                key={`${section}-${color}`}
                accessibilityRole="button"
                accessibilityLabel={`Set ${sectionLabel} color ${color}`}
                accessibilityState={{ selected: active }}
                hitSlop={4}
                style={[styles.annotationColorChoice, active && styles.annotationColorChoiceActive]}
                onPress={() => applyColor(section, color)}
              >
                <View style={[styles.annotationColorDot, { backgroundColor: color }]} />
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.annotationEditSheet,
        { height: annotationPanelHeight, transform: [{ translateY: slideY }] },
      ]}
    >
      <View {...panResponder.panHandlers}>
        <View style={styles.hubGrabber} />
        <View style={styles.drawerHeader}>
          <View>
            <Text style={styles.drawerTitle}>{gradientPickerSection ? `${pickerPanelLabel} color` : `${toolTitle} settings`}</Text>
            <Text style={styles.drawerSubtitle}>{gradientPickerSection ? 'Gradient picker' : `Focused on ${activePanelLabel}`}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close annotation settings" onPress={closeWithAnimation}>
            <X color={colors.text} size={18} />
          </Pressable>
        </View>
      </View>

      {supportsShapeTextTabs && !gradientPickerSection ? (
        <View style={styles.annotationEditTabs}>
          <View style={styles.annotationEditSegmentedTabs}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Shape settings"
              accessibilityState={{ selected: activeTextEditTab === 'shape' }}
              style={[styles.annotationEditSegmentedTab, activeTextEditTab === 'shape' && styles.annotationEditSegmentedTabActive]}
              onPress={() => {
                setActiveTextEditTab('shape');
                setOpenEditDropdown(null);
              }}
            >
              <Text style={[styles.annotationEditTabText, activeTextEditTab === 'shape' && styles.annotationEditTabTextActive]}>
                Shape
              </Text>
            </Pressable>
            <View style={styles.annotationEditSegmentedDivider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Text settings"
              accessibilityState={{ selected: activeTextEditTab === 'text' }}
              style={[styles.annotationEditSegmentedTab, activeTextEditTab === 'text' && styles.annotationEditSegmentedTabActive]}
              onPress={() => {
                setActiveTextEditTab('text');
                setOpenEditDropdown(null);
              }}
            >
              <Text style={[styles.annotationEditTabText, activeTextEditTab === 'text' && styles.annotationEditTabTextActive]}>
                Text
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.annotationEditScroll}
        contentContainerStyle={[styles.annotationEditContent, { paddingBottom: Math.max(bottomInset, 10) + 6 }]}
        showsVerticalScrollIndicator={false}
      >
        {gradientPickerSection ? renderGradientColorPicker(gradientPickerSection) : (
          <>
            {supportsText && activeTextEditTab === 'shape' ? (
              renderColorCard(activeSection === 'stroke' ? 'stroke' : 'fill', false, ['fill', 'stroke'])
            ) : null}

            {supportsText && activeTextEditTab === 'text' ? renderColorCard('text', true) : null}

            {!supportsShapeTextTabs ? renderColorCard(activeSection, false, config.sections.length > 1 ? config.sections : undefined) : null}
          </>
        )}

        {!gradientPickerSection && (supportsWidth || supportsStyle) && (!supportsShapeTextTabs || activeTextEditTab === 'shape') ? (
          <View style={[styles.annotationEditCard, styles.annotationSplitControlCard]}>
            {supportsStyle ? (
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>Stroke style</Text>
                <View style={[styles.annotationDropdownWrap, styles.annotationDropdownFullWidth]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Stroke style"
                    accessibilityState={{ expanded: openEditDropdown === 'lineStyle' }}
                    style={styles.annotationDropdownField}
                    onPress={() => setOpenEditDropdown(openEditDropdown === 'lineStyle' ? null : 'lineStyle')}
                  >
                    <Text style={styles.annotationDropdownValue}>{lineBorderStyleLabels[lineStyle]}</Text>
                    <ChevronDown color={colors.muted} size={15} />
                  </Pressable>
                  {openEditDropdown === 'lineStyle' ? (
                    <View style={styles.annotationDropdownMenuPopover}>
                      <ScrollView style={styles.annotationDropdownMenuScroll} showsVerticalScrollIndicator={lineStyleOptions.length > 4}>
                        {lineStyleOptions.map((style) => {
                          const active = style === lineStyle;
                          return (
                            <Pressable
                              key={style}
                              accessibilityRole="button"
                              accessibilityLabel={lineBorderStyleLabels[style]}
                              accessibilityState={{ selected: active }}
                              style={[styles.annotationDropdownItem, active && styles.annotationDropdownItemActive]}
                              onPress={() => {
                                setLineStyleLocal(style);
                                config.setLineBorderStyle(style);
                                setOpenEditDropdown(null);
                              }}
                            >
                              <Text style={[styles.annotationDropdownItemText, active && styles.annotationDropdownItemTextActive]}>{lineBorderStyleLabels[style]}</Text>
                              {active ? <Check color={colors.blue} size={15} strokeWidth={2.4} /> : null}
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
                {config.tool === 'rect' && lineStyle === 'cloud' ? (
                  <View style={[styles.annotationEditRowTight, styles.annotationDropdownFullWidth]}>
                    <Text style={styles.annotationEditValue}>Cloud bump</Text>
                    <TextInput
                      accessibilityLabel="Cloud bump size"
                      keyboardType="number-pad"
                      value={cloudIntensity}
                      onChangeText={(value) => {
                        if (value !== '' && !/^\d+$/.test(value)) return;
                        setCloudIntensityLocal(value);
                        config.setCloudIntensity(value);
                      }}
                      style={styles.annotationEditNumberInput}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            {supportsWidth && supportsStyle ? <View style={styles.annotationSplitControlDivider} /> : null}

            {supportsWidth ? (
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>{config.tool === 'eraser' ? 'Eraser size' : 'Stroke width'}</Text>
                <TextInput
                  accessibilityLabel={config.tool === 'eraser' ? 'Eraser size' : 'Stroke width'}
                  keyboardType="number-pad"
                  value={config.tool === 'eraser' ? eraserSize : strokeWidth}
                  onChangeText={config.tool === 'eraser' ? applyEraserSize : applyStrokeWidth}
                  style={styles.annotationEditNumberInput}
                />
                {config.tool === 'eraser' ? (
                  <View style={styles.annotationChipRow}>
                    {(Object.keys(eraserModeLabels) as EraserMode[]).map((mode) => {
                      const active = mode === eraserMode;
                      return (
                        <Pressable
                          key={mode}
                          accessibilityRole="button"
                          accessibilityLabel={eraserModeLabels[mode]}
                          accessibilityState={{ selected: active }}
                          style={[styles.annotationChip, active && styles.annotationChipActive]}
                          onPress={() => {
                            setEraserModeLocal(mode);
                            config.setEraserMode(mode);
                          }}
                        >
                          <Text style={[styles.annotationChipText, active && styles.annotationChipTextActive]}>{eraserModeLabels[mode]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {!gradientPickerSection && (config.tool === 'arrow' || (config.tool === 'callout' && activeTextEditTab === 'shape')) ? (
          <View style={styles.annotationEditCard}>
            <Text style={styles.annotationEditLabel}>Arrowhead</Text>
            <View style={styles.annotationDropdownWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Arrowhead"
                accessibilityState={{ expanded: openEditDropdown === 'arrowhead' }}
                style={styles.annotationDropdownField}
                onPress={() => setOpenEditDropdown(openEditDropdown === 'arrowhead' ? null : 'arrowhead')}
              >
                <Text style={styles.annotationDropdownValue}>{arrowheadStyleLabels[arrowheadStyle]}</Text>
                <ChevronDown color={colors.muted} size={15} />
              </Pressable>
              {openEditDropdown === 'arrowhead' ? (
                <View style={styles.annotationDropdownMenuPopover}>
                  <ScrollView style={styles.annotationDropdownMenuScroll} showsVerticalScrollIndicator={arrowheadOptions.length > 4}>
                    {arrowheadOptions.map((style) => {
                      const active = style === arrowheadStyle;
                      return (
                        <Pressable
                          key={style}
                          accessibilityRole="button"
                          accessibilityLabel={arrowheadStyleLabels[style]}
                          accessibilityState={{ selected: active }}
                          style={[styles.annotationDropdownItem, active && styles.annotationDropdownItemActive]}
                          onPress={() => {
                            setArrowheadStyleLocal(style);
                            config.setArrowheadStyle(style);
                            setOpenEditDropdown(null);
                          }}
                        >
                          <Text style={[styles.annotationDropdownItemText, active && styles.annotationDropdownItemTextActive]}>{arrowheadStyleLabels[style]}</Text>
                          {active ? <Check color={colors.blue} size={15} strokeWidth={2.4} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {!gradientPickerSection && supportsText && activeTextEditTab === 'text' ? (
          <>
            <View style={[styles.annotationEditCard, styles.annotationSplitControlCard]}>
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>Text formatting</Text>
                <View style={styles.annotationFormatToggleRow}>
                  {[
                    { key: 'bold', label: 'B', active: bold, setLocal: setBoldLocal, setRemote: config.setBold, textStyle: styles.boldFormatText },
                    { key: 'italic', label: 'I', active: italic, setLocal: setItalicLocal, setRemote: config.setItalic, textStyle: styles.italicFormatText },
                    { key: 'underline', label: 'U', active: underline, setLocal: setUnderlineLocal, setRemote: config.setUnderline, textStyle: styles.underlineFormatText },
                    { key: 'strike', label: 'S', active: strike, setLocal: setStrikeLocal, setRemote: config.setStrike, textStyle: styles.strikeFormatText },
                  ].map((item) => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={item.key}
                      accessibilityState={{ selected: item.active }}
                      style={[styles.annotationFormatToggle, item.active && styles.annotationChipActive]}
                      onPress={() => {
                        item.setLocal((active) => !active);
                        item.setRemote((active) => !active);
                      }}
                    >
                      <Text style={[styles.desktopFormatButtonText, item.active && styles.desktopFormatButtonTextActive, item.textStyle]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.annotationSplitControlDivider} />
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>Text size</Text>
                <TextInput
                  accessibilityLabel="Font size"
                  keyboardType="number-pad"
                  value={fontSize}
                  onChangeText={applyFontSize}
                  style={styles.annotationEditNumberInput}
                />
              </View>
            </View>

            <View style={styles.annotationEditCard}>
              <Text style={styles.annotationEditLabel}>Text alignment</Text>
              <View style={styles.annotationAlignmentGroup}>
                <View style={styles.annotationAlignmentChoiceRow}>
                  {horizontalAlignmentOptions.map((option) => (
                    <TextAlignmentOption
                      key={option.label}
                      axis="horizontal"
                      value={option.value}
                      label={option.label}
                      active={horizontalAlignment === option.value}
                      onPress={() => applyTextAlignment(option.value, verticalAlignment)}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.annotationAlignmentGroup}>
                <View style={styles.annotationAlignmentChoiceRow}>
                  {verticalAlignmentOptions.map((option) => (
                    <TextAlignmentOption
                      key={option.label}
                      axis="vertical"
                      value={option.value}
                      label={option.label}
                      active={verticalAlignment === option.value}
                      onPress={() => applyTextAlignment(horizontalAlignment, option.value)}
                    />
                  ))}
                </View>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Animated.View>
  );
}

function TextAlignmentOption({
  axis,
  value,
  label,
  active,
  onPress,
}: {
  axis: 'horizontal' | 'vertical';
  value: number;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${axis} alignment`}
      accessibilityState={{ selected: active }}
      style={[styles.annotationAlignmentChoice, active && styles.annotationAlignmentChoiceActive]}
      onPress={onPress}
    >
      <TextAlignmentSvg axis={axis} value={value} active={active} />
    </Pressable>
  );
}

function TextAlignmentSvg({
  axis,
  value,
  active,
}: {
  axis: 'horizontal' | 'vertical';
  value: number;
  active: boolean;
}) {
  const blue = '#35BEEA';
  const softBlue = '#A7E1F4';
  const stroke = active ? '#F4F7FB' : '#D8DEE9';
  const strokeWidth = 6;
  const commonProps = {
    stroke,
    strokeWidth,
    strokeLinecap: 'round' as const,
  };

  if (axis === 'horizontal') {
    const content = (
      <>
        <Line x1={48} y1={44} x2={48} y2={212} {...commonProps} />
        <Rect x={70} y={62} width={150} height={34} rx={8} fill={blue} />
        <Rect x={70} y={111} width={76} height={34} rx={8} fill={softBlue} />
        <Rect x={70} y={160} width={116} height={34} rx={8} fill={blue} />
      </>
    );

    return (
      <Svg width={48} height={34} viewBox="0 0 256 256">
        {value === 0 ? content : null}
        {value === 1 ? (
          <>
            <Line x1={128} y1={44} x2={128} y2={212} {...commonProps} />
            <Rect x={53} y={62} width={150} height={34} rx={8} fill={blue} />
            <Rect x={91} y={111} width={74} height={34} rx={8} fill={softBlue} />
            <Rect x={72} y={160} width={112} height={34} rx={8} fill={blue} />
          </>
        ) : null}
        {value === 2 ? <G transform="translate(256 0) scale(-1 1)">{content}</G> : null}
      </Svg>
    );
  }

  return (
    <Svg width={48} height={34} viewBox="0 0 256 256">
      {value === 0 ? (
        <>
          <Rect x={53} y={66} width={150} height={34} rx={8} fill={blue} />
          <Line x1={128} y1={130} x2={128} y2={202} {...commonProps} />
          <Path d="M128 130 L105 153 M128 130 L151 153" fill="none" {...commonProps} strokeLinejoin="round" />
        </>
      ) : null}
      {value === 1 ? (
        <>
          <Rect x={53} y={111} width={150} height={34} rx={8} fill={blue} />
          <Line x1={128} y1={40} x2={128} y2={82} {...commonProps} />
          <Path d="M128 82 L105 59 M128 82 L151 59" fill="none" {...commonProps} strokeLinejoin="round" />
          <Line x1={128} y1={174} x2={128} y2={216} {...commonProps} />
          <Path d="M128 174 L105 197 M128 174 L151 197" fill="none" {...commonProps} strokeLinejoin="round" />
        </>
      ) : null}
      {value === 2 ? (
        <>
          <Line x1={128} y1={48} x2={128} y2={120} {...commonProps} />
          <Path d="M128 120 L105 97 M128 120 L151 97" fill="none" {...commonProps} strokeLinejoin="round" />
          <Rect x={53} y={156} width={150} height={34} rx={8} fill={blue} />
        </>
      ) : null}
    </Svg>
  );
}

function annotationEditSectionLabel(section: AnnotationEditFocus, tool: ToolId) {
  if (tool === 'counter' && section === 'fill') return 'Pin Fill';
  if (tool === 'counter' && section === 'stroke') return 'Pin Number';
  if (section === 'text') return 'Text';
  if (section === 'fill') return 'Fill';
  return 'Stroke';
}

function BottomActionBar({
  openSpaces,
  openSurvey,
  toggleHub,
  hubMode,
  hubOpen,
  spacesModeActive,
  surveyModeActive,
  bottomInset,
}: {
  openSpaces: () => void;
  openSurvey: () => void;
  toggleHub: () => void;
  hubMode: HubMode;
  hubOpen: boolean;
  spacesModeActive: boolean;
  surveyModeActive: boolean;
  bottomInset: number;
}) {
  const activeHub = hubItems.find((item) => item.id === hubMode) ?? hubItems[0];
  const HubIcon = activeHub.icon;

  return (
    <View style={[styles.bottomActionBar, { height: 52 + bottomInset, paddingBottom: 4 }]}>
      <View pointerEvents="none" style={[styles.bottomBarSurface, { height: 36 + bottomInset }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open spaces panel"
        style={[styles.bottomSideButton, styles.bottomActionNudge, spacesModeActive && styles.bottomSideButtonActive]}
        onPress={openSpaces}
      >
        <Layers color={spacesModeActive ? colors.blue : colors.text} size={22} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open document hub"
        style={[styles.bottomHubButton, styles.bottomActionNudge, hubOpen && styles.bottomHubButtonActive]}
        onPress={toggleHub}
      >
        <HubIcon color={hubOpen ? colors.blue : colors.text} size={19} />
        <Text numberOfLines={1} style={[styles.bottomHubText, hubOpen && styles.bottomHubTextActive]}>{activeHub.label}</Text>
        <ChevronDown color={hubOpen ? colors.blue : colors.muted} size={13} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open survey panel"
        style={[styles.bottomSideButton, styles.bottomActionNudge, surveyModeActive && styles.bottomSideButtonActive]}
        onPress={openSurvey}
      >
        <SurveyIcon color={surveyModeActive ? colors.blue : colors.text} size={23} />
      </Pressable>
    </View>
  );
}

function SurveySetupSheet({
  template,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  modules,
  moduleIndex,
  selectedCategoryId,
  markers,
  sheetHeight,
  bottomInset,
  onSelectModule,
  onSelectMarker,
  onPlaceCategory,
  onExitSurvey,
  onClose,
}: {
  template: SurveyTemplate | null;
  templates: SurveyTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string) => void;
  modules: SurveyModule[];
  moduleIndex: number;
  selectedCategoryId: string | null;
  markers: Marker[];
  sheetHeight: number;
  bottomInset: number;
  onSelectModule: (moduleId: string) => void;
  onSelectMarker: (markerId: number) => void;
  onPlaceCategory: (moduleId: string, categoryId: string) => void;
  onExitSurvey: () => void;
  onClose: () => void;
}) {
  const slideY = useRef(new Animated.Value(sheetHeight + bottomInset)).current;
  const openedOnceRef = useRef(false);
  const [openDropdown, setOpenDropdown] = useState<'template' | 'module' | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(selectedCategoryId);
  const activeModule = modules[moduleIndex] ?? modules[0];
  const canGoBack = moduleIndex > 0;
  const canGoForward = moduleIndex < modules.length - 1;

  const closeWithAnimation = () => {
    Animated.timing(slideY, {
      toValue: sheetHeight + bottomInset,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) slideY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 82 || gesture.vy > 0.65) {
            closeWithAnimation();
            return;
          }
          Animated.spring(slideY, {
            toValue: 0,
            damping: 24,
            stiffness: 260,
            mass: 0.75,
            useNativeDriver: true,
          }).start();
        },
      }),
    [slideY, sheetHeight, bottomInset]
  );

  useEffect(() => {
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    slideY.setValue(sheetHeight + bottomInset);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideY, sheetHeight, bottomInset]);

  const selectModuleIndex = (nextIndex: number) => {
    const nextModule = modules[nextIndex];
    if (!nextModule) return;
    onSelectModule(nextModule.id);
    setExpandedCategoryId(null);
    setOpenDropdown(null);
  };

  const toggleCategoryItems = (categoryId: string) => {
    if (!activeModule) return;
    setExpandedCategoryId((current) => (current === categoryId ? null : categoryId));
  };

  const placeCategoryMarker = (categoryId: string) => {
    if (!activeModule) return;
    onPlaceCategory(activeModule.id, categoryId);
  };

  return (
    <Animated.View style={[styles.sheet, { height: sheetHeight, paddingBottom: bottomInset + 10, transform: [{ translateY: slideY }] }]}>
      <View style={styles.sheetFixedTop} {...panResponder.panHandlers}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleColumn}>
            <Text style={styles.sheetEyebrow}>Survey template</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose survey template"
              style={styles.templateTitleButton}
              onPress={() => setOpenDropdown(openDropdown === 'template' ? null : 'template')}
            >
              <Text numberOfLines={1} style={styles.sheetTitle}>{template?.name ?? 'Choose survey template'}</Text>
              <ChevronDown color={colors.muted} size={14} />
            </Pressable>
            {openDropdown === 'template' ? (
              <View style={styles.templateDropdownMenu}>
                {templates.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.dropdownItem, item.id === selectedTemplateId && styles.dropdownItemActive]}
                    onPress={() => {
                      onSelectTemplate(item.id);
                      setOpenDropdown(null);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close survey setup" style={styles.exportButton} onPress={closeWithAnimation}>
            <X color={colors.text} size={18} />
          </Pressable>
        </View>

        {template ? (
          <View style={styles.sheetRow}>
            <View style={styles.moduleNavigator}>
              <Pressable disabled={!canGoBack} style={[styles.moduleArrow, !canGoBack && styles.moduleArrowDisabled]} onPress={() => selectModuleIndex(moduleIndex - 1)}>
                <ChevronLeft color={canGoBack ? colors.text : colors.faint} size={18} />
              </Pressable>
              <View style={styles.moduleDropdownWrap}>
                <Pressable style={styles.moduleCenter} onPress={() => setOpenDropdown(openDropdown === 'module' ? null : 'module')}>
                  <Text style={styles.moduleCenterText}>{activeModule?.name ?? 'Select module'}</Text>
                  <ChevronDown color={colors.muted} size={14} />
                </Pressable>
                {openDropdown === 'module' ? (
                  <View style={styles.dropdownMenu}>
                    {modules.map((module, index) => (
                      <Pressable
                        key={module.id}
                        style={[styles.dropdownItem, module.id === activeModule?.id && styles.dropdownItemActive]}
                        onPress={() => selectModuleIndex(index)}
                      >
                        <Text style={styles.dropdownItemText}>{module.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
              <Pressable disabled={!canGoForward} style={[styles.moduleArrow, !canGoForward && styles.moduleArrowDisabled]} onPress={() => selectModuleIndex(moduleIndex + 1)}>
                <ChevronRight color={canGoForward ? colors.text : colors.faint} size={18} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {template ? (
        <>
          <View style={styles.surveyCategoryHeader}>
            <Text style={styles.compactFieldLabel}>Select Category to Highlight</Text>
            <Text style={styles.assignedText}>Tap category to place marker</Text>
          </View>

          <ScrollView style={styles.surveyCategoryList} contentContainerStyle={styles.surveyCategoryListContent} showsVerticalScrollIndicator>
            {(activeModule?.categories ?? []).map((category) => {
              const categoryMarkers = activeModule ? markers.filter((marker) => marker.moduleId === activeModule.id && marker.categoryId === category.id) : [];
              const count = categoryMarkers.length;
              const active = selectedCategoryId === category.id;
              const expanded = expandedCategoryId === category.id;
              return (
                <View key={category.id} style={[styles.surveyCategoryCard, active && styles.surveyCategoryCardActive]}>
                  <View style={styles.surveyCategoryRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Place ${category.name} survey marker`}
                      style={styles.surveyCategoryMain}
                      onPress={() => placeCategoryMarker(category.id)}
                    >
                      <Text numberOfLines={1} style={[styles.surveyCategoryName, active && styles.surveyCategoryNameActive]}>{category.name}</Text>
                      <Text style={[styles.surveyCategoryCount, active && styles.surveyCategoryNameActive]}>{count}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={expanded ? `Collapse ${category.name}` : `Expand ${category.name}`}
                      style={styles.surveyCategoryExpand}
                      onPress={() => toggleCategoryItems(category.id)}
                    >
                      <ChevronDown color={active || expanded ? colors.blue : colors.text} size={16} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
                    </Pressable>
                  </View>
                  {expanded ? (
                    <View style={styles.surveyCategoryItems}>
                      {categoryMarkers.length ? categoryMarkers.map((categoryItem) => {
                        const entity = (template?.entities ?? entities).find((entry) => entry.id === categoryItem.entity);
                        return (
                          <Pressable
                            key={categoryItem.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Open category item ${categoryItem.name}`}
                            style={styles.surveyCategoryItemRow}
                            onPress={() => onSelectMarker(categoryItem.id)}
                          >
                            <View style={[styles.entityDot, { backgroundColor: entity?.color ?? colors.faint }]} />
                            <Text numberOfLines={1} style={styles.surveyCategoryItemName}>{categoryItem.name}</Text>
                          </Pressable>
                        );
                      }) : (
                        <View style={styles.surveyCategoryEmptyItems}>
                          <Text style={styles.surveyCategoryEmptyText}>No category items yet. Hide panel, then tap plan to add one.</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </>
      ) : (
        <View style={styles.templatePickerBody}>
          <Text style={styles.compactFieldLabel}>Available Templates</Text>
          <View style={styles.templatePickerList}>
            {templates.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Select survey template ${item.name}`}
                style={styles.templatePickerItem}
                onPress={() => {
                  onSelectTemplate(item.id);
                  setOpenDropdown(null);
                }}
              >
                <View style={styles.templatePickerIcon}>
                  <FileText color={colors.blue} size={16} />
                </View>
                <View style={styles.templatePickerCopy}>
                  <Text numberOfLines={1} style={styles.templatePickerTitle}>{item.name}</Text>
                  <Text style={styles.templatePickerMeta}>{item.modules.length} modules</Text>
                </View>
                <ChevronRight color={colors.muted} size={16} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.sheetFooter}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit survey mode" style={styles.exitSurveyButton} onPress={onExitSurvey}>
          <Text style={styles.exitSurveyText}>Exit Survey</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function SurveySheet({
  marker,
  markers,
  entityName,
  template,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  modules,
  entities,
  moduleIndex,
  activeCategory,
  checklistItems,
  lastCategoryByModule,
  rememberSurveySelection,
  updateMarker,
  sheetHeight,
  checklistWindowHeight,
  bottomInset,
  onSelectMarker,
  onLocateMarker,
  onExitSurvey,
  onClose,
}: {
  marker: Marker;
  markers: Marker[];
  entityName: string;
  template: SurveyTemplate | null;
  templates: SurveyTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string) => void;
  modules: SurveyModule[];
  entities: Entity[];
  moduleIndex: number;
  activeCategory: SurveyCategory | null;
  checklistItems: SurveyChecklistItem[];
  lastCategoryByModule: Record<string, string>;
  rememberSurveySelection: (moduleId: string, categoryId: string | null) => void;
  updateMarker: (markerId: number, patch: Partial<Marker>) => void;
  sheetHeight: number;
  checklistWindowHeight: number;
  bottomInset: number;
  onSelectMarker: (markerId: number) => void;
  onLocateMarker: (marker: Marker) => void;
  onExitSurvey: () => void;
  onClose: () => void;
}) {
  const slideY = useRef(new Animated.Value(sheetHeight + bottomInset)).current;
  const openedOnceRef = useRef(false);
  const [openDropdown, setOpenDropdown] = useState<'template' | 'module' | 'category' | 'entity' | 'markerItem' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [notesEditorOpen, setNotesEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(marker.notes ?? '');
  const [photoDrafts, setPhotoDrafts] = useState<string[]>(marker.photos ?? []);
  const [videoDrafts, setVideoDrafts] = useState<string[]>(marker.videos ?? []);
  const activeModule = modules[moduleIndex] ?? modules[0];
  const activeEntity = entities.find((entity) => entity.id === marker.entity) ?? null;
  const categoryItems = activeModule && activeCategory
    ? markers.filter((item) => item.moduleId === activeModule.id && item.categoryId === activeCategory.id)
    : [];
  const canGoBack = moduleIndex > 0;
  const canGoForward = moduleIndex < modules.length - 1;

  const selectedTemplateName = template?.name ?? 'Choose survey template';

  const selectModule = (nextIndex: number) => {
    const nextModule = modules[nextIndex];
    if (!nextModule) return;
    const categoryId = nextModule.categories.some((category) => category.id === lastCategoryByModule[nextModule.id])
      ? lastCategoryByModule[nextModule.id]
      : nextModule.categories[0]?.id ?? null;
    updateMarker(marker.id, {
      moduleId: nextModule.id,
      categoryId,
    });
    rememberSurveySelection(nextModule.id, categoryId);
    setOpenDropdown(null);
    setExportOpen(false);
  };

  const selectCategory = (category: SurveyCategory) => {
    updateMarker(marker.id, {
      moduleId: activeModule.id,
      categoryId: category.id,
    });
    rememberSurveySelection(activeModule.id, category.id);
    setOpenDropdown(null);
    setExportOpen(false);
  };

  const selectEntity = (entityId: string) => {
    updateMarker(marker.id, { entity: entityId });
    setOpenDropdown(null);
    setExportOpen(false);
  };

  const selectChecklistResponse = (itemId: string, selection: ChecklistSelection) => {
    updateMarker(marker.id, {
      checklistResponses: {
        ...marker.checklistResponses,
        [itemId]: {
          ...(marker.checklistResponses[itemId] || {}),
          selection,
        },
      },
    });
  };

  const closeWithAnimation = () => {
    Animated.timing(slideY, {
      toValue: sheetHeight + bottomInset,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  };
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) slideY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 82 || gesture.vy > 0.65) {
            closeWithAnimation();
            return;
          }
          Animated.spring(slideY, {
            toValue: 0,
            damping: 24,
            stiffness: 260,
            mass: 0.75,
            useNativeDriver: true,
          }).start();
        },
      }),
    [slideY, sheetHeight, bottomInset]
  );

  useEffect(() => {
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    slideY.setValue(sheetHeight + bottomInset);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideY, sheetHeight, bottomInset]);

  useEffect(() => {
    setNotesEditorOpen(false);
    setNoteDraft(marker.notes ?? '');
    setPhotoDrafts(marker.photos ?? []);
    setVideoDrafts(marker.videos ?? []);
  }, [marker.id]);

  const openNotesEditor = () => {
    setOpenDropdown(null);
    setExportOpen(false);
    setNoteDraft(marker.notes ?? '');
    setPhotoDrafts(marker.photos ?? []);
    setVideoDrafts(marker.videos ?? []);
    setNotesEditorOpen(true);
  };

  const saveNotes = () => {
    updateMarker(marker.id, {
      notes: noteDraft,
      photos: photoDrafts,
      videos: videoDrafts,
    });
    setNotesEditorOpen(false);
  };

  const pickNotesMedia = async (kind: 'photos' | 'videos') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'photos' ? ['images'] : ['videos'],
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (result.canceled) return;
    const selected = result.assets.map((asset) => asset.fileName || asset.uri).filter(Boolean);
    if (!selected.length) return;
    if (kind === 'photos') {
      setPhotoDrafts((current) => [...current, ...selected]);
      return;
    }
    setVideoDrafts((current) => [...current, ...selected]);
  };

  if (notesEditorOpen) {
    return (
      <Animated.View style={[styles.sheet, { height: sheetHeight, paddingBottom: bottomInset + 10, transform: [{ translateY: slideY }] }]}>
        <View style={styles.sheetFixedTop} {...panResponder.panHandlers}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetEyebrow}>Survey marker</Text>
              <Text numberOfLines={1} style={styles.sheetTitle}>{marker.name}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close notes editor" style={styles.exportButton} onPress={() => setNotesEditorOpen(false)}>
              <X color={colors.text} size={18} />
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.notesEditorScroll} contentContainerStyle={styles.notesEditorContent} showsVerticalScrollIndicator>
          <View style={styles.notesEditorCard}>
            <TextInput
              accessibilityLabel="Survey marker notes"
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Add details..."
              placeholderTextColor={colors.faint}
              style={styles.notesEditorInput}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.notesEditorCard}>
            <View style={styles.notesEditorSectionHeader}>
              <Text style={styles.annotationEditLabel}>Attachments</Text>
              <View style={styles.notesUploadRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="Upload photos" style={styles.notesUploadButton} onPress={() => pickNotesMedia('photos')}>
                  <ImageIcon color={colors.text} size={15} />
                  <Text style={styles.notesUploadText}>Photo</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Upload videos" style={styles.notesUploadButton} onPress={() => pickNotesMedia('videos')}>
                  <Video color={colors.text} size={15} />
                  <Text style={styles.notesUploadText}>Video</Text>
                </Pressable>
              </View>
            </View>
            {photoDrafts.length ? photoDrafts.map((photo, index) => (
              <View key={`${photo}-${index}`} style={styles.attachmentRow}>
                <View style={styles.attachmentThumb}><ImageIcon color={colors.blue} size={16} /></View>
                <Text numberOfLines={1} style={styles.attachmentName}>{photo}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${photo}`} style={styles.attachmentRemoveButton} onPress={() => setPhotoDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <X color={colors.muted} size={13} />
                </Pressable>
              </View>
            )) : null}
            {videoDrafts.length ? videoDrafts.map((video, index) => (
              <View key={`${video}-${index}`} style={styles.attachmentRow}>
                <View style={styles.attachmentThumb}><Video color={colors.blue} size={16} /></View>
                <Text numberOfLines={1} style={styles.attachmentName}>{video}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${video}`} style={styles.attachmentRemoveButton} onPress={() => setVideoDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <X color={colors.muted} size={13} />
                </Pressable>
              </View>
            )) : null}
            {!photoDrafts.length && !videoDrafts.length ? <Text style={styles.notesEmptyText}>No attachments.</Text> : null}
          </View>
        </ScrollView>

        <View style={styles.notesEditorFooter}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel note edits" style={styles.notesCancelButton} onPress={() => setNotesEditorOpen(false)}>
            <Text style={styles.notesCancelText}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save note" style={styles.notesSaveButton} onPress={saveNotes}>
            <Text style={styles.notesSaveText}>Save</Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.sheet, { height: sheetHeight, paddingBottom: bottomInset + 10, transform: [{ translateY: slideY }] }]}
    >
      <View style={styles.sheetFixedTop} {...panResponder.panHandlers}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleColumn}>
            <Text style={styles.sheetEyebrow}>Survey template</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose survey template"
              style={styles.templateTitleButton}
              onPress={() => {
                setExportOpen(false);
                setOpenDropdown(openDropdown === 'template' ? null : 'template');
              }}
            >
              <Text numberOfLines={1} style={styles.sheetTitle}>{selectedTemplateName}</Text>
              <ChevronDown color={colors.muted} size={14} />
            </Pressable>
            {openDropdown === 'template' ? (
              <View style={styles.templateDropdownMenu}>
                {templates.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.dropdownItem, item.id === selectedTemplateId && styles.dropdownItemActive]}
                    onPress={() => {
                      onSelectTemplate(item.id);
                      setOpenDropdown(null);
                      setExportOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.sheetHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export survey data"
              style={[styles.exportButton, exportOpen && styles.exportButtonActive]}
              onPress={() => {
                setOpenDropdown(null);
                setExportOpen((open) => !open);
              }}
            >
              <ExportIcon color={exportOpen ? colors.blue : colors.text} size={20} />
            </Pressable>
            {exportOpen ? (
              <View style={styles.exportMenu}>
                <Pressable accessibilityRole="button" accessibilityLabel="Export as Excel" style={styles.exportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.exportMenuTitle}>Export Excel</Text>
                  <Text style={styles.exportMenuMeta}>Create workbook from survey data</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Sync to Microsoft 365" style={styles.exportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.exportMenuTitle}>Sync Microsoft 365</Text>
                  <Text style={styles.exportMenuMeta}>Update the shared workbook location</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.sheetRow}>
          <View style={styles.moduleNavigator}>
            <Pressable
              disabled={!canGoBack}
              style={[styles.moduleArrow, !canGoBack && styles.moduleArrowDisabled]}
              onPress={() => selectModule(moduleIndex - 1)}
            >
              <ChevronLeft color={canGoBack ? colors.text : colors.faint} size={18} />
            </Pressable>
            <View style={styles.moduleDropdownWrap}>
              <Pressable
                style={styles.moduleCenter}
                onPress={() => {
                  setExportOpen(false);
                  setOpenDropdown(openDropdown === 'module' ? null : 'module');
                }}
              >
                <Text style={styles.moduleCenterText}>{activeModule.name}</Text>
                <ChevronDown color={colors.muted} size={14} />
              </Pressable>
              {openDropdown === 'module' ? (
                <View style={styles.dropdownMenu}>
                  {modules.map((module, index) => (
                    <Pressable
                      key={module.id}
                      style={[styles.dropdownItem, module.id === activeModule.id && styles.dropdownItemActive]}
                      onPress={() => selectModule(index)}
                    >
                      <Text style={styles.dropdownItemText}>{module.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <Pressable
              disabled={!canGoForward}
              style={[styles.moduleArrow, !canGoForward && styles.moduleArrowDisabled]}
              onPress={() => selectModule(moduleIndex + 1)}
            >
              <ChevronRight color={canGoForward ? colors.text : colors.faint} size={18} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.sheetFixedBody}>
        <Text style={styles.compactFieldLabel}>Category</Text>
        <View style={[styles.dropdownWrap, openDropdown === 'category' && styles.dropdownWrapActive]}>
          <Pressable
            style={[styles.compactDropdownField, !activeCategory && styles.dropdownFieldEmpty]}
            onPress={() => {
              setExportOpen(false);
              setOpenDropdown(openDropdown === 'category' ? null : 'category');
            }}
          >
            <Text style={[styles.dropdownValue, !activeCategory && styles.dropdownPlaceholder]}>
              {activeCategory?.name ?? 'Choose category'}
            </Text>
            <ChevronDown color={colors.muted} size={15} />
          </Pressable>
          {openDropdown === 'category' ? (
            <View style={styles.dropdownMenu}>
              {activeModule.categories.map((category) => (
                <Pressable
                  key={category.id}
                  style={[styles.dropdownItem, category.id === activeCategory?.id && styles.dropdownItemActive]}
                  onPress={() => selectCategory(category)}
                >
                  <Text style={styles.dropdownItemText}>{category.name}</Text>
                  <Text style={styles.dropdownMeta}>{category.checklist.length}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <Text style={styles.compactFieldLabel}>Category Item</Text>
        <View style={[styles.markerToolsWrap, (openDropdown === 'entity' || openDropdown === 'markerItem') && styles.dropdownWrapActive]}>
          <View style={styles.markerToolsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose marker entity"
              style={[styles.markerEntitySwatchButton, !activeEntity && styles.markerEntitySwatchEmpty]}
              onPress={() => {
                setExportOpen(false);
                setOpenDropdown(openDropdown === 'entity' ? null : 'entity');
              }}
            >
              <View style={[styles.markerEntitySwatch, { backgroundColor: activeEntity?.color ?? 'transparent' }]} />
            </Pressable>
            <View style={styles.markerItemFieldWrap}>
              <View style={styles.markerItemInputRow}>
                <TextInput
                  accessibilityLabel="Rename category item"
                  value={marker.name}
                  onChangeText={(value) => updateMarker(marker.id, { name: value })}
                  onFocus={() => {
                    setOpenDropdown(null);
                    setExportOpen(false);
                  }}
                  onBlur={() => {
                    const fallbackName = activeCategory ? `${activeCategory.name} ${marker.id}` : `Survey Marker ${marker.id}`;
                    if (!marker.name.trim()) updateMarker(marker.id, { name: fallbackName });
                  }}
                  placeholder="Category item"
                  placeholderTextColor={colors.faint}
                  style={styles.markerNameInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose category item"
                  style={styles.markerItemDropdownButton}
                  onPress={() => {
                    setExportOpen(false);
                    setOpenDropdown(openDropdown === 'markerItem' ? null : 'markerItem');
                  }}
                >
                  <ChevronDown color={colors.muted} size={14} />
                </Pressable>
              </View>
              {openDropdown === 'markerItem' ? (
                <View style={styles.markerItemMenu}>
                  {categoryItems.length ? categoryItems.map((item) => (
                    <Pressable
                      key={item.id}
                      style={[styles.dropdownItem, item.id === marker.id && styles.dropdownItemActive]}
                      onPress={() => {
                        onSelectMarker(item.id);
                        setOpenDropdown(null);
                        setExportOpen(false);
                      }}
                    >
                      <Text numberOfLines={1} style={styles.dropdownItemText}>{item.name}</Text>
                    </Pressable>
                  )) : (
                    <View style={styles.dropdownItem}>
                      <Text style={styles.dropdownItemText}>No category items yet</Text>
                    </View>
                  )}
                </View>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Locate marker on PDF" style={styles.locateMarkerButton} onPress={() => onLocateMarker(marker)}>
              <Search color={colors.blue} size={16} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={marker.notes ? 'Edit marker notes' : 'Add marker notes'} style={styles.markerNotesIconButton} onPress={openNotesEditor}>
              <PenLine color={marker.notes ? '#4A90E2' : '#999'} size={15} />
            </Pressable>
          </View>
          {openDropdown === 'entity' ? (
            <View style={styles.markerEntityMenu}>
              {entities.map((entity) => (
                <Pressable
                  key={entity.id}
                  style={[styles.dropdownItem, marker.entity === entity.id && styles.dropdownItemActive]}
                  onPress={() => selectEntity(entity.id)}
                >
                  <View style={[styles.entityDot, { backgroundColor: entity.color }]} />
                  <Text style={styles.dropdownItemText}>{entity.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.checkHeader}>
          <Text style={styles.compactFieldLabel}>Checklist</Text>
          <Text style={styles.assignedText}>Court: {entityName}</Text>
        </View>
      </View>

      {activeCategory ? (
        <ScrollView
          style={[styles.checkListScroll, { height: checklistWindowHeight }]}
          contentContainerStyle={styles.checkList}
          showsVerticalScrollIndicator={checklistItems.length > MAX_VISIBLE_CHECKLIST_ITEMS}
        >
          {checklistItems.map((item) => {
            const response = marker.checklistResponses[item.id]?.selection;
            return (
              <View key={item.id} style={styles.checkItem}>
                <Text numberOfLines={1} style={styles.checkText}>{item.text}</Text>
                <View style={styles.checkResponseGroup}>
                  {(['Y', 'N', 'N/A'] as ChecklistSelection[]).map((selection) => (
                    <Pressable
                      key={selection}
                      accessibilityRole="button"
                      accessibilityState={{ selected: response === selection }}
                      accessibilityLabel={`${item.text} ${selection}`}
                      style={[
                        styles.checkResponseButton,
                        response === selection && styles.checkResponseButtonActive,
                        response === selection && selection === 'Y' && styles.checkResponseYes,
                        response === selection && selection === 'N' && styles.checkResponseNo,
                        response === selection && selection === 'N/A' && styles.checkResponseNa,
                      ]}
                      onPress={() => selectChecklistResponse(item.id, selection)}
                    >
                      <Text style={[styles.checkResponseText, response === selection && styles.checkResponseTextActive]}>{selection}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <View style={[styles.emptyChecklist, { height: checklistWindowHeight }]}>
          <Text style={styles.emptyChecklistText}>Choose category first</Text>
        </View>
      )}

      <View style={styles.sheetFooter}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit survey mode" style={styles.exitSurveyButton} onPress={onExitSurvey}>
          <Text style={styles.exitSurveyText}>Exit Survey</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function SpacesDrawer({
  spaces,
  activeSpaceId,
  activeRegionId,
  editingRegionId,
  panelHeight,
  bottomInset,
  totalPages,
  surveyMode,
  onToggleSpace,
  onToggleRegion,
  onUpdateSpace,
  onUpdateRegion,
  onAssignPages,
  onCreateSpace,
  onDeleteSpace,
  onCreateRegion,
  onMoveSpace,
  onLocatePage,
  onEditRegion,
  onExitRegion,
  onClose,
}: {
  spaces: SpaceConfig[];
  activeSpaceId: string | null;
  activeRegionId: string | null;
  editingRegionId: string | null;
  panelHeight: number;
  bottomInset: number;
  totalPages: number;
  surveyMode: boolean;
  onToggleSpace: (spaceId: string) => void;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateSpace: (spaceId: string, patch: Partial<SpaceConfig>) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onAssignPages: (spaceId: string, pages: number[]) => void;
  onCreateSpace: () => void;
  onDeleteSpace: (spaceId: string) => void;
  onCreateRegion: (spaceId?: string, pageOverride?: number) => void;
  onMoveSpace: (spaceId: string, delta: number) => void;
  onLocatePage: (pageNumber: number) => void;
  onEditRegion: (spaceId: string, regionId: string) => void;
  onExitRegion: () => void;
  onClose: () => void;
}) {
  const [pageDrafts, setPageDrafts] = useState<Record<string, string>>({});
  const [pageErrors, setPageErrors] = useState<Record<string, string | null>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const exportTarget = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null;

  function commitPages(space: SpaceConfig) {
    const rawDraft = pageDrafts[space.id] ?? '';
    const { pages, error } = parsePageRangeDraft(rawDraft, totalPages);
    if (error || pages.length === 0) {
      setPageErrors((current) => ({ ...current, [space.id]: error ?? 'Enter pages.' }));
      return;
    }
    onAssignPages(space.id, pages);
    setPageErrors((current) => ({ ...current, [space.id]: null }));
    setPageDrafts((current) => ({ ...current, [space.id]: pages.join(', ') }));
  }

  return (
    <View style={[styles.drawer, styles.spacesDrawer, { height: panelHeight, paddingBottom: bottomInset + 12 }]}>
      <View style={styles.spacesDrawerHeader}>
        <View>
          <Text style={styles.drawerTitle}>Spaces</Text>
          <Text style={styles.drawerSubtitle}>{activeRegionId ? 'Region active' : activeSpaceId ? 'Space active' : 'No space active'}</Text>
        </View>
        <View style={styles.spacesHeaderActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Create space" style={styles.spacesHeaderButton} onPress={onCreateSpace}>
            <Plus color={colors.text} size={16} />
          </Pressable>
          <View style={styles.spacesExportWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={exportTarget ? `Export ${exportTarget.name}` : 'Export space'}
              disabled={!exportTarget}
              style={[styles.spacesHeaderButton, exportOpen && styles.spacesHeaderButtonActive, !exportTarget && styles.spacesHeaderButtonDisabled]}
              onPress={() => {
                if (!exportTarget) return;
                setExportOpen((open) => !open);
              }}
            >
              <ExportIcon color={exportOpen ? colors.blue : colors.text} size={16} />
            </Pressable>
            {exportOpen && exportTarget ? (
              <View style={styles.spacesExportMenu}>
                <Pressable accessibilityRole="button" accessibilityLabel="Export space CSV" style={styles.spacesExportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.spacesExportMenuText}>CSV</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Export space PDF pages" style={styles.spacesExportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.spacesExportMenuText}>PDF Pages</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView style={styles.spacesList} contentContainerStyle={styles.spacesListContent} showsVerticalScrollIndicator={spaces.length > 2}>
        {spaces.length ? (
          spaces.map((space, index) => (
            <SpaceRow
              key={space.id}
              space={space}
              index={index}
              count={spaces.length}
              active={activeSpaceId === space.id}
              activeRegionId={activeRegionId}
              editingRegionId={editingRegionId}
              pageDraft={pageDrafts[space.id] ?? ''}
              pageError={pageErrors[space.id] ?? null}
              surveyMode={surveyMode}
              onPageDraftChange={(value) => {
                setPageDrafts((current) => ({ ...current, [space.id]: value }));
                setPageErrors((current) => ({ ...current, [space.id]: null }));
              }}
              onCommitPages={() => commitPages(space)}
              onAssignPages={onAssignPages}
              onToggleSpace={onToggleSpace}
              onToggleRegion={onToggleRegion}
              onUpdateSpace={onUpdateSpace}
              onUpdateRegion={onUpdateRegion}
              onDeleteSpace={onDeleteSpace}
              onCreateRegion={onCreateRegion}
              onMoveSpace={onMoveSpace}
              onLocatePage={onLocatePage}
              onEditRegion={onEditRegion}
            />
          ))
        ) : (
          <View style={styles.spaceEmptyState}>
            <Layers color={colors.muted} size={22} />
            <Text style={styles.spaceEmptyText}>No spaces yet</Text>
          </View>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" accessibilityLabel="Exit spaces and regions mode" style={styles.exitRegionButtonFull} onPress={onExitRegion}>
        <Text style={styles.exitRegionText}>Exit Spaces / Regions</Text>
      </Pressable>
    </View>
  );
}

function SpaceRow({
  space,
  index,
  count,
  active,
  activeRegionId,
  editingRegionId,
  pageDraft,
  pageError,
  surveyMode,
  onPageDraftChange,
  onCommitPages,
  onAssignPages,
  onToggleSpace,
  onToggleRegion,
  onUpdateSpace,
  onUpdateRegion,
  onDeleteSpace,
  onCreateRegion,
  onMoveSpace,
  onLocatePage,
  onEditRegion,
}: {
  space: SpaceConfig;
  index: number;
  count: number;
  active: boolean;
  activeRegionId: string | null;
  editingRegionId: string | null;
  pageDraft: string;
  pageError: string | null;
  surveyMode: boolean;
  onPageDraftChange: (value: string) => void;
  onCommitPages: () => void;
  onAssignPages: (spaceId: string, pages: number[]) => void;
  onToggleSpace: (spaceId: string) => void;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateSpace: (spaceId: string, patch: Partial<SpaceConfig>) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onDeleteSpace: (spaceId: string) => void;
  onCreateRegion: (spaceId?: string, pageOverride?: number) => void;
  onMoveSpace: (spaceId: string, delta: number) => void;
  onLocatePage: (pageNumber: number) => void;
  onEditRegion: (spaceId: string, regionId: string) => void;
}) {
  const dragProgressRef = useRef(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7,
        onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const step = 58;
          const delta = Math.trunc((gesture.dy - dragProgressRef.current) / step);
          if (!delta) return;
          dragProgressRef.current += delta * step;
          onMoveSpace(space.id, delta);
        },
        onPanResponderRelease: () => {
          dragProgressRef.current = 0;
        },
        onPanResponderTerminate: () => {
          dragProgressRef.current = 0;
        },
      }),
    [onMoveSpace, space.id]
  );
  const first = index === 0;
  const last = index === count - 1;
  const sortedPages = [...space.pages].sort((a, b) => a - b);

  return (
    <View style={[styles.spaceCard, active && styles.spaceCardActive]} {...panResponder.panHandlers}>
      <View style={styles.spaceCardHeader}>
        <View style={styles.spaceCardLeadingControls}>
          <View style={styles.spaceDragHandle}>
            <GripVertical color={colors.faint} size={15} />
          </View>
          <View style={styles.spaceRegionCountBadge}>
            <Text style={styles.spaceRegionCountText}>{space.regions.length}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={space.expanded ? 'Collapse space' : 'Expand space'} style={styles.spaceExpandButton} onPress={() => onUpdateSpace(space.id, { expanded: !space.expanded })}>
            <ChevronDown color={colors.muted} size={14} style={{ transform: [{ rotate: space.expanded ? '0deg' : '-90deg' }] }} />
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="Space name"
          value={space.name}
          onChangeText={(value) => onUpdateSpace(space.id, { name: value })}
          onBlur={() => {
            if (!space.name.trim()) onUpdateSpace(space.id, { name: `Space ${index + 1}` });
          }}
          style={styles.spaceNameInput}
        />
        <View style={styles.spaceHeaderControls}>
          <Pressable accessibilityRole="switch" accessibilityLabel={active ? 'Turn off space' : 'Turn on space'} style={[styles.toggle, active && styles.toggleActive]} onPress={() => onToggleSpace(space.id)}>
            <View style={[styles.toggleKnob, active && styles.toggleKnobActive]} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete space" style={styles.spaceDeleteButton} onPress={() => onDeleteSpace(space.id)}>
            <X color="#F08A8A" size={13} />
          </Pressable>
        </View>
      </View>

      {!space.expanded ? (
        <View style={styles.spaceCollapsedMetaRow}>
          <Text numberOfLines={1} style={styles.spaceMeta}>{summarizePages(space.pages)} · {space.regions.length} region{space.regions.length === 1 ? '' : 's'}</Text>
          <View style={styles.rowMoveButtons}>
            <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move space up" style={[styles.bookmarkMoveButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, -1)}>
              <ChevronLeft color={first ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
            <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move space down" style={[styles.bookmarkMoveButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, 1)}>
              <ChevronRight color={last ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {space.expanded ? (
        <View style={styles.spaceExpandedBody}>
          <View style={styles.spacePageAssignRow}>
            <TextInput
              accessibilityLabel="Assigned pages"
              value={pageDraft}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              onChangeText={onPageDraftChange}
              onSubmitEditing={onCommitPages}
              placeholder="Add pages (e.g. 3, 6-9, 12)"
              placeholderTextColor={colors.faint}
              style={styles.spacePageInput}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Add pages" style={styles.spaceAddPagesButton} onPress={onCommitPages}>
              <Plus color={colors.text} size={14} />
            </Pressable>
          </View>
          {pageError ? <Text style={styles.spacePageError}>{pageError}</Text> : null}

          <View style={styles.spacePageRows}>
            {sortedPages.length ? (
              sortedPages.map((pageNumber) => {
                const pageRegions = space.regions.filter((region) => region.page === pageNumber);
                const primaryRegion = pageRegions[0] ?? null;
                return (
                  <SpacePageRegionRow
                    key={`${space.id}:${pageNumber}`}
                    space={space}
                    pageNumber={pageNumber}
                    region={primaryRegion}
                    regionCount={pageRegions.length}
                    active={Boolean(primaryRegion && activeRegionId === primaryRegion.id)}
                    editing={Boolean(primaryRegion && editingRegionId === primaryRegion.id)}
                    surveyMode={surveyMode}
                    spaceActive={active}
                    onToggleRegion={onToggleRegion}
                    onUpdateRegion={onUpdateRegion}
                    onLocatePage={onLocatePage}
                    onEditRegion={onEditRegion}
                    onCreateRegion={onCreateRegion}
                    onRemovePage={(pageToRemove) => {
                      const nextPages = space.pages.filter((page) => page !== pageToRemove);
                      onAssignPages(space.id, nextPages);
                    }}
                  />
                );
              })
            ) : (
              <View style={styles.spaceNoPagesRow}>
                <Text style={styles.regionMeta}>No pages added yet.</Text>
              </View>
            )}
          </View>

          <View style={styles.spaceExpandedFooter}>
            <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move space up" style={[styles.bookmarkMoveButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, -1)}>
              <ChevronLeft color={first ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
            <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move space down" style={[styles.bookmarkMoveButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, 1)}>
              <ChevronRight color={last ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SpacePageRegionRow({
  space,
  pageNumber,
  region,
  regionCount,
  active,
  editing,
  surveyMode,
  spaceActive,
  onToggleRegion,
  onUpdateRegion,
  onLocatePage,
  onEditRegion,
  onCreateRegion,
  onRemovePage,
}: {
  space: SpaceConfig;
  pageNumber: number;
  region: RegionConfig | null;
  regionCount: number;
  active: boolean;
  editing: boolean;
  surveyMode: boolean;
  spaceActive: boolean;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onLocatePage: (pageNumber: number) => void;
  onEditRegion: (spaceId: string, regionId: string) => void;
  onCreateRegion: (spaceId?: string, pageOverride?: number) => void;
  onRemovePage: (pageNumber: number) => void;
}) {
  const visibilityOn = surveyMode ? region?.showSurveyAnnotations : region?.showCanvasAnnotations;
  const visibilityDisabled = !spaceActive || !region;
  const regionLabel = region?.name?.trim() || `Region ${pageNumber}`;

  return (
    <View style={[styles.spacePageRow, active && styles.spacePageRowActive, editing && styles.spacePageRowEditing]}>
      <View style={styles.spacePageLeadingControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Go to page ${pageNumber}`} style={styles.spacePagePill} onPress={() => onLocatePage(pageNumber)}>
          <Text style={styles.spacePagePillText}>{pageNumber}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={active ? 'Turn off region overlay' : 'Turn on region overlay'}
          disabled={!region}
          style={[styles.regionOverlayToggle, active && styles.toggleActive, !region && styles.regionOverlayToggleDisabled]}
          onPress={() => {
            if (region) onToggleRegion(space.id, region.id);
          }}
        >
          <View style={[styles.regionOverlayToggleKnob, active && styles.regionOverlayToggleKnobActive]} />
        </Pressable>
      </View>

      <View style={styles.spacePageCopy}>
        {region ? (
          <TextInput
            accessibilityLabel="Region name"
            value={region.name}
            onChangeText={(value) => onUpdateRegion(space.id, region.id, { name: value })}
            onBlur={() => {
              if (!region.name.trim()) onUpdateRegion(space.id, region.id, { name: `Region ${pageNumber}` });
            }}
            style={styles.spacePageRegionName}
          />
        ) : (
          <Text numberOfLines={1} style={styles.spacePageRegionName}>{regionLabel}</Text>
        )}
        <Text numberOfLines={1} style={styles.regionMeta}>
          {regionCount ? `${regionCount} region${regionCount === 1 ? '' : 's'}` : 'No region defined'}
        </Text>
      </View>

      <View style={styles.regionActionControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Exit region edit' : 'Edit region area'}
          style={[styles.regionActionButton, editing && styles.regionActionButtonActive]}
          onPress={() => {
            if (region) onEditRegion(space.id, region.id);
            else onCreateRegion(space.id, pageNumber);
          }}
        >
          <SquareDashed color={editing ? colors.blue : colors.text} size={13} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={surveyMode ? 'Toggle survey annotations' : 'Toggle canvas annotations'}
          disabled={visibilityDisabled}
          style={[styles.regionActionButton, visibilityOn && styles.regionActionButtonActive, visibilityDisabled && styles.regionActionButtonDisabled]}
          onPress={() => {
            if (!region) return;
            if (surveyMode) onUpdateRegion(space.id, region.id, { showSurveyAnnotations: !region.showSurveyAnnotations });
            else onUpdateRegion(space.id, region.id, { showCanvasAnnotations: !region.showCanvasAnnotations });
          }}
        >
          {surveyMode ? (
            <SurveyIcon color={visibilityOn ? colors.blue : colors.text} size={13} />
          ) : (
            <Lightbulb color={visibilityOn ? colors.blue : colors.text} size={13} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove page from space"
          style={styles.regionActionButton}
          onPress={() => onRemovePage(pageNumber)}
        >
          <X color="#F08A8A" size={12} />
        </Pressable>
      </View>
    </View>
  );
}

function RegionRow({
  spaceId,
  region,
  index,
  count,
  active,
  editing,
  onToggleRegion,
  onUpdateRegion,
  onDeleteRegion,
  onMoveRegion,
  onLocateRegion,
  onEditRegion,
}: {
  spaceId: string;
  region: RegionConfig;
  index: number;
  count: number;
  active: boolean;
  editing: boolean;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onDeleteRegion: (spaceId: string, regionId: string) => void;
  onMoveRegion: (spaceId: string, regionId: string, delta: number) => void;
  onLocateRegion: (spaceId: string, regionId: string) => void;
  onEditRegion: (spaceId: string, regionId: string) => void;
}) {
  const dragProgressRef = useRef(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7,
        onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const step = 48;
          const delta = Math.trunc((gesture.dy - dragProgressRef.current) / step);
          if (!delta) return;
          dragProgressRef.current += delta * step;
          onMoveRegion(spaceId, region.id, delta);
        },
        onPanResponderRelease: () => {
          dragProgressRef.current = 0;
        },
        onPanResponderTerminate: () => {
          dragProgressRef.current = 0;
        },
      }),
    [onMoveRegion, region.id, spaceId]
  );
  const first = index === 0;
  const last = index === count - 1;

  return (
    <View style={[styles.regionCard, active && styles.regionCardActive, editing && styles.regionCardEditing]} {...panResponder.panHandlers}>
      <View style={styles.regionDragHandle}>
        <GripVertical color={colors.faint} size={14} />
      </View>
      <View style={styles.regionCopy}>
        <TextInput
          accessibilityLabel="Region name"
          value={region.name}
          onChangeText={(value) => onUpdateRegion(spaceId, region.id, { name: value })}
          onBlur={() => {
            if (!region.name.trim()) onUpdateRegion(spaceId, region.id, { name: `Region ${index + 1}` });
          }}
          style={styles.regionNameInput}
        />
        <Text style={styles.regionMeta}>Page {region.page} · {region.surveyBound ? 'Survey-bound' : 'Regular annotations'}</Text>
      </View>
      <View style={styles.regionActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Locate region" style={styles.regionActionButton} onPress={() => onLocateRegion(spaceId, region.id)}>
          <Search color={colors.text} size={13} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit region" style={[styles.regionActionButton, editing && styles.regionActionButtonActive]} onPress={() => onEditRegion(spaceId, region.id)}>
          <SquareDashed color={editing ? colors.blue : colors.text} size={13} />
        </Pressable>
        <Pressable accessibilityRole="switch" accessibilityLabel="Region active" style={[styles.regionToggle, active && styles.toggleActive]} onPress={() => onToggleRegion(spaceId, region.id)}>
          <View style={[styles.regionToggleKnob, active && styles.regionToggleKnobActive]} />
        </Pressable>
      </View>
      <View style={styles.regionMoveDeleteRow}>
        <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move region up" style={[styles.regionTinyButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveRegion(spaceId, region.id, -1)}>
          <ChevronLeft color={first ? colors.faint : colors.text} size={12} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
        <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move region down" style={[styles.regionTinyButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveRegion(spaceId, region.id, 1)}>
          <ChevronRight color={last ? colors.faint : colors.text} size={12} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete region" style={styles.regionTinyButton} onPress={() => onDeleteRegion(spaceId, region.id)}>
          <X color={colors.muted} size={12} />
        </Pressable>
      </View>
    </View>
  );
}

function VersionHistoryDrawer({
  panelHeight,
  bottomInset,
  onClose,
}: {
  panelHeight: number;
  bottomInset: number;
  onClose: () => void;
}) {
  return (
    <View style={[styles.drawer, { height: panelHeight, paddingBottom: bottomInset + 14 }]}>
      <View style={styles.drawerHeader}>
        <View>
          <Text style={styles.drawerTitle}>Version History</Text>
          <Text style={styles.drawerSubtitle}>Online status and recent document activity</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Hide version history panel" onPress={onClose}>
          <X color={colors.text} size={18} />
        </Pressable>
      </View>
      <ScrollView style={styles.versionList} contentContainerStyle={styles.versionListContent} showsVerticalScrollIndicator={false}>
        {versionHistoryItems.map((item) => (
          <View key={item.id} style={styles.versionRow}>
            <View style={styles.versionDot} />
            <View style={styles.versionCopy}>
              <Text style={styles.versionTitle}>{item.title}</Text>
              <Text style={styles.versionMeta}>{item.meta}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function ActiveUsersDrawer({
  panelHeight,
  bottomInset,
  onClose,
}: {
  panelHeight: number;
  bottomInset: number;
  onClose: () => void;
}) {
  return (
    <View style={[styles.drawer, { height: panelHeight, paddingBottom: bottomInset + 14 }]}>
      <View style={styles.drawerHeader}>
        <View>
          <Text style={styles.drawerTitle}>Active Users</Text>
          <Text style={styles.drawerSubtitle}>{activeUsers.length} people currently in this document</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Hide active users panel" onPress={onClose}>
          <X color={colors.text} size={18} />
        </Pressable>
      </View>
      <ScrollView style={styles.versionList} contentContainerStyle={styles.versionListContent} showsVerticalScrollIndicator={false}>
        {activeUsers.map((user, index) => (
          <View key={user.id} style={styles.activeUserRow}>
            <View style={[styles.activeUserAvatar, index === 0 && styles.activeUserAvatarOwner]}>
              <Text style={styles.activeUserAvatarText}>{user.initials}</Text>
            </View>
            <View style={styles.versionCopy}>
              <Text style={styles.versionTitle}>{user.name}</Text>
              <Text style={styles.versionMeta}>{user.role} - {user.status}</Text>
            </View>
            <View style={styles.activeUserStatusDot} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function FloorPlan({ pageWidth, pageHeight }: { pageWidth: number; pageHeight: number }) {
  const wall = '#303640';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.16, width: pageWidth * 0.76, height: 3, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.16, width: 3, height: pageHeight * 0.62, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.88, top: pageHeight * 0.16, width: 3, height: pageHeight * 0.62, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.78, width: pageWidth * 0.76, height: 3, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.43, top: pageHeight * 0.16, width: 3, height: pageHeight * 0.34, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.5, width: pageWidth * 0.76, height: 3, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.63, top: pageHeight * 0.5, width: 3, height: pageHeight * 0.28, backgroundColor: wall }]} />
      <Text style={[styles.roomLabel, { left: pageWidth * 0.2, top: pageHeight * 0.27 }]}>LOBBY</Text>
      <Text style={[styles.roomLabel, { left: pageWidth * 0.54, top: pageHeight * 0.29 }]}>OFFICE</Text>
      <Text style={[styles.roomLabel, { left: pageWidth * 0.24, top: pageHeight * 0.62 }]}>RETAIL</Text>
      <Text style={[styles.roomLabel, { left: pageWidth * 0.68, top: pageHeight * 0.63 }]}>IDF</Text>
    </View>
  );
}

function RegionOverlay({
  pageWidth,
  pageHeight,
  region,
  editing,
  onPress,
  onLongPress,
}: {
  pageWidth: number;
  pageHeight: number;
  region: RegionConfig;
  editing: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      delayLongPress={420}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      onLongPress={(event) => {
        event.stopPropagation();
        onLongPress();
      }}
      style={[
        styles.regionOverlay,
        editing && styles.regionOverlayEditing,
        {
          left: pageWidth * region.bounds.x,
          top: pageHeight * region.bounds.y,
          width: pageWidth * region.bounds.width,
          height: pageHeight * region.bounds.height,
        },
      ]}
    >
      <Text style={styles.regionOverlayText}>{region.name.split('-')[0].trim() || 'Region'}</Text>
    </Pressable>
  );
}

function FloatingContextMenu({
  menu,
  onDismiss,
}: {
  menu: ContextMenuState;
  onDismiss: () => void;
}) {
  return (
    <>
      <Pressable style={styles.contextMenuDismissLayer} onPress={onDismiss} />
      <View style={[styles.contextMenuPanel, { left: menu.x, top: menu.y, width: menu.width ?? 154 }]}>
        <Text numberOfLines={1} style={styles.contextMenuTitle}>{menu.title}</Text>
        <View style={styles.contextMenuDivider} />
        {menu.actions.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            disabled={action.disabled}
            style={[styles.contextMenuAction, action.disabled && styles.contextMenuActionDisabled]}
            onPress={() => {
              if (action.disabled) return;
              action.onPress();
            }}
          >
            <Text style={[
              styles.contextMenuActionText,
              action.destructive && styles.contextMenuActionTextDestructive,
              action.disabled && styles.contextMenuActionTextDisabled,
            ]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nextMarkerId(markers: Marker[]) {
  return markers.reduce((max, marker) => Math.max(max, marker.id), 0) + 1;
}

function checklistResponseKey(categoryId: string, item: string) {
  return `${categoryId}:${item}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    paddingHorizontal: 0,
    backgroundColor: colors.chrome,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 90,
  },
  topLeftGroup: {
    position: 'absolute',
    left: 7,
    bottom: 4,
    maxWidth: 172,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  topCenterGroup: {
    position: 'absolute',
    left: '50%',
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    transform: [{ translateX: -34 }],
    zIndex: 95,
  },
  topIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBackButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titlePill: {
    height: 25,
    maxWidth: 136,
    paddingHorizontal: 12,
    borderRadius: 5,
    backgroundColor: '#2A2B31',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  titleText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  topActions: {
    position: 'absolute',
    right: 9,
    bottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  subBar: {
    backgroundColor: '#202126',
    borderBottomWidth: 1,
    borderBottomColor: '#090A0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    position: 'relative',
    zIndex: 70,
  },
  historyTools: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    zIndex: 96,
  },
  historyButton: {
    width: 26,
    height: 26,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  historyButtonDisabled: {
    opacity: 0.56,
  },
  pageZoomTools: {
    position: 'relative',
    width: 68,
    alignItems: 'center',
    zIndex: 80,
  },
  pageZoomButton: {
    height: 24,
    width: 68,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#343B46',
    backgroundColor: '#171A20',
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pageZoomButtonActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#121B2A',
  },
  pageZoomText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  pageZoomInput: {
    width: 16,
    height: 20,
    padding: 0,
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  pageZoomMenu: {
    position: 'absolute',
    top: 29,
    left: -35,
    width: 138,
    borderRadius: 8,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: '#3A4250',
    padding: 5,
    gap: 3,
  },
  pageZoomMenuItem: {
    height: 30,
    borderRadius: 6,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageZoomMenuItemActive: {
    backgroundColor: '#132135',
  },
  pageZoomMenuText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  pageZoomMenuTextActive: {
    color: colors.blue,
  },
  annotationFormatLayer: {
    position: 'absolute',
    right: 0,
    zIndex: 58,
  },
  annotationFormatBar: {
    height: 36,
    backgroundColor: '#202126',
    borderBottomWidth: 1,
    borderBottomColor: '#090A0D',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  annotationFormatCenter: {
    width: '100%',
    height: 36,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  formatKeepActiveButton: {
    height: 30,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3F4652',
    backgroundColor: '#2A2D34',
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  formatKeepActiveButtonActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#132235',
  },
  formatKeepActiveBox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#8A93A3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatKeepActiveBoxActive: {
    backgroundColor: colors.blue,
    borderColor: colors.blue,
  },
  formatKeepActiveText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  formatKeepActiveTextActive: {
    color: colors.blue,
  },
  surveyModuleEmptyPill: {
    height: 30,
    minWidth: 116,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3F4652',
    backgroundColor: '#2A2D34',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  surveyModuleEmptyText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  regionFormatButton: {
    height: 30,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3F4652',
    backgroundColor: '#2A2D34',
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  regionFormatButtonPrimary: {
    borderColor: colors.blue,
    backgroundColor: colors.blue,
  },
  regionFormatButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  regionFormatButtonTextPrimary: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  regionConfirmText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    maxWidth: 146,
  },
  textFormatSubToolbar: {
    position: 'absolute',
    top: 36,
    left: 0,
    right: 0,
    height: 36,
    backgroundColor: '#1B1C21',
    borderBottomWidth: 1,
    borderBottomColor: '#090A0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
    zIndex: 1,
  },
  contextColorSwatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  checkerCellOne: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 12,
    height: 12,
    backgroundColor: '#CFCFCF',
  },
  checkerCellTwo: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    backgroundColor: '#CFCFCF',
  },
  contextColorFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  counterSwatchText: {
    position: 'relative',
    zIndex: 2,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 13,
  },
  desktopNumberInput: {
    width: 36,
    height: 24,
    paddingVertical: 0,
    paddingHorizontal: 4,
    backgroundColor: '#444',
    color: '#DDD',
    borderRadius: 5,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  desktopMenuButton: {
    height: 24,
    paddingLeft: 8,
    paddingRight: 7,
    borderRadius: 5,
    backgroundColor: '#444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  desktopMenuButtonText: {
    flexShrink: 1,
    color: '#DDD',
    fontSize: 12,
    fontWeight: '700',
  },
  formatDropdownAnchor: {
    position: 'relative',
    zIndex: 320,
  },
  formatDropdownMenu: {
    position: 'absolute',
    top: 30,
    left: 0,
    maxHeight: 166,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#1E1E1E',
    padding: 4,
    zIndex: 340,
  },
  formatDropdownScroll: {
    maxHeight: 156,
  },
  formatDropdownRow: {
    minHeight: 30,
    borderRadius: 4,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  formatDropdownRowActive: {
    backgroundColor: '#132135',
  },
  formatDropdownText: {
    flex: 1,
    color: '#DDD',
    fontSize: 12,
    fontWeight: '700',
  },
  formatDropdownTextActive: {
    color: colors.blue,
  },
  textFormatMenuAnchor: {
    position: 'relative',
  },
  textFormatMenuButton: {
    minWidth: 42,
    justifyContent: 'center',
  },
  textFormatDropdown: {
    position: 'absolute',
    top: 30,
    left: 0,
    minWidth: 144,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#1E1E1E',
    padding: 4,
    zIndex: 200,
  },
  textFormatDropdownRow: {
    height: 30,
    borderRadius: 4,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textFormatDropdownRowActive: {
    backgroundColor: 'rgba(216,168,78,0.12)',
  },
  textFormatDropdownLabel: {
    color: '#DDD',
    fontSize: 12,
    fontWeight: '700',
  },
  counterSeriesMenuAnchor: {
    position: 'relative',
    zIndex: 260,
  },
  counterSeriesDropdown: {
    position: 'absolute',
    top: 30,
    left: 0,
    minWidth: 160,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#1E1E1E',
    padding: 4,
    zIndex: 260,
  },
  counterSeriesHeader: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  counterSeriesSubheader: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  counterSeriesRow: {
    minHeight: 30,
    borderRadius: 4,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  counterSeriesRowActive: {
    backgroundColor: '#2A2A2A',
  },
  counterSeriesDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  counterSeriesLabel: {
    flex: 1,
    color: '#DDD',
    fontSize: 12,
    fontWeight: '700',
  },
  counterSeriesCount: {
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
  },
  formatPillText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
  },
  formatTextModeButton: {
    minWidth: 34,
    height: 24,
    borderRadius: 5,
    backgroundColor: '#444',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  formatTextModeButtonActive: {
    borderColor: colors.blue,
    backgroundColor: '#132135',
  },
  bumpControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bumpLabel: {
    color: '#BBB',
    fontSize: 11,
    fontWeight: '700',
  },
  desktopFormatButton: {
    width: 28,
    height: 24,
    borderRadius: 5,
    backgroundColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopFormatButtonActive: {
    backgroundColor: 'rgba(216,168,78,0.18)',
  },
  desktopFormatButtonText: {
    color: '#DDD',
    fontSize: 13,
    fontWeight: '800',
  },
  desktopFormatButtonTextActive: {
    color: '#D8A84E',
  },
  boldFormatText: {
    fontWeight: '900',
  },
  italicFormatText: {
    fontStyle: 'italic',
  },
  underlineFormatText: {
    textDecorationLine: 'underline',
  },
  strikeFormatText: {
    textDecorationLine: 'line-through',
  },
  alignGridButton: {
    width: 28,
    height: 26,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#383D46',
    backgroundColor: '#2A2E36',
    padding: 5,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  alignGridDot: {
    width: 4,
    height: 4,
    borderRadius: 1,
    backgroundColor: 'rgba(168,176,191,0.4)',
  },
  alignGridDotActive: {
    backgroundColor: '#D8A84E',
  },
  workArea: {
    flex: 1,
    flexDirection: 'row',
  },
  rail: {
    backgroundColor: colors.rail,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    paddingTop: 7,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 5,
  },
  railButton: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  railButtonActive: {
    backgroundColor: '#111820',
    borderColor: '#2B6FB6',
  },
  railDivider: {
    width: 26,
    height: 1,
    backgroundColor: '#4A4F59',
    marginVertical: 3,
  },
  railSubDivider: {
    width: 20,
    height: 1,
    backgroundColor: '#3C424C',
    marginTop: 3,
    marginBottom: 1,
  },
  railSubMiniDivider: {
    width: 18,
    height: 1,
    backgroundColor: '#3C424C',
    marginVertical: 2,
  },
  railSubToolbar: {
    width: 34,
    borderRadius: 8,
    backgroundColor: '#1A1E25',
    borderWidth: 1,
    borderColor: '#323844',
    paddingVertical: 4,
    alignItems: 'center',
    gap: 4,
  },
  railSubButton: {
    width: 28,
    height: 28,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  railSubButtonActive: {
    backgroundColor: '#111820',
    borderColor: '#2B6FB6',
  },
  railSurveyCategoryToolbar: {
    width: 34,
    borderRadius: 8,
    backgroundColor: '#1A1E25',
    borderWidth: 1,
    borderColor: '#323844',
    paddingVertical: 4,
    alignItems: 'center',
    gap: 4,
  },
  railSurveyCategoryButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2A2D34',
    borderWidth: 1,
    borderColor: '#555C68',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  railSurveyCategoryButtonActive: {
    backgroundColor: colors.blue,
    borderColor: colors.blue,
  },
  railSurveyCategoryText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  railSurveyCategoryTextActive: {
    color: '#FFFFFF',
  },
  railSurveyEntityToolbar: {
    width: 34,
    borderRadius: 8,
    backgroundColor: '#1A1E25',
    borderWidth: 1,
    borderColor: '#323844',
    paddingVertical: 4,
    alignItems: 'center',
    gap: 4,
  },
  railSurveyEntityButton: {
    width: 28,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railSurveyEntityButtonActive: {
    backgroundColor: '#111820',
    borderColor: colors.blue,
  },
  railSurveyEntitySwatch: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0C0F13',
  },
  railSpacer: {
    flex: 1,
  },
  railFooterTools: {
    width: 34,
    alignItems: 'center',
    gap: 0,
    paddingBottom: 0,
    transform: [{ translateY: 34 }],
  },
  railFooterMenuButton: {
    width: 34,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railFooterButtonStack: {
    marginTop: 4,
    alignItems: 'center',
    gap: 5,
    transform: [{ translateY: -5 }],
  },
  railFooterButton: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    position: 'relative',
    transform: [{ translateY: -3 }],
  },
  syncStatusButton: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncStatusCircle: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  activeUsersButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    transform: [{ translateY: -3 }],
  },
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2A3B54',
    borderWidth: 1,
    borderColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
  },
  userCountBadge: {
    position: 'absolute',
    right: -2,
    top: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.blue,
    borderWidth: 1,
    borderColor: colors.rail,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  userCountText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  documentScroll: {
    flex: 1,
    backgroundColor: '#070A0D',
  },
  documentContent: {
    paddingBottom: 88,
  },
  page: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: '#D8D8D0',
    overflow: 'hidden',
  },
  planWall: {
    position: 'absolute',
    borderRadius: 2,
  },
  roomLabel: {
    position: 'absolute',
    color: '#68707A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  regionOverlay: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.blue,
    backgroundColor: 'rgba(74, 144, 226, 0.13)',
  },
  regionOverlayEditing: {
    borderStyle: 'dashed',
    backgroundColor: 'rgba(74, 144, 226, 0.2)',
  },
  regionOverlayText: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: '800',
    padding: 4,
  },
  contextMenuDismissLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 84,
    backgroundColor: 'rgba(0,0,0,0.01)',
  },
  contextMenuPanel: {
    position: 'absolute',
    width: 154,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#3C424D',
    backgroundColor: '#181B20',
    padding: 6,
    zIndex: 85,
    gap: 3,
  },
  contextMenuTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  contextMenuDivider: {
    height: 1,
    backgroundColor: '#343A45',
  },
  contextMenuAction: {
    height: 34,
    borderRadius: 6,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  contextMenuActionDisabled: {
    opacity: 0.45,
  },
  contextMenuActionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  contextMenuActionTextDestructive: {
    color: '#F08A8A',
  },
  contextMenuActionTextDisabled: {
    color: colors.faint,
  },
  marker: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inkDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.red,
  },
  markerText: {
    color: '#111',
    fontSize: 12,
    fontWeight: '900',
  },
  bottomActionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 45,
  },
  bottomBarSurface: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.chrome,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  bottomActionNudge: {
    transform: [{ translateY: 4 }],
  },
  bottomSideButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#181A1F',
    borderWidth: 1,
    borderColor: '#2E333C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomSideButtonActive: {
    backgroundColor: '#162236',
    borderColor: '#315F91',
  },
  bottomHubButton: {
    minWidth: 124,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#20242C',
    borderWidth: 1,
    borderColor: '#3A4250',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  bottomHubButtonActive: {
    backgroundColor: '#162236',
    borderColor: '#315F91',
  },
  bottomHubText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    maxWidth: 82,
  },
  bottomHubTextActive: {
    color: colors.blue,
  },
  hubTray: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: '#444B57',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
    zIndex: 60,
  },
  hubGrabber: {
    alignSelf: 'center',
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#6D7380',
    marginBottom: 2,
  },
  hubTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    position: 'relative',
  },
  hubTab: {
    width: 34,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubTabActive: {
    backgroundColor: '#1A3328',
  },
  hubClose: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#353A43',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageCounterRow: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pageCounterPill: {
    minWidth: 58,
    height: 30,
    paddingHorizontal: 16,
    borderRadius: 15,
    backgroundColor: '#171A20',
    borderWidth: 1,
    borderColor: '#353B46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageCounterValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pageCounterMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pageThumbScroller: {
    flexGrow: 0,
  },
  pageThumbTrack: {
    gap: 16,
    paddingHorizontal: 1,
    paddingTop: 2,
    paddingBottom: 2,
  },
  pageCard: {
    width: 130,
    height: 146,
    borderRadius: 8,
    backgroundColor: '#20242B',
    borderWidth: 1,
    borderColor: '#2F3641',
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  pageCardPressArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 12,
  },
  pageCardActive: {
    backgroundColor: '#1D2740',
    borderColor: '#2F6BB8',
  },
  pageCardDragging: {
    borderColor: colors.green,
    backgroundColor: '#1A2D25',
  },
  pagePreviewPaper: {
    width: 92,
    height: 112,
    borderRadius: 5,
    backgroundColor: '#FAFAF8',
    borderWidth: 1,
    borderColor: '#E5E5DE',
    overflow: 'hidden',
  },
  pagePreviewHeader: {
    height: 24,
    borderRadius: 3,
    backgroundColor: '#E7EDF4',
    marginBottom: 5,
  },
  pagePreviewLineShort: {
    width: '52%',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#B9C0CA',
  },
  pagePreviewLine: {
    width: '76%',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D3D8DF',
  },
  pageCardBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: '#E1E1DA',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  pageCardBadgeText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  pageActiveRail: {
    position: 'absolute',
    left: 4,
    top: 40,
    bottom: 40,
    width: 5,
    borderRadius: 3,
    backgroundColor: '#58D976',
  },
  pageCardMore: {
    position: 'absolute',
    right: 7,
    bottom: 54,
    width: 26,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(20, 24, 30, 0.82)',
    borderWidth: 1,
    borderColor: '#343A45',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageClipboardBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#132A20',
    borderWidth: 1,
    borderColor: '#2E8F5A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  pageDragHandle: {
    position: 'absolute',
    left: 44,
    right: 44,
    bottom: 2,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageMoveButtons: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageMoveButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#242A33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubActionPill: {
    alignSelf: 'center',
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  hubActionButton: {
    height: 34,
    minWidth: 72,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 9,
  },
  hubActionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  hubActionDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#343A45',
  },
  searchBox: {
    height: 42,
    borderRadius: 7,
    backgroundColor: '#171A20',
    borderWidth: 1,
    borderColor: '#333944',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    padding: 0,
  },
  resultList: {
    maxHeight: 112,
  },
  resultRow: {
    minHeight: 44,
    borderRadius: 6,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#333944',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 7,
  },
  resultTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  resultMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  searchEmptyState: {
    flex: 1,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 9,
  },
  searchEmptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  searchEmptyMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 17,
  },
  bookmarkList: {
    gap: 8,
  },
  bookmarkRows: {
    maxHeight: 166,
  },
  bookmarkRowsContent: {
    gap: 7,
    paddingBottom: 2,
  },
  bookmarkItem: {
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#333944',
    borderRadius: 6,
    paddingLeft: 5,
    paddingRight: 7,
    paddingVertical: 6,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  bookmarkDragHandle: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkIconBubble: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#20242C',
    borderWidth: 1,
    borderColor: '#343A45',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkOpenArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  bookmarkCopy: {
    flex: 1,
    minWidth: 0,
  },
  bookmarkMoveButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bookmarkMoveButton: {
    width: 22,
    height: 24,
    borderRadius: 5,
    backgroundColor: '#242A33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkMoveButtonDisabled: {
    opacity: 0.36,
  },
  bookmarkTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  bookmarkEmpty: {
    minHeight: 76,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#333944',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bookmarkEmptyText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  drawer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.panel,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderTopColor: '#444B57',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
    zIndex: 65,
  },
  annotationEditSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.panel,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderTopColor: '#444B57',
    paddingHorizontal: 16,
    paddingTop: 10,
    zIndex: 68,
  },
  annotationEditTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  annotationEditSegmentedTabs: {
    width: 224,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  annotationEditSegmentedTab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  annotationEditSegmentedTabActive: {
    backgroundColor: '#132135',
  },
  annotationEditSegmentedDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#343A45',
  },
  annotationEditTab: {
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 11,
  },
  annotationEditTabActive: {
    backgroundColor: '#132135',
    borderColor: '#2B6FB6',
  },
  annotationEditTabSwatch: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  annotationEditTabText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
  },
  annotationEditTabTextActive: {
    color: colors.text,
  },
  annotationColorTabs: {
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#141820',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  annotationColorTab: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  annotationColorTabActive: {
    backgroundColor: '#132135',
  },
  annotationColorTabsDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#343A45',
  },
  annotationColorTabText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
  },
  annotationColorTabTextActive: {
    color: colors.text,
  },
  annotationEditScroll: {
    flex: 1,
    marginTop: 12,
  },
  annotationEditContent: {
    gap: 10,
  },
  annotationEditCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    padding: 11,
    gap: 10,
  },
  annotationEditCardCompact: {
    padding: 9,
    gap: 8,
  },
  annotationTextControlsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  annotationTextFormatCard: {
    flex: 1,
  },
  annotationTextSizeCard: {
    flex: 1,
    alignItems: 'center',
  },
  annotationSplitControlCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: 0,
    gap: 0,
  },
  annotationSplitControlPane: {
    flex: 1,
    padding: 11,
    gap: 10,
    alignItems: 'center',
  },
  annotationSplitControlDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#343A45',
  },
  annotationStrokeSizeCard: {
    flex: 1,
    alignItems: 'center',
  },
  annotationStrokeStyleCard: {
    flex: 1,
    alignItems: 'center',
  },
  annotationEditCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  annotationEditLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  annotationEditValue: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  annotationEditSwatchButton: {
    borderRadius: 22,
  },
  annotationEditLargeSwatch: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
  },
  annotationEditCompactSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  annotationColorGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    gap: 0,
  },
  annotationColorChoice: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#3B424E',
    backgroundColor: '#15181D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  annotationColorChoiceActive: {
    borderColor: colors.blue,
    backgroundColor: '#122238',
  },
  annotationColorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  gradientPickerContent: {
    gap: 12,
  },
  gradientPickerSquare: {
    height: 176,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#111318',
    position: 'relative',
  },
  gradientPickerThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    marginTop: -10,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  gradientPickerRow: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gradientPickerLabel: {
    width: 66,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
  },
  gradientHueTrack: {
    flex: 1,
    height: 16,
    borderRadius: 8,
    overflow: 'visible',
    position: 'relative',
    backgroundColor: '#222833',
  },
  gradientHueThumb: {
    position: 'absolute',
    top: -3,
    width: 22,
    height: 22,
    marginLeft: -11,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  gradientPickerValue: {
    width: 46,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  gradientOpacityTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#444B57',
    position: 'relative',
  },
  gradientOpacityFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: colors.blue,
  },
  gradientOpacityThumb: {
    position: 'absolute',
    top: -12,
    width: 30,
    height: 30,
    marginLeft: -15,
    borderRadius: 15,
    backgroundColor: colors.blue,
  },
  gradientPickerDivider: {
    height: 1,
    backgroundColor: '#343A45',
  },
  gradientPickerInputRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gradientPickerPreview: {
    width: 52,
    height: 42,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#555D6B',
  },
  gradientPickerHexInput: {
    flex: 1,
    height: 42,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#15181D',
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    paddingHorizontal: 14,
    fontVariant: ['tabular-nums'],
  },
  gradientPickerOpacityInput: {
    width: 86,
    height: 42,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#15181D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  gradientPickerOpacityTextInput: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'right',
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
  gradientPickerPercentText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '900',
  },
  gradientPickerDoneButton: {
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradientPickerDoneText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  annotationEditRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  annotationEditRowTight: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  annotationEditNumberInput: {
    width: 52,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3A4250',
    backgroundColor: '#242A33',
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
  annotationDropdownField: {
    minHeight: 36,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3A4250',
    backgroundColor: '#242A33',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  annotationDropdownValue: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  annotationDropdownWrap: {
    position: 'relative',
    zIndex: 30,
  },
  annotationDropdownFullWidth: {
    alignSelf: 'stretch',
  },
  annotationDropdownMenu: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#171A20',
    padding: 4,
    gap: 2,
  },
  annotationDropdownMenuPopover: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 42,
    maxHeight: 174,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#171A20',
    padding: 4,
    zIndex: 80,
  },
  annotationDropdownMenuScroll: {
    maxHeight: 164,
  },
  annotationDropdownItem: {
    minHeight: 34,
    borderRadius: 6,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  annotationDropdownItemActive: {
    backgroundColor: '#132135',
  },
  annotationDropdownItemText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  annotationDropdownItemTextActive: {
    color: colors.text,
  },
  annotationChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  annotationChip: {
    minHeight: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#242A33',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  annotationChipActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#132135',
  },
  annotationChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  annotationChipTextActive: {
    color: colors.text,
  },
  annotationFormatToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  annotationFormatToggle: {
    width: 31,
    height: 31,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#242A33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  annotationAlignmentGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  annotationAlignmentGroupLabel: {
    width: 72,
    color: colors.muted,
    fontSize: 10,
    fontWeight: '900',
  },
  annotationAlignmentChoiceRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
  },
  annotationAlignmentChoice: {
    flex: 1,
    height: 43,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#242A33',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  annotationAlignmentChoiceActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#132135',
  },
  annotationAlignButton: {
    width: 34,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#242A33',
    padding: 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  drawerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  drawerSubtitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  versionList: {
    flex: 1,
  },
  versionListContent: {
    gap: 7,
    paddingBottom: 2,
  },
  versionRow: {
    minHeight: 50,
    borderRadius: 8,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  versionDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#58D976',
  },
  versionCopy: {
    flex: 1,
  },
  versionTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  versionMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  activeUserRow: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  activeUserAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2A3B54',
    borderWidth: 1,
    borderColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeUserAvatarOwner: {
    backgroundColor: '#263A2D',
    borderColor: '#58D976',
  },
  activeUserAvatarText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
  },
  activeUserStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#58D976',
  },
  spaceCard: {
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    borderRadius: 8,
    padding: 10,
    gap: 10,
  },
  spaceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spaceName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  spaceMeta: {
    color: colors.muted,
    fontSize: 11,
  },
  regionCard: {
    backgroundColor: '#242A33',
    borderRadius: 6,
    padding: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  regionName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  regionMeta: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3A3F49',
    padding: 3,
  },
  toggleActive: {
    backgroundColor: '#28598D',
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.muted,
  },
  toggleKnobActive: {
    transform: [{ translateX: 16 }],
    backgroundColor: colors.text,
  },
  editRegionButton: {
    height: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#315F91',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  editRegionText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: '800',
  },
  newSpaceButton: {
    flex: 1,
    height: 38,
    borderRadius: 6,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newSpaceText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  drawerFooter: {
    flexDirection: 'row',
    gap: 10,
  },
  exitRegionButton: {
    flex: 1,
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3A4250',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitRegionText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  spacesDrawer: {
    gap: 9,
    paddingTop: 10,
  },
  spacesDrawerHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  spacesHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  spacesHeaderButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacesHeaderButtonActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#132135',
  },
  spacesHeaderButtonDisabled: {
    opacity: 0.45,
  },
  spacesExportWrap: {
    position: 'relative',
    zIndex: 30,
  },
  spacesExportMenu: {
    position: 'absolute',
    right: 0,
    top: 36,
    width: 116,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3C424D',
    backgroundColor: '#181B20',
    padding: 5,
    gap: 4,
  },
  spacesExportMenuItem: {
    height: 30,
    borderRadius: 5,
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  spacesExportMenuText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  spacesList: {
    flex: 1,
  },
  spacesListContent: {
    gap: 8,
    paddingBottom: 2,
  },
  spaceCardActive: {
    borderColor: 'transparent',
    backgroundColor: '#2B2B2B',
  },
  spaceCardHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spaceCardLeadingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  spaceDragHandle: {
    width: 20,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceRegionCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  spaceRegionCountText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  spaceExpandButton: {
    width: 22,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceNameInput: {
    flex: 1,
    minWidth: 0,
    height: 30,
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    padding: 0,
  },
  spaceHeaderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  spaceDeleteButton: {
    width: 25,
    height: 25,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceCollapsedMetaRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 52,
  },
  rowMoveButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  spaceExpandedBody: {
    borderTopWidth: 1,
    borderTopColor: '#3A3A3A',
    paddingTop: 9,
    gap: 8,
  },
  spacePageAssignRow: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spacePageInput: {
    flex: 1,
    height: 28,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    backgroundColor: '#1F1F1F',
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  spaceAddPagesButton: {
    width: 28,
    height: 28,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    backgroundColor: '#242A33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceSmallButtonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  spaceIconButton: {
    width: 32,
    height: 32,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#242A33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacePageError: {
    color: '#F08A8A',
    fontSize: 11,
    fontWeight: '800',
  },
  spacePageRows: {
    gap: 6,
  },
  spaceNoPagesRow: {
    minHeight: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#1F1F1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceExpandedFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
  },
  spacePageRow: {
    minHeight: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#1F1F1F',
    paddingHorizontal: 7,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spacePageRowActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#17263A',
  },
  spacePageRowEditing: {
    borderStyle: 'dashed',
  },
  spacePageLeadingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spacePagePill: {
    minWidth: 26,
    height: 24,
    borderRadius: 5,
    backgroundColor: '#242A33',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  spacePagePillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  regionOverlayToggle: {
    width: 28,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#3A3A3A',
    borderWidth: 1,
    borderColor: '#4A4A4A',
    padding: 2,
  },
  regionOverlayToggleDisabled: {
    opacity: 0.45,
  },
  regionOverlayToggleKnob: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.muted,
  },
  regionOverlayToggleKnobActive: {
    transform: [{ translateX: 12 }],
    backgroundColor: colors.text,
  },
  spacePageCopy: {
    flex: 1,
    minWidth: 0,
  },
  spacePageRegionName: {
    height: 19,
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    padding: 0,
  },
  regionActionControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  regionCardActive: {
    borderWidth: 1,
    borderColor: '#2B6FB6',
    backgroundColor: '#17263A',
  },
  regionCardEditing: {
    borderStyle: 'dashed',
  },
  regionDragHandle: {
    width: 18,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionCopy: {
    flex: 1,
    minWidth: 0,
  },
  regionNameInput: {
    height: 22,
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    padding: 0,
  },
  regionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  regionActionButton: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionActionButtonActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#132135',
  },
  regionActionButtonDisabled: {
    opacity: 0.45,
  },
  regionToggle: {
    width: 34,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#3A3F49',
    padding: 3,
  },
  regionToggleKnob: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: colors.muted,
  },
  regionToggleKnobActive: {
    transform: [{ translateX: 13 }],
    backgroundColor: colors.text,
  },
  regionMoveDeleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  regionTinyButton: {
    width: 22,
    height: 24,
    borderRadius: 5,
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRegionRow: {
    minHeight: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#15181D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceEmptyState: {
    minHeight: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  spaceEmptyText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  exitRegionButtonFull: {
    height: 36,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#51404A',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.panel,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderTopColor: '#444B57',
    paddingHorizontal: 16,
    paddingTop: 6,
    zIndex: 70,
  },
  dismissLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.01)',
    zIndex: 25,
  },
  popoverDismissLayer: {
    zIndex: 65,
  },
  sheetFixedTop: {
    flexShrink: 0,
    zIndex: 10,
  },
  sheetFixedBody: {
    flexShrink: 0,
    zIndex: 8,
  },
  sheetFooter: {
    flexShrink: 0,
    height: 38,
    paddingTop: 6,
  },
  exitSurveyButton: {
    height: 32,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#51404A',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitSurveyText: {
    color: '#F08A8A',
    fontSize: 13,
    fontWeight: '900',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#68707A',
    marginBottom: 7,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitleColumn: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    zIndex: 45,
  },
  sheetHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    position: 'relative',
    zIndex: 40,
  },
  sheetEyebrow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '900',
  },
  templateTitleButton: {
    height: 25,
    marginTop: 1,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    maxWidth: '96%',
  },
  templateDropdownMenu: {
    position: 'absolute',
    top: 43,
    left: 0,
    width: 236,
    backgroundColor: '#181B20',
    borderWidth: 1,
    borderColor: '#3C424D',
    borderRadius: 8,
    padding: 5,
    gap: 4,
    zIndex: 100,
  },
  templatePickerBody: {
    paddingTop: 10,
    gap: 8,
  },
  templatePickerList: {
    gap: 7,
  },
  templatePickerItem: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  templatePickerIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#132235',
    borderWidth: 1,
    borderColor: '#294A72',
    alignItems: 'center',
    justifyContent: 'center',
  },
  templatePickerCopy: {
    flex: 1,
    minWidth: 0,
  },
  templatePickerTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  templatePickerMeta: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  exportButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#353A43',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportButtonActive: {
    backgroundColor: '#162236',
    borderColor: '#315F91',
  },
  exportMenu: {
    position: 'absolute',
    right: 0,
    top: 42,
    width: 218,
    borderRadius: 8,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    padding: 6,
    gap: 5,
    zIndex: 60,
  },
  exportMenuItem: {
    minHeight: 48,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  exportMenuTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  exportMenuMeta: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  sheetRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  moduleNavigator: {
    flex: 1,
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  moduleArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleArrowDisabled: {
    opacity: 0.45,
  },
  moduleDropdownWrap: {
    flex: 1,
    position: 'relative',
    zIndex: 20,
  },
  moduleCenter: {
    height: 32,
    borderRadius: 16,
    backgroundColor: '#181B20',
    borderWidth: 1,
    borderColor: '#343A45',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  moduleCenterText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  moduleSwitch: {
    flex: 1,
    height: 36,
    borderRadius: 7,
    backgroundColor: '#181B20',
    padding: 3,
    flexDirection: 'row',
  },
  moduleOption: {
    flex: 1,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleOptionActive: {
    backgroundColor: '#303847',
  },
  moduleText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  moduleTextActive: {
    color: colors.text,
  },
  progressPill: {
    height: 34,
    minWidth: 52,
    borderRadius: 17,
    backgroundColor: '#1C3325',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    color: '#A7F0B8',
    fontWeight: '900',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 13,
    textTransform: 'uppercase',
  },
  compactFieldLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 7,
    textTransform: 'uppercase',
  },
  markerNameInput: {
    flex: 1,
    minWidth: 0,
    height: 30,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 0,
    fontSize: 13,
    fontWeight: '900',
  },
  markerToolsWrap: {
    position: 'relative',
    zIndex: 12,
  },
  markerToolsRow: {
    marginTop: 4,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  markerItemFieldWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    zIndex: 20,
  },
  markerItemInputRow: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 7,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
  },
  markerItemDropdownButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#343A45',
  },
  markerItemMenu: {
    position: 'absolute',
    top: 36,
    left: 0,
    right: 0,
    backgroundColor: '#181B20',
    borderWidth: 1,
    borderColor: '#3C424D',
    borderRadius: 8,
    padding: 5,
    gap: 4,
    zIndex: 95,
  },
  markerEntitySwatchButton: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerEntitySwatchEmpty: {
    borderColor: '#4A5361',
    backgroundColor: '#20242C',
  },
  markerEntitySwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#D7DEE8',
  },
  locateMarkerButton: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerNotesIconButton: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: 'transparent',
    borderWidth: 0,
    opacity: 0.78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerEntityMenu: {
    position: 'absolute',
    top: 36,
    left: 0,
    width: 230,
    backgroundColor: '#181B20',
    borderWidth: 1,
    borderColor: '#3C424D',
    borderRadius: 8,
    padding: 5,
    gap: 4,
    zIndex: 90,
  },
  dropdownWrap: {
    position: 'relative',
    zIndex: 12,
  },
  dropdownWrapActive: {
    zIndex: 40,
  },
  dropdownField: {
    height: 38,
    marginTop: 7,
    borderRadius: 7,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  compactDropdownField: {
    height: 30,
    marginTop: 4,
    borderRadius: 7,
    backgroundColor: '#1B1F25',
    borderWidth: 1,
    borderColor: '#343A45',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dropdownFieldEmpty: {
    borderColor: '#4A5361',
    backgroundColor: '#20242C',
  },
  dropdownValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  dropdownPlaceholder: {
    color: colors.muted,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 41,
    left: 0,
    right: 0,
    backgroundColor: '#181B20',
    borderWidth: 1,
    borderColor: '#3C424D',
    borderRadius: 8,
    padding: 5,
    gap: 4,
    zIndex: 90,
  },
  dropdownItem: {
    minHeight: 34,
    borderRadius: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dropdownItemActive: {
    backgroundColor: '#20344D',
  },
  dropdownItemText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  dropdownMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  entityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  checkHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  assignedText: {
    color: colors.faint,
    fontSize: 11,
  },
  surveyCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 5,
  },
  surveyCategoryList: {
    flex: 1,
    minHeight: 0,
  },
  surveyCategoryListContent: {
    gap: 6,
    paddingBottom: 8,
  },
  surveyCategoryCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    overflow: 'hidden',
  },
  surveyCategoryCardActive: {
    borderColor: '#2B6FB6',
    backgroundColor: '#142236',
  },
  surveyCategoryRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
  },
  surveyCategoryMain: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
  },
  surveyCategoryName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  surveyCategoryNameActive: {
    color: colors.blue,
  },
  surveyCategoryCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  surveyCategoryExpand: {
    width: 36,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surveyCategoryItems: {
    borderTopWidth: 1,
    borderTopColor: '#343A45',
    paddingVertical: 6,
    paddingHorizontal: 7,
    gap: 5,
  },
  surveyCategoryItemRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#171B22',
    borderWidth: 1,
    borderColor: '#303743',
  },
  surveyCategoryItemName: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  surveyCategoryEmptyItems: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  surveyCategoryEmptyText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  notesEditorScroll: {
    flex: 1,
    marginTop: 10,
  },
  notesEditorContent: {
    gap: 9,
    paddingBottom: 10,
  },
  notesEditorCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#1B1F25',
    padding: 10,
    gap: 8,
  },
  notesEditorInput: {
    minHeight: 88,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3A4250',
    backgroundColor: '#15181D',
    color: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
    fontWeight: '700',
  },
  notesEditorSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  notesUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  notesUploadButton: {
    flex: 1,
    maxWidth: 112,
    minHeight: 30,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#343A45',
    backgroundColor: '#242A33',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 9,
  },
  notesUploadText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  notesEmptyText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  attachmentRow: {
    minHeight: 40,
    borderRadius: 7,
    backgroundColor: '#242A33',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  attachmentThumb: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#17263A',
    borderWidth: 1,
    borderColor: '#2B6FB6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentName: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  attachmentRemoveButton: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesEditorFooter: {
    height: 44,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 6,
  },
  notesCancelButton: {
    flex: 1,
    height: 36,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3A4250',
    backgroundColor: '#1B1F25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesCancelText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  notesSaveButton: {
    flex: 1,
    height: 36,
    borderRadius: 7,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesSaveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  checkList: {
    gap: CHECKLIST_ITEM_GAP,
  },
  checkListScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 6,
    zIndex: 1,
  },
  emptyChecklist: {
    marginTop: 6,
    borderRadius: 6,
    backgroundColor: '#1C2026',
    borderWidth: 1,
    borderColor: '#333944',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChecklistText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  checkItem: {
    height: CHECKLIST_ITEM_HEIGHT,
    borderRadius: 6,
    backgroundColor: '#1C2026',
    borderWidth: 1,
    borderColor: '#333944',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxActive: {
    backgroundColor: colors.green,
  },
  checkText: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  checkResponseGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  checkResponseButton: {
    minWidth: 28,
    height: 24,
    borderRadius: 5,
    backgroundColor: '#2A2F38',
    borderWidth: 1,
    borderColor: '#3A4250',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  checkResponseButtonActive: {
    borderColor: 'transparent',
  },
  checkResponseYes: {
    backgroundColor: '#2F7D55',
  },
  checkResponseNo: {
    backgroundColor: '#8C3A42',
  },
  checkResponseNa: {
    backgroundColor: '#5E6570',
  },
  checkResponseText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '900',
  },
  checkResponseTextActive: {
    color: '#FFF',
  },
});
