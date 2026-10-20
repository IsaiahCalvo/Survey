import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTabSource, isCurrentTabSource } from '../tabSourceIdentity.js';
test('a save completion accepts its source or same-version metadata, never a newer SHA',()=>{
 const file={id:'A',contentSha256:'old'};const origin=captureTabSource(file);
 assert.equal(isCurrentTabSource(origin,file),true);
 assert.equal(isCurrentTabSource(origin,{id:'A',content_sha256:'old',name:'Renamed'}),true);
 assert.equal(isCurrentTabSource(origin,{id:'A',contentSha256:'new'}),false);
 assert.equal(isCurrentTabSource(origin,{id:'B',contentSha256:'old'}),false);
 assert.equal(isCurrentTabSource(origin,{id:'A',filePath:'same',size:100}),false);
 file.contentSha256='new';assert.equal(isCurrentTabSource(origin,file),false);
});
test('local immutable Files use exact identity and a closed source rejects completion',()=>{
 const file=new Blob(['A']);const origin=captureTabSource(file);
 assert.equal(isCurrentTabSource(origin,file),true);
 assert.equal(isCurrentTabSource(origin,new Blob(['A'])),false);
 assert.equal(isCurrentTabSource(origin,null),false);
});
