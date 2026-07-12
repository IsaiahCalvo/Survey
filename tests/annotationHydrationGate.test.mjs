import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFirstVisibleAnnotationPage,
  shouldCoverFirstVisibleAnnotationPage,
  shouldGateFirstVisibleAnnotationPage,
} from '../src/utils/annotationHydrationGate.js';

describe('annotation hydration first-paint gate', () => {
  it('does not gate cloud pages while annotations hydrate', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: false, source: 'starting' },
        surveyHydration: { ready: true, source: 'supabase-highlight' },
      }),
      false
    );

    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: true, source: 'ydoc-snapshot' },
        surveyHydration: { ready: false, source: 'supabase-highlight-starting' },
      }),
      false
    );
  });

  it('allows the first visible cloud page after normal annotations are complete', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: true, source: 'ydoc-snapshot' },
        surveyHydration: { ready: true, source: 'supabase-highlight' },
      }),
      false
    );
  });

  it('does not gate offscreen pages, so they can lazy-load after first paint', () => {
    assert.equal(
      shouldGateFirstVisibleAnnotationPage({
        isCloudBackedDocument: true,
        pageNumber: 4,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: false, source: 'starting' },
        surveyHydration: { ready: false, source: 'supabase-highlight-starting' },
      }),
      false
    );
  });

  it('does not visually cover cloud pages while hydration is gated', () => {
    const pendingSources = {
      normalHydration: { ready: false, source: 'starting' },
      surveyHydration: { ready: false, source: 'supabase-highlight-starting' },
    };

    assert.equal(
      shouldCoverFirstVisibleAnnotationPage({
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        ...pendingSources,
      }),
      false
    );

    assert.equal(
      shouldCoverFirstVisibleAnnotationPage({
        isCloudBackedDocument: true,
        pageNumber: 2,
        firstVisiblePageNumber: 1,
        ...pendingSources,
      }),
      false
    );
  });

  it('releases the visual cover when hydration is ready and never covers local PDFs', () => {
    assert.equal(
      shouldCoverFirstVisibleAnnotationPage({
        isCloudBackedDocument: true,
        pageNumber: 1,
        firstVisiblePageNumber: 1,
        normalHydration: { ready: true, source: 'ydoc-snapshot' },
        surveyHydration: { ready: true, source: 'supabase-highlight' },
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

    assert.equal(resolveFirstVisibleAnnotationPage({
      visiblePages: new Set(),
      currentPage: 0,
      fallbackPage: 4,
    }), 4);

    assert.equal(resolveFirstVisibleAnnotationPage({
      visiblePages: null,
      currentPage: 'x',
      fallbackPage: 'y',
    }), 1);
  });
});
