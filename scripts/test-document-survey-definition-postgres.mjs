// Disposable local PostgreSQL only. This script accepts no remote connection.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import { documentSurveyDefinitionAdoptionIdentity,
  documentSurveySheetNameKey } from '../src/services/documentSurveyDefinition.js';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migration = fileURLToPath(new URL('../supabase/migrations/20260909106000_document_survey_definition.sql', import.meta.url));
const id = n => `10600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4);
const hash = value => value.repeat(64);
const checklist = (itemId='check',text='Installed') => ({id:itemId,text});
const modules = (moduleId='module',name='Survey',items=[checklist()]) =>
  [{id:moduleId,name,categories:[{id:'category',name:'General',checklist:items}]}];
let count=0;

await withDisposablePostgres(async ({sql,scalar,asRole,errorState,session,blocked,applyMigration,quote}) => {
  sql(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${editor}'),('${viewer}'),('${other}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id));
    CREATE TABLE public.documents(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),project_id uuid REFERENCES public.projects(id),template_id uuid,
      archived boolean NOT NULL DEFAULT false,user_archived_at timestamptz,locked_at timestamptz,title text DEFAULT 'kept');
    CREATE TABLE public.templates(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),config jsonb NOT NULL,
      updated_at timestamptz NOT NULL,user_archived_at timestamptz,archived boolean NOT NULL DEFAULT false);
    ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY template_owner_read ON public.templates FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE TABLE public.document_collaborators(document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id),role text NOT NULL,status text NOT NULL,PRIMARY KEY(document_id,user_id));
    CREATE TABLE public.project_collaborators(project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id),role text NOT NULL,status text NOT NULL,PRIMARY KEY(project_id,user_id));
    CREATE SCHEMA survey_private;
    CREATE TABLE survey_private.account_write_guards(user_id uuid PRIMARY KEY,closing boolean NOT NULL DEFAULT false);
    CREATE FUNCTION public.user_can_access_document(doc_id uuid,required_role text DEFAULT 'viewer') RETURNS boolean
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$DECLARE o uuid;p uuid;a timestamptz;r text;BEGIN
      SELECT d.user_id,d.project_id,d.user_archived_at INTO o,p,a FROM public.documents d WHERE d.id=doc_id;
      IF o IS NULL THEN RETURN false;END IF; IF a IS NOT NULL THEN RETURN o=auth.uid();END IF; IF o=auth.uid() THEN RETURN true;END IF;
      SELECT c.role INTO r FROM public.document_collaborators c WHERE c.document_id=doc_id AND c.user_id=auth.uid() AND c.status='active';
      IF r IS NULL AND p IS NOT NULL THEN SELECT c.role INTO r FROM public.project_collaborators c WHERE c.project_id=p AND c.user_id=auth.uid() AND c.status='active';
        IF r IS NULL THEN SELECT 'owner' INTO r FROM public.projects x WHERE x.id=p AND x.user_id=auth.uid();END IF;END IF;
      RETURN CASE required_role WHEN 'viewer' THEN r IN('viewer','editor','owner') WHEN 'editor' THEN r IN('editor','owner') WHEN 'owner' THEN r='owner' ELSE false END;END$$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$SELECT coalesce((SELECT locked_at IS NOT NULL FROM public.documents WHERE id=doc_id),true)$$;
    CREATE FUNCTION survey_private.assert_account_open(p_user_id uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
      DECLARE c boolean;BEGIN INSERT INTO survey_private.account_write_guards VALUES(p_user_id,false) ON CONFLICT DO NOTHING;
      SELECT closing INTO c FROM survey_private.account_write_guards WHERE user_id=p_user_id FOR SHARE;
      IF c THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514';END IF;END$$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT ON public.documents,public.templates,public.document_collaborators,public.projects,public.project_collaborators TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.user_can_access_document(uuid,text),public.kal49_document_is_locked(uuid),survey_private.assert_account_open(uuid) TO authenticated;
  `);
  applyMigration(migration);
  const doc=(n,actor=owner,templateId=null)=>{const d=id(100+n);sql(`INSERT INTO public.documents(id,user_id,template_id) VALUES('${d}','${actor}',${quote(templateId)})`);return d;};
  const tmpl=(n,value=modules(),actor=owner,at=`2026-09-09T12:${String(n).padStart(2,'0')}:00Z`)=>{const t=id(200+n);sql(`INSERT INTO public.templates(id,user_id,config,updated_at,user_archived_at) VALUES('${t}','${actor}',${quote(JSON.stringify({modules:value}))}::jsonb,${quote(at)},NULL)`);return t;};
  const preview=(actor,d,t)=>JSON.parse(asRole(actor,`SELECT public.preview_document_survey_definition_adoption('${d}','${t}')`).stdout);
  const adoptSql=(d,t,s,op,request=hash('b'))=>`SELECT public.adopt_document_survey_definition('${d}','${t}',${quote(s.templateUpdatedAt)}::timestamptz,${quote(s.structureSha256)},'${op}',${quote(request)})`;
  const adopt=(actor,d,t,s,op,request)=>JSON.parse(asRole(actor,adoptSql(d,t,s,op,request)).stdout);
  const read=(actor,d)=>JSON.parse(asRole(actor,`SELECT public.read_document_survey_definition('${d}')`).stdout);
  const check=async(name,fn)=>{await fn();count++;console.log(`PASS ${name}`);};

  await check('actual preview adopt and member read preserve exact public receipt',async()=>{const d=doc(1),t=tmpl(1,[{...modules()[0],privateWorkbookId:'never-public'}]);const p=preview(owner,d,t);
    assert.deepEqual(Object.keys(p).sort(),['documentId','modules','source','status','version']);
    const identity=await documentSurveyDefinitionAdoptionIdentity(p,id(301));
    const a=adopt(owner,d,t,p.source,id(301),identity.requestSha256);assert.equal(a.definitionRevision,1);assert.deepEqual(a.modules,p.modules);
    sql(`INSERT INTO public.document_collaborators VALUES('${d}','${viewer}','viewer','active')`);
    const member=read(viewer,d);assert.deepEqual(member,a);console.log(`SURVEY_DEFINITION_CONTRACT ${JSON.stringify({preview:p,accepted:a,read:member})}`);});
  await check('member with no template grant reads but cannot preview or adopt',()=>{const d=doc(2),t=tmpl(2);sql(`INSERT INTO public.document_collaborators VALUES('${d}','${editor}','editor','active')`);
    assert.equal(asRole(editor,`SELECT count(*) FROM public.templates WHERE id='${t}'`).stdout,'0');
    errorState(asRole(editor,`SELECT public.preview_document_survey_definition_adoption('${d}','${t}')`,'authenticated',false),'42501');
    const p=preview(owner,d,t);errorState(asRole(editor,adoptSql(d,t,p.source,id(302)),'authenticated',false),'42501');adopt(owner,d,t,p.source,id(303));assert.equal(read(editor,d).status,'accepted');
    sql(`UPDATE public.document_collaborators SET status='revoked' WHERE document_id='${d}' AND user_id='${editor}'`);
    errorState(asRole(editor,`SELECT public.read_document_survey_definition('${d}')`,'authenticated',false),'42501');});
  await check('read follows archive lock and project inheritance while adoption remains owner-open only',()=>{
    const project=id(500);sql(`INSERT INTO public.projects VALUES('${project}','${other}');INSERT INTO public.project_collaborators VALUES('${project}','${viewer}','viewer','active')`);
    const d=doc(50),t=tmpl(50);sql(`UPDATE public.documents SET project_id='${project}' WHERE id='${d}'`);const p=preview(owner,d,t);adopt(owner,d,t,p.source,id(350));
    assert.equal(read(viewer,d).status,'accepted');assert.equal(read(other,d).status,'accepted');
    sql(`UPDATE public.documents SET locked_at=now() WHERE id='${d}'`);assert.equal(read(viewer,d).status,'accepted');
    errorState(asRole(owner,`SELECT public.preview_document_survey_definition_adoption('${d}','${t}')`,'authenticated',false),'42501');
    sql(`UPDATE public.documents SET locked_at=NULL,user_archived_at=now() WHERE id='${d}'`);assert.equal(read(owner,d).status,'accepted');
    errorState(asRole(viewer,`SELECT public.read_document_survey_definition('${d}')`,'authenticated',false),'42501');
    const d2=doc(51),t2=tmpl(51);sql(`UPDATE public.templates SET archived=true WHERE id='${t2}'`);
    errorState(asRole(owner,`SELECT public.preview_document_survey_definition_adoption('${d2}','${t2}')`,'authenticated',false),'42501');
    const d3=doc(54),t3=tmpl(54);sql(`UPDATE public.documents SET archived=true WHERE id='${d3}'`);
    errorState(asRole(owner,`SELECT public.preview_document_survey_definition_adoption('${d3}','${t3}')`,'authenticated',false),'42501');});
  await check('stale time and structure hash reject without a row',()=>{const d=doc(3),t=tmpl(3),p=preview(owner,d,t);sql(`UPDATE public.templates SET config='${JSON.stringify({modules:modules('changed','Changed')})}'::jsonb,updated_at='2026-09-10' WHERE id='${t}'`);
    errorState(asRole(owner,adoptSql(d,t,p.source,id(304)),'authenticated',false),'40001');assert.equal(read(owner,d).status,'unadopted');
    const d2=doc(52),t2=tmpl(52),p2=preview(owner,d2,t2);sql(`UPDATE public.templates SET config='${JSON.stringify({modules:modules('digest-only','Changed')})}'::jsonb WHERE id='${t2}'`);
    errorState(asRole(owner,adoptSql(d2,t2,p2.source,id(352)),'authenticated',false),'40001');assert.equal(read(owner,d2).status,'unadopted');});
  await check('same seed replays while every different seed conflicts',()=>{const d=doc(4),t=tmpl(4),p=preview(owner,d,t),a=adopt(owner,d,t,p.source,id(305),hash('c'));
    assert.deepEqual(adopt(owner,d,t,p.source,id(305),hash('c')),a);sql(`DELETE FROM public.templates WHERE id='${t}'`);
    assert.deepEqual(adopt(owner,d,t,p.source,id(305),hash('c')),a);errorState(asRole(owner,adoptSql(d,t,p.source,id(306),hash('d')),'authenticated',false),'23505');
    const d2=doc(53),t2=tmpl(53),p2=preview(owner,d2,t2);sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${owner}'`);
    errorState(asRole(owner,`SELECT public.preview_document_survey_definition_adoption('${d2}','${t2}')`,'authenticated',false),'42501');
    errorState(asRole(owner,adoptSql(d2,t2,p2.source,id(353)),'authenticated',false),'23514');sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${owner}'`);});
  await check('template edit and delete cannot mutate snapshot or unrelated document metadata',()=>{const d=doc(5),t=tmpl(5),p=preview(owner,d,t),a=adopt(owner,d,t,p.source,id(307));sql(`UPDATE public.templates SET config='{"modules":[]}',updated_at='2026-09-11' WHERE id='${t}';DELETE FROM public.templates WHERE id='${t}'`);assert.deepEqual(read(owner,d),a);assert.equal(scalar(`SELECT title||':'||coalesce(template_id::text,'null') FROM public.documents WHERE id='${d}'`),'kept:null');});
  await check('invalid aliases ids bounds sheet keys and reserved headers fail closed',()=>{const cases=[
    [{id:'m',name:'A',categories:[{id:'c',name:'C',checklist:[{id:'x',text:' Item '}]}]}],
    [{id:'m1',name:'A/B',categories:[{id:'c1',name:'C',checklist:[]}]},{id:'m2',name:'A:B',categories:[{id:'c2',name:'C',checklist:[]}]}],
    [{id:'m1',name:'1234567890123456789012345678901A',categories:[{id:'c1',name:'C',checklist:[]}]},{id:'m2',name:'1234567890123456789012345678901B',categories:[{id:'c2',name:'C',checklist:[]}]}],
    [{id:'m',name:'M',categories:[{id:'c',name:'C',checklist:[checklist('x','Same'),checklist('y',' Same ')]}]}],
    [{id:'same',name:'One',categories:[]},{id:'same',name:'Two',categories:[]}],
    Array.from({length:65},(_,n)=>({id:`m${n}`,name:`M${n}`,categories:[]})),
    [{id:'m',name:'M',categories:[{id:'c',name:'C',checklist:Array.from({length:257},(_,n)=>checklist(`i${n}`,`Check ${n}`))}]}],
  ];cases.forEach((value,n)=>{const d=doc(20+n),t=tmpl(20+n,value);const r=asRole(owner,`SELECT public.preview_document_survey_definition_adoption('${d}','${t}')`,'authenticated',false);assert.notEqual(r.status,0);});});
  await check('Unicode module identity matches ICU root lower then ECMAScript whitespace strip',()=>{const whitespace=['\u0009','\u000a','\u000b','\u000c','\u000d','\u0020','\u00a0','\u1680','\u2000','\u2001','\u2002','\u2003','\u2004','\u2005','\u2006','\u2007','\u2008','\u2009','\u200a','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'];
    const vectors=['Valve','VAV','I','İ','ı','i','Σ','σ','ς','ΟΣ Σ','Ο Σ',...whitespace.map(space=>`A${space}B`),'Cafe\u0301','Café'];
    for(const value of vectors){const js=value.toLowerCase().replace(/\s|\ufeff/gu,'')+'Data';const pg=scalar(`SELECT survey_private.document_survey_module_data_key(${quote(value)})`);assert.equal(pg,js,value);}
    const astral='123456789012345678901234567890😀A';assert.throws(()=>documentSurveySheetNameKey(astral,'M'));
    errorState(sql(`SELECT survey_private.document_survey_sheet_key(${quote(astral)},'M')`,false),'22023');});
  await check('private rows and mutation are unavailable to app roles',()=>{for(const role of ['authenticated','service_role']){const r=asRole(owner,'SELECT * FROM survey_private.document_survey_definitions',role,false);errorState(r,'42501');}errorState(asRole(other,`SELECT public.read_document_survey_definition('${id(999)}')`,'authenticated',false),'42501');});
  await check('concurrent different seeds serialize to one immutable winner',async()=>{const d=doc(6),t1=tmpl(6),t2=tmpl(7,modules('two','Two')),p1=preview(owner,d,t1),p2=preview(owner,d,t2);const one=session('definition-seed-one',{role:'authenticated',actorId:owner});one.send(`${adoptSql(d,t1,p1.source,id(308),hash('e'))};SELECT 'held';`);await one.wait('held');const two=session('definition-seed-two',{role:'authenticated',actorId:owner});two.send(`${adoptSql(d,t2,p2.source,id(309),hash('f'))};`);await blocked('definition-seed-two');assert.equal((await one.finish()).status,0);const loser=await two.finish();assert.notEqual(loser.status,0);assert.match(loser.stderr,/23505:/);assert.equal(read(owner,d).source.templateId,t1);});
}, {name:'document-survey-definition'});
console.log(`document survey definition: ${count}/${count} passed; cleanup complete`);
