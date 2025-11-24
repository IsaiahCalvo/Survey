# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron-based PDF viewer application built with React and Vite. It allows users to open, view, zoom, and navigate PDF documents with both single-page and continuous scrolling modes.

## Development Commands

### Running the Application
```bash
npm run dev              # Start both Vite dev server and Electron (port 5173)
npm run dev:ui           # Start only Vite dev server
npm run dev:electron     # Start only Electron (waits for Vite on port 5173)
```

### Building and Distribution
```bash
npm run build            # Build React app for production (outputs to dist/)
npm run dist             # Build and package Electron app with electron-builder
```

## Architecture

### Dual-Process Architecture (Electron)

The application follows Electron's standard architecture:

1. **Main Process** (`src/electron-main.js`):
   - Creates and manages browser windows
   - Handles app lifecycle events
   - Loads dev server (http://localhost:5173) in development
   - Loads built files from dist/ in production
   - Uses preload script for secure IPC (currently minimal)

2. **Renderer Process** (React app):
   - Runs the React UI
   - Handles PDF rendering and user interactions
   - Isolated from Node.js APIs (contextIsolation: true)

3. **Preload Script** (`src/preload.js`):
   - Bridges main and renderer processes
   - Exposes safe APIs via contextBridge
   - Currently has placeholder stubs for future features

### Frontend Architecture

**Entry Point**: `src/main.jsx` → renders `App.jsx` into root div

**Main Components**:

- `App.jsx`: Main application component with view routing
  - `LandingPage`: Initial screen with "Open Document" button
  - `PDFViewer`: Full-featured PDF viewing interface

**PDF Rendering System**:

The application uses `pdfjs-dist` (Mozilla's PDF.js library) for rendering:

1. PDF loading: File selected via file input → converted to ArrayBuffer → loaded by PDF.js
2. Worker configuration: Uses CDN-hosted worker (`pdf.worker.min.js`)
3. Canvas rendering: Each page rendered to HTML canvas with device pixel ratio support
4. Two rendering modes:
   - **Single page mode**: Renders one page at a time, navigation via arrow buttons
   - **Continuous mode**: Pre-renders all pages in vertical scroll layout

**Key Features**:

- Zoom controls: +/- buttons, manual input (10-500%), Ctrl+Scroll
- Pan/drag: Click and drag to pan (cursor changes to grab/grabbing)
- Page navigation: Arrow buttons, direct page input, auto-tracking in continuous mode
- Responsive toolbar with file name display
- Status bar with keyboard shortcuts and page count

### Unused/Legacy Components

The following files exist but are not currently used in the active application:

- `src/PageAnnotationLayer.js`: Fabric.js-based annotation layer (not integrated)
- `src/utils/pdfCache.js`: Advanced caching utilities (LRU, ImageBitmap, IndexedDB)
- `src/TestPDFSlick.js`, `test-pdfslick.js`: Test files for @pdfslick/react (library not used)
- `src/App.test.js`, `src/setupTests.js`, `src/reportWebVitals.js`: CRA boilerplate
- `public/paintWorker.js`: Custom worker (not currently utilized)

### Build Configuration

**Vite** (`vite.config.js`):
- Development server on port 5173
- React plugin enabled
- Outputs to `dist/` directory

**Electron Builder** (in `package.json`):
- Packages files: dist/**, electron-main.js, preload.js, package.json
- Targets: macOS (dmg), Windows (nsis)
- App ID: com.example.survey

## Important Implementation Details

### PDF.js Worker Setup
The worker is loaded from CDN in `App.jsx:5`. For offline/production use, consider bundling the worker locally from `public/pdf.worker.min.mjs`.

### Canvas Rendering
- Uses device pixel ratio for sharp rendering on high-DPI displays
- Implements proper cleanup to prevent memory leaks (render task cancellation)
- Applies `setTransform()` for proper scaling

### Continuous Scroll Mode
- Pre-renders all pages on load and scale changes
- Tracks visible page via scroll event listener
- Auto-scrolls to page when page number changes programmatically

### State Management
All state is managed via React hooks (useState, useEffect, useRef) - no external state library.

## File Structure Notes

- `src/electron-main.js` and `src/preload.js` are Electron-specific (should stay in src/ for build process)
- `public/` contains static assets and manifest.json (PWA-related, not fully implemented)
- `index.html` in root is the Vite entry point (references /src/main.jsx)

## Development Notes

### Adding Electron IPC Features
When adding IPC communication:
1. Define IPC handlers in `src/electron-main.js`
2. Expose safe APIs in `src/preload.js` via contextBridge
3. Access via `window.electronAPI` in React components

### PDF Worker Configuration
If switching from CDN to local worker:
1. Update worker path in `App.jsx` to point to local file
2. Ensure worker file is included in Vite build output
3. Update electron-builder files configuration if needed
