import json, os, gzip, subprocess, sys, time
SP = os.environ['SP']; BK = os.environ['BK']
OUT = BK + '/step3-kal266-deleted-annotation-rows.ndjson.gz'
BATCH = int(os.environ.get('BATCH', '750'))
def q(sql):
    for attempt in range(4):
        p = subprocess.run([SP+'/q.sh', sql], capture_output=True, text=True, timeout=300)
        try:
            return json.loads(p.stdout)
        except Exception:
            if attempt == 3:
                raise RuntimeError('query failed: ' + p.stdout[:400])
            time.sleep(3)
last = '00000000-0000-0000-0000-000000000000'
n = 0
with gzip.open(OUT, 'wt') as fh:
    while True:
        sql = ("select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) rows from "
               "(select * from public.kal266_backup_deleted_2026_08_19 where id > '%s'::uuid order by id limit %d) t" % (last, BATCH))
        rows = q(sql)[0]['rows']
        if not rows: break
        for r in rows:
            fh.write(json.dumps(r, separators=(',',':'), sort_keys=True) + '\n')
        n += len(rows); last = rows[-1]['id']
        print('%d rows (last %s)' % (n, last), flush=True)
print('EXPORT DONE rows=%d file=%s bytes=%d' % (n, OUT, os.path.getsize(OUT)))
