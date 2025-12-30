# Spaces, Regions, Overlays, and Lightbulbs: Complete User Interaction Guide

## Overview

This document describes the complete system for Spaces, Regions, Grey Hashed Overlays, and Lightbulbs (Background Annotation Toggles). This serves as the authoritative reference for how these features should work and how users interact with them.

---

## 1. SPACES

### What is a Space?

A Space is a container that groups pages and defines which parts of the PDF are active. It acts as a filtering and organizational mechanism.

### Creating and Managing Spaces

- Users create spaces in the sidebar (Spaces panel)
- Each space has a name (editable)
- Spaces can be reordered via drag-and-drop
- Spaces can be deleted

### Activating a Space

- Click a space in the sidebar to activate it
- When active, only pages assigned to that space are visible
- All other pages are hidden
- Only one space can be active at a time
- Clicking the active space again or clicking "Exit Space Mode" deactivates it

### Space States

- **Active**: The space is enabled and filtering pages
- **Inactive**: The space exists but isn't filtering

---

## 2. REGIONS

### What is a Region?

A Region defines specific areas on a page within a space. Each page can have at most one region, and a region can contain multiple separate areas (polygons).

### Creating Regions

1. Activate a space
2. Assign pages to the space (if not already assigned)
3. Click "Edit" on a page entry in the Spaces panel
4. This opens the Region Selection Tool

### Region Selection Tool

**Drawing Tools:**
- **Rectangular**: Draw rectangular areas
- **Freehand**: Draw custom polygon areas
- **Move**: Move/resize existing areas

**Modes:**
- **Additive**: Adds new areas to the region
- **Subtractive**: Removes areas from the region (creates holes)

**Multiple Areas:**
- Users can draw multiple separate (non-touching) areas
- All areas are part of the same logical region
- Areas can overlap and will be merged automatically

**Confirming:**
- Click "Confirm" to save the region
- Click "Cancel" to discard changes

### Editing Regions

- Click "Edit" on a page entry to modify its region
- Existing areas are shown
- Add new areas, subtract areas, or move/resize existing ones
- Changes are saved on "Confirm"

### Region Constraints

- One region per page maximum
- Each region has exactly one lightbulb
- A region can contain multiple areas (polygons)
- Areas are visual only (for the overlay) and don't affect annotation scoping

---

## 3. GREY HASHED OVERLAY

### What is the Overlay?

A semi-transparent dark grey layer with a diagonal hashed pattern that dims the page to highlight active regions.

### When Does It Appear?

- Only when a space is active
- Only on pages that have regions with defined areas
- If a region exists but has no areas, no overlay appears

### Overlay Behavior

**Initial State (No Areas Defined):**
- When entering a space with no region areas, the page is fully visible with no overlay

**After Defining Additive Areas:**
- The overlay appears everywhere except the defined areas
- Defined areas remain clear/visible
- Multiple additive areas combine (union) — overlay shows everywhere except all areas combined

**Subtractive Areas:**
- Subtractive areas create holes in the visible region
- The overlay appears in those holes (they are dimmed)
- Uses "evenodd" fill rule to create holes

**Deleting All Areas:**
- If all areas are deleted, the overlay disappears and the page becomes fully visible again

### Visual Appearance

- Semi-transparent dark grey (~55% opacity)
- Diagonal hashed pattern on top
- Covers the entire page
- Region areas remain clear and visible

---

## 4. LIGHTBULB (Background Annotation Toggle)

### What is the Lightbulb?

A toggle control for each region that controls visibility of background annotations on that region's page.

### Key Characteristics

- One lightbulb per region
- One region per page (so one lightbulb per page in a space)
- Page-scoped: affects background annotations on the same page as the region
- Independent: each region's lightbulb works independently

### Lightbulb States

**When a Space is Active:**
- **Lightbulb ON (lit/blue)**: Background annotations on that page are visible
- **Lightbulb OFF (dimmed/grey)**: Background annotations on that page are hidden
- Lightbulbs are interactive and clickable

**When No Space is Active:**
- Lightbulbs are visible but faded/disabled (not interactive)
- Provides visual consistency and hints at functionality
- Background annotations are always visible regardless of lightbulb state

### Interaction

- Click the lightbulb icon next to a region name in the Spaces panel
- Toggles background annotation visibility for that page
- Only works when a space is active

---

## 5. ANNOTATIONS

### Two Types of Annotations

#### Region-Scoped Annotations

- Created while a region is active (when a space is enabled)
- Tied to that region via `regionId`
- Belong to the region as a whole, not to specific areas

**Visibility:**
- Always visible when their region is active (space is active)
- Hidden when no space is active
- Not affected by lightbulb state

