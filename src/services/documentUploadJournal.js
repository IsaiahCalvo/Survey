// Recovery data, not a cache: no network, eviction, or memory-only fallback.
export const DOCUMENT_UPLOAD_JOURNAL_DB_NAME = 'survey-document-upload-journal-v1';
const ATTEMPTS = 'attempts', FILES = 'files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const PHASES = ['ready', 'running', 'document-confirmed', 'archive-confirmed', 'complete'];
const INPUT_KEYS = ['id','documentId','projectId','name','size','type','lastModified','contentSha','filePath','archiveDocument'];
const SNAPSHOT_KEYS = ['id','user_id','project_id','name','file_path','file_size','content_sha256','updated_at','archived','user_archived_at'];
const nativeSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
const nativeType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get;
const nativeSlice = Blob.prototype.slice;
const fail = (code, message) => Object.assign(new Error(message), { name: 'DocumentUploadJournalError', code });
const check = (condition, message) => { if (!condition) throw fail('invalid-input', message); };
const id = value => check(typeof value === 'string' && UUID.test(value), 'A lowercase UUID is required.');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, max=1024) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const date = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const keys = (value, allowed) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported metadata fields.');
const errorText = value => check(value === null || (typeof value === 'string' && value.length <= 4096), 'Invalid error text.');
const alias = value => check(value === null || (text(value) && !/[\\/]/.test(value)), 'Invalid alias name.');
function ownedPath(value, actorId) {
  check(text(value,2048) && value.startsWith(`${actorId}/`) && !/[\\%?#]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..'), 'The file path must belong to this actor.');
}
function snapshot(value, row, target=false) {
  keys(value, target ? [...SNAPSHOT_KEYS,'page_count','name_aliases','created_at'] : SNAPSHOT_KEYS);
  id(value.id); id(value.user_id); if(value.project_id !== null) id(value.project_id);
  check(value.user_id === row.actorId && value.project_id === row.projectId, 'The document must belong to this actor and project.');
  check(text(value.name) && (target ? typeof value.archived === 'boolean' : value.archived === false)
    && value.user_archived_at === null, 'The document must not be user archived.');
  ownedPath(value.file_path,row.actorId);
  check(value.file_size === null || integer(value.file_size), 'Invalid stored document size.');
  check(value.content_sha256 === null || (typeof value.content_sha256 === 'string' && HASH.test(value.content_sha256)), 'Invalid stored document hash.');
  check(value.updated_at === null || date(value.updated_at), 'Invalid document update timestamp.');
  if(target) {
    // Existing published PDFs may have been edited since their original hash.
    // Bind the row identity without imposing the incoming PDF's byte size.
    check(value.content_sha256 === row.contentSha, 'The target hash must match this import.');
    if('page_count' in value) check(value.page_count === null || (integer(value.page_count) && value.page_count > 0), 'Invalid page count.');
    if('name_aliases' in value) check(value.name_aliases === null || (Array.isArray(value.name_aliases) && value.name_aliases.length <= 10_000 && value.name_aliases.every(name => text(name))), 'Invalid name aliases.');
    if('created_at' in value) check(value.created_at === null || date(value.created_at), 'Invalid creation timestamp.');
  } else check(value.id !== row.documentId, 'The archived row cannot be the new candidate.');
  return value;
}
function validate(row, actorId, attemptId) {
  try {
    keys(row,[...INPUT_KEYS,'actorId','version','revision','phase','target','aliasName','aliasDecided','error','createdAt','updatedAt']);
    check(row.actorId === actorId && row.id === attemptId && row.version === 1, 'Invalid attempt identity or version.');
    id(row.actorId); id(row.id); id(row.documentId); if(row.projectId !== null) id(row.projectId);
    check(integer(row.revision) && row.revision > 0 && date(row.createdAt) && date(row.updatedAt), 'Invalid revision or timestamps.');
    check(text(row.name) && !/[\\/]/.test(row.name) && integer(row.size) && row.size > 0 && integer(row.lastModified), 'Invalid file metadata.');
    check(row.type === 'application/pdf' || row.type === '', 'Only PDF files can be staged.');
    check(typeof row.contentSha === 'string' && HASH.test(row.contentSha), 'Invalid file hash.');
    check(row.filePath === `${actorId}/${row.documentId}/${row.contentSha}.pdf`, 'Invalid document-scoped content-addressed path.');
    check(PHASES.includes(row.phase) && typeof row.aliasDecided === 'boolean', 'Invalid upload phase or alias decision.');
    alias(row.aliasName); errorText(row.error);
    if(row.archiveDocument !== null) snapshot(row.archiveDocument,row);
    if(row.target !== null) snapshot(row.target,row,true);
    if(PHASES.indexOf(row.phase) >= PHASES.indexOf('document-confirmed')) check(row.target !== null, 'A confirmed document target is required.');
    if(row.phase === 'complete') check(row.aliasDecided, 'The alias choice has not been confirmed.');
    check(new TextEncoder().encode(JSON.stringify(row)).byteLength <= 1024*1024, 'Upload metadata is too large.');
  } catch(error) { throw fail('corrupt',error.message); }
  return row;
}
function notify() {
  try { if(typeof window !== 'undefined') window.dispatchEvent(new window.Event('document-upload-journal-changed')); }
  catch { /* A UI event cannot undo a committed write. */ }
}

export function createDocumentUploadJournal({ indexedDB, dbName=DOCUMENT_UPLOAD_JOURNAL_DB_NAME, timeoutMs=10_000 }={}) {
  check(text(dbName) && integer(timeoutMs) && timeoutMs > 0, 'Invalid journal options.');
  let connection=null, opening=null, cancelOpen=null, closed=false;
  const transactions=new Set();
  const active=()=>{ if(closed) throw fail('closed','The upload journal is closed.'); };
  async function database() {
    active(); if(connection) return connection; if(opening) return opening;
    opening=new Promise((resolve,reject)=>{
      let request,settled=false;
      const finish=(error,db)=>{
        if(settled) { db?.close(); return; }
        settled=true; clearTimeout(timer); cancelOpen=null;
        if(error) reject(error); else resolve(db);
      };
      const timer=setTimeout(()=>finish(fail('timed-out','Opening the upload journal timed out.')),timeoutMs);
      cancelOpen=()=>{ try { request?.transaction?.abort(); } catch { /* settled */ } finish(fail('closed','The upload journal is closed.')); };
      try {
        const factory=indexedDB === undefined ? globalThis.indexedDB : indexedDB;
        if(!factory?.open) throw fail('unavailable','Durable upload storage is unavailable.');
        request=factory.open(dbName,1);
      } catch(error) { finish(error); return; }
      request.onupgradeneeded=event=>{
        if(settled || closed) { request.transaction.abort(); return; }
        try {
          if(event.oldVersion !== 0) throw fail('schema','Unsupported upload journal schema.');
          request.result.createObjectStore(ATTEMPTS,{keyPath:['actorId','id']}).createIndex('actorId','actorId');
          request.result.createObjectStore(FILES,{keyPath:['actorId','id']});
        } catch(error) { request.transaction.abort(); finish(error); }
      };
      request.onblocked=()=>finish(fail('blocked','The upload journal is blocked by another window.'));
      request.onerror=()=>finish(request.error || fail('unavailable','The upload journal could not be opened.'));
      request.onsuccess=()=>{
        const db=request.result;
        if(settled || closed) { db.close(); finish(fail('closed','The upload journal is closed.')); return; }
        try {
          const tx=db.transaction([ATTEMPTS,FILES],'readonly');
          const metadata=tx.objectStore(ATTEMPTS),bytes=tx.objectStore(FILES);
          if(JSON.stringify(metadata.keyPath) !== JSON.stringify(['actorId','id']) || JSON.stringify(bytes.keyPath) !== JSON.stringify(['actorId','id'])
            || metadata.index('actorId').keyPath !== 'actorId' || metadata.index('actorId').unique) throw fail('schema','Invalid upload journal schema.');
        } catch(error) { db.close(); finish(fail('schema',error.message)); return; }
        connection=db;
        db.onversionchange=()=>{ db.close(); if(connection === db) connection=null; };
        db.onclose=()=>{ if(connection === db) connection=null; };
        finish(null,db);
      };
    }).finally(()=>{ opening=null; });
    return opening;
  }
  async function transact(names,mode,run) {
    const db=await database(); active();
    return new Promise((resolve,reject)=>{
      let tx,result,cause,settled=false;
      try { tx=db.transaction(names,mode); } catch(error) { reject(error); return; }
      const finish=error=>{
        if(settled) return;
        settled=true; clearTimeout(timer); transactions.delete(abort);
        if(error) reject(error); else { if(mode === 'readwrite') notify(); resolve(result); }
      };
      const abort=error=>{ cause ||= error; try { tx.abort(); } catch { /* settled */ } finish(cause); };
      const timer=setTimeout(()=>abort(fail('timed-out','The upload journal operation timed out. Check its recovery state before retrying.')),timeoutMs);
      transactions.add(abort);
      tx.oncomplete=()=>finish();
      tx.onabort=()=>finish(cause || tx.error || fail('aborted','The upload journal operation did not commit.'));
      tx.onerror=event=>{ cause ||= event.target?.error || tx.error; };
      try { run(tx,value=>{ result=value; },abort); } catch(error) { abort(error); }
    });
  }
  function mutate(actorId,attemptId,names,change) {
    id(actorId); id(attemptId);
    return transact(names,'readwrite',(tx,done,abort)=>{
      const store=tx.objectStore(ATTEMPTS),request=store.get([actorId,attemptId]);
      request.onsuccess=()=>{ try {
        if(!request.result) throw fail('not-found','This upload attempt was not found for this actor.');
        const row=validate(request.result,actorId,attemptId),next=change(row,tx);
        if(next === null) { done(true); return; }
        next.revision++; next.updatedAt=new Date().toISOString(); validate(next,actorId,attemptId); store.put(next); done(next);
      } catch(error) { abort(error); } };
    });
  }
  const remove=(actorId,attemptId,requireComplete)=>mutate(actorId,attemptId,[ATTEMPTS,FILES],(row,tx)=>{
    if(requireComplete && row.phase !== 'complete') throw fail('incomplete','The upload has not been confirmed. Its recovery data was kept.');
    tx.objectStore(FILES).delete([actorId,attemptId]); tx.objectStore(ATTEMPTS).delete([actorId,attemptId]); return null;
  });
  return {
    async create(actorId,input,blob) {
      id(actorId); keys(input,INPUT_KEYS);
      // The caller passes the owned PDF prepared for hashing. Capture native
      // Blob metadata and all input state before opening storage or yielding.
      const captured=structuredClone(input),size=nativeSize.call(blob),type=nativeType.call(blob);
      check(size === captured.size && type === captured.type,'The staged PDF does not match its size or type.');
      const bytes=nativeSlice.call(blob,0,size,type),now=new Date().toISOString();
      const row={...captured,actorId,version:1,revision:1,phase:'ready',target:null,aliasName:null,aliasDecided:false,error:null,createdAt:now,updatedAt:now};
      validate(row,actorId,row.id);
      return transact([ATTEMPTS,FILES],'readwrite',(tx,done)=>{
        tx.objectStore(FILES).add({actorId,id:row.id,blob:bytes}); tx.objectStore(ATTEMPTS).add(row); done(row);
      });
    },
    async get(actorId,attemptId) {
      id(actorId); id(attemptId);
      return transact([ATTEMPTS],'readonly',(tx,done,abort)=>{
        const request=tx.objectStore(ATTEMPTS).get([actorId,attemptId]);
        request.onsuccess=()=>{ try { done(request.result ? validate(request.result,actorId,attemptId) : null); } catch(error) { abort(error); } };
      });
    },
    async list(actorId) {
      id(actorId);
      return transact([ATTEMPTS],'readonly',(tx,done,abort)=>{
        const request=tx.objectStore(ATTEMPTS).index('actorId').getAll(actorId);
        request.onsuccess=()=>{ try { done(request.result.map(row=>validate(row,actorId,row.id)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))); } catch(error) { abort(error); } };
      });
    },
    async readFile(actorId,attemptId) {
      id(actorId); id(attemptId);
      return transact([ATTEMPTS,FILES],'readonly',(tx,done,abort)=>{
        const metadata=tx.objectStore(ATTEMPTS).get([actorId,attemptId]);
        metadata.onsuccess=()=>{ try {
          if(!metadata.result) { done(null); return; }
          const row=validate(metadata.result,actorId,attemptId),request=tx.objectStore(FILES).get([actorId,attemptId]);
          request.onsuccess=()=>{ try {
            const stored=request.result;
            check(stored?.actorId === actorId && stored.id === attemptId,'Missing staged bytes.');
            check(nativeSize.call(stored.blob) === row.size && nativeType.call(stored.blob) === row.type,'Invalid staged bytes.');
            done(stored.blob);
          } catch(error) { abort(fail('corrupt',error.message)); } };
        } catch(error) { abort(error); } };
      });
    },
    async patch(actorId,attemptId,patch) {
      keys(patch,['phase','target','aliasName','aliasDecided','error']); const captured=structuredClone(patch);
      return mutate(actorId,attemptId,[ATTEMPTS],row=>{
        if('phase' in captured) {
          check(PHASES.includes(captured.phase) && PHASES.indexOf(captured.phase) >= PHASES.indexOf(row.phase),'Invalid upload phase transition.');
          if(captured.phase === 'complete') check(row.phase === 'archive-confirmed' || row.phase === 'complete','Archive confirmation must precede completion.');
        }
        if('target' in captured) {
          check(captured.target !== null,'A target binding cannot be cleared.'); snapshot(captured.target,row,true);
          if(row.target) for(const field of ['id','user_id','project_id','file_path','content_sha256']) check(captured.target[field] === row.target[field],'The confirmed document target cannot change.');
        }
        if('aliasDecided' in captured) check(typeof captured.aliasDecided === 'boolean' && !(row.aliasDecided && !captured.aliasDecided),'An alias decision cannot be reset.');
        if('aliasName' in captured) { alias(captured.aliasName); check(!row.aliasDecided || captured.aliasName === row.aliasName,'The decided alias cannot change.'); }
        if('error' in captured) errorText(captured.error);
        Object.assign(row,captured); return row;
      });
    },
    finish:(actorId,attemptId)=>remove(actorId,attemptId,true),
    discard:(actorId,attemptId)=>remove(actorId,attemptId,false),
    close() {
      closed=true; cancelOpen?.(); for(const abort of transactions) abort(fail('closed','The upload journal closed before this operation committed.'));
      connection?.close(); connection=null;
    },
  };
}
let defaultJournal;
export function getDocumentUploadJournal() { return defaultJournal ||= createDocumentUploadJournal(); }
