import test from 'node:test';
import assert from 'node:assert/strict';
import { getCounterSeriesList, renumberCounters, buildCounterSeriesDeletionUpdates } from '../src/utils/counterNumbering.js';
import { serializePdfCounterMetadata, parsePdfCounterMetadata } from '../src/utils/pdfCounterMetadata.js';
const pin=(id,seriesId,createdAt,seriesName)=>({type:'circle',id,fill:'#ef4444',radius:14,left:20,top:30,data:{type:'counter',id,seriesId,createdAt,seriesName,seriesStart:5}});

test('saved names survive page order and fall back only for unnamed series',()=>{
  const pages={1:{objects:[pin('b','doors',2,'Doors'),pin('x','other',3)]},2:{objects:[pin('a','doors',1,'Doors')]}};
  const before=structuredClone(pages);
  assert.deepEqual(getCounterSeriesList(pages).map(({seriesId,label,count})=>({seriesId,label,count})),[
    {seriesId:'doors',label:'Doors',count:2},{seriesId:'other',label:'Count 2',count:1},
  ]);
  assert.deepEqual(pages,before);
});
test('continuing a named count keeps its numeric sequence independent of other series',()=>{
  const pages={1:{objects:[pin('a','doors',1,'Doors'),pin('x','other',3)]},2:{objects:[pin('b','doors',2,'Doors'),pin('c','doors',4,'Doors')]}};
  renumberCounters(pages);
  const doors=Object.values(pages).flatMap(page=>page.objects).filter(pin=>pin.data.seriesId==='doors');
  assert.deepEqual(doors.sort((a,b)=>a.data.createdAt-b.data.createdAt).map(pin=>pin.data.displayNumber),[5,6,7]);
  assert.equal(getCounterSeriesList(pages).find(series=>series.seriesId==='doors').label,'Doors');
  assert.equal(pages[1].objects[1].data.displayNumber,5);
});
test('deleting a named count plans every affected page and preserves the other count',()=>{
  const pages={1:{objects:[pin('a','doors',1,'Doors'),pin('x','other',3,'Windows')]},2:{objects:[pin('b','doors',2,'Doors')]}};
  const before=structuredClone(pages);
  const plan=buildCounterSeriesDeletionUpdates(pages,'doors');
  assert.equal(plan.removedCount,2);assert.equal(plan.updates.length,2);
  const after={...pages};for(const update of plan.updates)after[update.pageKey]=update.json;
  assert.deepEqual(getCounterSeriesList(after).map(series=>series.label),['Windows']);
  assert.deepEqual(pages,before);
});
test('renamed count identity and name survive the existing PDF metadata contract',()=>{
  const original=pin('a','doors',1,'Doors');
  const metadata=parsePdfCounterMetadata(serializePdfCounterMetadata(original,2));
  assert.equal(metadata.series.name,'Doors');assert.equal(metadata.data.seriesName,'Doors');assert.equal(metadata.series.id,'doors');
});

test('whole-count authority refuses all-locked and mixed locked pins before edits',async()=>{
  const {checkCounterSeriesEdit}=await import('../src/utils/counterSeriesActions.js');
  const authority={viewerId:'author',documentOwnerId:'owner'};
  for(const locked of [[true,true],[false,true]]){
    const pages={1:{objects:[pin('a','doors',1,'Doors')]},2:{objects:[pin('b','doors',2,'Doors')]}};
    Object.values(pages).forEach((page,index)=>{if(locked[index])page.objects[0].data.lockedBy='author';});
    const before=structuredClone(pages);
    assert.deepEqual(checkCounterSeriesEdit(pages,'doors',authority),{ok:false,reason:'locked'});
    assert.deepEqual(pages,before);
  }
});
test('whole-count authority checks current identity and current lock state on every call',async()=>{
  const {checkCounterSeriesEdit}=await import('../src/utils/counterSeriesActions.js');
  const pages={1:{objects:[pin('a','doors',1,'Doors')]}};
  assert.deepEqual(checkCounterSeriesEdit(pages,'doors',{viewerId:'author',documentOwnerId:'owner'}),{ok:true});
  pages[1].objects[0].data.lockedBy='author';
  assert.deepEqual(checkCounterSeriesEdit(pages,'doors',{viewerId:'author',documentOwnerId:'owner'}),{ok:false,reason:'locked'});
  delete pages[1].objects[0].data.lockedBy;
  assert.deepEqual(checkCounterSeriesEdit(pages,'doors',{viewerId:null,documentOwnerId:'owner'}),{ok:false,reason:'forbidden'});
});
