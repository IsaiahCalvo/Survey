// 2026-09-15 — Guard for the claim the CI split rests on:
// "the BLOCKING jobs contain no timing-sensitive test".
//
// ci.yml routes the millisecond-budget suites into the non-blocking `perf`
// lane (CI_PERF_TEST_FILES) and the slow-but-timing-free correctness suites
// into the `isolated` job. Everything else lands in one of the `test` shards.
// The shards AND the isolated suites are both blocking: a red job reds the run,
// and deploy-production.yml gates on that run's conclusion.
//
// Fix a report from this guard either by moving the offending file into
// CI_PERF_TEST_FILES / TIMING_SENSITIVE_TEST_FILES, or by recording it in
// ACKNOWLEDGED below with the reason it is safe to leave in the blocking path.
//
// ---------------------------------------------------------------------------
// 2026-09-15, second pass — THE DETECTOR IS A PROPERTY NOW, NOT A NAME LIST.
//
// The first version of this guard matched the source text of every shard file
// against
//
//     assert[.\w]*\([^)]*\b(?:elapsed|bestMs|durationMs|tookMs|cpuMs)\b
//
// which is a five-name allowlist reverse-engineered from the files that
// happened to exist that afternoon, not a description of the property. Every
// other ordinary spelling walked straight through it: `elapsedMs` (the word
// boundary after "elapsed" fails on the "M"), `ms`, `took`, `duration`,
// `latencyMs` — and, because `[^)]*` cannot cross a closing parenthesis, both
// inline forms, assert.ok(Date.now() - t0 < 500) and the performance.now()
// equivalent. It also scanned only the four shards, leaving the equally
// BLOCKING isolated suites unguarded.
//
// What is asserted now is the property itself. A file is timing-asserting when
// BOTH hold:
//
//   1. it reads a clock — Date.now(), performance.now(), process.hrtime(),
//      process.cpuUsage(), performance.mark()/measure(); and
//   2. an assert…() / expect() call takes, as one of its VALUE arguments, an
//      elapsed quantity: a clock difference written inline, or an identifier
//      that a light data-flow pass traces back to one.
//
// The data-flow pass tracks two kinds of value and keeps them apart, because
// the difference is the whole point:
//
//   * an INSTANT — `const now = Date.now()`, or an instant offset by a constant
//     (`new Date(now - 86_400_000)`). Fixture timestamps and cache-busting ids
//     are instants. Asserting on one is not a wall-clock budget, and flagging
//     them made the guard cry wolf on four honest files.
//   * a DURATION — one instant minus another (`Date.now() - startedAt`,
//     `end - start`), a call that returns a difference by construction
//     (`process.hrtime(t0)`, `process.cpuUsage(before)`), or any arithmetic on
//     a duration (`Number(ns) / 1e6`). Only these are wall-clock budgets.
//
// ---------------------------------------------------------------------------
// 2026-09-15, third pass — THE DATA-FLOW PASS FOLLOWS VALUES, NOT `=` SIGNS.
//
// The pass above was one regex over `name = …` assignments, so it only ever
// learned about durations bound with an equals sign. The single most ordinary
// way to write a timing helper in this repository — a plain function
// DECLARATION — has no `=` in it, so
//
//     function elapsedSince(startedAt) { return Date.now() - startedAt; }
//     const budgetMs = elapsedSince(startedAt);
//     assert.ok(budgetMs < 500, 'too slow');
//
// walked straight through, while the identical helper spelled
// `const elapsedSince = (startedAt) => …` was caught — a hole in the detector,
// not a stated limit. The pass now follows a duration through every in-file
// shape it can reach:
//
//   * a FUNCTION whose return expression is a duration is duration-returning,
//     however it is written — declaration, function expression, arrow, class
//     method, object-literal method — and every call of it is a duration,
//     whether bound first or called inline inside the assertion.
//   * a function returning an OBJECT LITERAL records which of its keys hold
//     durations, so `const { value, elapsedMs } = measure(…)` marks elapsedMs
//     and leaves value alone.
//   * an assignment TARGET may be dotted: `timings.elapsed = Date.now() - t0`
//     binds the name `timings.elapsed`, and the assertion on it is caught.
//   * an ARRAY that has had a duration pushed into it is a sample collection.
//     The array is not itself a duration — `samples.length` is a count — but a
//     reading taken out of it is: `Math.min(...samples)`, `samples.reduce(…)`,
//     `samples.sort()[0]`, `samples.at(0)`.
//
// All four grow together to a fixed point, because each feeds the others.
//
// A trailing argument that is a bare string or template literal is the
// assertion's MESSAGE, and is ignored: `assert.equal(rows.length, 3,
// `took ${elapsedMs}ms`)` asserts on a row count, not on the clock.
//
// KNOWN LIMIT, stated rather than hidden: the property is in-file. A budget
// measured inside a spawned child process and asserted in the parent as a plain
// JSON field — which is exactly what tests/partialEraserComplexity.test.mjs
// does — reads as an ordinary number here and is invisible. That file is in
// CI_PERF_TEST_FILES by explicit listing, and the lists in
// scripts/ci-perf-tests.mjs remain the first line of defence; this guard is the
// net under them, not a replacement for reading them.
//
// HOW TO RUN THIS FILE AND ITS TWO VERIFICATION SUITES. One at a time:
//
//     node --test tests/ciBlockingPathWallClockBudgets.test.mjs
//     node --test tests/ciWallClockGuardDetector.test.mjs
//     node --test tests/ciWallClockGuardHelperFlow.test.mjs
//
// `node --test tests/ci*.test.mjs` — several of them in ONE invocation — is NOT
// supported and reports a failure that means nothing. Both verification suites
// prove the guard by WRITING a probe test file into tests/, leaving it there
// while they run the guard as a child process, and deleting it afterwards.
// node's own runner runs the files it was handed in parallel worker processes,
// so a live probe from one file is in the tree — and therefore in a blocking
// shard — while this guard is scanning, and the guard correctly reports it and
// goes red. Verified: the three together fail every time; each on its own
// passes every time.
//
// Run them singly, or through `node scripts/run-node-tests.mjs`, which spawns
// exactly one file at a time and is what CI uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Files already known and argued for in scripts/ci-perf-tests.mjs, with the
 * argument repeated here so a reader of this guard never has to go and find it.
 */
