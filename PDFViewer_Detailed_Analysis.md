# PDFViewer Component Analysis: Page Navigation and Scroll Event Handling

## Overview
The PDFViewer is implemented as the main component in `/Users/isaiahcalvo/Desktop/Survey/src/App.jsx`. It's a complex, full-featured PDF viewer with page navigation, zoom, and rendering optimization. The page number tracking uses React hooks and an IntersectionObserver API for scroll tracking.

---

## 1. State Management for Page Navigation

### Core State Variables
Located at lines 5943-5945:

```javascript
const [pageNum, setPageNum] = useState(1);              // Current page number (1-based)
const [pageInputValue, setPageInputValue] = useState('1'); // Display value in input field
const [isPageInputDirty, setIsPageInputDirty] = useState(false); // Tracks if user is editing
```

### Ref Tracking
Located at lines 5901-5912:

```javascript
const containerRef = useRef();                    // Main scroll container
const pageContainersRef = useRef({});             // Map of page DOM elements by page number
const pageInputRef = useRef(null);                // Reference to the page number input element
const isNavigatingRef = useRef(false);            // Blocks IntersectionObserver during programmatic navigation
const targetPageRef = useRef(null);               // Target page during smooth scroll navigation
const observerRef = useRef(null);                 // IntersectionObserver instance
const pageNumRef = useRef(1);                     // Synced with pageNum state for closures
```

### Ref Sync with State
Located at lines 6059-6060:

```javascript
useEffect(() => {
  pageNumRef.current = pageNum;
}, [pageNum]);
```

---

## 2. Page Number Input Implementation

### Input Rendering (Lines 8207-8230)
The page input is rendered in the header toolbar:

```jsx
<input
  ref={pageInputRef}
  type="text"
  data-page-number-input
  value={pageInputValue}
  onChange={handlePageInputChange}
  onKeyDown={handlePageInputKeyDown}
  onBlur={handlePageInputBlur}
  inputMode="numeric"
  pattern="[0-9]*"
  aria-label="Current page"
  style={{
    width: '56px',
    padding: '6px 10px',
    background: '#444',
    color: '#ddd',
    border: '1px solid #555',
    borderRadius: '5px',
    fontSize: '14px',
    // ... more styles
  }}
/>
```

### Input Event Handlers

#### 1. `handlePageInputChange` (Lines 7591-7595)
Handles real-time input changes, only allows digits:

```javascript
const handlePageInputChange = useCallback((e) => {
  const digitsOnly = e.target.value.replace(/\D/g, '');
  setPageInputValue(digitsOnly);
  setIsPageInputDirty(true);  // Mark input as being edited
}, []);
```

#### 2. `commitPageInput` (Lines 7597-7610)
Validates and commits the page number change:

```javascript
const commitPageInput = useCallback(() => {
  const value = parseInt(pageInputValue);
  if (!isNaN(value) && value >= 1 && value <= numPages) {
    // Navigate first, then update input value will be synced by useEffect when pageNum updates
    goToPage(value);
    // Also set it immediately for visual feedback, but useEffect will ensure it's correct
    setPageInputValue(String(value));
    setIsPageInputDirty(false);
  } else {
    // Reset to current pageNum if invalid
    setPageInputValue(String(pageNum));
    setIsPageInputDirty(false);
  }
}, [pageInputValue, numPages, goToPage, pageNum]);
```

#### 3. `handlePageInputKeyDown` (Lines 7612-7618)
Triggers commit on Enter key:

```javascript
const handlePageInputKeyDown = useCallback((e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitPageInput();
    e.target.blur();
  }
}, [commitPageInput]);
```

#### 4. `handlePageInputBlur` (Lines 7620-7622)
Triggers commit when input loses focus:

```javascript
const handlePageInputBlur = useCallback(() => {
  commitPageInput();
}, [commitPageInput]);
```

---

## 3. Scroll Event Tracking (IntersectionObserver)

### Setup (Lines 7222-7318)
The component uses the IntersectionObserver API to track which pages are visible in the viewport. This is **NOT** a traditional scroll event listener but rather an observer-based system.

