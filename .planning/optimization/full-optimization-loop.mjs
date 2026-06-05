export const meta = {
  name: 'full-optimization-loop',
  description: 'Audit the whole codebase across all domains (perf, security, zoom/pan/scroll, db-sync, collaboration, rendering, IPC); auto-apply only mechanical safe speed wins; surface everything sensitive as a ranked report',
  phases: [
    { title: 'Domain Audit' },
    { title: 'Domain Verify' },
    { title: 'Perf Round 1 Audit' },
    { title: 'Perf Round 1 Verify' },
    { title: 'Perf Round 1 Apply' },
    { title: 'Perf Round 2 Audit' },
    { title: 'Perf Round 2 Verify' },
    { title: 'Perf Round 2 Apply' },
  ],
}

const ROOT = '/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2'
const SRC = ROOT + '/src'
const SKILL = '/Users/isaiahcalvo/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/react-best-practices'

// NEVER auto-edit: uncommitted WIP + load-bearing/high-risk files (CRDT, Electron).
const DENYLIST = [
  'src/components/FabricEraserCanvas.jsx','src/main.jsx','src/prototype/InteractiveOverlay.jsx',
  'src/prototype/PdfjsArm.jsx','src/prototype/RendererSpike.jsx','src/prototype/spikeLogger.js',
  'src/sidebar/SearchTextPanel.jsx','src/viewerShared.js','tests/performance/overlayPresentationGate.test.mjs',
  'src/components/PDFViewerEngineSelector.jsx','src/components/PdfjsFormLayer.jsx','src/components/PdfjsLinkLayer.jsx',
  'src/components/PdfjsTextLayer.jsx','src/components/PdfjsViewerContainer.jsx','src/components/pdfEngineContract.js',
  'src/prototype/FeatureSpike.jsx','src/prototype/PerfGateSpike.jsx','src/prototype/SpikeFormLayer.jsx',
  'src/prototype/SpikeLinkLayer.jsx','src/prototype/SpikeTextLayer.jsx',
]
const PROTECTED = [
  'src/PDFViewer.jsx','src/PageAnnotationLayer.jsx','src/components/SVGAnnotationLayer.jsx','src/viewerShared.js',
  'src/components/FabricDrawingCanvas.jsx','src/components/FabricEraserCanvas.jsx','src/components/FabricEditCanvas.jsx',
  'package.json','vite.config.js',
  'src/hooks/useAnnotationCloudSync.js','src/components/collab/YDocProvider.jsx',
  'src/lib/collab/crdtBackfill.js','src/electron-main.js','src/preload.js',
]
const BLOCKED = Array.from(new Set([...DENYLIST, ...PROTECTED]))

const CONTEXT = `
This is a Vite + React 18.3.1 + Electron desktop PDF-annotation app (NOT Next.js).
Source root: ${SRC}. React rulebook at ${SKILL}/AGENTS.md, per-rule files at ${SKILL}/rules/<rule>.md.
HARD INVARIANTS (a change that breaks these is an automatic reject):
- Canvas sizing MUST use container-aware measurement (containerEl.offsetWidth / pageSize.width).
- Fabric Textbox fontFamily MUST stay a single font name.
- The zoomGeneration signal must never be removed/renamed.
- SVGAnnotationLayer scales ONLY via SVG viewBox — never add JS zoom coordination there.
DO-NOT-AUTO-EDIT FILES (findings here are valid but must NEVER be auto-applied — surface only): ${BLOCKED.join(', ')}.
"Behavior-preserving" means it cannot change any observable output: iteration order, first-vs-last match on key
collision, the timing/concurrency of side effects, which branch runs, network/db calls, or security posture.
`

