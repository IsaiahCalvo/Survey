import test from 'node:test';
import assert from 'node:assert/strict';
import { CANCEL_WORDS, SHUTTER_WORDS, agentLocale, agentSays, readAgentLang, writeAgentLang } from '../src/agent/agentLanguage.js';
import { SURVEY_AGENT_SYSTEM_PROMPT, surveyAgentSystemMessages } from '../supabase/functions/_shared/surveyAgentSpec.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('the language follows the device first, then what the person picked', () => {
  const storage = memory();
  assert.equal(readAgentLang({ storage, nav: { language: 'es-MX' } }), 'es');
  assert.equal(readAgentLang({ storage, nav: { language: 'en-GB' } }), 'en');
  writeAgentLang('es', { storage });
  assert.equal(readAgentLang({ storage, nav: { language: 'en-US' } }), 'es');
  storage.setItem('survey.agent.lang', 'fr');
  assert.equal(readAgentLang({ storage, nav: { language: 'en-US' } }), 'en', 'unknown values are ignored');
});

test('hearing and voice use the device locale when it is that language', () => {
  assert.equal(agentLocale('es', { language: 'es-MX' }), 'es-MX');
  assert.equal(agentLocale('es', { language: 'en-US' }), 'es-US');
  assert.equal(agentLocale('en', { language: 'en-GB' }), 'en-GB');
  assert.equal(agentLocale('en', { language: 'es-ES' }), 'en-US');
});

test('what the app says itself, in Spanish too', () => {
  assert.match(agentSays('es', 'savedFirst'), /No hay señal/);
  assert.equal(agentSays('es', 'saved'), 'Guardado.');
  assert.equal(agentSays('en', 'saved'), 'Saved.');
  assert.equal(agentSays('fr', 'saved'), 'Saved.');
});

test('camera words in English and Spanish', () => {
  for (const said of ['take it', 'Tómala', 'saca la foto', 'toma foto']) assert.ok(SHUTTER_WORDS.test(said), said);
  for (const said of ['cancel', 'cancela', 'olvídalo', 'sin foto']) assert.ok(CANCEL_WORDS.test(said), said);
  assert.equal(SHUTTER_WORDS.test('la puerta tiene lector'), false);
});

test('Spanish adds a note to answer in Spanish without translating survey names', () => {
  assert.deepEqual(surveyAgentSystemMessages('en'), [{ role: 'system', content: SURVEY_AGENT_SYSTEM_PROMPT }]);
  assert.deepEqual(surveyAgentSystemMessages(undefined), [{ role: 'system', content: SURVEY_AGENT_SYSTEM_PROMPT }]);
  const es = surveyAgentSystemMessages('es');
  assert.equal(es.length, 2);
  assert.match(es[1].content, /Reply in Spanish/);
  assert.match(es[1].content, /do not translate/);
});