const ACKNOWLEDGED = new Map([
  ['tests/geometryHitTest.test.mjs',
    'one 500ms hit-test guard among many correctness checks; the budget sits '
    + 'far above its measured cost and has never flaked, and pulling the whole '
    + 'file out of the blocking path would cost more coverage than it buys'],
  ['tests/cloudStrokeBandFuzz.test.mjs',
    '500ms/4000ms per-case guards inside the cloud geometry fuzzer; same '
    + 'argument — the budgets are far above the measured cost and the fuzzer '
    + 'is a correctness gate'],
]);

/** This guard and its verification suites: they talk about clocks, never use them. */
const GUARD_FILES = new Set([
  'tests/ciBlockingPathWallClockBudgets.test.mjs',
  'tests/ciWallClockGuardDetector.test.mjs',
  'tests/ciWallClockGuardHelperFlow.test.mjs',
]);

// --- the clock surface -----------------------------------------------------
// Spelled as fragments and joined, so this file never matches its own scanner
// through a source-text search.
const CLOCK = [
  String.raw`Date\s*\.\s*now\s*\(\s*\)`,
  String.raw`performance\s*\.\s*now\s*\(\s*\)`,
  String.raw`process\s*\.\s*hrtime\s*(?:\.\s*bigint\s*)?\([^()]*\)`,
  String.raw`process\s*\.\s*cpuUsage\s*\([^()]*\)`,
  String.raw`performance\s*\.\s*(?:mark|measure)\s*\([^()]*\)`,
].join('|');
const CLOCK_CALL = new RegExp(CLOCK);

/** Clock calls that return a DIFFERENCE by construction, not an instant. */
const DIFFERENCE_CALL = new RegExp([
  String.raw`process\s*\.\s*hrtime\s*\(\s*[A-Za-z_$[]`,
  String.raw`process\s*\.\s*cpuUsage\s*\(\s*[A-Za-z_$[]`,
  String.raw`performance\s*\.\s*measure\s*\(`,
].join('|'));

const IDENT = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
/** A dotted assignment target: `elapsed`, `timings.elapsed`, `this.spans.total`. */
const TARGET = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * `name` as a whole reference: never the tail of a longer identifier, and never
 * somebody else's property — `elapsed` does not match `timings.elapsed`, while
 * the dotted name `timings.elapsed` does.
 */
