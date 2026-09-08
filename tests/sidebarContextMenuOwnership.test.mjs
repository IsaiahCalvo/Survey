import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('a page behind the sidebar cannot intercept the thumbnail menu at high zoom', () => {
  const source=readFileSync(new URL('../src/utils/contextMenuDiagnostics.js',import.meta.url),'utf8');
  const start=source.indexOf('const captureListener = ');
  const end=source.indexOf('\n  // 2026-04-25 — TWO',start);
  const callback=source.slice(start+'const captureListener = '.length,end).trim().replace(/;$/,'');
  const dom=new JSDOM('<div data-pdf-sidebar="true"><img alt="Page 1"></div><div id="page"></div>');
  try {
    let resolved=0,annotationMenus=0,thumbnailMenus=0;
    const scope={window:dom.window,diag:()=>{},logEvent:()=>{},shortTag:()=>'',CTX_DIAG_BUILD:'test',
      selectionUsesPdfTextLayer:()=>false,resolveAnnotationAt:()=>{resolved++;return {pageNumber:1,kind:'page'};},
      lookupPalHandler:()=>null,listRegistered:()=>[]};
    dom.window.__onAnnotationContextMenu=()=>annotationMenus++;
    const listener=new Function(...Object.keys(scope),`return (${callback});`)(...Object.values(scope));
    dom.window.document.addEventListener('contextmenu',listener,true);
    const image=dom.window.document.querySelector('img');
    image.addEventListener('contextmenu',()=>thumbnailMenus++);
    image.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    assert.equal(thumbnailMenus,1);assert.equal(annotationMenus,0);assert.equal(resolved,0);
    dom.window.document.getElementById('page').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    assert.equal(annotationMenus,1);assert.equal(resolved,1);
    assert.match(readFileSync(new URL('../src/PDFSidebar.jsx',import.meta.url),'utf8'),/data-pdf-sidebar="true"/);
  } finally {dom.window.close();}
});
