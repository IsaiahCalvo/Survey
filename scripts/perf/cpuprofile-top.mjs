#!/usr/bin/env node
// Summarise a .cpuprofile: top functions by self and by inclusive time, with
// positions mapped back to source when the build's .map files sit next to it.
//
//   DIST=dist-perf TOP=30 node scripts/perf/cpuprofile-top.mjs run.cpuprofile [fromMs toMs]
import fs from 'node:fs';
import path from 'node:path';
import { SourceMapConsumer } from 'source-map-js';

const [file, fromArg, toArg] = process.argv.slice(2);
const DIST = process.env.DIST || null;
const TOP = Number(process.env.TOP || 30);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);

const maps = new Map();
function mapPos(url, line, col) {
  if (!DIST || !url) return null;
  const base = path.basename(new URL(url, 'http://x').pathname);
  if (!maps.has(base)) {
    const p = path.join(DIST, 'assets', `${base}.map`);
    maps.set(base, fs.existsSync(p) ? new SourceMapConsumer(JSON.parse(fs.readFileSync(p, 'utf8'))) : null);
  }
  const m = maps.get(base);
  if (!m) return null;
  const o = m.originalPositionFor({ line: line + 1, column: col });
  return o.source ? `${o.name || '?'} ${o.source.replace(/^.*?(src|node_modules)\//, '$1/')}:${o.line}` : null;
}
const label = (n) => {
  const f = n.callFrame;
  return mapPos(f.url, f.lineNumber, f.columnNumber)
    || `${f.functionName || '(anon)'} ${path.basename(f.url || '') || f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
};

// Sample times, optionally windowed (ms from profile start).
const t0 = prof.startTime;
const from = fromArg != null ? t0 + Number(fromArg) * 1000 : -Infinity;
const to = toArg != null ? t0 + Number(toArg) * 1000 : Infinity;
const self = new Map();
const incl = new Map();
let t = t0;
let total = 0;
prof.samples.forEach((id, i) => {
  const dt = (prof.timeDeltas[i] || 0) / 1000;
  t += prof.timeDeltas[i] || 0;
  if (t < from || t > to) return;
  const n = byId.get(id);
  const name = n.callFrame.functionName;
  if (name === '(idle)' || name === '(program)' || name === '(garbage collector)') {
    self.set(name, (self.get(name) || 0) + dt);
    return;
  }
  total += dt;
  const key = label(n);
  self.set(key, (self.get(key) || 0) + dt);
  const seen = new Set();
  for (let cur = id; cur != null; cur = parent.get(cur)) {
    const k = label(byId.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    incl.set(k, (incl.get(k) || 0) + dt);
  }
});
const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k, v]) => `  ${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n');
console.log(`busy ${total.toFixed(0)} ms\nSELF\n${fmt(self)}\nINCLUSIVE\n${fmt(incl)}`);
