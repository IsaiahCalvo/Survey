import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageMutationBytes,isSamePageMutationVersion} from '../src/utils/pageMutationSource.js';

test('a cloud descriptor resolves through its adapter without changing its metadata',async()=>{
  const source={id:'doc',filePath:'owner/doc.pdf'},before={...source};const shared=new Uint8Array([1,2,3]).buffer;
  const bytes=await readPageMutationBytes(source,async file=>{assert.equal(file,source);return shared;});
  assert.deepEqual(new Uint8Array(bytes),new Uint8Array([1,2,3]));assert.notEqual(bytes,shared);new Uint8Array(bytes)[0]=9;assert.equal(new Uint8Array(shared)[0],1);assert.deepEqual(source,before);
});
test('native Files and Blob adapters resolve; an offset view excludes unrelated backing bytes',async()=>{
  const native=new File([new Uint8Array([2,3])],'fixture.pdf');assert.deepEqual([...new Uint8Array(await readPageMutationBytes(native,()=>{throw Error('do not re-download');}))],[2,3]);
  assert.deepEqual([...new Uint8Array(await readPageMutationBytes({},async()=>new Blob([new Uint8Array([4,5])])) )],[4,5]);
  assert.deepEqual([...new Uint8Array(await readPageMutationBytes({},async()=>new Uint8Array(new Uint8Array([9,6,7,9]).buffer,1,2)))],[6,7]);
});
test('unresolved descriptor reports a clear source error',async()=>{
  await assert.rejects(readPageMutationBytes({filePath:'missing.pdf'}),/source bytes are not available/);
  await assert.rejects(readPageMutationBytes({},async()=>null),/source bytes are not available/);
});
test('only same-document, same-version metadata refresh keeps the opened baseline',()=>{
  const saved={id:'a',contentSha256:'new-sha',filePath:'old-path',size:100};
  assert.equal(isSamePageMutationVersion(saved,{...saved,filePath:'moved-path',name:'New title'}),true);
  assert.equal(isSamePageMutationVersion(saved,{...saved,contentSha256:'remote-new-sha'}),false);
  assert.equal(isSamePageMutationVersion(saved,{...saved,id:'other'}),false);
  assert.equal(isSamePageMutationVersion(saved,{...saved,contentSha256:null}),false);
  assert.equal(isSamePageMutationVersion({id:'a',filePath:'same',size:100},{id:'a',filePath:'same',size:100}),false);
  assert.equal(isSamePageMutationVersion(saved,{id:'a',content_sha256:'new-sha'}),true);
  assert.equal(isSamePageMutationVersion({id:'a',filePath:'same',size:100},{id:'a',filePath:'same',size:101}),false);
});
