// Minimalist SVG Icons Component
import { getContentTypeIconColor } from './utils/contentTypeColors.js';
import textBoldUrl from './assets/icons/text-bold.svg';
import textItalicUrl from './assets/icons/text-italic.svg';
import textUnderlineUrl from './assets/icons/text-underline.svg';
import textStrikethroughUrl from './assets/icons/text-strikethrough.svg';
import textHighlightUrl from './assets/icons/text-highlight.svg';
import highlighterToolUrl from './assets/icons/highlighter-tool.svg';
import selectionCursorUrl from './assets/icons/selection-cursor-rounded.svg';
import lassoSelectUrl from './assets/icons/lasso-select-rounded.svg';
import textSelectUrl from './assets/icons/text-select-rounded.svg';
import textSquiggleUrl from './assets/icons/text-squiggle.svg';
import textHyperlinkUrl from './assets/icons/text-hyperlink.svg';
import textRedactUrl from './assets/icons/text-redact.svg';
import panHandUrl from './assets/icons/pan-hand-closed.svg';
import counterIconUrl from './assets/icons/counter.svg';
import calloutIconUrl from './assets/icons/callout-arrow-outline.svg';
import textBoxIconUrl from './assets/icons/text-box-selection.svg';
import shapesIconUrl from './assets/icons/shapes.svg';
import oneDriveLogoUrl from './assets/brand/onedrive-logo.svg';

/*
 * HOUSE ICON GEOMETRY — owner ruling 2026-09-16.
 *
 * One icon set is rendered by desktop, web mobile and iOS. Every glyph in this
 * module, and every asset in src/assets/icons, is drawn on a 24-unit grid and
 * must read as part of the same set:
 *
 *   - ONE stroke weight. A glyph drawn on another grid, or inside a scaled
 *     group, must carry a stroke width that RESOLVES to ICON_STROKE_WIDTH once
 *     the grid and the group scales are applied (the 192-unit house glyph uses
 *     12 = 1.5 x 192/24; the 1.2-scaled Text glyph uses 1.25 = 1.5 / 1.2).
 *   - ONE vertex/handle circle. Every "shape with handles" glyph draws its
 *     nodes through nodeCircle(), so polygon, polyline and the text-box asset
 *     all show the same size handle. The radius is the one on the owner's
 *     text-box-selection.svg corner handles.
 *   - ONE corner radius ratio. A rounded box is rounded by
 *     ICON_CORNER_RADIUS_RATIO of its shorter side, so a big box and a small
 *     box look equally rounded (the Rectangle tool: 18-unit box, rx 2).
 *   - ONE optical size. Ink, including half the stroke on each side, spans
 *     about ICON_INK_ENVELOPE of the 24-unit grid, centred on the grid.
 *
 * tests/iconSetConsistency.test.mjs enforces the stroke weight and the node
 * radius across this module and the asset folder.
 */
export const ICON_GRID = 24;
export const ICON_STROKE_WIDTH = 1.5;
export const ICON_NODE_RADIUS = 2;
export const ICON_INK_ENVELOPE = 20;
export const ICON_CORNER_RADIUS_RATIO = 1 / 9;
// The chevron-down geometry, shared so the morphing grip (DragRearrangeHandle)
// draws the SAME arrow the icon set does rather than a copy of it.
export const CHEVRON_DOWN_PATH = 'M6 9L12 15L18 9';

/** Rounded-box corner radius for a box whose shorter side is `shorterSide`. */
export const iconCornerRadius = (shorterSide) => (
  Math.round(shorterSide * ICON_CORNER_RADIUS_RATIO * 100) / 100
);

/**
 * The one vertex/handle node in the set, used by every glyph that draws a shape
 * with handles so the handles can never drift apart in size again.
 */
const nodeCircle = (key, cx, cy, color) => (
  <circle
    key={key}
    cx={cx}
    cy={cy}
    r={ICON_NODE_RADIUS}
    fill="none"
    stroke={color}
    strokeWidth={ICON_STROKE_WIDTH}
  />
);

/*
 * Vertex tables for the Polygon and Polyline glyphs, on the 24 grid. Kept beside
 * the geometry tokens so one place describes the whole "shape with handles"
 * family. Both are the owner-approved artworks' own vertices, rescaled onto the
 * grid — see the renderers for the history.
 */
const POLYGON_ICON_NODES = [
  [14.71, 4.92],
  [5.91, 7.13],
  [4.77, 16.73],
  [13.59, 19.08],
  [19.23, 12.83],
];

const POLYLINE_ICON_NODES = [
  [4.75, 18.34],
  [9.1, 7.83],
  [14.18, 11.82],
  [19.25, 5.66],
];

const renderMaskIcon = (url, size, color, style, className, width = size) => (
  <span
    aria-hidden="true"
    className={className}
    style={{
      ...style,
      display: 'inline-block',
      flex: '0 0 auto',
      width,
      height: size,
      backgroundColor: color,
      maskImage: `url("${url}")`,
      maskPosition: 'center',
      maskSize: 'contain',
      maskRepeat: 'no-repeat',
      WebkitMaskImage: `url("${url}")`,
      WebkitMaskPosition: 'center',
      WebkitMaskSize: 'contain',
      WebkitMaskRepeat: 'no-repeat',
    }}
  />
);

