---
name: Context Menu System
description: Complete documentation of all context menus in the Survey application, including styling, options, behaviors, and implementation details for annotations, callouts, regions, and pages.
---

# Context Menu System

This skill documents the complete context menu system used throughout the Survey application. Context menus appear when users right-click on different elements, providing contextual actions specific to the element type.

## Overview

The Survey application has **5 distinct context menu implementations** across different components:

| Component | File Location | Target Elements |
|-----------|--------------|-----------------|
| Callout Context Menu | `src/components/Callout/CalloutContextMenu.jsx` | Callout annotations (arrows with text) |
| Region Context Menu | `src/RegionSelectionTool.jsx` | Region selections during editing |
| Pages Panel Context Menu | `src/sidebar/PagesPanel.jsx` | Page thumbnails in sidebar |
| Annotation Context Menu | `src/PageAnnotationLayer.jsx` | Fabric.js annotations (shapes, lines, etc.) |
| Page Background Context Menu | `src/PageAnnotationLayer.jsx` | Empty canvas area |

---

## Global Styling Standards

All context menus follow a consistent dark theme design language:

### Container Styling

```css
/* Standard Context Menu Container */
{
  position: 'fixed',
  background: '#333',
  border: '1px solid #444',
  borderRadius: '6px',
  padding: '4px',
  zIndex: 10000,
  minWidth: '180px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif'
}
```

### Button Styling

```css
/* Standard Menu Button */
{
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  fontSize: '13px',
  textAlign: 'left',
  cursor: 'pointer',
  color: '#ddd',
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
}

/* Hover State */
onMouseEnter: background = '#3a3a3a'
onMouseLeave: background = 'transparent'

/* Delete Button (Destructive Action) */
{
  color: '#ff6b6b'  /* Red text for destructive actions */
}

/* Disabled Button */
{
  cursor: 'not-allowed',
  color: '#666',
  opacity: 0.5
}
```

### Divider Styling

```css
/* Menu Section Divider */
{
  height: '1px',
  background: '#444',
  margin: '4px 0'
}
```

---

## 1. Callout Context Menu

**File:** `src/components/Callout/CalloutContextMenu.jsx`

**Trigger:** Right-click on any callout annotation (arrow with text box)

### Props Interface

```javascript
const CalloutContextMenu = ({
  visible,      // boolean - Whether menu is visible
  x,            // number - X position (pixels from left)
  y,            // number - Y position (pixels from top)
  onClose,      // function - Close menu handler
  onCut,        // function - Cut callout handler
  onCopy,       // function - Copy callout handler
  onPaste,      // function - Paste callout handler
  onDelete,     // function - Delete callout handler
  onEdit,       // function - Open properties panel handler
  hasClipboard, // boolean - Whether clipboard has content
  onDeselect    // function - Deselect callout handler
}) => { ... }
```

### Menu Options

| Option | Condition | Color | Action |
|--------|-----------|-------|--------|
| **Cut** | Always | `#ddd` | Cuts callout to clipboard |
| **Copy** | Always | `#ddd` | Copies callout to clipboard |
| **Paste** | `hasClipboard === true` | `#ddd` | Pastes callout from clipboard |
| ─ Divider ─ | | | |
| **Properties** | Always | `#ddd` | Opens edit/properties panel |
| ─ Divider ─ | | | |
| **Delete** | Always | `#ff6b6b` | Deletes the callout |

### Position Adjustment Logic

The menu automatically adjusts position to stay within viewport:

```javascript
const getAdjustedPosition = () => {
  const menuWidth = 180;
  const menuHeight = 300;
  const padding = 10;

  let adjustedX = x;
  let adjustedY = y;

  // Prevent right edge overflow
  if (x + menuWidth > window.innerWidth - padding) {
    adjustedX = window.innerWidth - menuWidth - padding;
  }
  // Prevent left edge overflow
  if (x < padding) {
    adjustedX = padding;
  }
  // Prevent bottom edge overflow
  if (y + menuHeight > window.innerHeight - padding) {
    adjustedY = window.innerHeight - menuHeight - padding;
  }
  // Prevent top edge overflow
  if (y < padding) {
    adjustedY = padding;
  }

  return { x: adjustedX, y: adjustedY };
};
```

