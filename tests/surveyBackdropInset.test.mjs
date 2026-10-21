import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applySurveyBackdropInset,
  SURVEY_STRIP_SELECTOR,
  watchSurveyBackdropInset,
} from '../src/mobile/surveyBackdropInset.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const fakeStrip = (bottom) => ({
  getBoundingClientRect: () => ({ bottom }),
});

test('applySurveyBackdropInset uses the strip bottom and clears when it is missing', () => {
  const el = { style: { top: '10px' } };
  const root = {
    querySelector: (sel) => (sel === SURVEY_STRIP_SELECTOR ? null : null),
  };

  applySurveyBackdropInset(el, root);
  assert.equal(el.style.top, '');

  root.querySelector = (sel) => (
    sel === SURVEY_STRIP_SELECTOR ? fakeStrip(118.4) : null
  );
  applySurveyBackdropInset(el, root);
  assert.equal(el.style.top, '118px');
});

test('watchSurveyBackdropInset remeasures when the strip appears later', () => {
  const el = { style: { top: '' } };
  let listener = null;
  let hasStrip = false;
  const strip = fakeStrip(90);
  const root = {
    querySelector: (sel) => {
      if (sel === SURVEY_STRIP_SELECTOR) return hasStrip ? strip : null;
      return null;
    },
  };
  const view = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const stop = watchSurveyBackdropInset(el, {
    root,
    view,
    subscribeOverlays: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
  });

  assert.equal(el.style.top, '', 'first measure misses a strip that is not committed yet');
  hasStrip = true;
  listener();
  assert.equal(el.style.top, '90px', 'overlay notify remeasures once the strip mounts');
  stop();
});

test('watchSurveyBackdropInset remeasures on resize and header/strip box changes', () => {
  const el = { style: { top: '' } };
  let bottom = 80;
  const strip = fakeStrip(80);
  strip.getBoundingClientRect = () => ({ bottom });
  const header = {};
  const observed = [];
  const listeners = [];
  const root = {
    querySelector: (sel) => {
      if (sel === SURVEY_STRIP_SELECTOR) return strip;
      if (sel === '.mobile-pdf-header') return header;
      return null;
    },
  };
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; }
    observe(node) { observed.push(node); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
  }
  const view = {
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    addEventListener: (type, fn) => { listeners.push({ type, fn }); },
    removeEventListener: () => {},
  };

  const stop = watchSurveyBackdropInset(el, {
    root,
    view,
    subscribeOverlays: () => () => {},
  });

  assert.equal(el.style.top, '80px');
  assert.ok(observed.includes(header), 'header is observed so a safe-area move remeasures');
  assert.ok(observed.includes(strip), 'strip is observed so its later layout remeasures');

  bottom = 124.6;
  const resize = listeners.find((entry) => entry.type === 'resize');
  assert.ok(resize, 'window resize remeasures (orientation)');
  resize.fn();
  assert.equal(el.style.top, '125px');
  stop();
});

test('the survey sheet backdrop watches the live strip instead of a one-shot query', () => {
  const rail = read('../src/SurveySpacesRail.jsx');
  assert.match(rail, /watchSurveyBackdropInset\(surveyBackdropRef\.current, \{\s*subscribeOverlays: subscribeViewerTopOverlays,/);
  assert.match(rail, /ref=\{surveyBackdropRef\}/);
  assert.doesNotMatch(
    rail,
    /ref=\{\(el\) => \{\s*if \(!el\) return;\s*const strip = document\.querySelector\('\.mobile-pdf-properties--survey'\)/,
  );
});
