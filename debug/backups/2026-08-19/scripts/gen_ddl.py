import json, re, os
def q(n): return '"'+n.replace('"','""')+'"'
rows = json.load(open(os.environ['SP']+'/ddl.json'))
out = {}
for r in rows:
    t = r['table_name']; stmts = []
    # sequences referenced by defaults
    seqs = set()
    for c in r['columns'] or []:
        d = c.get('default') or ''
        m = re.search(r"nextval\('([^']+)'", d)
        if m: seqs.add(m.group(1).replace('::regclass','').strip('"'))
    for s in sorted(seqs):
        stmts.append(f"CREATE SEQUENCE IF NOT EXISTS public.{s};")
    cols = []
    for c in r['columns']:
        line = f"  {q(c['column'])} {c['type']}"
        if c.get('default') is not None: line += f" DEFAULT {c['default']}"
        if c.get('notnull'): line += " NOT NULL"
        cols.append(line)
    cons = [c for c in (r['constraints'] or [])]
    body = ",\n".join(cols + [f"  CONSTRAINT {c['name']} {c['def']}" for c in cons])
    stmts.append(f"CREATE TABLE public.{t} (\n{body}\n);")
    for s in sorted(seqs):
        stmts.append(f"ALTER SEQUENCE public.{s} OWNED BY public.{t}.id;")
    for ix in (r['indexes'] or []):
        if re.search(r'INDEX (\S+) ', ix) and any(c['name'] in ix for c in cons):
            continue  # index backing a constraint, created by the constraint
        stmts.append(ix + ';')
    if r.get('rls_enabled'):
        stmts.append(f"ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY;")
    for p in (r['policies'] or []):
        roles = p['roles']
        if isinstance(roles, str): roles = roles.strip('{}').split(',')
        s = f"CREATE POLICY {q(p['name'])} ON public.{t} AS {p['permissive']} FOR {p['cmd']} TO {', '.join(roles)}"
        if p.get('using'): s += f"\n  USING ({p['using']})"
        if p.get('with_check'): s += f"\n  WITH CHECK ({p['with_check']})"
        stmts.append(s + ';')
    for tg in (r['triggers'] or []):
        stmts.append(tg + ';')
    for g in sorted(r['grants'] or []):
        grantee, priv = g.split(':', 1)
        stmts.append(f"GRANT {priv} ON TABLE public.{t} TO {grantee};")
    for pub in (r['publications'] or []):
        stmts.append(f"ALTER PUBLICATION {pub} ADD TABLE public.{t};")
    if r.get('table_comment'):
        stmts.append("COMMENT ON TABLE public.%s IS %s;" % (t, "$$"+r['table_comment']+"$$"))
    out[t] = stmts
json.dump(out, open(os.environ['SP']+'/restore_sql.json','w'), indent=1)
for t,s in out.items(): print(t, len(s), 'statements')
