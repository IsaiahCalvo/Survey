// tests/phase35/cleanupResidueAudit.test.mjs
// Phase 35 Wave 0 scaffold (Plan 35-01) — runs as test.skip until Plan 35-05
// lands src/lib/collab/cleanupResidueAudit.js.
//
// Per-test existsSync skip-guard pattern lifted verbatim from Phase 27/28/29
// scaffolds. Each test inlines the skip guard so the file auto-flips from
// all-skipped to all-running the moment Plan 35-05 commits the production
// audit helper.
//
// Contract under test (locked here, consumed by Plan 35-05):
//   auditResidue({
//     cloudAnnotations: Annotation[],
//     viewerId: string,
//     isViewerOwner: boolean,
//     dismissedDocIds: Set<string>,
//     documentId?: string,
//     localUserDeletedSet?: Array<{ id, deletedAt }>,
//   }): { residueIds: string[], count: number }
//
// "Residue" = annotations whose authorId === viewerId AND whose lastEditedAt
// is older than the most recent local user-deleted-set entry (i.e. the wipe
// brake suppressed the local delete in earlier sessions and they survived
// the round-trip). The owner sees a one-shot "Clean up" banner; collaborators
// never see it. Dismissal is sticky per documentId.
//
// See .planning/phases/35-per-user-delete-authority-confirm-before-wipe/35-CONTEXT.md
// "One-time cleanup of brake-suppressed annotations" + "Brake retirement" for
// the design rationale.

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { auditResidue } from '../../src/lib/collab/cleanupResidueAudit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/cleanupResidueAudit.js');

// --- Fixtures -----------------------------------------------------------

const OWNER_ID = 'user-owner-uuid';
const COLLAB_ID = 'user-collab-uuid';

function makeCloudAnno(id, authorId, lastEditedAt) {
  return {
    id,
    authorId,
    lastEditedAt,
    data: { authorId, authorName: `Name-${authorId}` },
  };
}

// --- Tests --------------------------------------------------------------

test(
  'cleanupResidueAudit #1: auditResidue({ cloudAnnotations, viewerId, isViewerOwner: true, dismissedDocIds: new Set() }) returns { residueIds: [...], count: N } when viewer is owner AND ownership criterion matches AND not dismissed',
  { skip: !existsSync(TARGET) ? 'cleanupResidueAudit module not yet present (Plan 35-05)' : false },
  async () => {
    const cloudAnnotations = [
      // Owner authored these; lastEditedAt before the most-recent local
      // user-deleted entry (1000) → suspected residue.
      makeCloudAnno('a1', OWNER_ID, 500),
      makeCloudAnno('a2', OWNER_ID, 600),
      // Owner authored, but lastEditedAt AFTER any user-deleted entry (1500 > 1000)
      // → not residue (edited after the local delete attempt, so legitimate).
      makeCloudAnno('a3', OWNER_ID, 1500),
      // Collaborator-authored — never residue from owner's POV.
      makeCloudAnno('a4', COLLAB_ID, 200),
    ];
    const result = auditResidue({
      cloudAnnotations,
      viewerId: OWNER_ID,
      isViewerOwner: true,
      dismissedDocIds: new Set(),
      documentId: 'doc-1',
      localUserDeletedSet: [
        { id: 'a1', deletedAt: 1000 }, // most recent: 1000
        { id: 'a2', deletedAt: 800 },
      ],
    });
    deepStrictEqual([...result.residueIds].sort(), ['a1', 'a2']);
    strictEqual(result.count, 2);
  },
);

test(
  'cleanupResidueAudit #2: returns { residueIds: [], count: 0 } when isViewerOwner is false (collaborators never see the banner)',
  { skip: !existsSync(TARGET) ? 'cleanupResidueAudit module not yet present (Plan 35-05)' : false },
  async () => {
    const cloudAnnotations = [
      makeCloudAnno('a1', COLLAB_ID, 500),
      makeCloudAnno('a2', COLLAB_ID, 600),
    ];
    const result = auditResidue({
      cloudAnnotations,
      viewerId: COLLAB_ID,
      isViewerOwner: false,
      dismissedDocIds: new Set(),
      documentId: 'doc-1',
      localUserDeletedSet: [
        { id: 'a1', deletedAt: 1000 },
        { id: 'a2', deletedAt: 1200 },
      ],
    });
    deepStrictEqual(result.residueIds, []);
    strictEqual(result.count, 0);
  },
);