### Keyboard & Click Behaviors

- **Escape key:** Closes menu (`onClose`)
- **Click outside:** Deselects callout (`onDeselect`) then closes menu
- **Click inside:** Stops propagation, allows button clicks
- **Right-click inside:** Prevented (no nested context menus)

### Alternative Context Menu Triggers

The context menu can also be triggered via:

#### Cmd/Ctrl + Click (Desktop)

```javascript
// In CalloutComponent.jsx handlers (handleTextBoxMouseDown, handleHandleMouseDown, handleLineMouseDown)
const isModifierKey = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on Mac

// If modifier key is held and no drag occurred, show context menu
if (isModifierKey && isInteractive && !hasDraggedRef.current) {
  setContextMenu({
    visible: true,
    x: mouseDownPositionRef.current.x,
    y: mouseDownPositionRef.current.y,
  });
}
```

**Drag Prevention Logic:**
- Tracks `hasDraggedRef` to distinguish click vs drag
- Measures mouse movement distance (>5px = drag)
- Only shows context menu if no drag occurred

#### Long-Press (Mobile/Touch)

```javascript
// Touch handlers in CalloutComponent.jsx
const longPressTimerRef = useRef(null);
const touchStartPositionRef = useRef(null);

const handleTouchStart = useCallback((e) => {
  if (!isInteractive) return;
  
  const touch = e.touches[0];
  touchStartPositionRef.current = { x: touch.clientX, y: touch.clientY };
  
  // Start 500ms long press timer
  longPressTimerRef.current = setTimeout(() => {
    setContextMenu({
      visible: true,
      x: touch.clientX,
      y: touch.clientY,
    });
  }, 500); // 500ms delay for long-press
}, [isInteractive]);

const handleTouchMove = useCallback((e) => {
  // Cancel if finger moves > 5px (allows scrolling)
  if (longPressTimerRef.current) {
    const touch = e.touches[0];
    const startPos = touchStartPositionRef.current;
    const moveDistance = Math.sqrt(
      Math.pow(touch.clientX - startPos.x, 2) + 
      Math.pow(touch.clientY - startPos.y, 2)
    );
    if (moveDistance > 5) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }
}, []);

const handleTouchEnd = useCallback(() => {
  // Cancel timer if touch ends before 500ms
  if (longPressTimerRef.current) {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }
}, []);
```

**Touch Event Attachment:**
All interactive callout elements (arrow tip, knee handle, line segments, text box) have touch handlers:
```jsx
onTouchStart={handleTouchStart}
onTouchEnd={handleTouchEnd}
onTouchMove={handleTouchMove}
```

### Context Menu Integration with CalloutComponent

**File:** `src/components/Callout/CalloutComponent.jsx`

The `CalloutComponent` uses `CalloutContextMenu` as a child component:

```jsx
<CalloutContextMenu
  visible={contextMenu?.visible || false}
  x={contextMenu?.x || 0}
  y={contextMenu?.y || 0}
  onClose={() => setContextMenu(null)}
  onDeselect={onDeselect}
  onCut={handleCut}
  onCopy={handleCopy}
  onPaste={handlePaste}
  onDelete={handleDelete}
  onEdit={handleEdit}
  hasClipboard={!!clipboardCallout}
/>
```

---

## 1b. Callout Edit Modal

**File:** `src/components/Callout/CalloutEditModal.jsx`

Opened from the "Properties" option in the callout context menu. A draggable modal for editing callout styling.

### Opening the Edit Modal

