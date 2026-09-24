import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFirstVisibleAnnotationPage,
  shouldCoverFirstVisibleAnnotationPage,
  shouldGateFirstVisibleAnnotationPage,
} from '../src/utils/annotationHydrationGate.js';

describe('annotation hydration first-paint gate', () => {
  it('keeps the first visible cloud page gated until normal and survey sources are ready', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        documentId: 'doc-1',
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: false, source: 'starting', documentId: 'doc-1' },
        surveyHydration: { ready: true, source: 'supabase-highlight', documentId: 'doc-1' },
      }),
      true
    );

    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        documentId: 'doc-1',
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: true, source: 'ydoc-snapshot', documentId: 'doc-1' },
        surveyHydration: { ready: false, source: 'supabase-highlight-starting', documentId: 'doc-1' },
      }),
      true
    );
  });

  it('allows the first visible cloud page after normal annotations are complete', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        documentId: 'doc-1',
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: true, source: 'ydoc-snapshot', documentId: 'doc-1' },
        surveyHydration: { ready: true, source: 'supabase-highlight', documentId: 'doc-1' },
      }),
      false
    );
  });

  it('does not gate offscreen pages, so they can lazy-load after first paint', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        documentId: 'doc-1',
        isCloudBackedDocument: true,
        pageNumber: 4,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: false, source: 'starting', documentId: 'doc-1' },
        surveyHydration: { ready: false, source: 'supabase-highlight-starting', documentId: 'doc-1' },
      }),
      false
    );
  });

  it('visually covers only the first visible cloud page while hydration is gated', () => {
    const pendingSources = {
      normalHydration: { ready: false, source: 'starting', documentId: 'doc-1' },
      surveyHydration: { ready: false, source: 'supabase-highlight-starting', documentId: 'doc-1' },
    };

    assert.equal(
      shouldCoverFirstVisibleAnnotationPage({
        documentId: 'doc-1',
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        ...pendingSources,
      }),
      true
    );

    assert.equal(
      shouldCoverFirstVisibleAnnotationPage({
        documentId: 'doc-1',
        isCloudBackedDocument: true,
        pageNumber: 2,
        firstVisiblePageNumber: 1,
        ...pendingSources,
      }),
      false
    );
  });

  it('does not reuse the previous document readiness during a cloud document switch', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        documentId: 'next-document',
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: {
          ready: true,
          source: 'annotation-doc',
          documentId: 'previous-document',
        },
        surveyHydration: {
          ready: true,
          source: 'annotation-doc',
          documentId: 'previous-document',
        },
      }),
      true
    );
  });

  it('releases the visual cover when hydration is ready and never covers local PDFs', () => {
    assert.equal(
      shouldCoverFirstVisibleAnnotationPage({
        documentId: 'doc-1',
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: true, source: 'ydoc-snapshot', documentId: 'doc-1' },
        surveyHydration: { ready: true, source: 'supabase-highlight', documentId: 'doc-1' },
      }),
      false
    );

    assert.equal(
      shouldCoverFirstVisibleAnnotationPage({
        isCloudBackedDocument: false,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: false, source: 'starting' },
        surveyHydration: { ready: false, source: 'supabase-highlight-starting' },
      }),
      false
    );
  });

  it('resolves the first visible page from the visible set before falling back to current page', () => {
    assert.equal(resolveFirstVisibleAnnotationPage({
      visiblePages: new Set([5, 3]),
      currentPage: 7,
    }), 3);

    assert.equal(resolveFirstVisibleAnnotationPage({
      visiblePages: new Set(),
      currentPage: 7,
    }), 7);
  });
});

// w26 (2026-09-24): a document whose marks cannot be read (the WAL tail read
// timed out) must still show its PDF instead of loading dots forever.
describe('annotation store unavailable', () => {
  const unavailable = { ready: false, source: 'unavailable', documentId: 'doc-1', error: 'tail read: timeout' };
  const survey = { ready: true, source: 'annotation-doc', documentId: 'doc-1' };
  it('uncovers the first page while the store is unavailable for this document', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        documentId: 'doc-1', isCloudBackedDocument: true, pageNumber: 1, firstVisiblePageNumber: 1,
        normalHydration: unavailable, surveyHydration: survey,
      }),
      false,
    );
  });
  it('an unavailable state left over from another document never uncovers this one', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        documentId: 'doc-2', isCloudBackedDocument: true, pageNumber: 1, firstVisiblePageNumber: 1,
        normalHydration: unavailable, surveyHydration: { ...survey, documentId: 'doc-2' },
      }),
      true,
    );
  });
});