```javascript
useEffect(() => {
  if (scrollMode !== 'continuous' || !pdfDoc) return;

  if (observerRef.current) {
    observerRef.current.disconnect();
  }

  let visiblePages = new Map();    // Map of pageNumber -> intersectionRatio
  let updateTimer = null;

  const observer = new IntersectionObserver((entries) => {
    // Always process entries to ensure pages are rendered even during navigation.
    // We only gate the pageNum update below, not rendering.
    entries.forEach(entry => {
      const pageNumber = parseInt(entry.target.dataset.pageNum);

      if (entry.isIntersecting) {
        // Store the intersection ratio for this page
        visiblePages.set(pageNumber, entry.intersectionRatio);

        setRenderedPages(prev => {
          if (!prev.has(pageNumber)) {
            renderPage(pageNumber, 'high');  // High priority for visible pages
          }
          return prev;
        });
        
        // Pre-render nearby pages for instant scrolling
        preRenderNearbyPages(pageNumber);
      } else {
        visiblePages.delete(pageNumber);
      }
    });

    // Debounce page number updates
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      // Only update pageNum if we're not navigating programmatically
      // and if there are visible pages to check
      if (visiblePages.size > 0 && !isNavigatingRef.current && targetPageRef.current === null && !isZoomingRef.current) {
        // Find the page with the highest intersection ratio (most visible)
        let maxRatio = 0;
        let mostVisiblePage = 1;
        visiblePages.forEach((ratio, pageNum) => {
          if (ratio > maxRatio) {
            maxRatio = ratio;
            mostVisiblePage = pageNum;
          }
        });
        // Only update if the detected page is different from current
        // This prevents unnecessary updates that might interfere with navigation
        setPageNum(prevPage => {
          if (prevPage !== mostVisiblePage) {
            return mostVisiblePage;
          }
          return prevPage;
        });
      }
    }, 100);  // 100ms debounce
  }, {
    root: containerRef.current,
    rootMargin: '2000px',          // Increased to pre-render pages earlier
    threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0]
  });

  observerRef.current = observer;

  // Use a small timeout to ensure DOM elements are mounted
  const setupTimer = setTimeout(() => {
    const containers = Object.values(pageContainersRef.current).filter(Boolean);
    console.log('Setting up IntersectionObserver for', containers.length, 'page containers');
    containers.forEach(container => {
      if (container) {
        observer.observe(container);
      }
    });
  }, 100);

  // Cleanup on unmount or dependency change
  return () => {
    clearTimeout(setupTimer);
    clearTimeout(updateTimer);
    observer.disconnect();
  };
}, [scrollMode, pdfDoc, renderPage, preRenderNearbyPages]);
```

### Key Features of IntersectionObserver:
- **No scroll event listener**: Uses the Intersection Observer API instead
- **Threshold levels**: `[0, 0.1, 0.25, 0.5, 0.75, 1.0]` detects pages at multiple visibility levels
- **Root margin**: `2000px` to pre-render pages before they enter viewport
- **Debouncing**: 100ms debounce prevents too-frequent page updates
- **Guards**: Only updates `pageNum` when:
  - `isNavigatingRef.current === false` (not in programmatic navigation)
  - `targetPageRef.current === null` (no pending navigation target)
  - `isZoomingRef.current === false` (not zooming)

---

## 4. Page Input Synchronization

### Input Syncs to State (Lines 7626-7650)
When `pageNum` changes (from navigation, scroll, buttons, etc.), the input field is synced:

```javascript
useEffect(() => {
  const inputElement = pageInputRef.current;
  if (!inputElement) {
    // If ref not attached yet, still update the value
    setPageInputValue(String(pageNum));
    setIsPageInputDirty(false);
    return;
  }
  
  // Always sync to the current pageNum when it changes
  // This ensures the input reflects the actual current page
  // We use a functional update to avoid stale closures
  setPageInputValue(prevValue => {
    const currentPageStr = String(pageNum);
    // Only update if it's actually different to avoid unnecessary re-renders
    if (prevValue !== currentPageStr) {
      if (document.activeElement === inputElement && isPageInputDirty) {
        return prevValue;  // Don't overwrite if user is actively typing
      }
      setIsPageInputDirty(false);
      return currentPageStr;
    }
    return prevValue;
  });
}, [pageNum, isPageInputDirty]);
```

**Key Logic**:
- Only updates the display value if it differs from current `pageNum`
- **Preserves user input**: If user is actively editing (`isPageInputDirty === true`), doesn't overwrite
- Uses functional state update to avoid stale closure issues