```javascript
const handleEdit = useCallback(() => {
  // Calculate anchor position (positioned near text box)
  let anchor = null;
  if (textareaRef.current) {
    const textBoxRect = textareaRef.current.getBoundingClientRect();
    anchor = {
      x: textBoxRect.right + 20,  // 20px to the right of text box
      y: textBoxRect.top,
    };
  }
  // Fallback to center if textarea not available
  if (!anchor) {
    anchor = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    };
  }
  setEditModalAnchor(anchor);
  setShowEditModal(true);
  setContextMenu(null);  // Close context menu
}, []);
```

### Props Interface

```javascript
const CalloutEditModal = ({
  visible,         // boolean - Whether modal is visible
  callout,         // object - The callout being edited
  onUpdate,        // function - Update callout properties
  onClose,         // function - Close modal handler
  anchorPosition   // { x, y } - Position anchor point
}) => { ... }
```

### Editable Properties

| Property | Control Type | Description |
|----------|-------------|-------------|
| Border Color | Color picker | Arrow/border line color |
| Border Opacity | Slider (0-1) | Transparency of border |
| Line Thickness | Number input | Stroke width of arrow line |
| Arrowhead Style | Dropdown | Style of arrowhead |
| Text Color | Color picker | Text content color |
| Text Opacity | Slider (0-1) | Transparency of text |
| Fill Color | Color picker | Text box background |
| Font Size | Number input | Text size (px) |
| Font Family | Dropdown | Font selection |

### Arrowhead Style Options

```javascript
// From src/components/Callout/types.js
const ARROWHEAD_STYLES = {
  NONE: 'none',
  SOLID_TRIANGLE: 'solidTriangle',
  V_SHAPE: 'vShape',
  OPEN_CIRCLE: 'openCircle',
  OPEN_TRIANGLE: 'openTriangle',
  HORIZONTAL_LINE: 'horizontalLine'
};

const ARROWHEAD_STYLE_LABELS = {
  'none': 'None',
  'solidTriangle': 'Solid Triangle',
  'vShape': 'V-Shape',
  'openCircle': 'Open Circle',
  'openTriangle': 'Open Triangle',
  'horizontalLine': 'Horizontal Line'
};
```

### Preset Color Palettes

```javascript
// Border/line colors
const presetBorderColors = [
  '#1e293b', // slate-800
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#2563eb', // blue-600
  '#9333ea', // purple-600
  '#ea580c', // orange-600
  '#0891b2', // cyan-600
  '#000000', // black
];

// Fill/background colors
const presetFillColors = [
  '#fef3c7', // amber-100
  '#fee2e2', // red-100
  '#dcfce7', // green-100
  '#dbeafe', // blue-100
  '#f3e8ff', // purple-100
  '#ffedd5', // orange-100
  '#cffafe', // cyan-100
  '#ffffff', // white
  'transparent',
];
```

### Font Options

```javascript
const fontFamilies = [
  'Inter, Arial, sans-serif',
  'Arial, sans-serif',
  'Georgia, serif',
  'Times New Roman, serif',
  'Courier New, monospace',
  'Verdana, sans-serif',
];

const fontSizes = [10, 12, 14, 16, 18, 20, 24, 28, 32];
```

### Default Callout Style

```javascript
const defaultCalloutStyle = {
  borderColor: '#1e293b',
  borderOpacity: 1,
  lineThickness: 2,
  arrowheadStyle: 'solidTriangle',
  fillColor: '#ffffff',
  fillOpacity: 1,
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: 14,
  fontColor: '#1e293b',
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  textAlign: 'left',
};
```

### Drag Support

The modal header is draggable:

```javascript
const handleHeaderMouseDown = (e) => {
  setIsDragging(true);
  setDragOffset({
    x: e.clientX - modalPosition.x,
    y: e.clientY - modalPosition.y
  });
};
```


## 2. Region Selection Tool Context Menu

**File:** `src/RegionSelectionTool.jsx`

**Trigger:** Right-click during region selection/editing mode

### Context Menu State

```javascript
const [contextMenu, setContextMenu] = useState(null);
// Shape: { x, y, type: 'merge' | 'separate' | 'canvas', regionId?, canMerge? }
```

