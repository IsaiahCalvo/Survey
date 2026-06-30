import type { SurveyMarkerCore } from '@survey/shared';

export type ToolId =
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
export type ToolCategory = 'draw' | 'shape' | 'review';
export type HubMode = 'pages' | 'search' | 'bookmarks';
export type ZoomFitMode = 'fitPage' | 'fitWidth' | 'fitHeight';
export type FormatPanelMode = 'presets' | 'text';
export type RegionDrawTool = 'rectangular' | 'freehand';
export type RegionOperation = 'add' | 'subtract';

export type ContextMenuAction = {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export type ContextMenuState = {
  id: string;
  title: string;
  x: number;
  y: number;
  width?: number;
  actions: ContextMenuAction[];
};

export type Marker = SurveyMarkerCore & {
  id: number;
  notes: string;
  photos?: string[];
  videos?: string[];
  page: number;
  x: number;
  y: number;
  entity: string | null;
  done: Record<string, boolean>;
};

export type BookmarkEntry = {
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

export type InkMark = {
  id: number;
  page: number;
  x: number;
  y: number;
};

export type PageClipboard = {
  page: number;
  mode: 'copy' | 'cut';
};

export type AnnotationClipboard = {
  item: InkMark;
  mode: 'copy' | 'cut';
};

export type PageTransformState = {
  rotation: number;
  mirrorHorizontal: boolean;
  mirrorVertical: boolean;
};

export type HistoryEntry =
  | { type: 'marker'; item: Marker }
  | { type: 'ink'; item: InkMark };

export type CounterSeries = {
  seriesId: string;
  label: string;
  color: string;
  count: number;
};

export type SyncState = 'synced' | 'syncing' | 'offline';

export type AnnotationEditFocus = 'fill' | 'stroke' | 'text';

export const lineBorderStyleLabels = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  cloud: 'Cloud',
} as const;

export const arrowheadStyleLabels = {
  none: 'None',
  solidTriangle: 'Solid Triangle',
  vShape: 'V-Shape',
  openCircle: 'Open Circle',
  openTriangle: 'Open Triangle',
  horizontalLine: 'Horizontal Line',
} as const;

export const eraserModeLabels = {
  partial: 'Partial Erase',
  entire: 'Full Stroke',
} as const;

export type LineBorderStyle = keyof typeof lineBorderStyleLabels;
export type ArrowheadStyle = keyof typeof arrowheadStyleLabels;
export type EraserMode = keyof typeof eraserModeLabels;

export type AnnotationEditConfig = {
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