---

## 5. Navigation Methods

### 5.1 `goToPage()` (Lines 6811-6888)
Central navigation function handles both single and continuous scroll modes:

```javascript
const goToPage = useCallback((targetPage, options = {}) => {
  const { fallback = 'nearest' } = options;
  let desiredPage = targetPage;

  // Space filtering logic (if activeSpaceId set)
  if (activeSpaceId) {
    if (!activeSpacePages || activeSpacePages.length === 0) {
      return;
    }
    // ...space-specific page validation...
  }

  if (desiredPage < 1 || desiredPage > numPages) return;

  if (scrollMode === 'single') {
    setPageNum(desiredPage);  // Simple state update for single page mode
  } else {
    // Continuous scroll mode: complex smooth scroll with timing
    isNavigatingRef.current = true;
    targetPageRef.current = desiredPage;

    const targetContainer = pageContainersRef.current[desiredPage];
    const container = containerRef.current;
    if (targetContainer && container) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetContainer.getBoundingClientRect();
      const computedStyles = window.getComputedStyle(container);
      const paddingTop = parseFloat(computedStyles.paddingTop || '0');
      const deltaTop = targetRect.top - containerRect.top;
      const nextScrollTop = Math.max(deltaTop + container.scrollTop - paddingTop, 0);

      container.scrollTo({
        top: nextScrollTop,
        behavior: 'smooth'
      });

      setTimeout(() => {
        setPageNum(desiredPage);
        // Force input value to match the target page immediately
        setPageInputValue(String(desiredPage));
        setIsPageInputDirty(false);
        // Keep navigation flag longer to prevent IntersectionObserver from interfering
        // Wait for smooth scroll animation to fully complete
        setTimeout(() => {
          isNavigatingRef.current = false;
          targetPageRef.current = null;
          // One more sync after navigation fully completes to ensure consistency
          setPageNum(prev => prev !== desiredPage ? desiredPage : prev);
        }, 300);  // Wait 300ms for smooth scroll to complete
      }, 600);   // Initial delay for animation to start
    } else {
      // If container not found, still update pageNum immediately
      setPageNum(desiredPage);
      isNavigatingRef.current = false;
      targetPageRef.current = null;
      setPageInputValue(String(desiredPage));
      setIsPageInputDirty(false);
    }
  }
}, [numPages, scrollMode, activeSpaceId, activeSpacePages]);
```

### 5.2 Previous/Next Navigation (Lines 7399-7405)

```javascript
const goToPreviousPage = useCallback(() => {
  goToPage(pageNum - 1, { fallback: 'previous' });
}, [goToPage, pageNum]);

const goToNextPage = useCallback(() => {
  goToPage(pageNum + 1, { fallback: 'next' });
}, [goToPage, pageNum]);
```

These are bound to the arrow buttons in the toolbar (lines 8200-8204).

---

## 6. Potential Issues and Concerns

### Issue 1: Debounce Delay in Scroll Updates
**Location**: Line 7280
```javascript
}, 100);  // 100ms debounce
```

**Problem**: When scrolling rapidly, the page number update is delayed by up to 100ms after IntersectionObserver detects a change. This can cause:
- Input field not updating immediately during fast scrolling
- User seeing "wrong" page number briefly

**Impact**: Acceptable for most users, but noticeable on very large PDFs with fast scrolling.

---

### Issue 2: Navigation Guard Logic
**Location**: Line 7261
```javascript
if (visiblePages.size > 0 && !isNavigatingRef.current && targetPageRef.current === null && !isZoomingRef.current)
```

**Problem**: Three separate ref flags control when IntersectionObserver updates `pageNum`:
1. `isNavigatingRef.current` - Set during programmatic navigation
2. `targetPageRef.current` - Tracks the target page during navigation
3. `isZoomingRef.current` - Blocks updates during zoom

**Risk**: If any flag gets stuck in the wrong state, page updates won't work:
- **Scenario**: If `isNavigatingRef` is never reset to `false`, scroll won't update page number
- **Scenario**: If `targetPageRef` is not cleared, only the target page will update

---