const BASE_EXCLUDE = `
ALREADY DONE across passes 1-4 + auto-loop + salvage (do NOT re-report): hoisted inline components; removed redundant
memos; single-pass min/max in svg polygon+polyline; parallel PDF parses; passive scroll/touch listeners; hoisted logos;
narrowed deps to user?.id; parallel usage/owned-docs/collaborator reads; SVG-layer module Sets + single-pass centroid;
PAL callout-selection Set; exceljs lazy-load; lazy PDFViewer; documents-ledger project-name Map; PrintPanel Math.min;
AppShell arrowhead leaf import; content-visibility on page-thumbnail/text-search/documents-ledger lists; pdf.js deferred
out of first paint (lazy loadPdfjs); bounded-concurrency parallel per-page annotation import; optimistic upload created_at/
updated_at + '' date fallback; lazy-init useState (regions, selectedRegionIds, editingCategoryName, selectedCategoryIds,
selectedChecklistItemIds, expandedSpaces); Set selectedItemIds delete filter; lazy-load CompactColorPicker; passive resize
in RegionSelectionTool; entitiesMap O(1) lookup in survey-marker render loop; OAuth hash JSON.stringify; openExternal
protocol allowlist.
REVERTED/HELD, do NOT auto-apply (surface only, needs a human + live test): CRDT fan-out Promise.all on hydrate (the two
fan-outs share the 'annotations' Y.Map — UNSAFE as written); shell.openPath replacing the macOS 'open' workaround (needs a
Mac file-open test); the survey-rail name/type lookup Map (must use strict FIRST-match + a \\0 delimiter); PDFViewer passive
scroll listener; PdfjsViewerContainer startTransition on the virtualized range; region draw-cursor ref.
`

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['domain','title','file','location','severity','problem','suggestedFix','risk','confidence'],
    properties: {
      domain: { type: 'string', enum: ['react-perf','security','interaction','db-sync','collaboration','rendering','ipc'] },
      title: { type: 'string' },
      rule: { type: 'string' },
      file: { type: 'string' }, location: { type: 'string' },
      severity: { type: 'string', enum: ['CRITICAL','HIGH','MEDIUM','LOW'] },
      problem: { type: 'string' }, suggestedFix: { type: 'string' },
      risk: { type: 'string', enum: ['safe','risky'] }, confidence: { type: 'number' },
    } } } },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['disposition','reason','behaviorPreserving'],
  properties: {
    disposition: { type: 'string', enum: ['apply-safe','surface-risky','reject'] },
    reason: { type: 'string' }, behaviorPreserving: { type: 'boolean' }, correctedFix: { type: 'string' },
  },
}
const APPLY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status','detail'],
  properties: { status: { type: 'string', enum: ['applied','failed','skipped'] }, detail: { type: 'string' }, commit: { type: 'string' } },
}

// Auto-applicable react-perf lanes (mechanical, behavior-preserving wins only).
const PERF_LANES = [
  { key: 'rerender', prompt: `Audit ${SRC} for rerender-* rules: component defined inside another component (HIGH); useMemo on a trivial primitive; useState(expensiveCall()) without ()=> init; setState(prev-derived) not using functional updater; useEffect that only sets derivable state; useEffect deps on a whole object where only .id/.length is used; one useMemo doing two independent steps; memo() with inline default non-primitive param. Concrete hits only, exact location + before/after.` },
  { key: 'jsperf', prompt: `Audit ${SRC} for js-* rules in hot paths: .sort() only to grab [0]/[len-1]; .sort() on prop/state without copy; arr.includes(x) inside filter/map/loop; .find() by same key inside map/loop; .map().filter(Boolean); multiple filter/map passes over one array; RegExp built in render/hot loop; repeated deep property access in a loop; repeated storage reads; interleaved style writes + layout reads. Real hits, exact location + before/after, hot paths only.` },
  { key: 'bundle', prompt: `Audit ${SRC} + index.html for bundle-* rules: heavy modules imported statically but only used behind a user action/route; barrel imports from large libs; non-critical libs before first paint; large data imported statically but feature-gated. Exact import line + lazy/direct rewrite. pdf.js is already deferred — skip it.` },
  { key: 'effects', prompt: `Audit ${SRC} for client-*/transient-value rules: addEventListener('wheel'|'touchstart'|'touchmove'|'scroll',...) WITHOUT {passive:true} where the handler never preventDefaults; same global listener registered per-instance; a high-frequency value kept in useState where a ref would do; frequent non-urgent setState not wrapped in startTransition. Verify the handler before flagging — zoom/pan code legitimately uses non-passive.` },
  { key: 'rendering-react', prompt: `Audit ${SRC} for rendering-* react rules: CSS animation on an <svg> instead of a wrapping <div>; long NON-virtualized lists without content-visibility; large static JSX/SVG recreated each render; {someNumber && <X/>} where the number can be 0. Concrete hits, location + before/after.` },
]