**Interactivity:**
- Can be selected, moved, edited, and erased when their space is active
- Cannot be interacted with when no space is active

#### Background Annotations

- Created outside any space (when no space is active, or on pages not assigned to any space)
- Don't belong to any space or region

**Visibility:**
- Always visible when no space is active
- When a space is active: controlled by the lightbulb on the same page
  - Lightbulb ON: visible
  - Lightbulb OFF: hidden

**Interactivity:**
- Can be selected, moved, edited, and erased when no space is active
- **When a space is active: cannot be selected, moved, edited, or erased (even if visible via lightbulb)**

---

## 6. USER WORKFLOWS

### Creating a Space and Defining Regions

1. Create a new space in the sidebar
2. Activate the space
3. Assign pages to the space
4. For each page, click "Edit" to define regions
5. Draw areas using the Region Selection Tool
6. Click "Confirm" to save
7. The grey overlay appears, highlighting the defined areas

### Working Within an Active Space

- Only pages assigned to the space are visible
- Region-scoped annotations are visible and interactive
- Background annotations visibility is controlled by lightbulbs
- Background annotations cannot be interacted with (even if visible)

### Toggling Background Annotations

1. Activate a space
2. Find the region/page in the Spaces panel
3. Click the lightbulb icon to toggle background annotation visibility
4. Each page's lightbulb works independently

### Exiting Space Mode

- Click "Exit Space Mode" or deactivate the space
- All pages become visible again
- Region-scoped annotations are hidden
- Background annotations are always visible
- Lightbulbs become faded/disabled

---

## 7. VISUAL FEEDBACK AND STATES

### Space States

- **Active**: Highlighted/selected in the sidebar
- **Inactive**: Normal appearance

### Region States

- **Has Areas**: Grey overlay appears when space is active
- **No Areas**: No overlay, page fully visible

### Lightbulb States

- **ON (Active Space)**: Lit/blue, clickable
- **OFF (Active Space)**: Dimmed/grey, clickable
- **Disabled (No Active Space)**: Faded, not clickable

### Annotation States

- **Visible & Interactive**: Can be selected, moved, edited, erased
- **Visible & Non-Interactive**: Visible but cannot be selected or modified
- **Hidden**: Not visible at all

---

## 8. ARCHITECTURAL CONSTRAINTS

### Hierarchy

- Spaces contain Pages (filtering mechanism)
- Pages within a space can have Regions (one region per page maximum)
- Regions can have multiple areas within them (for visual overlay only - grey-hashed overlay)
- Annotations are made on pages associated with regions, which are associated with spaces

### Important Constraints

- Each region is associated with exactly one page
- Each page can have at most one region
- Each region has exactly one lightbulb
- A region can contain multiple areas (polygons) within it - these are purely visual (grey-hashed overlay) and do not affect annotation scoping
- When a space is active, only pages included in that space (through regions) are visible; all other pages are hidden

### Space and Region Activation

- When a space is activated, its regions become active automatically
- When a space is activated, only pages included in that space are visible; all other pages are hidden
- When a space is deactivated, its regions are deactivated as well, and all pages become visible again
- You cannot have active regions without an active space

### Visibility Rules

**When No Space is Active:**
- All pages: Visible
- Background annotations: Always visible on all pages
- Region-scoped annotations: Hidden (no regions are active)
- Lightbulbs: Visible but faded/disabled (not interactive) - this provides visual consistency and hints at functionality that becomes available when a space is active

**When a Space is Active:**
- Pages: Only pages included in the active space (through regions) are visible; all other pages are hidden
- Region-scoped annotations: Always visible when their region is active (regions are automatically active with the space), regardless of lightbulb state
- Background annotations: Controlled by the lightbulb associated with the region on the same page
  - Lightbulb ON: Background annotations on that page are visible
  - Lightbulb OFF: Background annotations on that page are hidden
- Lightbulbs: Interactive and functional

### Interaction Rules

**When a Space is Active:**
- Region-scoped annotations: Fully interactive (can be selected, moved, edited, erased)
- Background annotations: **NOT interactive** (cannot be selected, moved, edited, or erased), even if visible via lightbulb

**When No Space is Active:**
- Background annotations: Fully interactive
- Region-scoped annotations: Hidden (not visible, so not interactive)

---

## 9. SUMMARY

This system allows users to:
- Organize PDF content into spaces
- Define specific regions of interest on pages
- Control annotation visibility through lightbulbs
- Work within focused contexts while maintaining access to background content when needed
- Clearly distinguish between region-scoped and background annotations
- Prevent accidental modification of background annotations when working within a space

The key principle is that **when a space is active, background annotations are view-only** (controlled by lightbulbs) but **cannot be interacted with**, while **region-scoped annotations are fully interactive**.