### Issue 3: Two-Stage Timeout in goToPage()
**Location**: Lines 6859-6878
```javascript
container.scrollTo({ top: nextScrollTop, behavior: 'smooth' });

setTimeout(() => {
  setPageNum(desiredPage);
  // ...
  setTimeout(() => {
    isNavigatingRef.current = false;
    targetPageRef.current = null;
    // ...
  }, 300);
}, 600);
```

**Problem**: Hardcoded timeouts (600ms + 300ms = 900ms total):
- 600ms delay assumes the scroll starts immediately
- 300ms duration assumes "smooth" scroll takes 300ms
- **No guarantee** that CSS smooth scroll completes by then
- On slow devices or large PDFs, animation might still be running

**Risk**: Navigation flags reset before animation finishes, allowing IntersectionObserver to interfere

---

### Issue 4: Input Not Updating During Scroll
**Location**: Lines 7642-7644
```javascript
if (document.activeElement === inputElement && isPageInputDirty) {
  return prevValue;  // Don't overwrite if user is actively typing
}
```

**Problem**: If user clicks on input field but doesn't type, `isPageInputDirty` stays `false` but `document.activeElement` is the input. The condition only prevents updates if BOTH are true.

**Observation**: Once `commitPageInput()` is called (on blur or Enter), `isPageInputDirty` is set to `false`, allowing normal updates to resume.

---

### Issue 5: IntersectionObserver Not Re-triggered on Zoom
**Location**: Lines 7223
```javascript
if (scrollMode !== 'continuous' || !pdfDoc) return;
```

**Problem**: When zoom changes, `zoomingRef` is set but the IntersectionObserver callback still fires. However, the callback won't update `pageNum` because of the guard on line 7261:
```javascript
if (...&& !isZoomingRef.current)
```

**Timing Issue**: After zoom completes, IntersectionObserver might not be re-triggered immediately, so the page number might not update until the next actual scroll or visibility change.

---

## 7. Data Flow Diagram

```
User Actions:
├── Type in input field
│   └─> handlePageInputChange() [setPageInputValue, setIsPageInputDirty=true]
│       └─> (on Enter or Blur)
│           └─> commitPageInput()
│               └─> goToPage(value)
│
├── Click Previous/Next buttons
│   └─> goToPreviousPage/goToNextPage()
│       └─> goToPage(pageNum ± 1)
│
└── Scroll viewport manually
    └─> IntersectionObserver callback (automatic)
        └─> setRenderedPages()
        └─> (after 100ms debounce)
            └─> setPageNum(mostVisiblePage)

Page Number Update Flow:
├─> pageNum state changes
│   └─> useEffect [7626-7650]
│       └─> setPageInputValue(String(pageNum))
│           (unless user actively typing)
└─> pageNumRef.current synced [6059-6060]
```

---

## 8. Summary Table

| Feature | Implementation | Status |
|---------|-----------------|--------|
| Page input field | HTML `<input type="text">` with numeric filtering | Working |
| Input validation | Checks range `[1, numPages]` | Working |
| Input sync to state | `useEffect` watches `pageNum` changes | Working |
| Scroll tracking | IntersectionObserver API (not scroll events) | Working |
| Scroll debounce | 100ms delay | Present |
| Navigation guards | Three refs: `isNavigatingRef`, `targetPageRef`, `isZoomingRef` | Potential risk |
| Smooth scroll timing | Hardcoded 600ms + 300ms timeouts | Fragile |
| User typing protection | `isPageInputDirty` + `document.activeElement` check | Working |
| Previous/Next buttons | Bound to `goToPreviousPage/goToNextPage` | Working |

---

## 9. Debugging Tips

To identify scroll-to-page-number update issues:

1. **Check IntersectionObserver is active**:
   ```javascript
   console.log('Observer setup, pages watched:', Object.keys(pageContainersRef.current).length);
   ```
   (Already logged at line 7292)

2. **Monitor ref state during scrolling**:
   ```javascript
   console.log({
     isNavigatingRef: isNavigatingRef.current,
     targetPageRef: targetPageRef.current,
     isZoomingRef: isZoomingRef.current
   });
   ```

3. **Check visiblePages detected**:
   ```javascript
   console.log('Visible pages:', Array.from(visiblePages.entries()));
   ```

4. **Monitor pageNum updates**:
   ```javascript
   console.log('pageNum changed to:', mostVisiblePage);
   ```

5. **Verify input synchronization**:
   ```javascript
   console.log('Input synced to:', pageNum);
   ```

