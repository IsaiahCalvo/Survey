# Critical Code Snippets - PDFViewer Page Navigation

## File Location
`/Users/isaiahcalvo/Desktop/Survey/src/App.jsx`

---

## 1. PAGE INPUT ELEMENT RENDERING (Lines 8207-8230)

```jsx
<input
  ref={pageInputRef}
  type="text"
  data-page-number-input
  value={pageInputValue}              // Controlled by state
  onChange={handlePageInputChange}    // User typing
  onKeyDown={handlePageInputKeyDown}  // Enter key detection
  onBlur={handlePageInputBlur}        // Focus loss detection
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
    fontFamily: FONT_FAMILY,
    fontWeight: '500',
    letterSpacing: '-0.2px',
    textAlign: 'center'
  }}
/>
```

**Key Points:**
- Controlled input with `value={pageInputValue}`
- Three event handlers for user interaction
- HTML input type constraints (`inputMode="numeric"`, `pattern="[0-9]*"`)

---

## 2. PAGE INPUT CHANGE HANDLER (Lines 7591-7595)

```javascript
const handlePageInputChange = useCallback((e) => {
  const digitsOnly = e.target.value.replace(/\D/g, '');  // Remove non-digits
  setPageInputValue(digitsOnly);                          // Update display value
  setIsPageInputDirty(true);                              // Mark as being edited
}, []);
```

**Purpose:** 
- Filters input to digits only
- Marks input as "dirty" (user is actively typing)
- Does NOT navigate yet - waits for Enter or blur

---

## 3. COMMIT PAGE INPUT (Lines 7597-7610)

```javascript
const commitPageInput = useCallback(() => {
  const value = parseInt(pageInputValue);
  
  // Validate range
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

**Key Logic:**
1. Parse input to integer
2. Validate: 1 <= value <= numPages
3. Call `goToPage()` to navigate
4. Reset dirty flag to allow sync updates
5. On invalid input, revert to current `pageNum`

---

## 4. KEY DOWN & BLUR HANDLERS (Lines 7612-7622)

```javascript
const handlePageInputKeyDown = useCallback((e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitPageInput();       // Validate and navigate
    e.target.blur();         // Remove focus
  }
}, [commitPageInput]);

