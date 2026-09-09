// Keep the current whole-library hook contract without silently losing rows
// at PostgREST's response cap. 500 stays below this project's max_rows=1000.
// Seek by a unique, immutable key; sort for display only after the full read.
export const LIBRARY_PAGE_SIZE = 500;
export const LIBRARY_ID_CHUNK_SIZE = 100;

const limitError = () => Object.assign(new Error('The complete library exceeds this read limit. Narrow the project scope and retry.'), { code: 'LIBRARY_READ_LIMIT' });
const abortError = () => Object.assign(new Error('The complete library read was canceled or timed out. Retry to refresh it.'), { code: 'LIBRARY_READ_ABORTED' });

function createReadBudget({ cursorColumn = 'id', pageSize = LIBRARY_PAGE_SIZE, signal,
  timeoutMs = 60000, maxPages = 1000, maxRows = 200000, maxBytes = 64 * 1024 * 1024 } = {}) {
  for (const [label,value,max] of [['page size',pageSize,1000],['timeout',timeoutMs,120000],
    ['page limit',maxPages,10000],['row limit',maxRows,1000000],['byte limit',maxBytes,256*1024*1024]]) {
    if (!Number.isSafeInteger(value) || value<1 || value>max) throw new TypeError(`Invalid library ${label}`);
  }
  if (typeof cursorColumn!=='string' || !/^[a-z_][a-z0-9_]*$/i.test(cursorColumn)) throw new TypeError('Invalid library cursor column');
  if (signal != null && (typeof signal.aborted!=='boolean' || typeof signal.addEventListener!=='function'
    || typeof signal.removeEventListener!=='function')) throw new TypeError('Invalid library abort signal');
  const controller = new AbortController(), deadline = performance.now()+timeoutMs;
  const encoder = new TextEncoder();
  let pages=0, count=0, bytes=0;
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort,timeoutMs);
  const check = () => { if (controller.signal.aborted || performance.now()>=deadline) throw abortError(); };
  return {
    cursorColumn,pageSize,maxRows,check,
    async request(createQuery) {
      check(); if (++pages>maxPages) throw limitError();
      // An SDK promise may ignore abort. Settle our caller anyway and discard
      // late values; forward the signal when the query supports cancellation.
      return new Promise((resolve,reject) => {
        let settled=false;
        const finish=(callback,value)=>{if(settled)return;settled=true;controller.signal.removeEventListener('abort',onAbort);callback(value);};
        const onAbort=()=>finish(reject,abortError());
        controller.signal.addEventListener('abort',onAbort,{once:true});
        Promise.resolve().then(()=>{
          check(); let query=createQuery(); check();
          if(typeof query?.abortSignal==='function') query=query.abortSignal(controller.signal);
          return query;
        }).then(value=>{try{check();finish(resolve,value);}catch(error){finish(reject,error);}},error=>finish(reject,error));
      });
    },
    accept(batch) {
      check(); if (count+batch.length>maxRows) throw limitError();
      // Supabase has already parsed this page. Bound retained data, not the
      // provider's earlier response-body allocation. Include every page's JSON.
      const encoded=JSON.stringify(batch);
      // UTF-8 cannot be smaller than this JSON string's UTF-16 length. Reject
      // before allocating a second oversized buffer, and reuse one encoder.
      if(encoded.length>maxBytes-bytes) throw limitError();
      bytes+=encoder.encode(encoded).byteLength;
      if(bytes>maxBytes) throw limitError();
      count+=batch.length; check();
    },
    dispose(){clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();},
  };
}

async function readRowsWithinBudget(createQuery,budget) {
  const {cursorColumn,pageSize}=budget;
  const rows = [];
  let cursor = null;
  for (;;) {
    const {data,error} = await budget.request(()=>{
      let query = createQuery().order(cursorColumn, { ascending: true }).limit(pageSize);
      if (cursor !== null) query = query.gt(cursorColumn, cursor);
      return query;
    });
      if (error) throw error;
      const batch = data ?? [];
      if (!Array.isArray(batch) || batch.length>pageSize) throw new TypeError('Invalid library page');
      // A broken cursor must fail visibly, not loop forever or duplicate rows.
      for (const row of batch) {
        const next = row?.[cursorColumn];
        if (typeof next !== 'string' || !next || (cursor !== null && next <= cursor)) {
          throw new Error('Library cursor did not advance');
        }
        cursor = next;
      }
      budget.accept(batch);
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
  }
}

export async function readLibraryRows(createQuery,options={}) {
  const budget=createReadBudget(options);
  try {
    const data=await readRowsWithinBudget(createQuery,budget);
    budget.check();
    return {data,error:null};
  }
  catch(error) { return {data:null,error}; }
  finally { budget.dispose(); }
}

// Keep UUID lists well below proxy URL limits. Chunks run in order, bounding
// outstanding reads; a failure never publishes a misleading partial library.
export async function readLibraryIdChunks(ids, createQuery,options={}) {
  const budget=createReadBudget(options);
  try {
    if(!Array.isArray(ids)) throw new TypeError('Invalid library IDs');
    const unique=new Set();
    for(const id of ids) {
      budget.check();
      if(typeof id!=='string' || !id) throw new TypeError('Invalid library ID');
      unique.add(id); if(unique.size>budget.maxRows) throw limitError();
    }
    const uniqueIds=[...unique],rows=[];
    for(let start=0;start<uniqueIds.length;start+=LIBRARY_ID_CHUNK_SIZE) {
      const chunk=uniqueIds.slice(start,start+LIBRARY_ID_CHUNK_SIZE),allowed=new Set(chunk);
      const batch=await readRowsWithinBudget(()=>createQuery(chunk),budget);
      for(const row of batch) {
        if(!allowed.has(row[budget.cursorColumn])) throw new TypeError('Invalid library chunk result');
        rows.push(row);
      }
    }
    budget.check(); return {data:rows,error:null};
  } catch(error) { return {data:null,error}; }
  finally { budget.dispose(); }
}

export function sortLibraryRows(rows, timestamp) {
  return [...rows].sort((a, b) => (Date.parse(b[timestamp]) || 0) - (Date.parse(a[timestamp]) || 0)
    || String(a.id).localeCompare(String(b.id)));
}