// Surface-only domain lanes (reviewed by a human + live-tested; NEVER auto-applied).
const DOMAIN_LANES = [
  { key: 'security', domain: 'security', prompt: `Audit ${SRC} (especially src/electron-main.js, src/preload.js, IPC handlers, any executeJavaScript/eval/exec/shell calls, URL handling, auth/token storage) for SECURITY weaknesses: command/script injection, unsafe protocol handling, missing input validation on IPC, overly broad webPreferences (nodeIntegration/contextIsolation), secrets in logs, unsafe deserialization. For each: file, exact location, the risk, and a concrete safer fix. Mark all risky.` },
  { key: 'interaction', domain: 'interaction', prompt: `Audit ${SRC} (the pdf.js viewer container, zoom/pan/scroll handlers, wheel/pointer/touch listeners, requestAnimationFrame loops, virtualization) for ZOOM / PAN / SCROLL smoothness: layout thrash (read-after-write), non-passive listeners on hot gestures, per-frame setState that could be a ref/rAF, unbatched DOM writes, missing will-change/transform hints, work done synchronously on the gesture path that could be deferred. The north star is near-zero-lag zoom/pan/scroll. Concrete hits, location + concrete fix. Mark risky.` },
  { key: 'db-sync', domain: 'db-sync', prompt: `Audit ${SRC} (Supabase calls, the cloud-sync hook, save/load/snapshot paths, debounced writes) for DATABASE SYNC efficiency: sequential awaits that could be parallel, N+1 query patterns, missing debounce/coalescing on writes, over-fetching columns, redundant round-trips, no cache-bypass where freshness is required. Be careful: some sequential short-circuits are load-bearing — note that. Concrete hits + concrete fix. Mark risky.` },
  { key: 'collaboration', domain: 'collaboration', prompt: `Audit ${SRC} (the Y.Doc/CRDT layer, presence, realtime transport, fan-out functions, the collab provider) for MULTI-USER COLLABORATION correctness + efficiency: races between concurrent CRDT writers, transactions that should batch, presence churn, redundant re-broadcasts, missing origin tagging, reconnect/wake handling. CRITICAL: flag anything where parallelizing writes could interleave on a SHARED Y.Map. Concrete hits + fix. Mark risky.` },
  { key: 'rendering-pipeline', domain: 'rendering', prompt: `Audit ${SRC} (the pdf.js page render pipeline, tile/canvas rendering, the SVG annotation layer, the Fabric canvases, worker usage) for RENDERING performance: redundant re-renders of pages/tiles, work that could move to a worker, canvas reuse, unnecessary full-page repaints, missing memoization of expensive geometry, devicePixelRatio handling. Respect the hard invariants. Concrete hits + fix. Mark risky.` },
  { key: 'ipc', domain: 'ipc', prompt: `Audit ${SRC} (electron-main IPC handlers, preload bridge, renderer<->main calls, file I/O) for IPC / "calling" efficiency + safety: chatty round-trips that could batch, large payloads copied across the bridge, synchronous IPC blocking the main process, missing error handling, unvalidated handler inputs. Concrete hits + fix. Mark risky.` },
]

