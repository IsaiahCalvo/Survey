export const meta = {
  name: 'react-perf-audit',
  description: 'Audit the React codebase against Vercel react-best-practices, adversarially verify each finding, and classify safe vs risky',
  phases: [
    { title: 'Audit' },
    { title: 'Verify' },
  ],
}

// ---------------------------------------------------------------------------
// Context shared with every agent
// ---------------------------------------------------------------------------
const SRC = '/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/src'
const SKILL = '/Users/isaiahcalvo/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/react-best-practices'

// args lets the orchestrator narrow the audit to specific files/globs and
// tell agents which rules are already exhausted (so passes converge).
const SCOPE = (args && args.scope) ? args.scope : 'the entire src/ tree'
const EXCLUDE_NOTE = (args && args.exclude) ? `\n\nALREADY-EXHAUSTED (do NOT re-report these exact findings):\n${args.exclude}` : ''

const CONTEXT = `
This is a Vite + React 18.3.1 + Electron desktop app for PDF annotation (NOT Next.js).
Source root: ${SRC}
The full rulebook lives at ${SKILL}/AGENTS.md and per-rule files at ${SKILL}/rules/<rule-name>.md — read a rule file when you need the exact before/after.

BECAUSE IT IS NOT NEXT.JS, these rule families DO NOT APPLY — never report them:
- All server-* rules (RSC, server actions, React.cache, LRU, after(), serialization).
- async-api-routes, async-suspense-boundaries (no RSC streaming).
- rendering-hydration-* (no SSR), rendering-activity (needs React 19 — this app is 18.3.1).
- client-swr-dedup as "add SWR" (no SWR dep) — but the underlying dedup principle and event-listener dedup DO apply.

HARD INVARIANTS (proposing any change that breaks these is an automatic reject):
- Canvas sizing MUST use container-aware measurement (containerEl.offsetWidth / pageSize.width), never pageSize*scale.
- Fabric.js Textbox fontFamily MUST stay a single font name, never a CSS fallback stack.
- The zoomGeneration signal (setZoomGeneration / watchers in Fabric canvases) must never be removed or renamed.
- SVGAnnotationLayer.jsx scales ONLY via SVG viewBox — never add JavaScript zoom coordination there.

HIGH-RISK / LOAD-BEARING FILES (a finding here is valid but must be marked risk:"risky" — keep its suggested diff minimal and never propose a refactor):
- src/PDFViewer.jsx (~33k lines), src/PageAnnotationLayer.jsx (~10k lines),
  src/components/SVGAnnotationLayer.jsx, src/viewerShared.js,
  src/components/FabricDrawingCanvas.jsx, src/components/FabricEraserCanvas.jsx, src/components/FabricEditCanvas.jsx,
  package.json, vite.config.js.
Everything else is "safe" territory (still must be behavior-preserving).
`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'file', 'location', 'severity', 'problem', 'suggestedFix', 'risk', 'confidence'],
        properties: {
          rule: { type: 'string', description: 'rule slug e.g. js-set-map-lookups' },
          file: { type: 'string', description: 'path relative to repo root' },
          location: { type: 'string', description: 'line number(s) or unique anchor text' },
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          problem: { type: 'string', description: 'one sentence: what is wrong and why it costs perf' },
          suggestedFix: { type: 'string', description: 'concrete change — show the before and after code snippet' },
          risk: { type: 'string', enum: ['safe', 'risky'], description: 'risky if it touches a high-risk file or changes observable behavior' },
          confidence: { type: 'number', description: '0..1 how sure you are this is real and worth doing' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['disposition', 'reason', 'behaviorPreserving'],
  properties: {
    disposition: { type: 'string', enum: ['apply-safe', 'surface-risky', 'reject'] },
    reason: { type: 'string' },
    behaviorPreserving: { type: 'boolean' },
    correctedFix: { type: 'string', description: 'if the suggested fix was slightly wrong but salvageable, the corrected version; else empty' },
  },
}

// ---------------------------------------------------------------------------
// Audit lanes — each greps the tree for a cluster's signatures, then reads
// context around hits to confirm before reporting. Pattern-based so it scales
// to the 33k-line files.
// ---------------------------------------------------------------------------
const LANES = [
  {
    key: 'rerender',
    prompt: `Audit ${SCOPE} for the rerender-* rules. Detection signatures (grep, then Read context to confirm):
- Component defined inside another component (function/const Name = (...) => returning JSX, declared in a component body) -> rerender-no-inline-components (HIGH).
- useMemo wrapping a trivial primitive expression (boolean/number/string, few ops) -> rerender-simple-expression-in-memo.
- useState(expensiveCall(...)) without a () => initializer (JSON.parse, build index, map construction, localStorage read) -> rerender-lazy-state-init.
- setState(prev-derived) using the closed-over state var instead of functional updater, esp inside useCallback with that state in deps -> rerender-functional-setstate.
- useEffect that only sets state derived from props/other state (could be computed during render) -> rerender-derived-state-no-effect.
- useEffect deps on a whole object where only .id/.length is used -> rerender-dependencies.
- a single useMemo doing two independent steps with different deps -> rerender-split-combined-hooks.
- memo() component with a default non-primitive param value inline (= [] / = {} / = () => {}) -> rerender-memo-with-default-value.
Only report concrete, high-confidence hits with exact location and a before/after snippet.`,
  },
  {
    key: 'jsperf',
    prompt: `Audit ${SCOPE} for the js-* rules in hot paths (render bodies, event handlers, loops over annotations/marks/pages). Signatures:
- Array .sort() used only to grab [0] or [len-1] -> js-min-max-loop.
- .sort(...) on a prop/state array without copy (mutation) -> js-tosorted-immutable.
- arr.includes(x) inside a .filter/.map/loop where arr is constant-ish -> js-set-map-lookups.
- .find(...) by same key inside a .map/loop -> js-index-maps.
- .map(...).filter(Boolean) or .map(...).filter(x=>x!=null) -> js-flatmap-filter.
- multiple .filter()/.map() passes over the same array -> js-combine-iterations.
- new RegExp(...) or /.../ literal created inside a component render or hot loop -> js-hoist-regexp.
- deep obj.a.b.c property access repeated every loop iteration -> js-cache-property-access.
- localStorage/sessionStorage/document.cookie read repeatedly -> js-cache-storage.
- interleaved DOM style writes and offsetWidth/getBoundingClientRect reads -> js-batch-dom-css (layout thrash).
Only report real hits with exact location + before/after. Prefer hot paths; ignore one-shot init code.`,
  },
  {
    key: 'bundle',
    prompt: `Audit ${SCOPE} plus index.html and src/main.jsx for bundle-* rules in a Vite app. Signatures:
- Heavy modules imported statically at top level when only used behind a user action/route (pdfjs-dist, fabric, @syncfusion/*, exceljs, the PDFViewer, Dashboard, editors) -> bundle-dynamic-imports (use React.lazy / dynamic import()).
- Barrel imports from large libraries (import { ... } from '@syncfusion/ej2-*' or other index re-export packages) -> bundle-barrel-imports (import from the specific sub-path).
- Analytics/logging/non-critical libs loaded before first paint -> bundle-defer-third-party.
- Large data/JSON modules imported statically but only needed when a feature activates -> bundle-conditional.
Report exact import line + the lazy/direct rewrite. Mark anything touching package.json or vite.config.js as risky.`,
  },
  {
    key: 'effects-client',
    prompt: `Audit ${SCOPE} for client-* and advanced-* and the transition/ref rerender rules. Signatures:
- addEventListener('wheel'|'touchstart'|'touchmove'|'scroll', ...) WITHOUT { passive: true } where the handler does not call preventDefault -> client-passive-event-listeners. (Do NOT flag handlers that DO call preventDefault — custom zoom/gesture code legitimately needs non-passive.)
- the same global window/document listener registered per-instance by a hook used many times -> client-event-listeners.
- localStorage.setItem/getItem without a version prefix or try/catch, storing whole objects -> client-localstorage-schema.
- app-wide init inside useEffect([]) that could remount (guarded by nothing) -> advanced-init-once.
- a high-frequency value (mouse/scroll/drag position, transient flag) kept in useState causing re-renders, where a ref would do -> rerender-use-ref-transient-values.
- frequent non-urgent setState (scroll/resize handlers) not wrapped in startTransition -> rerender-transitions.
Only report concrete hits with location + before/after. Be careful: the PDF zoom/pan code intentionally uses non-passive listeners — verify the handler before flagging.`,
  },
  {
    key: 'async',
    prompt: `Audit ${SCOPE} (especially src/hooks/useAnnotationCloudSync.js, src/utils/*importer*.js, save/sync/load paths, electron-main) for async-* rules. Signatures:
- consecutive independent await statements that could be Promise.all -> async-parallel.
- await early in a function whose result is only used after an early-return branch -> async-defer-await.
- a dependency chain where an independent fetch waits behind an unrelated await -> async-dependencies.
Only report cases where the operations are genuinely independent (no data dependency) and the path is actually hot (runs on user actions, not one-time boot). Give location + before/after.`,
  },
  {
    key: 'rendering',
    prompt: `Audit ${SCOPE} for the applicable rendering-* rules (skip hydration/activity/resource-hint/script rules — N/A here, except check index.html script tags once). Signatures:
- CSS animation/transition applied directly to an <svg> element instead of a wrapping <div> -> rendering-animate-svg-wrapper.
- long mapped lists rendered without virtualization AND without content-visibility (note: react-window is already used in places — only flag long lists that are NOT virtualized) -> rendering-content-visibility.
- large static JSX or SVG recreated every render that could be hoisted to a module constant -> rendering-hoist-jsx.
- {someNumber && <X/>} conditional rendering where someNumber can be 0 -> rendering-conditional-render.
- raw <script src> without defer/async in index.html -> rendering-script-defer-async.
Only report concrete hits with location + before/after.`,
  },
]

// ---------------------------------------------------------------------------
// Phase 1: Audit (parallel lanes, barrier so we can dedup before verifying)
// ---------------------------------------------------------------------------
phase('Audit')
log(`Auditing ${SCOPE} across ${LANES.length} rule lanes...`)

const laneResults = await parallel(
  LANES.map((lane) => () =>
    agent(`${CONTEXT}\n\n${lane.prompt}${EXCLUDE_NOTE}\n\nReturn ONLY real, concrete, actionable findings. Empty list is a fine answer if the codebase is already clean for your lane.`,
      { label: `audit:${lane.key}`, phase: 'Audit', schema: FINDING_SCHEMA })
  )
)

let findings = laneResults.filter(Boolean).flatMap((r) => r.findings || [])

// dedup by rule+file+location
const seen = new Set()
findings = findings.filter((f) => {
  const k = `${f.rule}|${f.file}|${f.location}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

log(`${findings.length} candidate findings after dedup. Verifying each adversarially...`)

if (findings.length === 0) {
  return { findings: [], verified: [], applySafe: [], surfaceRisky: [], rejected: [] }
}

// ---------------------------------------------------------------------------
// Phase 2: Verify (parallel, per-finding) — a skeptic re-reads the code at the
// site, confirms the rule truly applies, the fix preserves behavior, and it
// violates no invariant.
// ---------------------------------------------------------------------------
phase('Verify')

const verified = await parallel(
  findings.map((f) => () =>
    agent(`${CONTEXT}

You are an adversarial verifier. A prior agent reported this finding:
- rule: ${f.rule}
- file: ${f.file}
- location: ${f.location}
- severity: ${f.severity}
- problem: ${f.problem}
- suggestedFix: ${f.suggestedFix}
- proposed risk: ${f.risk}

Open ${f.file} at that location and judge it for real. Decide:
- reject: the rule does not actually apply, the "problem" is wrong, the code is already fine, the fix would change behavior or break a test, or it violates a hard invariant.
- surface-risky: the finding is real but the file is high-risk/load-bearing OR the change has any behavioral nuance — list it for human sign-off, do not auto-apply.
- apply-safe: the finding is real, the file is NOT high-risk, and the fix is mechanical and provably behavior-preserving.
Default to reject when unsure. If the suggested fix is close but slightly off, put the corrected version in correctedFix.`,
      { label: `verify:${f.rule}:${f.file.split('/').pop()}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then((v) => ({ ...f, verdict: v }))
  )
)

const judged = verified.filter(Boolean)
const applySafe = judged.filter((f) => f.verdict.disposition === 'apply-safe')
const surfaceRisky = judged.filter((f) => f.verdict.disposition === 'surface-risky')
const rejected = judged.filter((f) => f.verdict.disposition === 'reject')

log(`Verified: ${applySafe.length} safe-to-apply, ${surfaceRisky.length} risky (need sign-off), ${rejected.length} rejected.`)

return {
  counts: { candidates: findings.length, applySafe: applySafe.length, surfaceRisky: surfaceRisky.length, rejected: rejected.length },
  applySafe,
  surfaceRisky,
  rejected,
}