const wordSource = (name) => String.raw`(?<![.\w$])`
  + name.split('.').map((part) => escapeRegExp(part.trim())).join(String.raw`\s*\.\s*`)
  + String.raw`(?![\w$])`;

/** Each identifier is looked up against every file; build its regex once. */
const patternCache = new Map();
function cachedPattern(key, build) {
  let pattern = patternCache.get(key);
  if (!pattern) { pattern = build(); patternCache.set(key, pattern); }
  return pattern;
}

const word = (name) => cachedPattern(`w:${name}`, () => new RegExp(wordSource(name)));
const mentions = (text, names) => [...names].some((name) => word(name).test(text));

/**
 * A reference to an array of samples. Unlike `word` a leading `.` is allowed,
 * because the read that matters is the spread: `Math.min(...samples)`.
 */
const collectionSource = (name) => String.raw`(?<![\w$])${escapeRegExp(name)}(?![\w$])`;

/** A call to `name`, with or without a receiver: `since(t)` and `watch.since(t)`. */
const callOf = (name) => cachedPattern(
  `c:${name}`,
  () => new RegExp(String.raw`(?<![\w$])${escapeRegExp(name)}\s*\(`),
);
const calls = (text, names) => [...names].some((name) => callOf(name).test(text));

/** Index of the bracket that closes the one at `open`, or -1 if none does. */
function matchingBracket(code, open) {
  const closer = { '(': ')', '[': ']', '{': '}' }[code[open]];
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === code[open]) depth += 1;
    else if (code[index] === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Blank out comments and the literal TEXT of strings, keeping `${…}`
 * interpolations (they are code) and every character offset (so reported line
 * numbers stay true).
 */
function blankCommentsAndStringText(source) {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') { out += ' '; index += 1; }
      continue;
    }
    if (char === '/' && next === '*') {
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        out += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      out += '  ';
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      out += char;
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') { out += '  '; index += 2; continue; }
        out += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) { out += char; index += 1; }
      continue;
    }
    if (char === '`') {
      out += char;
      index += 1;
      let depth = 0;
      while (index < source.length) {
        if (depth === 0 && source[index] === '`') break;
        if (source[index] === '\\') { out += '  '; index += 2; continue; }
        if (depth === 0 && source[index] === '$' && source[index + 1] === '{') {
          out += '${';
          index += 2;
          depth = 1;
          continue;
        }
        if (depth > 0) {
          if (source[index] === '{') depth += 1;
          if (source[index] === '}') { depth -= 1; out += '}'; index += 1; continue; }
          out += source[index];
          index += 1;
          continue;
        }
        out += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) { out += '`'; index += 1; }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * True when `text` subtracts one instant from another — an elapsed time.
 * `Date.now() - startedAt` and `end - start` qualify. `now - 86_400_000` does
 * not: an instant minus a constant is another instant, which is how fixture
 * timestamps are written. That is why the right-hand operand must begin with an
 * identifier, `$`, `_` or `(` rather than a digit.
 */
function differenceOfInstants(text, instants) {
  const instant = [CLOCK, ...[...instants].map(wordSource)].join('|');
  return new RegExp(String.raw`(?:${instant})\s*-\s*[A-Za-z_$(]`).test(text)
    || new RegExp(String.raw`-\s*(?:${instant})`).test(text);
}

/**
 * Every `<target> = <initialiser>` in the file, initialisers cut at `;` or
 * newline. The target may be dotted, so `timings.elapsed = Date.now() - t0`
 * is a binding of the name `timings.elapsed` — a duration parked on an object
 * property is still a duration. `==`, `===` and `=>` are not assignments and
 * are skipped.
 */
function bindings(code) {
  const found = [];
  const pattern = new RegExp(
    String.raw`(?:^|[;{}()\s])(?:(?:const|let|var)\s+)?(${TARGET})\s*(?:[-+*/]?=)(?![=>])\s*([^;\n]*)`,
    'gm',
  );
  let match;
  while ((match = pattern.exec(code)) !== null) {
    // A value being built as a string — a cache-busting URL, a log label — is
    // never a duration, however many clocks went into spelling it.
    if (/^\s*[`'"]/.test(match[2])) continue;
    found.push([match[1].replace(/\s+/g, ''), match[2]]);
  }
  return found;
}

/** Every `const { a, b: c } = <initialiser>` in the file. */
function destructurings(code) {
  const found = [];
  const pattern = new RegExp(
    String.raw`(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*([^;\n]*)`,
    'g',
  );
  const entryPattern = new RegExp(String.raw`^\s*(${IDENT})\s*(?::\s*(${IDENT}))?`);
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const entries = [];
    for (const part of match[1].split(',')) {
      const pair = entryPattern.exec(part);
      if (pair) entries.push({ key: pair[1], local: pair[2] ?? pair[1] });
    }
    if (entries.length > 0) found.push({ entries, initialiser: match[2] });
  }
  return found;
}

/** Every `samples.push(<argument>)`, argument read with balanced brackets. */
function arrayPushes(code) {
  const found = [];
  const pattern = new RegExp(
    String.raw`(?<![\w$])(${TARGET})\s*\.\s*(?:push|unshift)\s*\(`,
    'g',
  );
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchingBracket(code, open);
    if (close === -1) continue;
    found.push([match[1].replace(/\s+/g, ''), code.slice(open + 1, close)]);
  }
  return found;
}

/** Words that can head a `keyword (…) {` block but are not function names. */
const BLOCK_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'do', 'else', 'return',
  'function', 'typeof', 'await', 'new', 'case', 'try', 'finally', 'class',
  'import', 'export', 'delete', 'void', 'in', 'of', 'yield',
]);

/** Every `return <expression>` inside a function body, brackets balanced. */
function returnExpressions(body) {
  const found = [];
  const pattern = /(?<![.\w$])return(?![\w$])/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    let index = match.index + 'return'.length;
    let depth = 0;
    let expression = '';
    while (index < body.length) {
      const char = body[index];
      if (depth === 0 && (char === ';' || (char === '\n' && expression.trim()))) break;
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) break;
        depth -= 1;
      }
      expression += char;
      index += 1;
    }
    if (expression.trim()) found.push(expression.trim());
  }
  return found;
}

/**
 * Every named function in the file that has a `{ … }` body, paired with the
 * expressions it returns. Covers declarations (`function elapsedSince(t) {`),
 * class and object-literal methods (`since(t) {`), and named function
 * expressions and arrows (`const f = (t) => {`, `f: function (t) {`).
 *
 * A concise arrow — `const f = (t) => Date.now() - t` — needs nothing here:
 * `bindings` already binds the whole arrow to the name, so the name itself
 * reads as a duration and every call of it is caught by `mentions`.
 */
function namedFunctions(code) {
  const heads = [
    new RegExp(
      String.raw`(?<![.\w$])(?:(?:async|static|get|set)\s+)*(?:function\s*\*?\s+)?`
      + String.raw`(${IDENT})\s*\([^()]*\)\s*\{`,
      'g',
    ),
    new RegExp(
      String.raw`(?<![.\w$])(${IDENT})\s*[:=]\s*(?:async\s+)?`
      + String.raw`(?:function\s*\*?\s*[A-Za-z0-9_$]*\s*)?\([^()]*\)\s*(?:=>\s*)?\{`,
      'g',
    ),
  ];
  const found = [];
  const seen = new Set();
  for (const head of heads) {
    let match;
    while ((match = head.exec(code)) !== null) {
      if (BLOCK_KEYWORDS.has(match[1])) continue;
      const open = match.index + match[0].length - 1;
      if (seen.has(open)) continue;
      seen.add(open);
      const close = matchingBracket(code, open);
      if (close === -1) continue;
      found.push({ name: match[1], returns: returnExpressions(code.slice(open + 1, close)) });
    }
  }
  return found;
}

/** Top-level `key: value` pairs, and shorthands, of an object literal. */
function objectProperties(text) {
  const found = [];
  const keyed = new RegExp(String.raw`^\s*(${IDENT})\s*:([\s\S]*)$`);
  const shorthand = new RegExp(String.raw`^\s*(${IDENT})\s*$`);
  for (const part of splitArguments(text.slice(1, -1))) {
    const pair = keyed.exec(part);
    if (pair) { found.push([pair[1], pair[2]]); continue; }
    const bare = shorthand.exec(part);
    if (bare) found.push([bare[1], bare[1]]);
  }
  return found;
}

/**
 * Light data-flow. Four sets come out of it, and the assertion scanner reads
 * all four:
 *
 *   instants   — identifiers holding a clock READING (`const now = Date.now()`).
 *                Fixture timestamps and cache-busting ids live here; asserting
 *                on one is not a wall-clock budget.
 *   durations  — identifiers holding an ELAPSED quantity, however it got there:
 *                a difference written inline, a value read off a duration-
 *                returning helper, a property assigned a difference
 *                (`timings.elapsed = …`), or a name destructured out of a
 *                measuring helper's result object.
 *   collections — arrays that have had a duration pushed into them. A sample
 *                array is not itself a duration; `Math.min(...samples)` is.
 *   functions  — functions whose return expression is a duration, so that
 *                `elapsedSince(t0)` — whether bound first or called inline
 *                inside the assertion — reads as one.
 *
 * The four grow together to a fixed point, because each can feed the others: a
 * helper's return is classified from the durations known so far, and its call
 * sites then create new durations. The loop is bounded so a pathological file
 * cannot spin.
 */
function clockValues(code) {
  const declarations = bindings(code);
  const destructured = destructurings(code);
  const pushes = arrayPushes(code);
  const functions = namedFunctions(code);

  const instants = new Set();
  const durations = new Set();
  const collections = new Set();
  const durationFunctions = new Set();
  /** helper name -> the keys of its returned object that hold durations. */
  const durationKeys = new Map();

  /** True when a duration is read out of one of the sample arrays. */
  const reducesCollection = (text) => [...collections].some((name) => {
    const reference = collectionSource(name);
    return new RegExp(String.raw`Math\s*\.\s*(?:min|max)\s*\([^()]*${reference}`).test(text)
      || new RegExp(
        String.raw`${reference}\s*(?:\[|\.\s*(?:reduce|at|sort|find|every|some|pop|shift)\b)`,
      ).test(text);
  });

  const isDuration = (text) => DIFFERENCE_CALL.test(text)
    || mentions(text, durations)
    || differenceOfInstants(text, instants)
    || calls(text, durationFunctions)
    || reducesCollection(text);

  let changed = true;
  let rounds = 0;
  while (changed && rounds < 16) {
    changed = false;
    rounds += 1;

    for (const { name, returns } of functions) {
      for (const expression of returns) {
        if (expression.startsWith('{')) {
          for (const [key, value] of objectProperties(expression)) {
            if (!isDuration(value)) continue;
            const keys = durationKeys.get(name) ?? new Set();
            if (keys.has(key)) continue;
            keys.add(key);
            durationKeys.set(name, keys);
            changed = true;
          }
          continue;
        }
        if (!durationFunctions.has(name) && isDuration(expression)) {
          durationFunctions.add(name);
          changed = true;
        }
      }
    }

    for (const [name, argument] of pushes) {
      if (!collections.has(name) && isDuration(argument)) {
        collections.add(name);
        changed = true;
      }
    }

    for (const [name, initialiser] of declarations) {
      if (!durations.has(name)) {
        if (isDuration(initialiser)) { durations.add(name); changed = true; continue; }
      }
      if (!instants.has(name) && CLOCK_CALL.test(initialiser)) {
        instants.add(name);
        changed = true;
      }
    }

    for (const { entries, initialiser } of destructured) {
      const helper = [...durationKeys.keys()].find((name) => callOf(name).test(initialiser));
      if (!helper) continue;
      for (const { key, local } of entries) {
        if (durations.has(local) || !durationKeys.get(helper).has(key)) continue;
        durations.add(local);
        changed = true;
      }
    }
  }
  return {
    instants, durations, collections, durationFunctions, reducesCollection,
  };
}

/** Split a balanced argument list on its top-level commas. */
function splitArguments(text) {
  const args = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) { args.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim()) args.push(current);
  return args;
}

/** An argument that is nothing but a string or template literal: the message. */
const MESSAGE_ARGUMENT = /^\s*(?:`[\s\S]*`|'[\s\S]*'|"[\s\S]*")\s*$/;

/** Every assertion in `source` whose value arguments carry an elapsed time. */
export function wallClockAssertions(source) {
  const code = blankCommentsAndStringText(source);
  const {
    instants, durations, durationFunctions, reducesCollection,
  } = clockValues(code);
  const hits = [];
  const callSite = new RegExp(
    String.raw`(?<![.\w$])(assert(?:\s*\.\s*${IDENT})*|expect)\s*\(`,
    'g',
  );
  let match;
  while ((match = callSite.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let index = open; index < code.length; index += 1) {
      if (code[index] === '(') depth += 1;
      else if (code[index] === ')') {
        depth -= 1;
        if (depth === 0) { close = index; break; }
      }
    }
    if (close === -1) continue;
    const inner = code.slice(open + 1, close);
    const subject = splitArguments(inner)
      .filter((argument) => !MESSAGE_ARGUMENT.test(argument))
      .join(',');
    const offending = mentions(subject, durations)
      || differenceOfInstants(subject, instants)
      || calls(subject, durationFunctions)
      || reducesCollection(subject)
      || (CLOCK_CALL.test(subject) && /[<>]=?/.test(subject));
    if (offending) {
      hits.push({
        line: code.slice(0, match.index).split('\n').length,
        text: `${match[1]}(${inner.replace(/\s+/g, ' ').trim().slice(0, 100)}`,
      });
    }
  }
  return hits;
}

/** How many shards ci.yml actually runs, so this guard follows the matrix. */
function shardCountFromWorkflow() {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const matrix = /^\s*shard:\s*\[([^\]]*)\]/m.exec(ci);
  assert.ok(matrix, 'ci.yml no longer declares a `shard:` matrix for the test job');
  const shards = matrix[1].split(',').map((entry) => entry.trim()).filter(Boolean);
  assert.ok(shards.length > 0, 'ci.yml declares an empty `shard:` matrix');
  return shards.length;
}

function filesIn(args) {
  return execFileSync(process.execPath, ['scripts/run-node-tests.mjs', ...args, '--list'], {
    cwd: root,
    encoding: 'utf8',
    // The `isolated` job sets this on bot bumps; the guard must always see
    // the full selection, never the skipped-empty one.
    env: { ...process.env, SKIP_TIMING_SUITES: '' },
  }).split('\n').filter(Boolean);
}

/** Every BLOCKING selection ci.yml runs: the shards, and the isolated suites. */
function blockingSelections() {
  const selections = [];
  const shardCount = shardCountFromWorkflow();
  for (let shard = 1; shard <= shardCount; shard += 1) {
    selections.push([`shard ${shard}/${shardCount}`, [`--shard=${shard}/${shardCount}`]]);
  }
  selections.push(['isolated suites', ['--only-timing-sensitive']]);
  return selections;
}

test('no blocking CI job asserts on wall-clock time', () => {
  const offenders = [];
  const seen = new Set();
  for (const [label, args] of blockingSelections()) {
    for (const file of filesIn(args)) {
      if (GUARD_FILES.has(file) || ACKNOWLEDGED.has(file)) continue;
      seen.add(file);
      const hits = wallClockAssertions(readFileSync(join(root, file), 'utf8'));
      for (const hit of hits) {
        offenders.push(`${label}: ${file}:${hit.line} -> ${hit.text}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These files run in a BLOCKING CI job and assert on elapsed wall-clock '
    + 'time. A loaded hosted runner can red them, which reds the run, which '
    + 'stops the production deploy — the exact failure the perf lane was built '
    + 'to remove. Move the file into CI_PERF_TEST_FILES, or add it to '
    + 'ACKNOWLEDGED in this file with the reason it is safe to leave:'
    + `\n  ${offenders.join('\n  ')}`,
  );
  assert.ok(seen.size > 400, `only ${seen.size} blocking files were scanned — the`
    + ' selection query is broken, not the suite');
});

test('every acknowledged exception is still in a blocking job, and still timed', () => {
  // An entry that is no longer reachable, or no longer times anything, is a
  // stale excuse. Either way it must come out of the list rather than sit there
  // granting a permission nobody is using.
  const blocking = new Set();
  for (const [, args] of blockingSelections()) for (const file of filesIn(args)) blocking.add(file);

  for (const [file, reason] of ACKNOWLEDGED) {
    assert.ok(reason.length > 40, `${file} needs a real reason, not a note`);
    assert.ok(
      blocking.has(file),
      `${file} is acknowledged as a wall-clock budget left in the blocking path, `
      + 'but no blocking job runs it any more — delete the entry',
    );
    assert.ok(
      wallClockAssertions(readFileSync(join(root, file), 'utf8')).length > 0,
      `${file} is acknowledged as carrying a wall-clock budget, but no longer `
      + 'asserts on elapsed time — delete the entry',
    );
  }
});