function keyOf(f) { return `${f.domain}|${f.file}|${f.location}|${f.title}` }
function isBlocked(file) {
  const norm = String(file).replace(/^\.\//, '')
  return BLOCKED.some((b) => norm === b || norm.endsWith('/' + b) || norm.endsWith(b.split('/').pop()))
}

// ---------------------------------------------------------------------------
// PHASE 1 — Broad cross-domain audit (surface-only). Sonnet.
// ---------------------------------------------------------------------------
phase('Domain Audit')
log(`Auditing ${DOMAIN_LANES.length} sensitive domains (surface-only, Sonnet)...`)
const domainRaw = (await parallel(DOMAIN_LANES.map((lane) => () =>
  agent(`${CONTEXT}\n\n${lane.prompt}\n\nALREADY-EXHAUSTED (do NOT re-report):\n${BASE_EXCLUDE}\n\nReturn ONLY real, concrete, actionable findings with a one-line title. Set domain="${lane.domain}", risk="risky". Empty list is fine.`,
    { label: `audit:${lane.key}`, phase: 'Domain Audit', agentType: 'Explore', model: 'sonnet', schema: FINDING_SCHEMA })
))).filter(Boolean).flatMap((r) => r.findings || [])

// Dedup, then lightly verify each domain finding to drop false positives.
const domainSeen = new Set()
const domainFindings = domainRaw.filter((f) => { const k = keyOf(f); if (domainSeen.has(k)) return false; domainSeen.add(k); return true })
phase('Domain Verify')
log(`Verifying ${domainFindings.length} domain findings (Sonnet)...`)
const surfaced = (await parallel(domainFindings.map((f) => () =>
  agent(`${CONTEXT}\n\nVerify this ${f.domain} finding is REAL and worth a human's time (do NOT apply anything):\n- title: ${f.title}\n- file: ${f.file}\n- location: ${f.location}\n- severity: ${f.severity}\n- problem: ${f.problem}\n- suggestedFix: ${f.suggestedFix}\n\nOpen ${f.file} at that location. disposition "reject" if not real / already handled / wrong; otherwise "surface-risky". Be strict — only confirm genuine, specific, actionable issues.`,
    { label: `verify:${f.domain}:${f.file.split('/').pop()}`, phase: 'Domain Verify', agentType: 'Explore', model: 'sonnet', schema: VERDICT_SCHEMA })
    .then((v) => ({ ...f, verdict: v }))))).filter(Boolean)
  .filter((f) => f.verdict.disposition !== 'reject')
log(`${surfaced.length} domain findings confirmed for human review.`)

// ---------------------------------------------------------------------------
// PHASE 2 — react-perf auto-apply loop (mechanical safe wins only). Sonnet audit/verify, Opus apply.
// ---------------------------------------------------------------------------
const applied = [], failed = [], skipped = []
const perfSeen = new Set()
let dynamicExclude = ''
const MAX_ROUNDS = 2, MAX_APPLIED = 25

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const exclude = BASE_EXCLUDE + dynamicExclude
  phase(`Perf Round ${round} Audit`)
  log(`Perf round ${round}: auditing ${PERF_LANES.length} lanes (${applied.length} applied so far)...`)
  let findings = (await parallel(PERF_LANES.map((lane) => () =>
    agent(`${CONTEXT}\n\nAudit for REACT-PERF only (these MAY be auto-applied, so be conservative and behavior-preserving). ${lane.prompt}\nSet domain="react-perf".\n\nALREADY-EXHAUSTED:\n${exclude}\n\nReturn only real mechanical wins. Empty list is fine.`,
      { label: `r${round}:audit:${lane.key}`, phase: `Perf Round ${round} Audit`, agentType: 'Explore', model: 'sonnet', schema: FINDING_SCHEMA })
  ))).filter(Boolean).flatMap((r) => r.findings || [])
  findings = findings.filter((f) => { const k = keyOf(f); if (perfSeen.has(k)) return false; perfSeen.add(k); return true })
  if (findings.length === 0) { log(`Perf round ${round}: no new candidates — converged.`); break }

  phase(`Perf Round ${round} Verify`)
  const verified = (await parallel(findings.map((f) => () =>
    agent(`${CONTEXT}\n\nAdversarial verifier. Finding:\n- title: ${f.title}\n- file: ${f.file}\n- location: ${f.location}\n- problem: ${f.problem}\n- suggestedFix: ${f.suggestedFix}\n\nOpen ${f.file}. "reject" if not real / already fine / would change behavior / breaks a test / breaks an invariant. "surface-risky" if real but in a DO-NOT-AUTO-EDIT file OR any behavioral/visual/ordering nuance. "apply-safe" ONLY if real, NOT in a blocked file, mechanical, and provably behavior-preserving. Default reject. Corrected fix in correctedFix if slightly off.`,
      { label: `r${round}:verify:${f.title.slice(0,24)}`, phase: `Perf Round ${round} Verify`, agentType: 'Explore', model: 'sonnet', schema: VERDICT_SCHEMA })
      .then((v) => ({ ...f, verdict: v }))))).filter(Boolean)

  const roundSafe = verified.filter((f) => f.verdict.disposition === 'apply-safe' && !isBlocked(f.file))
  surfaced.push(...verified.filter((f) => f.verdict.disposition === 'surface-risky' || (f.verdict.disposition === 'apply-safe' && isBlocked(f.file))))
  dynamicExclude += '\n' + verified.map((f) => `${f.title} @ ${f.file} (${f.verdict.disposition})`).join('; ')
  if (roundSafe.length === 0) { log(`Perf round ${round}: 0 new safe wins — converged.`); break }

  phase(`Perf Round ${round} Apply`)
  log(`Perf round ${round}: applying ${roundSafe.length} safe wins one at a time (test+build gated)...`)
  let appliedThisRound = 0
  for (const f of roundSafe) {
    if (applied.length >= MAX_APPLIED) break
    const fix = (f.verdict.correctedFix && f.verdict.correctedFix.trim()) ? f.verdict.correctedFix : f.suggestedFix
    const res = await agent(
      `Apply ONE verified behavior-preserving react-performance fix in the repo at ${ROOT}. Work from that directory.\n\n` +
      `FILE: ${f.file}\nTITLE: ${f.title}\nLOCATION: ${f.location}\nPROBLEM: ${f.problem}\n\nFIX:\n${fix}\n\nSTRICT RULES:\n` +
      `1. Edit ONLY ${f.file}. If it needs any other file, return "skipped".\n` +
      `2. If ${f.file} is any DO-NOT-AUTO-EDIT file, return "skipped": ${BLOCKED.join(', ')}.\n` +
      `2b. If the fix would change ANY observable behavior (iteration order, first-vs-last match, side-effect timing/concurrency, security/auth/networking, which branch runs), STOP and return "skipped". Performance only.\n` +
      `3. Read the file first, apply the smallest diff, preserve exact behavior, do NOT refactor anything else.\n` +
      `4. Run from ${ROOT}: node scripts/run-node-tests.mjs — MUST show "# pass 888" and "# fail 0".\n` +
      `5. Run: npx vite build — MUST finish "built in" with no error.\n` +
      `6. If BOTH pass: git add ${f.file} (explicit path, NEVER -A) and commit "perf(react): <what> (auto-loop)" with trailer "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>". Return "applied", detail=summary, commit=short hash.\n` +
      `7. If EITHER fails: git checkout -- ${f.file} and return "failed" with the failing output. Never push. Never -A.`,
      { label: `r${round}:apply:${f.file.split('/').pop()}`, phase: `Perf Round ${round} Apply`, agentType: 'general-purpose', schema: APPLY_SCHEMA })
    if (!res) { failed.push({ ...f, detail: 'null' }); continue }
    if (res.status === 'applied') { applied.push({ title: f.title, file: f.file, detail: res.detail, commit: res.commit }); appliedThisRound++ }
    else if (res.status === 'failed') failed.push({ title: f.title, file: f.file, detail: res.detail })
    else skipped.push({ title: f.title, file: f.file, detail: res.detail })
  }
  if (appliedThisRound === 0) { log(`Perf round ${round}: nothing landed — converged.`); break }
}

// Rank the surfaced report: CRITICAL/HIGH first, then by confidence.
const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
surfaced.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) || (b.confidence || 0) - (a.confidence || 0))
const byDomain = {}
for (const f of surfaced) { (byDomain[f.domain] = byDomain[f.domain] || []).push({ title: f.title, file: f.file, location: f.location, severity: f.severity, problem: f.problem, suggestedFix: f.suggestedFix, confidence: f.confidence }) }

return {
  summary: { autoApplied: applied.length, surfacedForReview: surfaced.length, failed: failed.length, skipped: skipped.length },
  autoApplied: applied,
  surfacedByDomain: byDomain,
  failed, skipped,
}
