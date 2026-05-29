// tests/phase31/idAtCreationStamping.test.mjs
// Phase 31 Wave 0 scaffold (Plan 31-01) — locks contracts for Plan 31-02.
//
// Defends Phase 31 lean-variant Acceptance Criterion #4 — "given an annotation
// drawn after cutover lands, when the row is inspected, then it carries a
// stable data.id minted at creation time (UUID format) AND that id matches the
// Y.Doc Y.Map key."
//
// Today annotations get their data.id only on first cloud upload via
// `serializeFabricObjectToRow`. After the cutover the legacy upload path is
// gated off, so IDs MUST be minted at creation time. Counter pointerdown
// handlers (App.jsx overlay #1 ~29811 and overlay #2 ~31170) are the two
// creation sites this plan locks. Plan 31-02 stamps `data.id = crypto.randomUUID()`
// at both sites under the standing App.jsx narrow waiver.
//
// This test ships RED until Plan 31-02 lands (Phase 30 / Phase 27 precedent for
// red→green wave-0 tests). The grep count gives the executor of Plan 31-02 a
// concrete target.
//
// Skip-guard pattern: per-test existsSync (Phase 27/28/29/30 precedent).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_PATH = path.resolve(__dirname, '../../src/App.jsx');
// The counter overlay handlers moved to src/PDFViewer.jsx when PDFViewer was
// extracted from App.jsx; read both so the source grep finds them.
const PDFVIEWER_PATH = path.resolve(__dirname, '../../src/PDFViewer.jsx');
const APP_SKIP = !existsSync(APP_PATH) ? 'src/App.jsx missing' : false;

describe('Counter pointerdown handlers stamp data.id at creation (Plan 31-02)', () => {
  it('App.jsx contains >= 2 occurrences of data.id = crypto.randomUUID() (one per counter overlay)', { skip: APP_SKIP }, () => {
    const source = readFileSync(APP_PATH, 'utf8') + '\n' + readFileSync(PDFVIEWER_PATH, 'utf8');
    // The two counter pointerdown handlers around lines 29811 and 31170 must
    // each stamp the id at creation, NOT defer to first cloud upload. The
    // grep target is the literal assignment form so the executor of Plan
    // 31-02 has zero ambiguity about what to add.
    const matches = source.match(/data\.id\s*=\s*crypto\.randomUUID\(\)/g) || [];
    assert.ok(
      matches.length >= 2,
      `expected >=2 occurrences of "data.id = crypto.randomUUID()" in App.jsx (one per counter overlay), found ${matches.length}`,
    );
  });

  it('counter object construction includes id field next to data.type and data.createdAt', { skip: APP_SKIP }, () => {
    const source = readFileSync(APP_PATH, 'utf8') + '\n' + readFileSync(PDFVIEWER_PATH, 'utf8');
    // For each counter overlay region (find by data-counter-overlay attribute),
    // take ~3000 chars after each match and assert the slice contains BOTH
    // type: 'counter' AND an id-related stamp (the stamp form is left to the
    // executor — `data.id = ...` OR `id: ...` inside the data block both
    // satisfy as long as the per-creation-site grep above already locks the
    // crypto.randomUUID form).
    const overlayRegex = /data-counter-overlay/g;
    const overlayMatches = [...source.matchAll(overlayRegex)];
    assert.ok(
      overlayMatches.length >= 2,
      `expected >=2 data-counter-overlay regions in App.jsx, found ${overlayMatches.length}`,
    );
    for (const match of overlayMatches) {
      const start = match.index;
      const slice = source.slice(start, start + 3000);
      assert.ok(
        slice.includes("type: 'counter'"),
        `counter overlay region at offset ${start} must contain type: 'counter'`,
      );
      // Either form is accepted: explicit data.id assignment OR id: key inside
      // the data block. Plan 31-02 owns the exact phrasing.
      assert.ok(
        /\bdata\.id\s*=\s*crypto\.randomUUID/.test(slice) || /\bid\s*:\s*crypto\.randomUUID/.test(slice),
        `counter overlay region at offset ${start} must stamp an id via crypto.randomUUID at creation`,
      );
    }
  });

  it('counter id stamp lives BEFORE handleSaveAnnotations call (stamp must be in the saved JSON)', { skip: APP_SKIP }, () => {
    const source = readFileSync(APP_PATH, 'utf8') + '\n' + readFileSync(PDFVIEWER_PATH, 'utf8');
    // For each counter overlay region, find the offset of the crypto.randomUUID
    // call and the offset of the FIRST handleSaveAnnotations call. The
    // randomUUID offset MUST be smaller (i.e. earlier in source) so the saved
    // JSON carries the stamped id. Stamping AFTER save would defeat the
    // entire seal — the cloud round-trip would still see an id-less row.
    const overlayRegex = /data-counter-overlay/g;
    const overlayMatches = [...source.matchAll(overlayRegex)];
    for (const match of overlayMatches) {
      const start = match.index;
      // Take a generous slice — counter overlay handlers run ~3000 chars from
      // the data-counter-overlay attribute through to handleSaveAnnotations.
      const slice = source.slice(start, start + 3000);
      const stampOffset = slice.search(/crypto\.randomUUID\(/);
      const saveOffset = slice.search(/handleSaveAnnotations\(/);
      // If either is missing in this slice, defer to the count test above —
      // the stamp may live earlier in the handler. Only assert ordering when
      // BOTH appear in the same slice.
      if (stampOffset >= 0 && saveOffset >= 0) {
        assert.ok(
          stampOffset < saveOffset,
          `counter overlay at offset ${start}: crypto.randomUUID (offset ${stampOffset}) must come BEFORE handleSaveAnnotations (offset ${saveOffset}) so the saved JSON carries the id`,
        );
      }
    }
  });
});
