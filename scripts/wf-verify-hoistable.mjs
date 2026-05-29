export const meta = {
  name: 'verify-hoistable-helpers',
  description: 'Adversarially verify each capture-free helper in PDFViewer.jsx is truly safe to lift to a module, and bucket it by concern',
  phases: [{ title: 'Verify', detail: 'one read-only skeptic per candidate helper' }],
}

// 28 capture-free helpers found by scripts/find-hoistable.mjs (zero component captures).
const CANDIDATES = [
  { name: 'buildTrackpadInteractionDebugSummaryText', start: 655, end: 687, wrapper: 'useCallback' },
  { name: 'sortSyncfusionPagesByDistance', start: 1133, end: 1140, wrapper: 'useCallback' },
  { name: 'getCounterRenderGeometry', start: 3077, end: 3094, wrapper: 'useCallback' },
  { name: 'removeCounterDragPreview', start: 3107, end: 3111, wrapper: 'useCallback' },
  { name: 'sanitizeTemplateConfig', start: 4655, end: 4659, wrapper: 'plain-fn' },
  { name: 'normalizeViewState', start: 4661, end: 4671, wrapper: 'useCallback' },
  { name: 'areViewStatesEqual', start: 4673, end: 4684, wrapper: 'useCallback' },
  { name: 'composeColorForPatch', start: 6794, end: 6804, wrapper: 'useCallback' },
  { name: 'generateBookmarkId', start: 7350, end: 7350, wrapper: 'useCallback' },
  { name: 'summarizeOverlayLagSamples', start: 7580, end: 7920, wrapper: 'useCallback' },
  { name: 'normalizeHistoryReason', start: 9749, end: 9753, wrapper: 'useCallback' },
  { name: 'getHistoryFingerprint', start: 9755, end: 9762, wrapper: 'useCallback' },
  { name: 'summarizeAnnotationPageTransitionForDebug', start: 9764, end: 9802, wrapper: 'useCallback' },
  { name: 'getHistoryDebugRows', start: 9983, end: 10016, wrapper: 'useCallback' },
  { name: 'migrateHistorySpaces', start: 10190, end: 10200, wrapper: 'useCallback' },
  { name: 'isLegacyAnnotationHistoryMeta', start: 10243, end: 10249, wrapper: 'useCallback' },
  { name: 'getYjsHistoryTarget', start: 10795, end: 10821, wrapper: 'useCallback' },
  { name: 'materializeFabricAnnotationFromYMap', start: 10823, end: 10855, wrapper: 'useCallback' },
  { name: 'getExportErrorMessage', start: 13589, end: 13615, wrapper: 'plain-fn' },
  { name: 'isFileLocked', start: 13618, end: 13621, wrapper: 'plain-fn' },
  { name: 'hasValidRegionAreas', start: 16824, end: 16836, wrapper: 'useCallback' },
  { name: 'renderAnnotationHydrationPageCover', start: 17008, end: 17056, wrapper: 'useCallback' },
  { name: 'resolvePdfOutlinePageNumber', start: 18408, end: 18438, wrapper: 'useCallback' },
  { name: 'resolvePageContentElement', start: 19520, end: 19540, wrapper: 'useCallback' },
  { name: 'getBoundsCenter', start: 19542, end: 19561, wrapper: 'useCallback' },
  { name: 'normalizeCanvasJsonForHistory', start: 21060, end: 21108, wrapper: 'useCallback' },
  { name: 'boundsMatch', start: 22857, end: 22865, wrapper: 'plain-fn' },
  { name: 'handleSyncfusionTextSelectionEnd', start: 23802, end: 23805, wrapper: 'useCallback' },
]

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'safeToHoist', 'returnsJsx', 'identitySensitive', 'nameCollision', 'refsOutsidePdfviewer', 'concern', 'callSiteCount', 'risks'],
  properties: {
    name: { type: 'string' },
    safeToHoist: { type: 'boolean', description: 'true only if you confirmed it can become a plain exported module function with NO behavior change' },
    returnsJsx: { type: 'boolean', description: 'true if the function body returns or contains JSX (target module must be .jsx)' },
    identitySensitive: { type: 'boolean', description: 'true if the function is currently a NON-memoized plain fn AND its reference identity is consumed in a deps array / React.memo / passed as a prop where a stable identity would change behavior' },
    nameCollision: { type: 'boolean', description: 'true if this exact name is already an imported or exported symbol that PDFViewer.jsx pulls in (would clash when re-imported)' },
    refsOutsidePdfviewer: { type: 'boolean', description: 'true if any file OTHER than PDFViewer.jsx references this name' },
    concern: { type: 'string', description: 'short bucket: one of history | counters | view-state | regions-geometry | bookmarks-outline | export | overlay-debug | annotation-data | misc' },
    callSiteCount: { type: 'integer', description: 'number of references to this name inside PDFViewer.jsx, EXCLUDING the definition line(s)' },
    risks: { type: 'array', items: { type: 'string' }, description: 'concrete risks or caveats; empty array if none' },
  },
}

phase('Verify')

const verdicts = await parallel(CANDIDATES.map((c) => () =>
  agent(
    `You are adversarially verifying whether ONE helper function can be safely lifted out of a 34,000-line React component file into a plain module, with ZERO behavior change. Default to NOT safe unless you actually confirm safety.

File: src/PDFViewer.jsx
Function name: ${c.name}
Definition location: lines ${c.start}-${c.end}
Current form: ${c.wrapper}

A static analyzer already proved this function captures NOTHING from component scope (it references only its own locals, module-level imports, and real JS/DOM globals). Your job is to catch what static analysis cannot. Do this:

1. Read ONLY lines ${Math.max(1, c.start - 2)}-${c.end + 2} of src/PDFViewer.jsx (use Read with offset/limit) to see the definition and how it is declared.
2. Grep for the exact identifier "${c.name}" across the repo: run it against src/ and tests/ separately. Count references inside PDFViewer.jsx (excluding the definition itself) = callSiteCount. Note any references in OTHER files (refsOutsidePdfviewer).
3. Decide returnsJsx: does the body return or contain JSX?
4. Decide identitySensitive: if it is a plain (non-memoized) arrow/function, is its reference identity consumed anywhere that matters — e.g. listed in a useEffect/useCallback/useMemo dependency array, passed to a React.memo child, or used as a Map/Set key? If it is wrapped in useCallback/useMemo it is already a stable reference, so making it a module function is identity-equivalent -> identitySensitive=false. Only the plain-fn cases can be identitySensitive.
5. Decide nameCollision: is "${c.name}" ALSO an imported symbol (from './viewerShared' or any './utils|./services|./lib|./hooks|./components' module) or otherwise already in scope at module level in PDFViewer.jsx? If yes, re-importing it would clash -> nameCollision=true.
6. Pick a concern bucket from: history | counters | view-state | regions-geometry | bookmarks-outline | export | overlay-debug | annotation-data | misc.
7. safeToHoist = true ONLY if: no nameCollision, not identitySensitive, and you see no other reason a plain exported module function would behave differently from the current definition. List every concrete risk you find in risks (empty array if truly none).

Return the structured verdict. Do not edit any file.`,
    { label: c.name, schema: SCHEMA }
  ).catch(() => null)
))

return { total: CANDIDATES.length, verdicts: verdicts.filter(Boolean) }