### Menu Types

#### Type: `merge` (Multiple regions selected)

Shown when 2+ overlapping/contiguous regions are selected.

| Option | Condition | Color | Action |
|--------|-----------|-------|--------|
| **Cut** | Selection exists | `#333` | Cuts regions to clipboard |
| **Copy** | Selection exists | `#333` | Copies regions to clipboard |
| ─ Divider ─ | | | |
| **Paste** | Always | `#333` | Pastes regions at cursor |
| ─ Divider ─ | | | |
| **Merge Areas** | `canMerge === true` | `#333` | Merges regions into one |

> **Note:** "Merge Areas" is disabled (`opacity: 0.5`, `cursor: 'not-allowed'`) if regions cannot be merged (disjoint).

#### Type: `separate` (Single merged region selected)

Shown when a previously-merged region is selected.

| Option | Condition | Color | Action |
|--------|-----------|-------|--------|
| **Cut** | Selection exists | `#333` | Cuts region to clipboard |
| **Copy** | Selection exists | `#333` | Copies region to clipboard |
| ─ Divider ─ | | | |
| **Paste** | Always | `#333` | Pastes regions at cursor |
| ─ Divider ─ | | | |
| **Separate Areas** | Region has `sourceRegions` | `#333` | Unmerges back to original regions |

#### Type: `canvas` (Background click)

Shown when right-clicking on empty canvas area.

| Option | Condition | Color | Action |
|--------|-----------|-------|--------|
| **Cut** | Selection exists | `#333` | Cuts selected regions |
| **Copy** | Selection exists | `#333` | Copies selected regions |
| ─ Divider ─ | | | |
| **Paste** | Always | `#333` | Pastes regions at cursor position |

### Light Theme Styling (Exception)

> **Note:** This menu uses a **light theme** (exception to the global dark standard):

```css
/* Region Context Menu Container */
{
  position: 'fixed',
  background: 'white',
  border: '1px solid #ccc',
  borderRadius: '4px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  zIndex: 2000,
  minWidth: '120px',
  overflow: 'hidden'
}

/* Button Styling */
{
  padding: '8px 12px',
  cursor: 'pointer',
  fontSize: '13px',
  color: '#333',
  fontFamily: FONT_FAMILY
}

/* Hover State */
onMouseEnter: background = '#f0f0f0'
onMouseLeave: background = 'white'

/* Divider */
{
  height: '1px',
  background: '#e0e0e0',
  margin: '4px 0'
}
```

### Merge Detection Logic

```javascript
// Check if selected regions can be merged
const regionsToMerge = regions.filter(r => selectedRegionIds.has(r.regionId));
let canMerge = false;

if (regionsToMerge.length >= 2) {
  let currentUnion = regionToPolygon(regionsToMerge[0]);
  if (currentUnion) {
    for (let i = 1; i < regionsToMerge.length; i++) {
      const nextPoly = regionToPolygon(regionsToMerge[i]);
      if (nextPoly) {
        const result = union(currentUnion, nextPoly);
        if (result && result.length > 0) {
          currentUnion = result;
        }
      }
    }
    // Only mergeable if result is single polygon
    if (currentUnion.length === 1) {
      canMerge = true;
    }
  }
}
```

---

## 3. Pages Panel Context Menu

**File:** `src/sidebar/PagesPanel.jsx`

**Trigger:** Right-click on page thumbnail in sidebar

### Context Menu State

```javascript
const [contextMenu, setContextMenu] = useState(null);
// Shape: { pageNumber, x, y }
```

### Menu Options

