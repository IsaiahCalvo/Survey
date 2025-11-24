# Survey - PDF Viewer & Analysis Tool

An Electron-based PDF viewer application built with React and Vite. Features advanced PDF viewing, annotation, bookmarking, spaces for organizing pages, and export capabilities.

## Features

- **PDF Viewing**: Single-page and continuous scroll modes with zoom controls
- **Page Management**: Duplicate, delete, rotate, mirror, and reorder pages
- **Bookmarks**: Create hierarchical bookmarks and bookmark groups with drag-and-drop organization
- **Spaces**: Define regions on pages, organize them into spaces, and export filtered data
- **Search**: Full-text search across PDF documents
- **Export**: Export spaces to CSV or PDF format
- **Multi-Document**: Tabbed interface for working with multiple PDFs simultaneously

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development

Run the application in development mode:

```bash
npm run dev              # Start both Vite dev server and Electron (port 5173)
```

Or run components separately:

```bash
npm run dev:ui           # Start only Vite dev server
npm run dev:electron     # Start only Electron (waits for Vite on port 5173)
```

### Building for Production

Build the React app:

```bash
npm run build            # Build React app for production (outputs to dist/)
```

Package the Electron app:

```bash
npm run dist             # Build and package Electron app with electron-builder
```

This will create distributable packages for your platform in the `dist/` folder.

## Architecture

### Technology Stack

- **Frontend**: React 18 with Hooks
- **Build Tool**: Vite
- **Desktop Framework**: Electron
- **PDF Rendering**: PDF.js (pdfjs-dist)
- **PDF Manipulation**: pdf-lib
- **Drag & Drop**: @dnd-kit/core, @dnd-kit/sortable
- **Export**: xlsx for CSV/Excel export

### Project Structure

```
Survey/
├── src/
│   ├── App.jsx                      # Main application component
│   ├── main.jsx                     # React entry point
│   ├── electron-main.js             # Electron main process
│   ├── preload.js                   # Electron preload script
│   ├── styles.css                   # Global styles
│   ├── Icons.jsx                    # Icon components
│   ├── PDFSidebar.jsx              # Sidebar with tabs
│   ├── TabBar.jsx                   # Multi-document tab bar
│   ├── TextLayer.jsx                # Text selection layer
│   ├── RegionSelectionTool.jsx     # Region drawing tool
│   ├── SpaceRegionOverlay.jsx      # Space region visualization
│   ├── sidebar/
│   │   ├── PagesPanel.jsx          # Page thumbnails and management
│   │   ├── SearchTextPanel.jsx     # Text search functionality
│   │   ├── BookmarksPanel.jsx      # Bookmarks management
│   │   ├── SpacesPanel.jsx         # Spaces management
│   │   └── DraggableBookmark*.jsx  # Bookmark components
│   └── utils/
│       ├── zoomController.js        # Zoom logic and preferences
│       ├── pageRangeParser.js       # Page range input parsing
│       ├── regionMath.js            # Region geometry calculations
│       └── pdfCache.js              # PDF caching utilities
├── public/                          # Static assets
├── dist/                            # Build output
├── index.html                       # HTML entry point
├── package.json                     # Dependencies and scripts
├── vite.config.js                   # Vite configuration
└── CLAUDE.md                        # Development documentation

```

## Key Features Explained

### Spaces

Spaces allow you to define regions of interest on PDF pages and organize them:

1. Create a space in the Spaces panel
2. Add pages using page numbers or ranges (e.g., "1-5, 7, 10")
3. Click "Edit" to draw rectangular or freehand regions on each page
4. Export space data to CSV (tabular) or PDF (visual) format

### Bookmarks

Create bookmarks to quickly navigate to specific pages:

- Single bookmarks: Link to one page
- Bookmark groups: Organize multiple bookmarks in folders
- Drag and drop to reorder or nest bookmarks
- Double-click folders to expand/collapse

### Page Operations

- **Duplicate**: Create copies of pages
- **Delete**: Remove pages from the document
- **Rotate**: Rotate pages 90° clockwise
- **Mirror**: Flip pages horizontally
- **Reorder**: Drag pages to rearrange order

## Development Notes

### Electron IPC

To add new IPC features:

1. Define handlers in `src/electron-main.js`
2. Expose APIs in `src/preload.js` via `contextBridge`
3. Access via `window.electronAPI` in React components

### PDF.js Configuration

The PDF.js worker is currently loaded from CDN. For offline/production use, bundle the worker locally from `node_modules/pdfjs-dist/build/pdf.worker.min.js`.

### State Management

State is managed via React hooks (useState, useEffect, useRef). No external state management library is currently used.

## Browser Support

This is an Electron application and uses Chromium rendering. Modern JavaScript features (ES6+) are fully supported.

## Contributing

Contributions are welcome! Please follow the existing code style and test your changes thoroughly.

## License

[Add your license here]

## Acknowledgments

- [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla
- [pdf-lib](https://pdf-lib.js.org/) for PDF manipulation
- [dnd-kit](https://dndkit.com/) for drag and drop functionality