const handlePageInputBlur = useCallback(() => {
  commitPageInput();  // Validate and navigate when focus lost
}, [commitPageInput]);
```

**Behavior:**
- Enter key: Trigger commit, remove focus
- Focus loss: Trigger commit

---

## 5. INPUT SYNC WITH PAGE NUMBER STATE (Lines 7626-7650)

```javascript
// Sync input value when pageNum changes from other sources 
// (prev/next buttons, IntersectionObserver, etc.)
// But only if the input is not currently focused (user isn't typing)
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
      // Preserve input if user is actively typing
      if (document.activeElement === inputElement && isPageInputDirty) {
        return prevValue;  // DON'T OVERWRITE USER'S INPUT
      }
      setIsPageInputDirty(false);
      return currentPageStr;  // Update to new page number
    }
    return prevValue;
  });
}, [pageNum, isPageInputDirty]);
```

**Critical Logic:**
- Line 7642-7644: **User typing protection**
  - If input is focused AND user is actively typing, don't overwrite
  - Otherwise, sync to current `pageNum`
- Uses functional state update to handle stale closure issues

---

## 6. GO TO PAGE - CORE NAVIGATION (Lines 6811-6888)

```javascript
const goToPage = useCallback((targetPage, options = {}) => {
  const { fallback = 'nearest' } = options;
  let desiredPage = targetPage;

  // Space filtering logic (if activeSpaceId set)...
  if (activeSpaceId) {
    if (!activeSpacePages || activeSpacePages.length === 0) {
      return;
    }
    // ...page validation for active space...
  }

  if (desiredPage < 1 || desiredPage > numPages) return;

  // SINGLE PAGE MODE
  if (scrollMode === 'single') {
    setPageNum(desiredPage);  // Simple state update
  } else {
    // CONTINUOUS SCROLL MODE
    isNavigatingRef.current = true;        // [Line 6846] BLOCK IntersectionObserver
    targetPageRef.current = desiredPage;   // [Line 6847] Set target

    const targetContainer = pageContainersRef.current[desiredPage];
    const container = containerRef.current;
    
    if (targetContainer && container) {
      // Calculate scroll position
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetContainer.getBoundingClientRect();
      const computedStyles = window.getComputedStyle(container);
      const paddingTop = parseFloat(computedStyles.paddingTop || '0');
      const deltaTop = targetRect.top - containerRect.top;
      const nextScrollTop = Math.max(
        deltaTop + container.scrollTop - paddingTop, 
        0
      );

      // [Line 6859-6862] SMOOTH SCROLL TO PAGE
      container.scrollTo({
        top: nextScrollTop,
        behavior: 'smooth'  // CSS animation ~300-500ms
      });

      // [Line 6864-6878] TIMING SEQUENCE
      setTimeout(() => {
        // After 600ms, update page state
        setPageNum(desiredPage);
        setPageInputValue(String(desiredPage));
        setIsPageInputDirty(false);
        
        // Wait 300ms more for smooth scroll to complete
        setTimeout(() => {
          isNavigatingRef.current = false;    // [Line 6873] UNBLOCK observer
          targetPageRef.current = null;       // [Line 6874] Clear target
          
          // Final sync to ensure consistency
          setPageNum(prev => prev !== desiredPage ? desiredPage : prev);
        }, 300);  // ~900ms total
      }, 600);
    } else {
      // Container not found - update immediately
      setPageNum(desiredPage);
      isNavigatingRef.current = false;
      targetPageRef.current = null;
      setPageInputValue(String(desiredPage));
      setIsPageInputDirty(false);
    }
  }
}, [numPages, scrollMode, activeSpaceId, activeSpacePages]);
```

**Timing Issues:**
- Line 6859-6862: `scrollTo()` starts CSS animation (typically 300-500ms)
- Line 6864: 600ms delay assumes animation starts instantly
- Line 6872: 300ms more assumes animation finishes by then
- **Risk**: Total 900ms timeout may not match actual animation duration

---

## 7. INTERSECTION OBSERVER - SCROLL DETECTION (Lines 7222-7318)

```javascript
useEffect(() => {
  if (scrollMode !== 'continuous' || !pdfDoc) return;

  if (observerRef.current) {
    observerRef.current.disconnect();
  }

  let visiblePages = new Map();    // pageNumber -> intersectionRatio
  let updateTimer = null;

  const observer = new IntersectionObserver((entries) => {
    // Process all visibility changes
    entries.forEach(entry => {
      const pageNumber = parseInt(entry.target.dataset.pageNum);

      if (entry.isIntersecting) {
        // Page is visible - store its visibility ratio
        visiblePages.set(pageNumber, entry.intersectionRatio);

        // Render visible page
        setRenderedPages(prev => {
          if (!prev.has(pageNumber)) {
            renderPage(pageNumber, 'high');  // High priority
          }
          return prev;
        });
        
        // Pre-render nearby pages
        preRenderNearbyPages(pageNumber);
      } else {
        // Page left viewport
        visiblePages.delete(pageNumber);
      }
    });

    // [Line 7257-7280] DEBOUNCED PAGE UPDATE
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      // [Line 7261] GUARD: Only update if NOT navigating
      if (visiblePages.size > 0 && 
          !isNavigatingRef.current &&           // Not programmatically navigating
          targetPageRef.current === null &&     // No pending navigation
          !isZoomingRef.current) {              // Not zooming
        
        // Find most visible page
        let maxRatio = 0;
        let mostVisiblePage = 1;
        visiblePages.forEach((ratio, pageNum) => {
          if (ratio > maxRatio) {
            maxRatio = ratio;
            mostVisiblePage = pageNum;
          }
        });
        
        // Update only if changed
        setPageNum(prevPage => {
          if (prevPage !== mostVisiblePage) {
            return mostVisiblePage;
          }
          return prevPage;
        });
      }
    }, 100);  // [Line 7280] 100ms debounce

  }, {
    root: containerRef.current,
    rootMargin: '2000px',                    // Pre-render before visible
    threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0]  // Multiple visibility levels
  });

  observerRef.current = observer;

  // Setup observer after DOM elements mounted
  const setupTimer = setTimeout(() => {
    const containers = Object.values(pageContainersRef.current).filter(Boolean);
    console.log('Setting up IntersectionObserver for', containers.length, 'page containers');
    containers.forEach(container => {
      if (container) {
        observer.observe(container);
      }
    });
  }, 100);

  // Cleanup
  return () => {
    clearTimeout(setupTimer);
    clearTimeout(updateTimer);
    observer.disconnect();
  };
}, [scrollMode, pdfDoc, renderPage, preRenderNearbyPages]);
```

**Key Features:**
- Line 7232: IntersectionObserver with 6 threshold levels
- Line 7240: Track intersection ratio for each page
- Line 7261: Guard prevents update during navigation
- Line 7280: 100ms debounce limits update frequency
- Line 7283: 2000px margin pre-renders pages before visible

---

## 8. PREVIOUS/NEXT PAGE BUTTONS (Lines 7399-7405)

```javascript
const goToPreviousPage = useCallback(() => {
  goToPage(pageNum - 1, { fallback: 'previous' });  // Navigate with fallback
}, [goToPage, pageNum]);

