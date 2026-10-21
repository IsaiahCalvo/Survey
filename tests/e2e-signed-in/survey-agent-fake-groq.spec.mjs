// The stack's fake Groq answers the real survey-agent function: hearing gives
// "D-1-17 is installed" and the model sets every line of D-1-17. App walks
// (browser, iOS, Android) lean on this, so it is checked here first: the
// function reaches the fake inside the stack, and the seeded survey is there.
import { FAKE_HEARD } from '../../scripts/e2e-fake-groq.mjs';
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { apiClientFor, expect, functionUrl, test } from './helpers.mjs';

async function agent(token, body) {
  const res = await fetch(functionUrl('survey-agent'), {
    method: 'POST',
    headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('survey-agent hears and answers through the fake Groq, for the seeded D-1-17', async () => {
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { session } } = await owner.auth.getSession();
  const token = session.access_token;

  const status = await agent(token, { action: 'status' });
  expect(status.status).toBe(200);
  expect(status.body).toMatchObject({ enabled: true, transcription: true });

  // A short WAV header is enough: the fake never listens.
  const wav = Buffer.alloc(44, 0);
  wav.write('RIFF', 0); wav.write('WAVE', 8);
  const heard = await agent(token, { action: 'transcribe', mime: 'audio/wav', audio: wav.toString('base64'), duration_ms: 1000 });
  expect(heard.status).toBe(200);
  expect(heard.body.text).toBe(FAKE_HEARD);

  const turn = await agent(token, {
    action: 'turn',
    messages: [{ role: 'user', content: heard.body.text }],
    answer_values: ['Y', 'N', 'N/A'],
  });
  expect(turn.status).toBe(200);
  const call = turn.body.message.tool_calls[0];
  expect(call.function.name).toBe('set_answers');
  expect(JSON.parse(call.function.arguments)).toEqual({ item_name: E2E_SURVEY.itemName, all_lines: 'Y' });

  // The survey the walks open: the owner sees the drawing and its template.
  const doc = await owner.from('documents').select('id, name').eq('id', E2E_SURVEY.documentId).single();
  expect(doc.data?.name).toBe(E2E_SURVEY.documentName);
  const template = await owner.from('templates').select('id, name, config').eq('id', E2E_SURVEY.templateId).single();
  expect(template.data?.name).toBe(E2E_SURVEY.templateName);
  expect(template.data.config.modules[0].categories[0].checklist.map((c) => c.id))
    .toEqual(E2E_SURVEY.checklist.map((c) => c.id));
  await owner.auth.signOut();
});
