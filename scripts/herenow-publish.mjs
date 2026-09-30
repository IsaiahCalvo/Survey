import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const API='https://here.now/api/v1'; const H={'X-HereNow-Client':'claude-code/desktop','content-type':'application/json'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.wasm':'application/wasm','.txt':'text/plain','.md':'text/markdown','.woff2':'font/woff2','.woff':'font/woff','.traineddata':'application/octet-stream','.gz':'application/gzip','.pdf':'application/pdf','.map':'application/json','.webp':'image/webp','.jpg':'image/jpeg'};
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const files=walk(dir).map(f=>({abs:f,path:path.relative(dir,f).split(path.sep).join('/'),size:fs.statSync(f).size,contentType:types[path.extname(f).toLowerCase()]||'application/octet-stream'}));
const r=await fetch(API+'/publish',{method:'POST',headers:H,body:JSON.stringify({files:files.map(({path,size,contentType})=>({path,size,contentType}))})});
const j=await r.json(); if(!r.ok){console.error('create failed',r.status,JSON.stringify(j).slice(0,500));process.exit(1)}
const ups=j.upload?.uploads||[]; console.error('slug',j.slug,'uploads',ups.length,'files',files.length);
let i=0; for(const u of ups){const f=files.find(x=>x.path===u.path)||files[i]; i++; const pr=await fetch(u.url,{method:u.method||'PUT',headers:{'Content-Type':f.contentType,...(u.headers||{})},body:fs.readFileSync(f.abs)}); if(!pr.ok){console.error('upload fail',f.path,pr.status,(await pr.text()).slice(0,200));process.exit(1)}}
const fin=await fetch(`${API}/publish/${j.slug}/finalize`,{method:'POST',headers:H,body:JSON.stringify({versionId:j.upload.versionId})}); const fj=await fin.json(); if(!fin.ok){console.error('finalize fail',fin.status,JSON.stringify(fj).slice(0,400));process.exit(1)}
const m=await fetch(`${API}/publish/${j.slug}/metadata`,{method:'PATCH',headers:{...H,...(j.claimToken?{authorization:'Bearer '+j.claimToken}:{})},body:JSON.stringify({spa:true})}); console.error('spa',m.status,(await m.text()).slice(0,200));
console.log(JSON.stringify({siteUrl:fj.siteUrl,claimUrl:fj.claimUrl,slug:j.slug,expires:fj.expiresAt||j.expiresAt}));