const goToNextPage = useCallback(() => {
  goToPage(pageNum + 1, { fallback: 'next' });
}, [goToPage, pageNum]);
```

**Button Usage (Line 8200):**
```jsx
<button
  onClick={goToPreviousPage}
  disabled={pageNum <= 1}
  className="btn btn-default btn-icon"
>
  <Icon name="chevronLeft" size={18} />
</button>
```

---

## 9. STATE VARIABLES (Lines 5943-5945, 5901-5912, 6019)

```javascript
// Display state
const [pageNum, setPageNum] = useState(1);              // Current page (1-based)
const [pageInputValue, setPageInputValue] = useState('1'); // Input display
const [isPageInputDirty, setIsPageInputDirty] = useState(false); // User editing

// Ref tracking
const containerRef = useRef();                    // Scroll container
const pageContainersRef = useRef({});             // DOM elements: { [page]: element }
const pageInputRef = useRef(null);                // Input element reference
const isNavigatingRef = useRef(false);            // Navigation in progress
const targetPageRef = useRef(null);               // Target page during navigation
const observerRef = useRef(null);                 // IntersectionObserver instance
const pageNumRef = useRef(1);                     // Keep pageNum in sync for closures
```

---

## 10. REF SYNCHRONIZATION (Lines 6059-6060)

```javascript
// Keep ref in sync with state for use in closures
useEffect(() => {
  pageNumRef.current = pageNum;
}, [pageNum]);
```

**Purpose:** Ensures `pageNumRef` always matches current `pageNum` for use in event handlers that might otherwise have stale values.

---

## Summary of Data Flow

```
User Types "42" + Enter
    ↓
handlePageInputChange()
    ↓
commitPageInput()
    ↓
goToPage(42)
    ├→ Set isNavigatingRef = true (block observer)
    ├→ scrollTo({ behavior: 'smooth' })
    ├→ Wait 600ms
    ├→ setPageNum(42)
    └→ Wait 300ms
        └→ Reset isNavigatingRef = false (unblock observer)

pageNum changes
    ↓
useEffect [7626-7650]
    ├→ IF NOT (focused AND dirty)
    └→ setPageInputValue("42")

User scrolls manually
    ↓
IntersectionObserver callback
    ├→ Detect visible pages
    ├→ Wait 100ms (debounce)
    └→ IF NOT navigating AND NOT zooming
        └→ setPageNum(mostVisiblePage)
```

