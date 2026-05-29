// find-hoistable.mjs — find in-component functions that are safe to lift to a
// plain module (capture NOTHING from component scope).
//
// Read-only. A companion to check-undef.mjs / derive-slice-deps.mjs, but
// per-FUNCTION instead of per-line-slice. For a target component, it walks every
// top-level declaration inside the component body that is a function (plain
// arrow/function, or one wrapped in useCallback/useMemo) and classifies every
// free identifier the function references as one of:
//   LOCAL    - bound inside the candidate itself (param / local / nested).
//   IMPORT   - a module-level import binding (safe; replicate the import).
//   MODDECL  - a module-level (non-import) declaration in the same file
//              (safe to reference, but must be exported or co-moved).
//   CAPTURE  - bound in the COMPONENT scope (state/ref/setter/prop/sibling
//              handler). ANY capture => NOT hoistable as-is.
//   GLOBAL   - no binding found (real JS/DOM global, or — investigate — a typo).
//
// A candidate is HOISTABLE iff it has zero CAPTUREs. (Eyeball GLOBALs + MODDECLs
// before extracting; the build + check-undef + test gate is the final word.)
//
// Usage:
//   node scripts/find-hoistable.mjs [file.jsx] [ComponentName] [--json]
//   node scripts/find-hoistable.mjs                      (defaults: src/PDFViewer.jsx PDFViewer)

import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const positional = argv.filter((a) => a !== '--json');
const file = positional[0] || 'src/PDFViewer.jsx';
const COMPONENT = positional[1] || 'PDFViewer';

const PLUGINS = ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread', 'dynamicImport', 'topLevelAwait'];

const code = readFileSync(file, 'utf8');
const ast = parse(code, { sourceType: 'module', plugins: PLUGINS });

// Locate the component function path (declaration or const-assigned arrow/fn).
let componentPath = null;
traverse(ast, {
  FunctionDeclaration(p) {
    if (p.node.id && p.node.id.name === COMPONENT) componentPath = p;
  },
  VariableDeclarator(p) {
    if (
      p.node.id && p.node.id.name === COMPONENT &&
      p.node.init && (p.node.init.type === 'ArrowFunctionExpression' || p.node.init.type === 'FunctionExpression')
    ) componentPath = p.get('init');
  },
});

if (!componentPath) {
  console.error(`Could not find component "${COMPONENT}" in ${file}`);
  process.exit(2);
}

const compStart = componentPath.node.start;
const compEnd = componentPath.node.end;

// Pull the candidate function out of an init expression: plain fn, or the
// first argument of useCallback(fn, deps) / useMemo(() => ..., deps).
function candidateFromInit(initPath) {
  if (!initPath || !initPath.node) return null;
  const t = initPath.node.type;
  if (t === 'ArrowFunctionExpression' || t === 'FunctionExpression') {
    return { fnPath: initPath, wrapper: null, deps: null };
  }
  if (t === 'CallExpression' && initPath.node.callee && initPath.node.callee.type === 'Identifier') {
    const callee = initPath.node.callee.name;
    if (callee === 'useCallback' || callee === 'useMemo') {
      const args = initPath.get('arguments');
      const first = args[0];
      if (first && (first.node.type === 'ArrowFunctionExpression' || first.node.type === 'FunctionExpression')) {
        const depsNode = args[1] && args[1].node;
        const deps = depsNode && depsNode.type === 'ArrayExpression' ? depsNode.elements.length : (depsNode ? -1 : null);
        return { fnPath: first, wrapper: callee, deps };
      }
    }
  }
  return null;
}

// Collect top-level candidates inside the component body.
const body = componentPath.get('body'); // BlockStatement
const stmts = body.get('body');
const candidates = [];

for (const stmt of stmts) {
  if (stmt.node.type === 'VariableDeclaration') {
    for (const decl of stmt.get('declarations')) {
      if (decl.node.id && decl.node.id.type === 'Identifier') {
        const cand = candidateFromInit(decl.get('init'));
        if (cand) candidates.push({ name: decl.node.id.name, ...cand });
      }
    }
  } else if (stmt.node.type === 'FunctionDeclaration' && stmt.node.id) {
    candidates.push({ name: stmt.node.id.name, fnPath: stmt, wrapper: 'funcdecl', deps: null });
  }
}

function classify(cand) {
  const fnPath = cand.fnPath;
  const cs = fnPath.node.start, ce = fnPath.node.end;
  const captures = new Set();
  const imports = new Set();
  const moddecls = new Set();
  const globals = new Set();

  fnPath.traverse({
    ReferencedIdentifier(idp) {
      const name = idp.node.name;
      const binding = idp.scope.getBinding(name);
      if (!binding) { globals.add(name); return; }
      const bnode = binding.path.node;
      const bs = bnode.start, be = bnode.end;
      if (bs == null || be == null) { globals.add(name); return; }
      if (bs >= cs && be <= ce) return;                       // local to candidate
      if (bs >= compStart && be <= compEnd) { captures.add(name); return; } // component capture
      if (binding.kind === 'module') imports.add(name);        // module-level import
      else moddecls.add(name);                                 // module-level decl
    },
  });

  return {
    name: cand.name,
    wrapper: cand.wrapper,
    deps: cand.deps,
    startLine: fnPath.node.loc ? fnPath.node.loc.start.line : null,
    endLine: fnPath.node.loc ? fnPath.node.loc.end.line : null,
    lines: fnPath.node.loc ? (fnPath.node.loc.end.line - fnPath.node.loc.start.line + 1) : null,
    hoistable: captures.size === 0,
    captures: [...captures].sort(),
    imports: [...imports].sort(),
    moddecls: [...moddecls].sort(),
    globals: [...globals].sort(),
  };
}

const results = candidates.map(classify);
const hoistable = results.filter((r) => r.hoistable);

if (jsonMode) {
  console.log(JSON.stringify({ file, component: COMPONENT, total: results.length, hoistable: hoistable.length, results }, null, 2));
  process.exit(0);
}

console.log(`=== ${file} :: ${COMPONENT} ===`);
console.log(`top-level function candidates: ${results.length}   HOISTABLE (zero captures): ${hoistable.length}\n`);
console.log('--- HOISTABLE (safe to lift; verify GLOBALs are real globals + MODDECLs are exportable) ---');
for (const r of hoistable.sort((a, b) => a.startLine - b.startLine)) {
  const dep = r.deps == null ? '' : ` deps=${r.deps === -1 ? '?' : r.deps}`;
  console.log(`  ${r.name}  [${r.wrapper || 'fn'}${dep}]  lines ${r.startLine}-${r.endLine} (${r.lines})`);
  if (r.moddecls.length) console.log(`      MODDECL: ${r.moddecls.join(', ')}`);
  if (r.globals.length) console.log(`      GLOBAL : ${r.globals.join(', ')}`);
}
console.log('\n--- NOT hoistable (captures component scope) — count only, top offenders by fewest captures ---');
const notHoist = results.filter((r) => !r.hoistable).sort((a, b) => a.captures.length - b.captures.length);
for (const r of notHoist.slice(0, 15)) {
  console.log(`  ${r.name}  captures ${r.captures.length}: ${r.captures.slice(0, 8).join(', ')}${r.captures.length > 8 ? ', …' : ''}`);
}
console.log(`  … and ${Math.max(0, notHoist.length - 15)} more not-hoistable`);
