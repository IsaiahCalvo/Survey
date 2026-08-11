export const FAST_SUITE_IDS = Object.freeze([
  'annotations',
  'advanced',
  'advanced-entities',
  'secondary',
  'viewer',
  'projects',
  'surveys',
  'hub',
  'stability',
  'contracts',
]);

export const NATIVE_SUITE_IDS = Object.freeze([
  'native-pinch',
  'native-zoomout',
]);

export const FULL_APP_COVERAGE = Object.freeze({
  annotations: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile'],
    covers: [
      'pen/highlighter/line/arrow/rectangle/ellipse/text/callout/counter',
      'Survey Marker/Space/Region',
      'partial and whole-object eraser',
      'create/edit/move/undo/redo/delete/hard-reload exact-key persistence',
    ],
  }),
  advanced: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile'],
    covers: [
      'standard annotation resize and rotation',
      'callout textbox/arrow-tip/knee transforms',
      'undo/redo and hard-reload exact-key persistence',
    ],
  }),
  'advanced-entities': Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile'],
    covers: [
      'Survey Marker resize and rotation',
      'Region resize and rotation',
      'undo/redo and hard-reload exact-key persistence',
    ],
  }),
  secondary: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile'],
    covers: [
      'multi-select clipboard and group z-order persistence',
      'counter series creation, switching, numbering, and reload persistence',
      'bookmark CRUD plus add/rotate/reorder/delete page operations',
      'annotated PDF export/reimport exact type, text, geometry, style, page, counter-series, and z-order parity',
    ],
  }),
  viewer: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile', 'desktop'],
    covers: [
      'real PDF render/search/forms/links',
      'cold first-page readiness timing budget',
      'zoom/fit/page navigation',
      'back/reopen and hard-reload persistence',
    ],
  }),
  projects: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile', 'desktop'],
    covers: [
      'create/rename/delete projects',
      'PDF upload/add/rename/delete/open/return',
      'reload persistence and project delete cascade',
    ],
  }),
  surveys: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile', 'desktop'],
    covers: [
      'template/module/category/checklist CRUD',
      'template reload persistence',
      'create/open survey and Survey Marker cleanup',
    ],
  }),
  hub: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile', 'desktop'],
    covers: [
      'Documents/Projects/Templates navigation',
      'first-visit no-flash continuity',
      'search/sort/select/empty/loading/long-list/history/refresh states',
    ],
  }),
  stability: Object.freeze({
    proof: 'browser-e2e',
    surfaces: ['mobile'],
    covers: [
      '60-document thumbnail memory budget',
      'list idle/scroll/open/viewer idle',
      'page crash, uncaught error, and dead-canvas detection',
    ],
  }),
  contracts: Object.freeze({
    proof: 'node-contract',
    surfaces: ['mobile', 'desktop'],
    covers: [
      'signed-out account chrome and sign-in routing',
      'yellow/red sync-status details and retry affordance contract',
      'password autofill and auth recovery contracts',
      'pinch anchor/release, two-axis pan momentum, and zoom-out safety contracts',
      'project/template/survey workflow wiring and account-lease enforcement',
    ],
  }),
  'native-pinch': Object.freeze({
    proof: 'ios-simulator-xcui',
    surfaces: ['mobile'],
    covers: [
      'real two-contact pinch geometry change',
      'rapid pinch stress and fit restoration',
      'native screenshot and xcresult evidence',
    ],
  }),
  'native-zoomout': Object.freeze({
    proof: 'ios-simulator-xcui',
    surfaces: ['mobile'],
    covers: [
      'three slow 800%-to-6.25% zoom-out contractions',
      'WebView session survival and bounded compositor scale',
      'native screenshot and xcresult evidence',
    ],
  }),
  durable: Object.freeze({
    proof: 'leased-real-auth',
    surfaces: ['mobile', 'desktop'],
    external: true,
    covers: [
      'real Supabase auth/storage persistence',
      'real project invitations and collaboration roles',
      'exact cleanup and account baseline restoration',
    ],
  }),
});

export function coverageForSuites(ids) {
  return Object.fromEntries(ids.map((id) => [id, FULL_APP_COVERAGE[id]]));
}