| Option | Icon | Condition | Color | Action |
|--------|------|-----------|-------|--------|
| **Cut** | `scissors` | Always | `#ddd` | Cuts page to clipboard |
| **Copy** | `copy` | Always | `#ddd` | Copies page to clipboard |
| **Paste** | `paste` | `clipboardPage` exists | `#ddd` / `#666` disabled | Pastes page |
| **Duplicate** | `duplicate` | Always | `#ddd` | Duplicates the page |
| ─ Divider ─ | | | | |
| **Rotate** | `rotate` | Always | `#ddd` | Rotates page 90° clockwise |
| **Mirror Horizontally** | `flipHorizontal` | Always | `#ddd` | Flips page horizontally |
| **Mirror Vertically** | `flipVertical` | Always | `#ddd` | Flips page vertically |
| **Reset** | `reset` | Always | `#ddd` | Resets all transformations |
| ─ Divider ─ | | | | |
| **Delete** | `trash` | Always | `#ff6b6b` | Deletes the page (with confirmation) |

### Icon Integration

Uses the `Icon` component for menu item icons:

```jsx
<Icon name="scissors" size={14} color="#999" />
<Icon name="copy" size={14} color="#999" />
<Icon name="paste" size={14} color={clipboardPage ? "#999" : "#555"} />
<Icon name="duplicate" size={14} color="#999" />
<Icon name="rotate" size={14} color="#999" />
<Icon name="flipHorizontal" size={14} color="#999" />
<Icon name="flipVertical" size={14} color="#999" />
<Icon name="reset" size={14} color="#999" />
<Icon name="trash" size={14} color="#ff6b6b" />
```

### Paste Disabled State

```css
/* Disabled Paste Button */
{
  cursor: clipboardPage ? 'pointer' : 'not-allowed',
  color: clipboardPage ? '#ddd' : '#666',
  opacity: clipboardPage ? 1 : 0.5
}
```

---

## 4. PageAnnotationLayer Context Menus

**File:** `src/PageAnnotationLayer.jsx`

This component handles **3 different context menu types** based on what was clicked.

### Context Menu State

```javascript
const [contextMenu, setContextMenu] = useState(null);
// Shape: { visible, x, y, type: 'annotation' | 'callout' | 'page', target?, calloutId? }
```

### Menu Types

#### Type: `annotation` (Fabric.js Objects)

Shown when right-clicking on shapes, lines, arrows, text, etc.

| Option | Condition | Color | Action |
|--------|-----------|-------|--------|
| **Cut** | Always | `#ddd` | Cuts to internal clipboard |
| **Copy** | Always | `#ddd` | Copies to internal clipboard |
| **Paste** | Clipboard has content | `#ddd` | Pastes from clipboard |
| ─ Divider ─ | | | |
| **Group** | `type === 'activeSelection'` | `#ddd` | Groups selected objects |
| **Ungroup** | `type === 'group'` | `#ddd` | Ungroups the group |
| **Properties** | Always | `#ddd` | Opens edit modal |
| ─ Divider ─ | | | |
| **Delete** | Always | `#ff6b6b` | Deletes annotation(s) |

#### Type: `callout` (React Callouts)

Shown when right-clicking on callout annotations.

| Option | Condition | Color | Action |
|--------|-----------|-------|--------|
| **Cut** | Always | `#ddd` | Cuts callout |
| **Copy** | Always | `#ddd` | Copies callout |
| **Paste** | `clipboardCallout` exists | `#ddd` | Pastes callout |
| ─ Divider ─ | | | |
| **Properties** | Always | `#ddd` | Opens callout edit modal |
| ─ Divider ─ | | | |
| **Delete** | Always | `#ff6b6b` | Deletes callout |

#### Type: `page` (Background)

Shown when right-clicking on empty canvas area.

| Option | Condition | Color | Action |
|--------|-----------|-------|--------|
| **Paste** | Clipboard/callout exists | `#ddd` | Pastes annotation/callout |
| ─ Divider ─ | | | |
| **Paste Page** | `pageClipboard` exists | `#ddd` | Pastes page at this location |
| ─ Divider ─ | | | |
| **Duplicate Page** | Always | `#ddd` | Duplicates current page |
| ─ Divider ─ | | | |
| **Rotate Clockwise** | Always | `#ddd` | Rotates page CW |
| **Rotate Counter-Clockwise** | Always | `#ddd` | Rotates page CCW |
| ─ Divider ─ | | | |
| **Insert Blank Page** | Always | `#ddd` | Inserts blank page after |

