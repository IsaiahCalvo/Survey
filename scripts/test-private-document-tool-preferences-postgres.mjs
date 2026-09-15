// Disposable local PostgreSQL only. This script accepts no remote connection.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migration = fileURLToPath(new URL('../supabase/migrations/20260909116000_private_document_tool_preferences.sql', import.meta.url));
const id = n => `11600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), collaborator = id(2), other = id(3);
const doc = n => id(100 + n);
const operation = n => id(200 + n);
const allTools = ['pen','highlighter','text-highlight','eraser','rect','ellipse','line','arrow',
  'callout','counter','text','note','underline','strikeout','squiggly','surveyMarker'];
let count = 0;

await withDisposablePostgres(async ({ sql, scalar, asRole, errorState, session, blocked, applyMigration, quote }) => {
  sql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${owner}'),('${collaborator}'),('${other}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.documents(
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id),
      archived boolean NOT NULL DEFAULT false,
      user_archived_at timestamptz,
      tool_preferences jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE public.document_collaborators(
      document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id),
      role text NOT NULL,
      status text NOT NULL,
      PRIMARY KEY(document_id,user_id));
    CREATE FUNCTION public.user_can_access_document(doc_id uuid, required_role text DEFAULT 'viewer')
    RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
    DECLARE owner_id uuid; member_role text;
    BEGIN
      SELECT d.user_id INTO owner_id FROM public.documents d
        WHERE d.id=doc_id AND d.archived=false AND d.user_archived_at IS NULL;
      IF owner_id IS NULL THEN RETURN false;END IF;
      IF owner_id=auth.uid() THEN RETURN true;END IF;
      SELECT c.role INTO member_role FROM public.document_collaborators c
        WHERE c.document_id=doc_id AND c.user_id=auth.uid() AND c.status='active';
      RETURN CASE required_role WHEN 'viewer' THEN member_role IN('viewer','editor','owner')
        WHEN 'editor' THEN member_role IN('editor','owner') WHEN 'owner' THEN member_role='owner' ELSE false END;
    END $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT ON public.documents,public.document_collaborators TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.user_can_access_document(uuid,text) TO authenticated;
    INSERT INTO public.documents(id,user_id,tool_preferences) VALUES
      ('${doc(1)}','${owner}','{"pen":{"strokeColor":"legacy-owner"}}'),
      ('${doc(2)}','${owner}','{"line":{"strokeWidth":777}}'),
      ('${doc(3)}','${owner}','{}'),('${doc(4)}','${owner}','{}'),
      ('${doc(5)}','${owner}','{}'),('${doc(6)}','${owner}','{}'),
      ('${doc(7)}','${owner}','{}'),('${doc(8)}','${owner}','{}');
    INSERT INTO public.document_collaborators VALUES
      ('${doc(1)}','${collaborator}','viewer','active'),
      ('${doc(2)}','${collaborator}','editor','active');
  `);
  const legacyBefore = scalar(`SELECT jsonb_agg(jsonb_build_object('id',id,'prefs',tool_preferences) ORDER BY id)
    FROM public.documents`);
  applyMigration(migration);

  const readSql = documentId => `SELECT public.read_document_tool_preferences('${documentId}')`;
  const writeSql = (documentId, expected, clientRevision, preferences) =>
    `SELECT public.write_document_tool_preferences('${documentId}',${expected},'${clientRevision}',${quote(JSON.stringify(preferences))}::jsonb)`;
  const read = (actor, documentId) => JSON.parse(asRole(actor, readSql(documentId)).stdout);
  const write = (actor, documentId, expected, clientRevision, preferences) =>
    JSON.parse(asRole(actor, writeSql(documentId, expected, clientRevision, preferences)).stdout);
  const check = async (name, work) => { await work(); count++; console.log(`PASS ${name}`); };

  await check('missing read requires access and all current tool IDs accept bounded optional styles', () => {
    assert.deepEqual(read(owner, doc(1)), {
      status:'missing', version:1, documentId:doc(1), revision:0,
      clientRevision:null, preferences:null, updatedAt:null,
    });
    const preferences = Object.fromEntries(allTools.map((toolId, index) => [toolId,
      index === 0 ? {strokeColor:'#ff0000',strokeWidth:0,strokeOpacity:0,fillColor:'rgba(1, 2, 3, 0.5)',fillOpacity:100}
        : index === 1 ? {strokeColor:'#abcd'}
        : index === 2 ? {strokeColor:'#abcdef12'}
        : index === 3 ? {strokeColor:'rgb(1, 2, 255)'}
        : index === 4 ? {strokeColor:'rgb(1,2,3,0.5)'}
        : index === 5 ? {strokeColor:'rgba(1,2,3)'} : {}]));
    const receipt = write(owner, doc(1), 0, operation(1), preferences);
    assert.deepEqual(Object.keys(receipt).sort(), ['clientRevision','documentId','preferences','revision','status','updatedAt','version']);
    assert.equal(receipt.status, 'written');
    assert.equal(receipt.version, 1);
    assert.equal(receipt.revision, 1);
    assert.equal(receipt.clientRevision, operation(1));
    assert.match(receipt.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    assert.deepEqual(receipt.preferences, preferences);
    assert.deepEqual(read(owner, doc(1)), {...receipt, status:'present'});
    const pacificRead = JSON.parse(asRole(owner,
      `SET TIME ZONE 'America/Los_Angeles';${readSql(doc(1))}`).stdout);
    assert.equal(pacificRead.updatedAt, receipt.updatedAt);
    console.log(`PRIVATE_TOOL_PREFERENCES_CONTRACT ${JSON.stringify(receipt)}`);
  });

  await check('owner and collaborator keep separate private rows on the same shared document', () => {
    const collaboratorPrefs = {pen:{strokeColor:'#00ff00',strokeWidth:1000}};
    const collaboratorReceipt = write(collaborator, doc(1), 0, operation(2), collaboratorPrefs);
    assert.deepEqual(read(collaborator, doc(1)), {...collaboratorReceipt,status:'present'});
    assert.equal(read(owner, doc(1)).preferences.pen.strokeColor, '#ff0000');
    assert.equal(write(owner, doc(8), 0, operation(2), {text:{strokeColor:'blue'}}).documentId, doc(8));
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_tool_preferences WHERE document_id='${doc(1)}'`), '2');
  });

  await check('revoked and unrelated actors cannot read, write, or replay a receipt', () => {
    const accepted = write(collaborator, doc(2), 0, operation(3), {line:{strokeWidth:12}});
    errorState(asRole(other, readSql(doc(2)), 'authenticated', false), '42501');
    errorState(asRole(other, writeSql(doc(2),0,operation(4),{}), 'authenticated', false), '42501');
    sql(`UPDATE public.document_collaborators SET status='revoked'
      WHERE document_id='${doc(2)}' AND user_id='${collaborator}'`);
    errorState(asRole(collaborator, readSql(doc(2)), 'authenticated', false), '42501');
    errorState(asRole(collaborator, writeSql(doc(2),0,operation(3),accepted.preferences), 'authenticated', false), '42501');
  });

  await check('only the current exact request replays its receipt and a successor supersedes it', () => {
    const first = write(owner, doc(3), 0, operation(5), {rect:{strokeColor:'#abc',fillOpacity:10}});
    assert.deepEqual(write(owner, doc(3), 0, operation(5), {rect:{fillOpacity:10,strokeColor:'#abc'}}), first);
    errorState(asRole(owner, writeSql(doc(3),1,operation(5),{rect:{strokeColor:'#abc',fillOpacity:10}}), 'authenticated', false), '23505');
    const second = write(owner, doc(3), 1, operation(6), {rect:{strokeColor:'#def',fillOpacity:20}});
    assert.equal(second.revision, 2);
    errorState(asRole(owner, writeSql(doc(3),0,operation(5),{rect:{fillOpacity:10,strokeColor:'#abc'}}), 'authenticated', false), '40001');
    assert.deepEqual(read(owner, doc(3)), {...second,status:'present'});
  });

  await check('create-only and update CAS conflicts never mutate current truth', () => {
    errorState(asRole(owner, writeSql(doc(4),1,operation(7),{}), 'authenticated', false), '40001');
    const first = write(owner, doc(4), 0, operation(8), {eraser:{strokeWidth:10}});
    errorState(asRole(owner, writeSql(doc(4),0,operation(9),{eraser:{strokeWidth:20}}), 'authenticated', false), '40001');
    errorState(asRole(owner, writeSql(doc(4),4,operation(10),{eraser:{strokeWidth:30}}), 'authenticated', false), '40001');
    assert.deepEqual(read(owner, doc(4)), {...first,status:'present'});
  });

  await check('invalid, unknown, nonnumeric, control, range, and oversize payloads fail closed', () => {
    const invalid = [
      [null,'22023'], [[], '22023'], [{select:{}},'22023'], [{pen:{size:2}},'22023'],
      [{pen:null},'22023'], [{pen:{strokeColor:''}},'22023'],
      [{pen:{strokeColor:'bad\ncolor'}},'22023'], [{pen:{strokeWidth:'2'}},'22023'],
      [{pen:{strokeWidth:-1}},'22023'], [{pen:{strokeOpacity:101}},'22023'],
      [{pen:{fillOpacity:-0.1}},'22023'], [{pen:{strokeColor:'x'.repeat(65)}},'22023'],
      [{pen:{strokeColor:'url(javascript:x)'}},'22023'], [{pen:{strokeColor:'rgb(999, 0, 0)'}},'22023'],
      [{pen:{strokeColor:'#abcde'}},'22023'],
      [{unknown:'x'.repeat(33000)},'54000'],
    ];
    invalid.forEach(([preferences,state], index) =>
      errorState(asRole(owner, writeSql(doc(5),0,operation(20+index),preferences), 'authenticated', false), state));
    assert.equal(read(owner, doc(5)).status, 'missing');
  });

  await check('concurrent create-only writes serialize and exactly one wins', async () => {
    const first = session('private-prefs-first',{role:'authenticated',actorId:owner});
    first.send(`${writeSql(doc(6),0,operation(40),{pen:{strokeWidth:1}})};SELECT 'private-prefs-held';`);
    await first.wait('private-prefs-held');
    const second = session('private-prefs-second',{role:'authenticated',actorId:owner});
    second.send(`${writeSql(doc(6),0,operation(41),{pen:{strokeWidth:2}})};`);
    await blocked('private-prefs-second');
    assert.equal((await first.finish(true)).status, 0);
    const loser = await second.finish(true);
    assert.notEqual(loser.status, 0);
    assert.match(loser.stderr, /40001:/);
    assert.equal(read(owner, doc(6)).preferences.pen.strokeWidth, 1);
  });

  await check('RPC-only grants deny anon, authenticated, and service-role direct access', () => {
    errorState(asRole(null, readSql(doc(1)), 'anon', false), '42501');
    errorState(asRole(owner, readSql(doc(1)), 'service_role', false), '42501');
    for (const role of ['authenticated','service_role']) {
      errorState(asRole(owner, 'SELECT * FROM survey_private.document_tool_preferences', role, false), '42501');
      errorState(asRole(owner, 'UPDATE survey_private.document_tool_preferences SET revision=99', role, false), '42501');
    }
    assert.equal(scalar(`SELECT count(*) FROM information_schema.role_routine_grants
      WHERE routine_schema='public' AND routine_name IN ('read_document_tool_preferences','write_document_tool_preferences')
      AND grantee='authenticated'`), '2');
  });

  await check('the RLS policy isolates actors and still checks live document access', () => {
    sql(`GRANT USAGE ON SCHEMA survey_private TO authenticated;
      GRANT SELECT ON survey_private.document_tool_preferences TO authenticated`);
    assert.equal(asRole(owner, `SELECT count(*) FROM survey_private.document_tool_preferences
      WHERE document_id='${doc(1)}'`).stdout, '1');
    assert.equal(asRole(collaborator, `SELECT count(*) FROM survey_private.document_tool_preferences
      WHERE document_id='${doc(1)}'`).stdout, '1');
    sql(`UPDATE public.document_collaborators SET status='revoked'
      WHERE document_id='${doc(1)}' AND user_id='${collaborator}'`);
    assert.equal(asRole(collaborator, `SELECT count(*) FROM survey_private.document_tool_preferences
      WHERE document_id='${doc(1)}'`).stdout, '0');
    sql(`REVOKE SELECT ON survey_private.document_tool_preferences FROM authenticated;
      REVOKE USAGE ON SCHEMA survey_private FROM authenticated`);
  });

  await check('document deletion cascades private rows and legacy shared preferences never change', () => {
    write(owner, doc(7), 0, operation(50), {note:{fillColor:'#ffff00'}});
    assert.equal(scalar(`SELECT count(*) FROM pg_indexes WHERE schemaname='survey_private'
      AND indexname='document_tool_preferences_document_id_idx'`), '1');
    sql(`DELETE FROM public.documents WHERE id='${doc(7)}'`);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_tool_preferences WHERE document_id='${doc(7)}'`), '0');
    assert.deepEqual(JSON.parse(scalar(`SELECT jsonb_agg(jsonb_build_object('id',id,'prefs',tool_preferences) ORDER BY id)
      FROM public.documents WHERE id <> '${doc(7)}'`)), JSON.parse(legacyBefore).filter(row => row.id !== doc(7)));
  });
}, { name:'private-tool-preferences' });

console.log(`private document tool preferences: ${count}/${count} passed; cleanup complete`);