test(
  'cleanupResidueAudit #3: returns { residueIds: [], count: 0 } when documentId is in dismissedDocIds (sticky-per-document dismissal)',
  { skip: !existsSync(TARGET) ? 'cleanupResidueAudit module not yet present (Plan 35-05)' : false },
  async () => {
    const cloudAnnotations = [
      makeCloudAnno('a1', OWNER_ID, 500),
      makeCloudAnno('a2', OWNER_ID, 600),
    ];
    const dismissed = new Set(['doc-1']);
    const result = auditResidue({
      cloudAnnotations,
      viewerId: OWNER_ID,
      isViewerOwner: true,
      dismissedDocIds: dismissed,
      documentId: 'doc-1',
      localUserDeletedSet: [
        { id: 'a1', deletedAt: 1000 },
      ],
    });
    deepStrictEqual(result.residueIds, []);
    strictEqual(result.count, 0);
  },
);

test(
  'cleanupResidueAudit #4: residueIds are annotation IDs whose authorId === viewerId AND whose lastEditedAt is older than the most recent local user-deleted-set entry (indicating the brake suppressed the local delete in earlier sessions)',
  { skip: !existsSync(TARGET) ? 'cleanupResidueAudit module not yet present (Plan 35-05)' : false },
  async () => {
    // Most recent local user-deleted entry timestamp = 5000.
    // Anything authored by viewer with lastEditedAt < 5000 is residue.
    // Anything authored by viewer with lastEditedAt >= 5000 is NOT residue
    //   (it was edited after the local-delete attempt — likely legitimate).
    const cloudAnnotations = [
      makeCloudAnno('older-1', OWNER_ID, 1000),
      makeCloudAnno('older-2', OWNER_ID, 4999),
      makeCloudAnno('boundary', OWNER_ID, 5000), // not residue — exactly the cutoff
      makeCloudAnno('newer', OWNER_ID, 6000), // not residue — edited after delete attempt
      makeCloudAnno('foreign', COLLAB_ID, 100), // not residue — wrong author
    ];
    const result = auditResidue({
      cloudAnnotations,
      viewerId: OWNER_ID,
      isViewerOwner: true,
      dismissedDocIds: new Set(),
      documentId: 'doc-1',
      localUserDeletedSet: [
        { id: 'somewhere', deletedAt: 3000 },
        { id: 'most-recent', deletedAt: 5000 },
        { id: 'older', deletedAt: 1500 },
      ],
    });
    deepStrictEqual([...result.residueIds].sort(), ['older-1', 'older-2']);
    strictEqual(result.count, 2);
  },
);

test(
  'cleanupResidueAudit #5: pure function — read-only against cloudAnnotations',
  { skip: !existsSync(TARGET) ? 'cleanupResidueAudit module not yet present (Plan 35-05)' : false },
  async () => {
    const cloudAnnotations = [
      makeCloudAnno('a1', OWNER_ID, 500),
      makeCloudAnno('a2', OWNER_ID, 600),
    ];
    const localUserDeletedSet = [{ id: 'a1', deletedAt: 1000 }];
    const dismissed = new Set();

    const cloudBefore = JSON.stringify(cloudAnnotations);
    const localBefore = JSON.stringify(localUserDeletedSet);
    const dismissedBefore = [...dismissed];

    auditResidue({
      cloudAnnotations,
      viewerId: OWNER_ID,
      isViewerOwner: true,
      dismissedDocIds: dismissed,
      documentId: 'doc-1',
      localUserDeletedSet,
    });

    strictEqual(JSON.stringify(cloudAnnotations), cloudBefore, 'cloudAnnotations not mutated');
    strictEqual(JSON.stringify(localUserDeletedSet), localBefore, 'localUserDeletedSet not mutated');
    deepStrictEqual([...dismissed], dismissedBefore, 'dismissedDocIds not mutated');
    ok(true, 'pure function contract upheld');
  },
);

test(
  'cleanupResidueAudit #6: defensive guards return empty audit',
  { skip: !existsSync(TARGET) ? 'cleanupResidueAudit module not yet present (Plan 35-05)' : false },
  () => {
    deepStrictEqual(auditResidue({ cloudAnnotations: null, viewerId: OWNER_ID, isViewerOwner: true }), {
      residueIds: [],
      count: 0,
    });
    deepStrictEqual(auditResidue({ cloudAnnotations: [], viewerId: '', isViewerOwner: true }), {
      residueIds: [],
      count: 0,
    });
    deepStrictEqual(auditResidue({
      cloudAnnotations: [makeCloudAnno('a1', OWNER_ID, 1)],
      viewerId: OWNER_ID,
      isViewerOwner: true,
      dismissedDocIds: new Set(),
      documentId: 'doc-1',
      localUserDeletedSet: null,
    }), { residueIds: [], count: 0 });
    deepStrictEqual(auditResidue({
      cloudAnnotations: [makeCloudAnno('a1', OWNER_ID, 1)],
      viewerId: OWNER_ID,
      isViewerOwner: true,
      dismissedDocIds: new Set(),
      documentId: 'doc-1',
      localUserDeletedSet: [{ id: 'x' }, null],
    }), { residueIds: [], count: 0 });
  },
);
