# Drag-to-Reorder Troubleshooting Guide

## Current Status
Drag-to-reorder for bookmarks is not working. This document helps debug the issue.

## Debugging Steps

### 1. Open Browser Console
Open the browser developer tools (F12) and go to the Console tab.

### 2. Enable Edit Mode
1. Click the "Edit" button in the Bookmarks panel
2. Look for this log: `[BookmarksPanel] Hook state:`
3. Verify:
   - `isEditMode: true`
   - `flatBookmarksCount` > 0 (should show number of root-level bookmarks)
   - `hasHandleGrab: true`
   - `hasRegisterItemRef: true`

### 3. Check Element Registration
When bookmarks render, you should see logs like:
- `[BookmarkItem] Registering root item ref via callback: <item-id>`
- `[BookmarkItem] Registering root item ref via useEffect: <item-id>`

If you DON'T see these logs, the elements aren't being registered.

### 4. Test Drag Handle Click
1. Click on a drag handle (☰ icon) - it should have a blue background/border (debug styling)
2. Look for these logs in order:
   - `[BookmarkItem] Drag handle onMouseDown fired`
   - `[BookmarkItem] ===== DRAG HANDLE CLICKED =====`
   - `[BookmarkItem] ✅ Calling onDragHandle with item.id: <id>`
   - `[BookmarksPanel] onDragHandle prop called with itemId: <id>`
   - `[HierarchicalDrag] handleGrab called with itemId: <id>, enabled: true`
   - `[HierarchicalDrag] Found itemElement: true`

### 5. Common Issues

#### Issue: "Drag blocked: Edit mode is OFF"
**Solution**: Click the "Edit" button to enable edit mode

#### Issue: "Drag blocked: onDragHandle is not provided"
**Solution**: The `handleGrab` function from the hook is not being passed correctly. Check that `isEditMode` is true.

#### Issue: "No element found, returning"
**Solution**: The element isn't registered. Check:
- Is the bookmark at root level? (level === 0, no parentId)
- Are the registration logs appearing?
- Is `registerItemRef` being called?

#### Issue: Drag handle not visible
**Solution**: The drag handle should have a blue background/border in debug mode. If not visible:
- Check if `isEditMode` is true
- Check if the bookmark item is rendering
- Check browser console for errors

#### Issue: Click doesn't fire
**Solution**: 
- Check if another element is overlaying the drag handle
- Check CSS `pointer-events` property
- Check `z-index` values

### 6. Visual Debugging
The drag handles now have:
- Blue background: `rgba(74, 144, 226, 0.1)`
- Blue border: `rgba(74, 144, 226, 0.3)`
- Tooltip showing the item name/id

If you don't see these, the drag handle isn't rendering.

### 7. Check Hook Configuration
Verify in console logs:
```
[BookmarksPanel] Hook state: {
  isEditMode: true,
  flatBookmarksCount: <number>,
  flatBookmarks: [array of bookmarks],
  hasHandleGrab: true,
  hasRegisterItemRef: true,
  draggingState: null (or object when dragging)
}
```

### 8. Manual Test
Try manually calling the drag function:
1. Open console
2. Type: `document.querySelector('[data-drag-handle]')`
3. Should return the drag handle element
4. Try clicking it and see what logs appear

## Expected Flow

1. User clicks "Edit" → `isEditMode` becomes `true`
2. Hook initializes with `enabled: true`
3. Bookmarks render with drag handles visible
4. Elements register via ref callback
5. User clicks drag handle → `onMouseDown` fires
6. `handleDragHandleMouseDown` checks conditions
7. Calls `onDragHandle(e, itemId)`
8. Which calls `handleGrab(e, itemId)` from hook
9. Hook finds element in `itemRefs.current.get(itemId)`
10. Drag starts

## Next Steps

After running through these steps, share:
1. What logs you see (or don't see)
2. At which step it fails
3. Any error messages
4. Screenshot of console logs when clicking drag handle



