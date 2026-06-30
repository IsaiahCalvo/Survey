import React from 'react';
import Svg, { Path } from 'react-native-svg';
import {
  Bookmark, Eraser, FileText, Highlighter, Hash, MessageSquareText, Minus,
  MousePointer2, ArrowRight, Pencil, PenLine, RectangleHorizontal, Search,
  Square, Circle, Type, Hand,
} from 'lucide-react-native';
import type { ToolId, ToolCategory, HubMode, ZoomFitMode, SyncState } from './types';
export { lineBorderStyleLabels, arrowheadStyleLabels, eraserModeLabels } from './types';

export const colors = {
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

export function SurveyIcon({ color, size = 22 }: { color: string; size?: number }) {
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

export function ExportIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 15V4" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M8 8L12 4L16 8" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 13V18C5 19.1046 5.89543 20 7 20H17C18.1046 20 19 19.1046 19 18V13" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function VersionHistoryIcon({ color, size = 21 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12C19 15.866 15.866 19 12 19C9.73476 19 7.72111 17.924 6.44154 16.255" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M5 7V12H10" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 8.5V12.3L14.5 14" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export const primaryTools: Array<{ id: ToolId; label: string; icon: React.ComponentType<any> }> = [
  { id: 'pan', label: 'Pan', icon: Hand },
  { id: 'select', label: 'Select', icon: MousePointer2 },
];

export const toolbarCategories: Array<{ id: ToolCategory; label: string; icon: React.ComponentType<any>; defaultTool: ToolId }> = [
  { id: 'draw', label: 'Draw', icon: Pencil, defaultTool: 'pen' },
  { id: 'shape', label: 'Shapes', icon: RectangleHorizontal, defaultTool: 'rect' },
  { id: 'review', label: 'Text', icon: Type, defaultTool: 'text' },
];

export const hubItems: Array<{ id: HubMode; label: string; icon: React.ComponentType<any> }> = [
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
];

export const pdfTextMatches = [
  { id: 'lobby', page: 1, title: 'LOBBY', excerpt: 'Lobby room label on Floor 1 Plan' },
  { id: 'office', page: 1, title: 'OFFICE', excerpt: 'Office room label on Floor 1 Plan' },
  { id: 'retail', page: 1, title: 'RETAIL', excerpt: 'Retail space label on Floor 1 Plan' },
  { id: 'idf', page: 1, title: 'IDF', excerpt: 'IDF room label on Floor 1 Plan' },
  { id: 'region', page: 1, title: 'Region', excerpt: 'Region annotation label on Floor 1 Plan' },
];

export const documentTitle = 'Floor 1 Plan';
export const initialPageCount = 2;

export const zoomFitOptions: Array<{ id: ZoomFitMode; label: string }> = [
  { id: 'fitPage', label: 'Fit Page' },
  { id: 'fitWidth', label: 'Fit Width' },
  { id: 'fitHeight', label: 'Fit Height' },
];

export const syncStateConfig: Record<SyncState, { label: string; color: string }> = {
  synced: { label: 'Up to date', color: '#2bbd7e' },
  syncing: { label: 'Syncing now...', color: '#f5a524' },
  offline: { label: 'Offline', color: '#ef4444' },
};

export const activeUsers = [
  { id: 'isaiah', initials: 'IC', name: 'Isaiah', role: 'Document owner', status: 'Viewing Floor 1' },
  { id: 'pm', initials: 'PM', name: 'Project Manager', role: 'Project manager', status: 'Online' },
  { id: 'field', initials: 'FS', name: 'Field Surveyor', role: 'Field surveyor', status: 'Online' },
];

export const versionHistoryItems = [
  { id: 'sync', title: 'Online sync active', meta: 'Microsoft 365 workbook ready' },
  { id: 'marker', title: 'Camera C-104 updated', meta: 'Isaiah changed checklist status' },
  { id: 'region', title: 'Region filter enabled', meta: 'Floor 1 customer area' },
];

export const railSubtools: Record<ToolCategory, Array<{ id: ToolId; label: string; icon: React.ComponentType<any> }>> = {
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

export const toolCategoryById: Partial<Record<ToolId, ToolCategory>> = {
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

export const annotationToolIds: ToolId[] = ['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'line', 'arrow', 'counter', 'text', 'callout'];

export const formatToolTitle: Partial<Record<ToolId, string>> = {
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

export const desktopColorPresets = ['#ff0000', '#4A90E2', '#27C07D', '#F4D35E', '#ffffff', '#1e293b'];

export const fontSizeOptions = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '40', '48', '56', '64', '72'];
export const counterSeriesColors = ['#ff0000', '#4A90E2', '#27C07D', '#F4D35E', '#C7A7FF', '#FF8A3D'];
export const annotationColorChoices = Array.from(new Set([...desktopColorPresets, ...counterSeriesColors, '#000000']));
