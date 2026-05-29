// src/components/Callout/index.jsx
// Phase 14 (CALL-10): This file was a 126-line CalloutOverlay shell that
// hosted the legacy HTML-overlay callout subsystem. Phase 14 ports callout
// rendering into the SVG pipeline (svgAnnotationRenderers.renderCallout,
// via SVGAnnotationLayer) and retires this subsystem.
//
// The stub remains because src/PageAnnotationLayer.jsx:4 and src/viewerShared.js:77
// still import CalloutOverlay from this path. PAL is an Always-Protected
// file (CLAUDE.md); removing its import requires a waiver. The stub
// preserves the import contract while rendering nothing — all callout
// rendering and interaction now flows through SVGAnnotationLayer.
//
// types.js in this directory is PRESERVED as the enum/factory shim for
// ARROWHEAD_STYLES, defaultCalloutStyle, createCallout, hexToRgba — those
// are used by Plan 14-03 creation logic and by Phase 15 ARROW-04. Re-export
// the same three symbols the legacy index.jsx did so existing
// `import { defaultCalloutStyle } from '../components/Callout'` callsites
// (if any) keep resolving.
export { defaultCalloutStyle, createCallout, hexToRgba } from './types';

// UX: null-render stub — all callout UI is now in SVGAnnotationLayer.
// eslint-disable-next-line no-unused-vars
export default function CalloutOverlay(_props) {
  return null;
}