### Click Target Detection

```javascript
const handleContextMenu = useCallback((e, fabricTarget = null) => {
  // 1. Check for Fabric.js annotation
  let target = fabricTarget || canvas.findTarget(e, false);
  
  // Handle callout group children
  if (target?.group?.data?.type === 'callout') {
    target = target.group;
  }
  
  if (target) {
    // Show annotation menu
    setContextMenu({ type: 'annotation', target, ... });
    return;
  }
  
  // 2. Check for React callout
  const pageCallouts = calloutsRef.current.filter(c => c.pageNumber === pageNumber);
  for (const callout of pageCallouts) {
    if (isPointOnCallout(clickPos, callout, pageWidth, pageHeight)) {
      setSelectedCalloutId(callout.id);
      setContextMenu({ type: 'callout', calloutId: callout.id, ... });
      return;
    }
  }
  
  // 3. Background click - show page menu
  setContextMenu({ type: 'page', ... });
}, [...]);
```

### Viewport-Safe Positioning

Uses `calculateViewportSafePosition` utility for all menus:

```javascript
import { calculateViewportSafePosition, calculateViewportSafePositionFromElement } from './utils/menuPositioning';

// Initial positioning (before element is rendered)
const safePosition = calculateViewportSafePosition(e.clientX, e.clientY, {
  estimatedWidth: 200,
  estimatedHeight: 300,
  padding: 10,
  preferAbove: true  // Position above cursor if it would overflow below
});

// Post-render positioning (using actual element dimensions)
const exactPosition = calculateViewportSafePositionFromElement(
  menuRef.current,  // The rendered menu element
  initialX,
  initialY,
  10,    // padding
  true   // preferAbove
);
```

**Function Signatures:**

```javascript
// Initial positioning with estimated dimensions
function calculateViewportSafePosition(x, y, options = {}) {
  // options: { estimatedWidth, estimatedHeight, padding, preferAbove }
  // Returns: { x: number, y: number }
}

// Precise positioning using actual DOM element
function calculateViewportSafePositionFromElement(element, initialX, initialY, padding = 10, preferAbove = true) {
  // Returns: { x: number, y: number }
}
```

Post-render adjustment for accurate dimensions:

```javascript
useEffect(() => {
  if (!contextMenu?.visible || contextMenuPositionAdjustedRef.current) return;
  
  requestAnimationFrame(() => {
    const rect = contextMenuRef.current.getBoundingClientRect();
    const padding = 10;
    
    let adjustedX = contextMenu.x;
    let adjustedY = contextMenu.y;
    
    if (rect.right + padding > viewportWidth) {
      adjustedX = viewportWidth - rect.width - padding;
    }
    if (rect.left < padding) {
      adjustedX = padding;
    }
    if (rect.bottom + padding > viewportHeight) {
      adjustedY = viewportHeight - rect.height - padding;
    }
    if (rect.top < padding) {
      adjustedY = padding;
    }
    
    setContextMenu(prev => ({ ...prev, x: adjustedX, y: adjustedY }));
    contextMenuPositionAdjustedRef.current = true;
  });
}, [contextMenu?.visible]);
```

---

## 5. Edit/Properties Modal

**File:** `src/PageAnnotationLayer.jsx`

Opened from "Properties" menu option. A draggable modal for editing annotation properties.

### Modal State

```javascript
const [editModal, setEditModal] = useState(null);
// Shape: { visible, x, y, object, initialStates? }

const [editValues, setEditValues] = useState({
  stroke: '#000000',
  strokeWidth: 1,
  opacity: 1,
  arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  fill: '#000000',
  fontSize: 16,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textAlign: 'left',
  fontFamily: 'Arial',
  fillColor: 'rgba(255,255,255,0.9)'
});
```

### Modal Styling