const ICON_RENDERERS = {
    oneDrive: (size, _color, style, className) => (
      <img
        src={oneDriveLogoUrl}
        alt=""
        aria-hidden="true"
        className={className}
        style={{ ...style, width: size * 1.45, height: size, objectFit: 'contain' }}
      />
    ),
    google: (size, _color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
    // Document/File icons
    document: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 13H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 16H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 19H13" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Upload icon
    upload: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 10L12 5L17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 5V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Download icon
    download: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 10L12 15L17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 15V3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Folder/Project icon
    folder: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 7C3 6.46957 3.21071 5.96086 3.58579 5.58579C3.96086 5.21071 4.46957 5 5 5H9L11 7H19C19.5304 7 20.0391 7.21071 20.4142 7.58579C20.7893 7.96086 21 8.46957 21 9V17C21 17.5304 20.7893 18.0391 20.4142 18.4142C20.0391 18.7893 19.5304 19 19 19H5C4.46957 19 3.96086 18.7893 3.58579 18.4142C3.21071 18.0391 3 17.5304 3 17V7Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Stacked layers icon used for Spaces.
    layers: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M12.83 2.18C12.3 1.94 11.7 1.94 11.17 2.18L2.6 6.08C1.8 6.44 1.8 7.56 2.6 7.92L11.17 11.82C11.7 12.06 12.3 12.06 12.83 11.82L21.4 7.92C22.2 7.56 22.2 6.44 21.4 6.08L12.83 2.18Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 12.65L12.83 16.81C12.3 17.05 11.7 17.05 11.17 16.81L2 12.65" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 17.65L12.83 21.81C12.3 22.05 11.7 22.05 11.17 21.81L2 17.65" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Template icon - simplified with just outlines and page lines
    template: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        {/* Main clipboard outline */}
        <rect x="5" y="4" width="14" height="16" rx="1.56" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Top clip */}
        <path d="M9 4C9 3.44772 9.44772 3 10 3H14C14.5523 3 15 3.44772 15 4V6H9V4Z" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Page lines - horizontal lines representing text */}
        <path d="M7 10H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 13H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 16H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 19H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Search icon
    search: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="11" cy="11" r="8" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M20 20L16 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    history: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3.0156 10H7M3.0156 10V6M3.0156 10L6.34315 6.34315C9.46734 3.21895 14.5327 3.21895 17.6569 6.34315C20.781 9.46734 20.781 14.5327 17.6569 17.6569C14.5327 20.781 9.46734 20.781 6.34315 17.6569C5.55928 16.873 4.97209 15.9669 4.58158 15M12 9V13L15 14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    retry: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M20 11a8 8 0 1 0-2.34 5.66" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M20 5v6h-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Close/Delete icon
    close: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 6L6 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 6L18 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Select/Check icon
    check: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M20 6L9 17L4 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Select mode for a list (owner 2026-10-02: section header actions are
    // icons, the pair is Select = list-checks and Add = plus). Lucide
    // list-checks on the house grid and stroke.
    // Owner 2026-10-02 (debate pick, E5 redrawn): "edit this list" — rows
    // with a pencil writing on the last one. Used wherever a list header
    // toggles an edit mode (Bookmarks today). Not the Draw group's pencil.
    editList: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 6h18M3 12h9M3 18h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 21l.75-3 6.1-6.1a1.6 1.6 0 0 1 2.25 2.25L15 20.25z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    listChecks: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 7L5 9L9 5M3 17L5 19L9 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 6H21M13 12H21M13 18H21" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Arrow icons
    chevronLeft: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M15 18L9 12L15 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronRight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M9 18L15 12L9 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronDown: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d={CHEVRON_DOWN_PATH} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronUp: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 15L12 9L6 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    /* PASS 7 (owner ruling, boards 8-15): the text tool's glyph is Lucide
       scan-text — lines of text inside a frame. It replaces the Lucide
       Case Sensitive "Aa", which read as a FONT control rather than as the
       group that draws a text box and a callout. Drawn at the house 1.5
       weight on the house 24 grid, like every other glyph in the set. */
    scanText: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <path d="M7 8h8" />
          <path d="M7 12h10" />
          <path d="M7 16h6" />
        </g>
      </svg>
    ),

    /* PASS 7 (boards 10, 15, 16): the three ARROW ENDS, Lucide move-right /
       move-horizontal / minus. They are one control's three values, so they are
       drawn to the same visual length (the shaft runs 2 -> 22 in all three) and
       at the house weight. `arrowEndsNone` below is the third of the set. */
    moveRight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 8L22 12L18 16M2 12H22" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    moveHorizontal: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 8L22 12L18 16M6 8L2 12L6 16M2 12H22" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    /* The third of the set: an arrow with no head on either end. It is `minus`,
       drawn at the SET's length rather than at the general icon's - board 16
       draws all three ends at 2 -> 22, and the owner's ruling is "all the same
       length", so a 5 -> 19 rule beside two 2 -> 22 ones would read as a shorter
       line rather than as the same line with its heads taken off. `minus` itself
       is the app's decrement / zoom-out glyph and keeps its own length. */
    arrowEndsNone: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M2 12H22" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    /* PASS 7 (board 12): the six ALIGNMENTS on the text-formatting bar. Three
       rules of text, and which rule is short says which way the text is pushed
       (horizontal) or where the block sits in its box (vertical). Drawn exactly
       as board 12 draws them, at the house weight. */
    alignLeft: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 6H20M4 12H14M4 18H18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    alignCenter: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 6H20M7 12H17M5 18H19" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    alignRight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 6H20M10 12H20M6 18H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    alignTop: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 5H20M7 10H17M7 15H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    alignMiddle: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 12H20M7 7H17M7 17H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    alignBottom: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 19H20M7 14H17M7 9H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    /* PASS 7 (board 15): the LINE-STYLE samples. Each one is the line it names,
       drawn across a 24x12 field so the menu row and the pill preview show the
       same drawing at two sizes. Cloud is the Drawboard-style scallop with three
       bumps, exactly as board 15 draws it. */
    lineSampleSolid: (size, color, style, className) => (
      <svg width={size} height={size / 2} viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M1 6H23" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    lineSampleDashed: (size, color, style, className) => (
      <svg width={size} height={size / 2} viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M1 6H6M9.5 6H14.5M18 6H23" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    lineSampleDotted: (size, color, style, className) => (
      <svg width={size} height={size / 2} viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M1 6H23" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 4" />
      </svg>
    ),

    lineSampleCloud: (size, color, style, className) => (
      <svg width={size} height={size / 2} viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M1 10a2.75 2.75 0 0 1 5.5 0 2.75 2.75 0 0 1 5.5 0 2.75 2.75 0 0 1 5.5 0 2.75 2.75 0 0 1 5.5 0" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    /* PASS 7 (board 15): the ARROWHEAD samples — the head itself on the end of a
       shaft, so the menu says what it will draw instead of naming it. The filled
       heads are fill-drawn (Solid, Circle, Square); the rest are the house
       stroke. */
    arrowheadNone: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12H21" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    arrowheadSolid: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 8L19 12L13 16Z" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    arrowheadOpen: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12H21M15 7L21 12L15 17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    arrowheadCircle: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="12" r="3" fill={color} />
      </svg>
    ),

    arrowheadSquare: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="15" y="9" width="6" height="6" fill={color} />
      </svg>
    ),

    arrowheadBar: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12H19M19 7.5V16.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Zoom icons
    minus: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M5 12H19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    plus: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M12 5V19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5 12H19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Page view icons
    pages: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 19" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="3" y="3" width="9" height="13" rx="1" stroke={color} strokeWidth="1.5" />
        <rect x="12" y="3" width="9" height="13" rx="1" stroke={color} strokeWidth="1.5" />
      </svg>
    ),

    // Annotation tool icons
    cursor: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 13l6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Pen sub-tool. UX 2026-09-16: redrawn as stroke work on the 24 grid. The
    // old glyph was a filled outline of a nib, which meant the Draw sub-row held
    // one solid glyph (Pen) beside two stroked ones (Highlighter, Eraser) — the
    // same filled-vs-stroked break the owner called out on the Shapes row. Same
    // subject, same 1.5 weight, same round caps as the rest of the set.
    // The group scale keeps the ink inside the house optical margin (the nib runs
    // corner to corner, so at 1:1 it would touch all four edges of its box).
    pen: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g
          transform="translate(12 12) scale(0.93) translate(-11.9 -12.2)"
          fill="none"
          stroke={color}
          strokeWidth="1.61"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          <path d="m15 5 4 4" />
        </g>
      </svg>
    ),

    // UX 2026-09-08: the Draw GROUP button (desktop top toolbar + phone tool bar)
    // shows Lucide's "square-pen" (lucide-static v1.43.0, ISC) — a pen writing on
    // a page, which reads as "markup tools" rather than as any one sub-tool. Its
    // sub-tools (Pen / Highlighter / Eraser) keep their own glyphs.
    // UX 2026-09-16: stroke width is the house 1.5, NOT Lucide's own 2. The old
    // comment defended 2 because the rest of the top-toolbar row was filled
    // artwork at mixed sizes; that row is now one stroked set at one size, so
    // Lucide's heavier weight made Draw the odd one out (measured 1.50px painted
    // against Pan's 1.25px in the same row).
    // UX 2026-09-07 rule still holds: no translateY nudge — this glyph is centred
    // on its own ink, like every other top-toolbar icon.
    drawGroup: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    eraser: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'rotate(270deg)' }} className={className}>
        <g transform="rotate(-45 12 12)">
          <rect x="7" y="4" width="10" height="16" rx="1.11" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="7" y1="10" x2="17" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    ),

    // UX 2026-09-07: no optical nudge. The serif-T artwork is already symmetric
    // about the viewBox centre (ink spans y 3.25..20.75 of 24), so the old
    // translateY(2px) simply hung the T below the top-toolbar baseline. Removed
    // so this glyph shares the row's common centre line wherever it is reused.
    // UX 2026-09-16: the strokes are 1.25, not the house 1.5, because the whole
    // glyph sits in a scale(1.2) group — 1.25 x 1.2 resolves to exactly 1.5 on
    // the 24 grid. Before this, 1.5 x 1.2 painted 1.8 and the Text glyph read
    // heavier than everything beside it.
    text: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g transform="translate(12 12) scale(1.2) translate(-12 -12)">
          <polyline points="4 7 4 4 20 4 20 7" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="9" y1="20" x2="15" y2="20" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="12" y1="4" x2="12" y2="20" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    ),

    textBox: (size, color, style, className) => renderMaskIcon(textBoxIconUrl, size, color, style, className),


    callout: (size, color, style, className) => renderMaskIcon(calloutIconUrl, size, color, style, className),

    shapes: (size, color, style, className) => renderMaskIcon(shapesIconUrl, size, color, style, className),

    // 2026-09-16 (desktop sweep): the photo and video glyphs the Survey Marker
    // notes sheet used to hand-write as inline <svg>. Both drew at stroke 2 on a
    // 24 grid, so they painted a third heavier than every icon in the set, and
    // the video frame's rx was a flat 2 on a 12-unit side (a sixth) against the
    // set's ninth. Same shapes as before, on the house rules: ICON_STROKE_WIDTH,
    // iconCornerRadius(), and the video glyph inset to the 19.5-unit ink envelope
    // the Rectangle glyph sets (it used to span 21.5, so it read oversized).
    image: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx={iconCornerRadius(18)} />
          <circle cx="9" cy="9" r="2" />
          <path d="M21 15 17.5 11.5 6 21" />
        </g>
      </svg>
    ),

    video: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6.6" width="12.6" height="10.8" rx={iconCornerRadius(10.8)} />
          <path d="M21 8.4 15.6 12 21 15.6Z" />
        </g>
      </svg>
    ),

    // Survey media (owner 2026-10-01): Take photo, Record audio, and the
    // play mark on a video thumbnail.
    camera: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7.5L9 4.5H15L16.5 7H19.5A1.5 1.5 0 0 1 21 8.5V18A1.5 1.5 0 0 1 19.5 19.5H4.5A1.5 1.5 0 0 1 3 18Z" />
          <circle cx="12" cy="13" r="3.5" />
        </g>
      </svg>
    ),

    mic: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6A3 3 0 0 1 15 6V11A3 3 0 0 1 9 11Z" />
          <path d="M5.5 11A6.5 6.5 0 0 0 18.5 11M12 17.5V21" />
        </g>
      </svg>
    ),

    play: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M8 5.5V18.5L18.5 12Z" fill={color} stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinejoin="round" />
      </svg>
    ),

    // Survey note: add a photo, video or audio clip.
    paperclip: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M20 11.5L12 19.5A5 5 0 0 1 4.9 12.4L13.4 3.9A3.3 3.3 0 0 1 18.1 8.6L9.7 17A1.7 1.7 0 0 1 7.3 14.6L15 6.9" stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Shape icons.
    // Rectangle is the size reference for this row: an 18-unit box, so ink
    // including the stroke spans 19.5 of the 24 grid. It is also the corner
    // radius reference — rx 2 on an 18-unit box is ICON_CORNER_RADIUS_RATIO.
    rect: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // UX 2026-09-16: r 9.3, not 10. A circle has to overshoot a square of the
    // same optical size, but only by 2-4% (the rule shapes.svg already applies
    // to its own circle-and-square pair). At r 10 the ink ran 11% wider than
    // Rectangle's and the Ellipse plainly read as the bigger glyph in the row.
    // 9.3 puts outer ink at 20.1 against Rectangle's 19.5 — a 3.1% overshoot.
    ellipse: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="12" r="9.3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // Shape tool: Polygon. UX 2026-09-16 — the owner-approved artwork (a closed
    // five-corner run with hollow vertex nodes) redrawn natively on the 24 grid.
    // Its vertices are the five node centres of the original 1156x1038 tracing,
    // scaled 0.89 about their own bounding box and centred on the grid, so the
    // shape is the owner's; only the drawing technique changed.
    //
    // Why it was redrawn: the tracing was a single FILLED path in a row of
    // stroked outlines. Its limbs measured 1.15 grid units against the row's
    // 1.5, its five node holes came out at five different sizes (1.75 to 1.85),
    // and being filled it could not share a stroke weight with anything. Now:
    // one 1.5 stroke, and nodes from the shared nodeCircle() so they match the
    // text-box glyph's handles exactly.
    //
    // Segments stop 2.0 units short of each node centre — the same trim the
    // owner's text-box asset uses, which lands the round cap on the ring's inner
    // edge so the run reads as continuous through the node.
    polygon: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g fill="none" stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.77 5.41 7.85 6.64" />
          <path d="M5.67 9.12 5.01 14.74" />
          <path d="M6.7 17.25 11.66 18.57" />
          <path d="M14.93 17.6 17.89 14.32" />
          <path d="M18.24 11.09 15.7 6.66" />
        </g>
        {POLYGON_ICON_NODES.map(([cx, cy], i) => nodeCircle(`polygon-node-${i}`, cx, cy, color))}
      </svg>
    ),

    // Shape tool: Polyline. UX 2026-09-16 — the owner-approved 64-unit artwork
    // (an open four-point run with hollow circular vertices) redrawn natively on
    // the 24 grid: its four vertices scaled and centred, nothing re-posed.
    //
    // Why it was redrawn: it carried TWO stroke weights inside one glyph (3.5
    // segments and 2.2 rings inside a scale(0.4049) group, i.e. 1.42 and 0.89 on
    // the 24 grid), and its vertex rings came out 31% smaller than the text-box
    // glyph's handles, so the two never read as the same family. Now: one 1.5
    // stroke and the shared node circle.
    polyline: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g fill="none" stroke={color} strokeWidth={ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.52 16.49 8.34 9.68" />
          <path d="M10.67 9.07 12.61 10.59" />
          <path d="M15.45 10.28 17.98 7.2" />
        </g>
        {POLYLINE_ICON_NODES.map(([cx, cy], i) => nodeCircle(`polyline-node-${i}`, cx, cy, color))}
      </svg>
    ),

    // UX 2026-09-16: the diagonal now runs 3..21, the same span as the Rectangle
    // glyph's box, so Line and Arrow fill their buttons like their neighbours. On
    // the old 5..19 diagonal they measured 22% smaller than Rectangle and 30%
    // smaller than Ellipse in a row of identical buttons — the widest size break
    // in the app. The arrowhead legs keep their old half-the-span proportion.
    line: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <line x1="3" y1="21" x2="21" y2="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    arrow: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <line x1="3" y1="21" x2="21" y2="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 3h9v9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    counter: (size, color, style, className) => renderMaskIcon(counterIconUrl, size, color, style, className),

    note: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 13H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 17H12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Settings icon
    settings: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path fillRule="evenodd" clipRule="evenodd" d="M12 8.25C9.92894 8.25 8.25 9.92893 8.25 12C8.25 14.0711 9.92894 15.75 12 15.75C14.0711 15.75 15.75 14.0711 15.75 12C15.75 9.92893 14.0711 8.25 12 8.25ZM9.75 12C9.75 10.7574 10.7574 9.75 12 9.75C13.2426 9.75 14.25 10.7574 14.25 12C14.25 13.2426 13.2426 14.25 12 14.25C10.7574 14.25 9.75 13.2426 9.75 12Z" />
        <path fillRule="evenodd" clipRule="evenodd" d="M11.9747 1.25C11.5303 1.24999 11.1592 1.24999 10.8546 1.27077C10.5375 1.29241 10.238 1.33905 9.94761 1.45933C9.27379 1.73844 8.73843 2.27379 8.45932 2.94762C8.31402 3.29842 8.27467 3.66812 8.25964 4.06996C8.24756 4.39299 8.08454 4.66251 7.84395 4.80141C7.60337 4.94031 7.28845 4.94673 7.00266 4.79568C6.64714 4.60777 6.30729 4.45699 5.93083 4.40743C5.20773 4.31223 4.47642 4.50819 3.89779 4.95219C3.64843 5.14353 3.45827 5.3796 3.28099 5.6434C3.11068 5.89681 2.92517 6.21815 2.70294 6.60307L2.67769 6.64681C2.45545 7.03172 2.26993 7.35304 2.13562 7.62723C1.99581 7.91267 1.88644 8.19539 1.84541 8.50701C1.75021 9.23012 1.94617 9.96142 2.39016 10.5401C2.62128 10.8412 2.92173 11.0602 3.26217 11.2741C3.53595 11.4461 3.68788 11.7221 3.68786 12C3.68785 12.2778 3.53592 12.5538 3.26217 12.7258C2.92169 12.9397 2.62121 13.1587 2.39007 13.4599C1.94607 14.0385 1.75012 14.7698 1.84531 15.4929C1.88634 15.8045 1.99571 16.0873 2.13552 16.3727C2.26983 16.6469 2.45535 16.9682 2.67758 17.3531L2.70284 17.3969C2.92507 17.7818 3.11058 18.1031 3.28089 18.3565C3.45817 18.6203 3.64833 18.8564 3.89769 19.0477C4.47632 19.4917 5.20763 19.6877 5.93073 19.5925C6.30717 19.5429 6.647 19.3922 7.0025 19.2043C7.28833 19.0532 7.60329 19.0596 7.8439 19.1986C8.08452 19.3375 8.24756 19.607 8.25964 19.9301C8.27467 20.3319 8.31403 20.7016 8.45932 21.0524C8.73843 21.7262 9.27379 22.2616 9.94761 22.5407C10.238 22.661 10.5375 22.7076 10.8546 22.7292C11.1592 22.75 11.5303 22.75 11.9747 22.75H12.0252C12.4697 22.75 12.8407 22.75 13.1454 22.7292C13.4625 22.7076 13.762 22.661 14.0524 22.5407C14.7262 22.2616 15.2616 21.7262 15.5407 21.0524C15.686 20.7016 15.7253 20.3319 15.7403 19.93C15.7524 19.607 15.9154 19.3375 16.156 19.1985C16.3966 19.0596 16.7116 19.0532 16.9974 19.2042C17.3529 19.3921 17.6927 19.5429 18.0692 19.5924C18.7923 19.6876 19.5236 19.4917 20.1022 19.0477C20.3516 18.8563 20.5417 18.6203 20.719 18.3565C20.8893 18.1031 21.0748 17.7818 21.297 17.3969L21.3223 17.3531C21.5445 16.9682 21.7301 16.6468 21.8644 16.3726C22.0042 16.0872 22.1135 15.8045 22.1546 15.4929C22.2498 14.7697 22.0538 14.0384 21.6098 13.4598C21.3787 13.1586 21.0782 12.9397 20.7378 12.7258C20.464 12.5538 20.3121 12.2778 20.3121 11.9999C20.3121 11.7221 20.464 11.4462 20.7377 11.2742C21.0783 11.0603 21.3788 10.8414 21.6099 10.5401C22.0539 9.96149 22.2499 9.23019 22.1547 8.50708C22.1136 8.19546 22.0043 7.91274 21.8645 7.6273C21.7302 7.35313 21.5447 7.03183 21.3224 6.64695L21.2972 6.60318C21.0749 6.21825 20.8894 5.89688 20.7191 5.64347C20.5418 5.37967 20.3517 5.1436 20.1023 4.95225C19.5237 4.50826 18.7924 4.3123 18.0692 4.4075C17.6928 4.45706 17.353 4.60782 16.9975 4.79572C16.7117 4.94679 16.3967 4.94036 16.1561 4.80144C15.9155 4.66253 15.7524 4.39297 15.7403 4.06991C15.7253 3.66808 15.686 3.2984 15.5407 2.94762C15.2616 2.27379 14.7262 1.73844 14.0524 1.45933C13.762 1.33905 13.4625 1.29241 13.1454 1.27077C12.8407 1.24999 12.4697 1.24999 12.0252 1.25H11.9747ZM10.5216 2.84515C10.5988 2.81319 10.716 2.78372 10.9567 2.76729C11.2042 2.75041 11.5238 2.75 12 2.75C12.4762 2.75 12.7958 2.75041 13.0432 2.76729C13.284 2.78372 13.4012 2.81319 13.4783 2.84515C13.7846 2.97202 14.028 3.21536 14.1548 3.52165C14.1949 3.61826 14.228 3.76887 14.2414 4.12597C14.271 4.91835 14.68 5.68129 15.4061 6.10048C16.1321 6.51968 16.9974 6.4924 17.6984 6.12188C18.0143 5.9549 18.1614 5.90832 18.265 5.89467C18.5937 5.8514 18.9261 5.94047 19.1891 6.14228C19.2554 6.19312 19.3395 6.27989 19.4741 6.48016C19.6125 6.68603 19.7726 6.9626 20.0107 7.375C20.2488 7.78741 20.4083 8.06438 20.5174 8.28713C20.6235 8.50382 20.6566 8.62007 20.6675 8.70287C20.7108 9.03155 20.6217 9.36397 20.4199 9.62698C20.3562 9.70995 20.2424 9.81399 19.9397 10.0041C19.2684 10.426 18.8122 11.1616 18.8121 11.9999C18.8121 12.8383 19.2683 13.574 19.9397 13.9959C20.2423 14.186 20.3561 14.29 20.4198 14.373C20.6216 14.636 20.7107 14.9684 20.6674 15.2971C20.6565 15.3799 20.6234 15.4961 20.5173 15.7128C20.4082 15.9355 20.2487 16.2125 20.0106 16.6249C19.7725 17.0373 19.6124 17.3139 19.474 17.5198C19.3394 17.72 19.2553 17.8068 19.189 17.8576C18.926 18.0595 18.5936 18.1485 18.2649 18.1053C18.1613 18.0916 18.0142 18.045 17.6983 17.8781C16.9973 17.5075 16.132 17.4803 15.4059 17.8995C14.68 18.3187 14.271 19.0816 14.2414 19.874C14.228 20.2311 14.1949 20.3817 14.1548 20.4784C14.028 20.7846 13.7846 21.028 13.4783 21.1549C13.4012 21.1868 13.284 21.2163 13.0432 21.2327C12.7958 21.2496 12.4762 21.25 12 21.25C11.5238 21.25 11.2042 21.2496 10.9567 21.2327C10.716 21.2163 10.5988 21.1868 10.5216 21.1549C10.2154 21.028 9.97201 20.7846 9.84514 20.4784C9.80512 20.3817 9.77195 20.2311 9.75859 19.874C9.72896 19.0817 9.31997 18.3187 8.5939 17.8995C7.86784 17.4803 7.00262 17.5076 6.30158 17.8781C5.98565 18.0451 5.83863 18.0917 5.73495 18.1053C5.40626 18.1486 5.07385 18.0595 4.81084 17.8577C4.74458 17.8069 4.66045 17.7201 4.52586 17.5198C4.38751 17.314 4.22736 17.0374 3.98926 16.625C3.75115 16.2126 3.59171 15.9356 3.4826 15.7129C3.37646 15.4962 3.34338 15.3799 3.33248 15.2971C3.28921 14.9684 3.37828 14.636 3.5801 14.373C3.64376 14.2901 3.75761 14.186 4.0602 13.9959C4.73158 13.5741 5.18782 12.8384 5.18786 12.0001C5.18791 11.1616 4.73165 10.4259 4.06021 10.004C3.75769 9.81389 3.64385 9.70987 3.58019 9.62691C3.37838 9.3639 3.28931 9.03149 3.33258 8.7028C3.34348 8.62001 3.37656 8.50375 3.4827 8.28707C3.59181 8.06431 3.75125 7.78734 3.98935 7.37493C4.22746 6.96253 4.3876 6.68596 4.52596 6.48009C4.66055 6.27983 4.74468 6.19305 4.81093 6.14222C5.07395 5.9404 5.40636 5.85133 5.73504 5.8946C5.83873 5.90825 5.98576 5.95483 6.30173 6.12184C7.00273 6.49235 7.86791 6.51962 8.59394 6.10045C9.31998 5.68128 9.72896 4.91837 9.75859 4.12602C9.77195 3.76889 9.80512 3.61827 9.84514 3.52165C9.97201 3.21536 10.2154 2.97202 10.5216 2.84515Z" />
      </svg>
    ),

    // Survey icon — the 2026-08-30 mark re-derived onto the 24 grid at the
    // icon set's own 1.5 stroke (two bars; four ticks inside the ring). Not the
    // brand 48-weight proportions — this must sit beside its rail siblings.
    //
    // UX 2026-09-17 (owner: "make Survey and Spaces match — same box, same ink
    // extent within 1px, house stroke"). Survey and Spaces (`layers`) sit at
    // opposite ends of the phone's bottom dock as two identical 30px circles,
    // so any size difference between the marks is unmissable. This one was
    // drawn to a smaller box than the rest of the set: r 9 put its ink at 19.5
    // of the 24 grid where layers, Text and the shapes glyphs are 20.5-21.5, so
    // at the shared 17px dock glyph it read ~9% small and ~14% light (rasterised
    // ink coverage 20.58% against Spaces' 23.83%) — and a circle needs a few
    // percent MORE than an edge-filling diamond to read the same size, so it
    // looked worse than it measured. r 10 puts the ink box at exactly 21.5,
    // matching layers; the two bars widen with it so the mark scales rather
    // than just its ring. The ticks stay: their round caps still land inside
    // the ring's stroke band (the band is 1.25..2.75 at the top, the cap reaches
    // 2.65), so they read as touching the ring exactly as before.
    // Pinned by tests/dockGlyphParity.test.mjs.
    survey: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M12 3.4V5.4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 18.6V20.6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M3.4 12H5.4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M18.6 12H20.6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7.7 9.8H15.8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7.7 14.2H13.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Bookmark icon
    bookmark: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M19 21L12 16L5 21V5C5 4.46957 5.21071 3.96086 5.58579 3.58579C5.96086 3.21071 6.46957 3 7 3H17C17.5304 3 18.0391 3.21071 18.4142 3.58579C18.7893 3.96086 19 4.46957 19 5V21Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // Duplicate — Lucide "copy-plus" (lucide-static v1.49.0, ISC). Owner
    // 2026-10-01: the page actions (Cut / Copy / Paste / Duplicate / Rotate /
    // Mirror / Reset) show the Lucide glyphs everywhere; see the note above
    // `scissors` for the two house adjustments (stroke 1.5, rect rx ratio).
    duplicate: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="15" x2="15" y1="12" y2="18" />
          <line x1="12" x2="18" y1="15" y2="15" />
          <rect width="14" height="14" x="8" y="8" rx="1.56" ry="1.56" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </g>
      </svg>
    ),

    // Rename/Edit icon
    edit: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18.5 2.5C18.8978 2.10217 19.4374 1.87868 20 1.87868C20.5626 1.87868 21.1022 2.10217 21.5 2.5C21.8978 2.89782 22.1213 3.43739 22.1213 4C22.1213 4.56261 21.8978 5.10217 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Trash/Delete icon
    trash: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 6H5H21" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M10 11V17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 11V17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // More options menu icon
    more: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="5" r="1.5" fill={color} />
        <circle cx="12" cy="12" r="1.5" fill={color} />
        <circle cx="12" cy="19" r="1.5" fill={color} />
      </svg>
    ),

    // w42 (2026-09-26): the desktop tool bar's More (⋯) button — the same
    // three level dots the phone strip's "..." draws, as a shared icon.
    moreHorizontal: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="5" cy="12" r="1.6" fill={color} />
        <circle cx="12" cy="12" r="1.6" fill={color} />
        <circle cx="19" cy="12" r="1.6" fill={color} />
      </svg>
    ),

    // Grip/Drag handle icon
    grip: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="9" cy="5" r="1.5" fill={color} />
        <circle cx="15" cy="5" r="1.5" fill={color} />
        <circle cx="9" cy="12" r="1.5" fill={color} />
        <circle cx="15" cy="12" r="1.5" fill={color} />
        <circle cx="9" cy="19" r="1.5" fill={color} />
        <circle cx="15" cy="19" r="1.5" fill={color} />
      </svg>
    ),

    // Home icon
    home: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12L5 10M5 10L12 3L19 10M5 10V20C5 20.5304 5.21071 21.0391 5.58579 21.4142C5.96086 21.7893 6.46957 22 7 22H9M19 10L21 12M19 10V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H15M9 22C9.53043 22 10.0391 21.7893 10.4142 21.4142C10.7893 21.0391 11 20.5304 11 20V16C11 15.4696 11.2107 14.9609 11.5858 14.5858C11.9609 14.2107 12.4696 14 13 14H15C15.5304 14 16.0391 14.2107 16.4142 14.5858C16.7893 14.9609 17 15.4696 17 16V20C17 20.5304 17.2107 21.0391 17.5858 21.4142C17.9609 21.7893 18.4696 22 19 22H9Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // Home tab icon — CC0 source: https://www.svgrepo.com/svg/504469/house
    homeTab: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M41.733 160.134v-59.2H21.999L96 31.865l74 69.067h-19.733v59.201H110.8v-44.4H81.2v44.4z" stroke={color} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" strokeMiterlimit="5" fill="none" />
      </svg>
    ),

    // Cut / Copy / Paste / Rotate / Mirror / Reset — owner 2026-10-01: the
    // Lucide glyphs (lucide-static v1.49.0, ISC) everywhere these actions are
    // offered, phone and desktop. Geometry is Lucide's own, verbatim, on its
    // 24 grid with round caps and joins; the stroke is the house 1.5 rather
    // than Lucide's 2 (the 2026-09-16 one-weight ruling at the top of this
    // file, enforced by tests/iconSetConsistency.test.mjs), and a <rect>'s rx
    // is the house ninth of its shorter side (copy 2 -> 1.56, the clipboard
    // clip 1 -> 0.44; same test). Paths are untouched.

    // Cut — Lucide "scissors".
    scissors: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="3" />
          <path d="M8.12 8.12 12 12" />
          <path d="M20 4 8.12 15.88" />
          <circle cx="6" cy="18" r="3" />
          <path d="M14.8 14.8 20 20" />
        </g>
      </svg>
    ),

    // Copy — Lucide "copy".
    copy: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="1.56" ry="1.56" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </g>
      </svg>
    ),

    // Move to — PROVISIONAL (owner 2026-10-02 is still choosing the final
    // glyph). Copy's two sheets with the back sheet dashed (it leaves) and an
    // arrow into the front one. Every Move button reads this one renderer, so
    // swapping the artwork is an edit to these three paths only.
    moveTo: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" strokeDasharray="1.5 3" />
          <rect width="14" height="14" x="8" y="8" rx="1.56" ry="1.56" />
          <path d="M11.5 15h6.5M15.5 12l3 3-3 3" />
        </g>
      </svg>
    ),

    // Paste — Lucide "clipboard".
    paste: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect width="8" height="4" x="8" y="2" rx="0.44" ry="0.44" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        </g>
      </svg>
    ),

    // Rotate — Lucide "refresh-cw".
    rotate: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </g>
      </svg>
    ),

    // Mirror horizontally — Lucide "triangles-centerline-dashed-vertical"
    // (two triangles facing each other across a dashed vertical axis).
    flipHorizontal: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 14v2" />
          <path d="M12 20v2" />
          <path d="M12 2v2" />
          <path d="M12 8v2" />
          <path d="M20.288 16.703A1 1 0 0022 16V8a1 1 0 00-1.712-.703l-3.99 3.991a1 1 0 00-.001 1.424z" />
          <path d="M3.712 16.703A1 1 0 012 16V8a1 1 0 011.712-.703l3.99 3.991a1 1 0 01.001 1.424z" />
        </g>
      </svg>
    ),

    // Mirror vertically — Lucide "triangles-centerline-dashed-horizontal".
    flipVertical: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12H8" />
          <path d="M16 12h-2" />
          <path d="M22 12h-2" />
          <path d="M4 12H2" />
          <path d="M7.298 20.288A1 1 0 008 22h8a1 1 0 00.703-1.712l-3.991-3.99a1 1 0 00-1.424-.001z" />
          <path d="M7.298 3.712A1 1 0 018 2h8a1 1 0 01.703 1.712l-3.991 3.99a1 1 0 01-1.424.001z" />
        </g>
      </svg>
    ),

    // Reset — Lucide "rotate-cw-fading-clock" turned to run COUNTER-clockwise
    // (owner 2026-10-01: reset winds the page back). Every path except the
    // clock hands is mirrored about the vertical centre line x = 12 (x -> 24-x,
    // relative dx negated, arc sweep flags flipped), so the arrowhead now
    // points back from 12 o'clock towards 10 o'clock and the fading dashes run
    // down the left. The hands "M12 7v5l4 2" are Lucide's, untouched.
    reset: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a9.75 9.75 0 0 0-6.74 2.74" />
          <path d="M5.26 5.74 3 8" />
          <path d="M3 8V3" />
          <path d="M16.5 19.794c6-3.464 6-12.124 0-15.588" />
          <path d="M16.5 4.206A9 9 0 0 0 12 3" />
          <path d="M12 7v5l4 2" />
          <path d="M10 20.775A9 9 0 0 0 12 21" />
          <path d="M5 17.656a9 9 0 0 0 1.5 1.456" />
          <path d="M3 12a9 9 0 0 0 .228 2" />
          <path d="M3 8h5" />
        </g>
      </svg>
    ),
    // Undo icon
    //
    // UX 2026-09-17 (desktop sweep): the arrow is drawn off-centre on the 24
    // grid and then mirrored by the CSS transform below, which put its ink LOW
    // in the button - the two leftmost controls in the viewer's top row read as
    // sitting under the tool group beside them. Measured at 1440x900 in a 34px
    // button with an 18px glyph: ink centre 1.13px below the button's centre,
    // against Draw at -0.37 and Export at 0.00 in the same row - a 1.5px
    // disagreement between neighbours.
    // The paths' own ink (including half the stroke) spans x 2.25..20.75 and
    // y 1.25..19.75, so its centre is 11.5, 10.5 where the grid's is 12, 12.
    // The <g> translate is exactly that difference. It is applied in the glyph's
    // own coordinates, BEFORE the mirror, and a mark centred on the grid stays
    // centred under any flip about that centre - so both arrows now sit on the
    // row's centre line whichever way they point.
    undo: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'rotate(180deg) scaleX(-1)' }} className={className}>
        <g transform="translate(0.5 1.5)">
          <path d="M9 14H14C17.3137 14 20 11.3137 20 8C20 4.68629 17.3137 2 14 2H9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 14V19L3 14L9 9V14Z" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    ),

    // UX: history arrows must mirror, not rotate; keep the flip here for every
    // surface. The translate is the mirror image of undo's, for the same reason
    // (this mark's ink centre is 12.5, 10.5 on the grid).
    redo: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'rotate(180deg) scaleX(-1)' }} className={className}>
        <g transform="translate(-0.5 1.5)">
          <path d="M15 14H10C6.68629 14 4 11.3137 4 8C4 4.68629 6.68629 2 10 2H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 14V19L21 14L15 9V14Z" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    ),

    // Mobile viewer history icons match lucide Undo2 / Redo2 from the
    // preserved native viewer without changing the desktop history glyphs.
    undo2: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M9 14L5 10L9 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 10H16C18.2091 10 20 11.7909 20 14C20 16.2091 18.2091 18 16 18H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    redo2: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M15 14L19 10L15 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 10H8C5.79086 10 4 11.7909 4 14C4 16.2091 5.79086 18 8 18H9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    // UX 2026-09-17 (owner, phone build: "Bold, italics, underline and
    // strikethrough don't look centred in their buttons"). These four used to
    // pass a per-icon width - 0.8, 0.66, 0.89, 1.04 of the requested size - to
    // stop `mask-size: contain` letterboxing a non-square asset. That gave the
    // row four different glyph boxes AND four different optical sizes: measured
    // at STRIP_GLYPH 14 the ink came out 12.05, 9.89, 11.35 and 10.95 px tall,
    // a 22% spread, and italic's ink sat 0.42px right of its own box because the
    // slanted stroke is not centred in a letterform's bounds.
    // The four assets are now normalised onto the house 24 grid - square
    // viewBox, ink centred on (12, 12), ink exactly 20 units tall - so a square
    // box is the correct box and one `size` serves all four: one glyph box, one
    // optical height, ink dead centre. Do not reintroduce a width factor here;
    // fix the asset's viewBox instead.
    formatBold: (size, color, style, className) => renderMaskIcon(textBoldUrl, size, color, style, className),
    formatItalic: (size, color, style, className) => renderMaskIcon(textItalicUrl, size, color, style, className),
    formatUnderline: (size, color, style, className) => renderMaskIcon(textUnderlineUrl, size, color, style, className),
    formatStrikethrough: (size, color, style, className) => renderMaskIcon(textStrikethroughUrl, size, color, style, className),
    formatHighlight: (size, color, style, className) => renderMaskIcon(textHighlightUrl, size, color, style, className),
    highlighterTool: (size, color, style, className) => renderMaskIcon(highlighterToolUrl, size, color, style, className),
    selectCursor: (size, color, style, className) => renderMaskIcon(selectionCursorUrl, size, color, style, className),
    // 2026-10-02 optical balance: Box / Lasso / Text Select are sized by their
    // assets, not here. Text Select used to carry a fixed translateY(2px) — 3
    // grid units at 16px and 4 at the 12px phone strip — which sat it low and
    // made it read smaller. Its asset is now drawn centred on the grid instead,
    // so the placement scales with the glyph. Do not add a nudge back here.
    lassoSelect: (size, color, style, className) => renderMaskIcon(lassoSelectUrl, size, color, style, className),
    textSelect: (size, color, style, className) => renderMaskIcon(textSelectUrl, size, color, style, className),
    formatSquiggle: (size, color, style, className) => renderMaskIcon(textSquiggleUrl, size, color, style, className),
    formatHyperlink: (size, color, style, className) => renderMaskIcon(textHyperlinkUrl, size, color, style, className),
    formatRedact: (size, color, style, className) => renderMaskIcon(textRedactUrl, size, color, style, className),
    formatPan: (size, color, style, className) => renderMaskIcon(panHandUrl, size, color, style, className),
    filter: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M3 5H21M6 12H18M10 19H14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    menu: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M4 7H20M4 12H20M4 17H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    clock: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" />
        <path d="M12 7V12L15 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    users: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="9" cy="8" r="3.5" stroke={color} strokeWidth="1.5" />
        <path d="M2 20A7 7 0 0 1 16 20M17 11A3 3 0 1 0 15 6M22 19A5 5 0 0 0 17 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    // Line with an arrowhead at each end — the "Both ends" arrow toggle.
    arrowBothEnds: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M4 12H20M9 7L4 12L9 17M15 7L20 12L15 17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    arrowRight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M5 12H19M13 6L19 12L13 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    share: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="18" cy="5" r="3" stroke={color} strokeWidth="1.5" /><circle cx="6" cy="12" r="3" stroke={color} strokeWidth="1.5" /><circle cx="18" cy="19" r="3" stroke={color} strokeWidth="1.5" />
        <path d="M8.6 13.5L15.4 17.5M15.4 6.5L8.6 10.5" stroke={color} strokeWidth="1.5" />
      </svg>
    ),
    lock: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="4" y="11" width="16" height="10" rx="1.11" stroke={color} strokeWidth="1.5" /><path d="M8 11V7A4 4 0 0 1 16 7V11" stroke={color} strokeWidth="1.5" />
      </svg>
    ),
    signout: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M9 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H9M16 17L21 12L16 7M21 12H9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    rotateCcw: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M4 12A8 8 0 1 0 6.4 6.3" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><path d="M3 3V8H8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    rotateCw: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M20 12A8 8 0 1 1 17.6 6.3" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><path d="M21 3V8H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    arrowLeft: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M19 12H5M12 19L5 12L12 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    library: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20V22H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    warningCircle: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" /><path d="M12 8V13M12 17H12.01" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    /*
     * UX: the destructive-alert triangle. warningCircle is the quiet caution
     * ("heads up"); this one is "something failed and it needs you", which is why
     * the collab storage-failure banner leads with it. Reference behaviour
     * matched: that banner's own hand-drawn glyph, traced here vertex for vertex
     * so the shape is unchanged — only the weight moved, from 2 to the house
     * 1.5, so it no longer out-weighs the dismiss cross 8px to its right. Added
     * 2026-09-16 (r5-icons) when that glyph moved into the shared set.
     *
     * aria-hidden: the banner this leads always spells the failure out in text
     * right beside it, so the glyph is decoration. Carried over from the
     * hand-drawn original rather than dropped in the move.
     */
    warningTriangle: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={style} className={className}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 9V13M12 17H12.01" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    infoCircle: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" /><circle cx="12" cy="8" r="1" fill={color} /><path d="M12 11V16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    lightbulbOn: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M14.5 19.5H9.5M14.5 19.5C14.5 18.7865 14.5 18.4297 14.5381 18.193C14.6609 17.4296 14.6824 17.3815 15.1692 16.7807C15.3201 16.5945 15.8805 16.0927 17.0012 15.0892C18.5349 13.7159 19.5 11.7206 19.5 9.5C19.5 5.35786 16.1421 2 12 2C7.85786 2 4.5 5.35786 4.5 9.5C4.5 11.7206 5.4651 13.7159 6.99876 15.0892C8.11945 16.0927 8.67987 16.5945 8.83082 16.7807C9.31762 17.3815 9.3391 17.4296 9.46192 18.193C9.5 18.4297 9.5 18.7865 9.5 19.5M14.5 19.5C14.5 20.4346 14.5 20.9019 14.299 21.25C14.1674 21.478 13.978 21.6674 13.75 21.799C13.4019 22 12.9346 22 12 22C11.0654 22 10.5981 22 10.25 21.799C10.022 21.6674 9.83261 21.478 9.70096 21.25C9.5 20.9019 9.5 20.4346 9.5 19.5" stroke={color} strokeWidth="1.5" />
        <path d="M12.7857 8.5L10.6429 11.5H13.6429L11.5 14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    lightbulbOff: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M14.5 19.5H9.5M14.5 19.5C14.5 18.7865 14.5 18.4297 14.5381 18.193C14.6609 17.4296 14.6824 17.3815 15.1692 16.7807C15.3201 16.5945 15.8805 16.0927 17.0012 15.0892C18.5349 13.7159 19.5 11.7206 19.5 9.5C19.5 5.35786 16.1421 2 12 2C7.85786 2 4.5 5.35786 4.5 9.5C4.5 11.7206 5.4651 13.7159 6.99876 15.0892C8.11945 16.0927 8.67987 16.5945 8.83082 16.7807C9.31762 17.3815 9.3391 17.4296 9.46192 18.193C9.5 18.4297 9.5 18.7865 9.5 19.5M14.5 19.5C14.5 20.4346 14.5 20.9019 14.299 21.25C14.1674 21.478 13.978 21.6674 13.75 21.799C13.4019 22 12.9346 22 12 22C11.0654 22 10.5981 22 10.25 21.799C10.022 21.6674 9.83261 21.478 9.70096 21.25C9.5 20.9019 9.5 20.4346 9.5 19.5" stroke={color} strokeWidth="1.5" />
      </svg>
    ),
    fitWidth: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="4" y="5" width="16" height="14" rx="1.56" stroke={color} strokeWidth="1.5" /><path d="M7 12H17M7 12L10 9M7 12L10 15M17 12L14 9M17 12L14 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    fitHeight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="5" y="4" width="14" height="16" rx="1.56" stroke={color} strokeWidth="1.5" /><path d="M12 7V17M12 7L9 10M12 7L15 10M12 17L9 14M12 17L15 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    fitPage: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="6" y="3" width="12" height="18" rx="1.33" stroke={color} strokeWidth="1.5" /><path d="M9 7H15M9 11H15M9 15H13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    mail: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="3" y="5" width="18" height="14" rx="1.56" stroke={color} strokeWidth="1.5" /><path d="M3 7L12 13L21 7" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    userRole: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="9" cy="8" r="3.5" stroke={color} strokeWidth="1.5" /><path d="M2 20A7 7 0 0 1 16 20M17 12H22M22 8L17 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
};

const ICON_ALIASES = {
  // PASS 7 (owner ruling): the Text group renders Lucide scan-text everywhere —
  // the desktop tool bar, the phone rail and every menu that names the group.
  textGroup: 'scanText',
  highlighter: 'highlighterTool',
  pan: 'formatPan',
  underline: 'formatUnderline',
  strikeout: 'formatStrikethrough',
  squiggly: 'formatSquiggle',
  hyperlink: 'formatHyperlink',
  redact: 'formatRedact',
};

const DEFAULT_CONTENT_TYPE_BY_ICON = {
  document: 'document',
  template: 'template',
};

const Icon = ({ name, size = 16, color, contentType, style, className }) => {
  const rendererName = ICON_ALIASES[name] || name;
  const resolvedColor = color || getContentTypeIconColor(
    contentType || DEFAULT_CONTENT_TYPE_BY_ICON[name],
    'currentColor',
  );
  return ICON_RENDERERS[rendererName]?.(size, resolvedColor, style, className) ?? null;
};

export default Icon;
