// extract-helpers.mjs — mechanically lift capture-free helper functions out of a
// component file into plain modules, and rewire the imports.
//
// For each configured { module, names[] } it:
//   1. finds each named top-level declaration in the component body (a
//      useCallback/useMemo-wrapped fn, a plain arrow/function const, or a
//      function declaration),
//   2. rewrites it as a plain `export function NAME(params) { ... }` (dropping
//      the useCallback/useMemo wrapper — a module function is an equally stable
//      reference, so dependency arrays are unaffected),
//   3. derives the imports the module needs by resolving the function's free
//      identifiers against the component file's own imports (re-relativized to
//      the module's directory),
//   4. writes the module, removes the in-component declarations, and inserts the
//      new import statements into the component file.
//
// Only safe for functions PROVEN capture-free by scripts/find-hoistable.mjs and
// verified by the wf-verify-hoistable workflow. Read-only without --write.
//
// Usage:
//   node scripts/extract-helpers.mjs            (dry run: print plan, touch nothing)
//   node scripts/extract-helpers.mjs --write     (perform the moves)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;
const PLUGINS = ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread', 'dynamicImport', 'topLevelAwait'];

const WRITE = process.argv.includes('--write');
const VIEWER = 'src/PDFViewer.jsx';
const COMPONENT = 'PDFViewer';
const VIEWER_DIR = path.posix.dirname(VIEWER); // 'src'

// --- CONFIG: which helpers go where -----------------------------------------
const CONFIG = [
  { module: 'src/utils/regionGeometry.js', header: 'Geometry / page-resolution helpers for the viewer (page distance sort, region-area checks, DOM page-element + bounds-center math). Lifted verbatim from PDFViewer; all capture-free.', names: ['sortPdfjsPagesByDistance', 'hasValidRegionAreas', 'resolvePageContentElement', 'getBoundsCenter'] },
  { module: 'src/utils/annotationData.js', header: 'Annotation data helpers — color patch composition + Y.Map → Fabric annotation materialization. Lifted verbatim from PDFViewer; all capture-free.', names: ['composeColorForPatch', 'materializeFabricAnnotationFromYMap'] },
  { module: 'src/utils/bookmarkOutline.js', header: 'Bookmark / PDF outline helpers — id generation + outline page-number resolution. Lifted verbatim from PDFViewer; all capture-free.', names: ['generateBookmarkId', 'resolvePdfOutlinePageNumber'] },
  { module: 'src/utils/counterGeometry.js', header: 'Counter Survey Marker geometry helpers — render geometry + drag-preview cleanup. Lifted verbatim from PDFViewer; all capture-free.', names: ['getCounterRenderGeometry', 'removeCounterDragPreview'] },
  { module: 'src/utils/exportHelpers.js', header: 'Export helpers — export error message mapping + file-lock detection. Lifted verbatim from PDFViewer; all capture-free.', names: ['getExportErrorMessage', 'isFileLocked'] },
  { module: 'src/utils/overlayDebug.js', header: 'Overlay-lag / trackpad interaction debug summaries. Lifted verbatim from PDFViewer; all capture-free.', names: ['buildTrackpadInteractionDebugSummaryText', 'summarizeOverlayLagSamples'] },
];

const code = readFileSync(VIEWER, 'utf8');
const ast = parse(code, { sourceType: 'module', plugins: PLUGINS });

// Component imports: localName -> { source, kind, imported }, plus last-import end.
const imports = new Map();
let lastImportEnd = 0;
// Find component path.
let componentPath = null;
traverse(ast, {
  ImportDeclaration(p) {
    if (p.node.end > lastImportEnd) lastImportEnd = p.node.end;
    const source = p.node.source.value;
    for (const spec of p.node.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') imports.set(spec.local.name, { source, kind: 'default' });
      else if (spec.type === 'ImportNamespaceSpecifier') imports.set(spec.local.name, { source, kind: 'namespace' });
      else imports.set(spec.local.name, { source, kind: 'named', imported: spec.imported.name });
    }
  },
  FunctionDeclaration(p) { if (p.node.id && p.node.id.name === COMPONENT) componentPath = p; },
});
if (!componentPath) { console.error('component not found'); process.exit(2); }

// Map each requested name -> { stmtNode, fnNode } by scanning the component body.
const wanted = new Map();
for (const group of CONFIG) for (const n of group.names) wanted.set(n, null);

function fnFromInit(init) {
  if (!init) return null;
  if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') return init;
  if (init.type === 'CallExpression' && init.callee.type === 'Identifier' && (init.callee.name === 'useCallback' || init.callee.name === 'useMemo')) {
    const a = init.arguments[0];
    if (a && (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')) return a;
  }
  return null;
}

for (const stmt of componentPath.node.body.body) {
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) {
      if (d.id.type === 'Identifier' && wanted.has(d.id.name) && wanted.get(d.id.name) === null) {
        const fn = fnFromInit(d.init);
        if (fn) wanted.set(d.id.name, { stmtNode: stmt, fnNode: fn });
      }
    }
  } else if (stmt.type === 'FunctionDeclaration' && stmt.id && wanted.has(stmt.id.name) && wanted.get(stmt.id.name) === null) {
    wanted.set(stmt.id.name, { stmtNode: stmt, fnNode: stmt });
  }
}

const missing = [...wanted.entries()].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error('NOT FOUND in component:', missing.join(', ')); process.exit(3); }