```css
{
  position: 'fixed',
  background: '#2b2b2b',
  border: '1px solid #444',
  borderRadius: '8px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  zIndex: 10001,
  minWidth: '200px',
  display: 'flex',
  flexDirection: 'column'
}
```

### Editable Properties

| Property | Control Type | Applies To |
|----------|-------------|------------|
| Stroke Color | Color picker | All shapes |
| Stroke Width | Number input | All shapes |
| Opacity | Range slider | All objects |
| Arrowhead Style | Dropdown | Arrows only |
| Fill Color | Color picker | Text, callouts |
| Font Size | Number input | Text, callouts |
| Font Weight | Toggle | Text, callouts |
| Font Style | Toggle | Text, callouts |
| Text Align | Buttons | Text, callouts |
| Font Family | Dropdown | Text, callouts |
| Background Color | Color picker | Callouts only |

---

## Implementation Patterns

### 1. Preventing Event Bubbling

```jsx
<div
  onClick={(e) => e.stopPropagation()}
  onContextMenu={(e) => e.preventDefault()}
>
  {/* Menu content */}
</div>
```

### 2. Close-on-Click-Outside Pattern

```javascript
useEffect(() => {
  const handleClickOutside = (event) => {
    if (menuRef.current && !menuRef.current.contains(event.target)) {
      onClose();
    }
  };
  
  if (visible) {
    document.addEventListener('click', handleClickOutside, true);
    document.addEventListener('contextmenu', handleClickOutside, true);
  }
  
  return () => {
    document.removeEventListener('click', handleClickOutside, true);
    document.removeEventListener('contextmenu', handleClickOutside, true);
  };
}, [visible, onClose]);
```

### 3. Keyboard Navigation

```javascript
useEffect(() => {
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };
  
  document.addEventListener('keydown', handleEscape);
  return () => document.removeEventListener('keydown', handleEscape);
}, [onClose]);
```

### 4. Delayed Event Listener Registration

Prevents immediate closing when opening menu:

```javascript
// Delay adding click listener to allow current click to complete
const timeout = setTimeout(() => {
  document.addEventListener('click', handleClickOutside, true);
}, 100);

// Track with ref to prevent race conditions
contextMenuJustOpenedRef.current = true;
setTimeout(() => {
  contextMenuJustOpenedRef.current = false;
}, 100);
```

---

## Color Reference

| Color Code | Usage |
|------------|-------|
| `#333` | Menu background (dark theme) |
| `#3a3a3a` | Button hover state |
| `#444` | Border color, divider |
| `#555` | Input borders |
| `#666` | Disabled text |
| `#999` | Icon color (normal) |
| `#ddd` | Text color (normal) |
| `#ff6b6b` | Delete/destructive action text |
| `white` | Menu background (light theme) |
| `#f0f0f0` | Button hover (light theme) |
| `#e0e0e0` | Divider (light theme) |

---

## Dependencies

- **React** - Component framework
- **Fabric.js** - Canvas annotations (PageAnnotationLayer)
- **martinez-polygon-clipping** - Region merge/separate operations
- **Custom Icon component** - Menu icons (`src/Icons.jsx`)
- **calculateViewportSafePosition** - Position utility (`src/utils/menuPositioning.js`)

---

## File Locations Summary

```
src/
├── components/
│   └── Callout/
│       ├── CalloutContextMenu.jsx    # Standalone callout context menu component
│       ├── CalloutComponent.jsx      # Callout renderer with context menu integration
│       ├── CalloutEditModal.jsx      # Properties/edit modal for callouts
│       └── types.js                  # ARROWHEAD_STYLES, presetColors, fontFamilies
├── sidebar/
│   └── PagesPanel.jsx                # Page thumbnail context menu
├── utils/
│   └── menuPositioning.js            # calculateViewportSafePosition utility
├── RegionSelectionTool.jsx           # Region context menu (inline)
├── PageAnnotationLayer.jsx           # Annotation, callout, page menus (inline)
└── Icons.jsx                         # Icon component for menu items
```

