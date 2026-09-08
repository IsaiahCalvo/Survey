import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { guardLocalPageMutation } from '../src/services/localPageMutationGuard.js';

test('local page commit blocks input and restores interaction after success and failure', async () => {
  const dom = new JSDOM('<!doctype html><button>Save</button>');
  try {
    for (const fail of [false, true]) {
      const document=dom.window.document, pendingRef={current:false};
      let release; const wait=new Promise(resolve=>{release=resolve;});
      const action=guardLocalPageMutation({document,pendingRef,flush:fn=>fn(),run:async()=>{await wait;if(fail)throw new Error('quota');return true;}});
      assert.equal(pendingRef.current,true);assert.equal(document.documentElement.inert,true);
      const key=new dom.window.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true});
      assert.equal(document.querySelector('button').dispatchEvent(key),false);
      await assert.rejects(guardLocalPageMutation({document,pendingRef,flush:fn=>fn(),run:()=>{throw new Error('must not start');}}),/already running/);
      release();if(fail)await assert.rejects(action,/quota/);else assert.equal(await action,true);
      assert.equal(pendingRef.current,false);assert.equal(document.documentElement.inert,false);
      assert.equal(document.documentElement.hasAttribute('aria-busy'),false);
      assert.equal(document.querySelector('button').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})),true);
    }
  } finally {dom.window.close();}
});
test('a native close freeze or live text edit cannot be replaced by a local page guard', async () => {
  const dom=new JSDOM('<!doctype html><div data-text-edit-overlay></div>');
  try {
    const document=dom.window.document,pendingRef={current:false};
    const options={document,pendingRef,flush:fn=>fn(),run:()=>{throw new Error('must not run');}};
    await assert.rejects(guardLocalPageMutation(options),/Finish editing text/);
    document.documentElement.inert=true;
    await assert.rejects(guardLocalPageMutation(options),/already running/);
    assert.equal(document.documentElement.inert,true);assert.equal(pendingRef.current,false);
  } finally {dom.window.close();}
});