// Re-relativize an import source from VIEWER_DIR to the module's directory.
function rerelative(source, moduleDir) {
  if (!source.startsWith('.')) return source; // bare specifier
  const abs = path.posix.normalize(path.posix.join(VIEWER_DIR, source));
  let rel = path.posix.relative(moduleDir, abs);
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

// Build the `export function` text for a fn node.
function exportFnText(name, fnNode) {
  if (fnNode.type === 'FunctionDeclaration') {
    return 'export ' + code.slice(fnNode.start, fnNode.end);
  }
  // arrow / function expression
  const async = fnNode.async ? 'async ' : '';
  const params = fnNode.params.length
    ? code.slice(fnNode.params[0].start, fnNode.params[fnNode.params.length - 1].end)
    : '';
  const body = fnNode.body;
  if (body.type === 'BlockStatement') {
    return `export ${async}function ${name}(${params}) ${code.slice(body.start, body.end)}`;
  }
  // expression body
  return `export ${async}function ${name}(${params}) {\n  return ${code.slice(body.start, body.end)};\n}`;
}

// Free identifiers of a fn -> needed imports, grouped by (re-relativized) source.
function neededImports(fnNode, moduleDir) {
  const text = exportFnText('___tmp', fnNode);
  const sub = parse(text, { sourceType: 'module', plugins: PLUGINS });
  let globals = [];
  traverse(sub, { Program(p) { globals = Object.keys(p.scope.globals); } });
  const bySource = new Map();
  const assumedGlobals = [];
  for (const g of globals) {
    if (!imports.has(g)) { assumedGlobals.push(g); continue; }
    const info = imports.get(g);
    const src = rerelative(info.source, moduleDir);
    if (!bySource.has(src)) bySource.set(src, { default: null, namespace: null, named: new Set() });
    const e = bySource.get(src);
    if (info.kind === 'default') e.default = g;
    else if (info.kind === 'namespace') e.namespace = g;
    else e.named.add(info.imported === g ? g : `${info.imported} as ${g}`);
  }
  return { bySource, assumedGlobals };
}

function renderImports(bySource) {
  const lines = [];
  for (const [src, g] of [...bySource.entries()].sort()) {
    const parts = [];
    if (g.default) parts.push(g.default);
    if (g.namespace) parts.push(`* as ${g.namespace}`);
    if (g.named.size) parts.push(`{ ${[...g.named].sort().join(', ')} }`);
    lines.push(`import ${parts.join(', ')} from '${src}';`);
  }
  return lines;
}

// Build modules + collect removal spans + viewer import lines.
const removalSpans = [];
const viewerImportLines = [];
const moduleFiles = [];
let anyUnknown = false;

for (const group of CONFIG) {
  const moduleDir = path.posix.dirname(group.module);
  const mergedBySource = new Map();
  const fnTexts = [];
  const exportedNames = [];
  for (const name of group.names) {
    const { stmtNode, fnNode } = wanted.get(name);
    fnTexts.push(exportFnText(name, fnNode));
    exportedNames.push(name);
    const { bySource, assumedGlobals } = neededImports(fnNode, moduleDir);
    for (const [src, e] of bySource) {
      if (!mergedBySource.has(src)) mergedBySource.set(src, { default: null, namespace: null, named: new Set() });
      const m = mergedBySource.get(src);
      if (e.default) m.default = e.default;
      if (e.namespace) m.namespace = e.namespace;
      for (const n of e.named) m.named.add(n);
    }
    // record removal span (indent line start .. trailing blank line)
    let s = stmtNode.start;
    while (s > 0 && code[s - 1] !== '\n') s -= 1; // back up to line start (eat indent)
    let e = stmtNode.end;
    if (code[e] === '\n') e += 1;                  // eat statement's own newline
    // eat one following blank line if present
    let probe = e;
    while (probe < code.length && code[probe] !== '\n' && /\s/.test(code[probe])) probe += 1;
    if (code[probe] === '\n') e = probe + 1;
    removalSpans.push([s, e]);
    if (assumedGlobals.length) console.log(`   ${name}: assumed-global -> ${assumedGlobals.sort().join(', ')}`);
  }
  const importLines = renderImports(mergedBySource);
  const moduleSource = `// ${group.header}\n\n${importLines.join('\n')}${importLines.length ? '\n\n' : ''}${fnTexts.join('\n\n')}\n`;
  moduleFiles.push({ path: group.module, source: moduleSource });
  // viewer import for this module
  const rel = './' + path.posix.relative(VIEWER_DIR, group.module).replace(/\.js$/, '');
  viewerImportLines.push(`import { ${[...exportedNames].sort().join(', ')} } from '${rel}';`);
  console.log(`MODULE ${group.module}: ${exportedNames.join(', ')}  (${importLines.length} import lines)`);
}

// Apply viewer edits: remove spans (descending) + insert imports after last import.
removalSpans.sort((a, b) => b[0] - a[0]);
let out = code;
for (const [s, e] of removalSpans) out = out.slice(0, s) + out.slice(e);
// Recompute insertion: lastImportEnd is valid only on original; do insertion on
// original-coordinate basis BEFORE removals would be complex, so insert by
// string anchor instead: after the viewerShared import block close.
const anchor = `} from './viewerShared';`;
const ai = out.indexOf(anchor);
if (ai === -1) { console.error('could not find viewerShared import anchor for insertion'); process.exit(4); }
const insertAt = ai + anchor.length;
const importBlock = '\n' + viewerImportLines.join('\n');
out = out.slice(0, insertAt) + importBlock + out.slice(insertAt);

console.log(`\nPlan: write ${moduleFiles.length} modules, remove ${removalSpans.length} declarations, insert ${viewerImportLines.length} viewer imports.`);
console.log(`Viewer size: ${code.length} -> ${out.length} chars.`);

if (!WRITE) { console.log('\n(dry run — pass --write to apply)'); process.exit(0); }

for (const m of moduleFiles) writeFileSync(m.path, m.source);
writeFileSync(VIEWER, out);
console.log('\nWROTE modules + updated viewer.');
