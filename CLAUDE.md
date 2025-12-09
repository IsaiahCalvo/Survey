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
   - **IPC Handlers**:
     - `fs:readFile`, `fs:writeFile`, `fs:fileExists`: File system operations
     - `fileWatcher:start`, `fileWatcher:stop`: Real-time file monitoring via chokidar
     - `dialog:saveFile`: Native save dialogs
     - `shell:openPath`: Open files/folders in default OS app

2. **Renderer Process** (React app):
   - Runs the React UI
   - Handles PDF rendering and user interactions
   - Isolated from Node.js APIs (contextIsolation: true)

3. **Preload Script** (`src/preload.js`):
   - Bridges main and renderer processes
   - Exposes safe APIs via contextBridge (`window.electronAPI`)

### Frontend Architecture

**Entry Point**: `src/main.jsx` → renders `App.jsx` wrapped in `AuthProvider`

**Key Directories**:
- `src/components/`: Reusable UI components (Modals, Tools, Layers)
- `src/contexts/`: Global state (AuthContext)
- `src/workers/`: Web Workers for heavy tasks (PDF rendering)
- `src/sidebar/`: Sidebar panel components
- `src/utils/`: Helper functions (OneDrive, Geometry, Zoom)

**PDF Rendering System**:

The application uses `pdfjs-dist` (Mozilla's PDF.js library) for rendering:

1. PDF loading: File selected via file input → converted to ArrayBuffer → loaded by PDF.js
2. Worker configuration: Uses local worker (`src/workers/pdfRender.worker.js`)
3. Canvas rendering: Each page rendered to HTML canvas with device pixel ratio support
4. Two rendering modes:
   - **Single page mode**: Renders one page at a time
   - **Continuous mode**: Virtualized list of pages

**Key Features**:

- **Authentication**: Supabase-powered auth (Email, Google, SSO) via `AuthContext`
- **Cloud Integration**: OneDrive file sync and management
- **Zoom controls**: +/- buttons, manual input (10-500%), Ctrl+Scroll
- **Pan/drag**: Click and drag to pan (cursor changes to grab/grabbing)
- **Page navigation**: Arrow buttons, direct page input, auto-tracking in continuous mode
- **Responsive toolbar**: With file name display and user account menu

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

### State Management
- **Global User State**: Managed via `AuthContext` (User, Session, Loading)
- **Local State**: React hooks (useState, useEffect, useRef) for component-level logic

### PDF.js Worker Setup
The worker is now bundled locally in `src/workers/pdfRender.worker.js` to ensure offline capability and consistent versioning.

### Canvas Rendering
- Uses device pixel ratio for sharp rendering on high-DPI displays
- Implements proper cleanup to prevent memory leaks (render task cancellation)
- Applies `setTransform()` for proper scaling

### Continuous Scroll Mode
- Pre-renders all pages on load and scale changes
- Tracks visible page via scroll event listener
- Auto-scrolls to page when page number changes programmatically

## Development Notes

### Adding Electron IPC Features
When adding IPC communication:
1. Define IPC handlers in `src/electron-main.js`
2. Expose safe APIs in `src/preload.js` via contextBridge
3. Access via `window.electronAPI` in React components

### Authentication
- Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in `.env`
- `AuthContext` provides `user`, `signIn`, `signOut`, etc. to the entire app

