// Company sign-in setup (supabase/functions/company-sso): the DNS proof and
// the checks on what a company's IT person pastes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dohAnswerHasToken, readMetadataInput, signOnErrorText, txtRecordName, txtRecordValue,
} from '../supabase/functions/_shared/companySso.js';
import { itSetupText, signOnLinks } from '../src/services/companyService.js';

test('the DNS line and its lookup', () => {
  assert.equal(txtRecordName('acme.com'), '_survey-verify.acme.com');
  assert.equal(txtRecordValue('abc'), 'survey-verify=abc');
  const answer = (data) => ({ Status: 0, Answer: [{ name: '_survey-verify.acme.com', type: 16, data }] });
  assert.equal(dohAnswerHasToken(answer('"survey-verify=abc"'), 'abc'), true);
  // Long TXT values come back split into quoted pieces.
  assert.equal(dohAnswerHasToken(answer('"survey-ver" "ify=abc"'), 'abc'), true);
  assert.equal(dohAnswerHasToken(answer('"survey-verify=abcd"'), 'abc'), false);
  assert.equal(dohAnswerHasToken(answer('"v=spf1 include:x"'), 'abc'), false);
  assert.equal(dohAnswerHasToken({ Status: 3 }, 'abc'), false);
  assert.equal(dohAnswerHasToken({ Answer: [{ type: 5, data: '"survey-verify=abc"' }] }, 'abc'), false);
  assert.equal(dohAnswerHasToken(answer('"survey-verify="'), ''), false);
});

test('sign-on details: a public https link or SAML XML, never a private address', () => {
  assert.deepEqual(readMetadataInput({ metadataUrl: ' https://login.microsoftonline.com/x/federationmetadata.xml ' }),
    { ok: true, value: { metadata_url: 'https://login.microsoftonline.com/x/federationmetadata.xml' } });
  for (const bad of ['http://idp.acme.com/m', 'https://localhost/m', 'https://127.0.0.1/m', 'https://10.0.0.5/m',
    'https://192.168.1.2/m', 'https://169.254.169.254/latest', 'https://[::1]/m', 'https://idp.internal/m', 'not a url']) {
    assert.equal(readMetadataInput({ metadataUrl: bad }).ok, false, bad);
  }
  assert.equal(readMetadataInput({ metadataXml: '<md:EntityDescriptor xmlns:md="x">' }).ok, true);
  assert.equal(readMetadataInput({ metadataXml: '<html></html>' }).ok, false);
  assert.equal(readMetadataInput({ metadataXml: `<EntityDescriptor>${'x'.repeat(200_001)}` }).ok, false);
  assert.equal(readMetadataInput({ metadataUrl: 'https://a.com/m', metadataXml: '<EntityDescriptor>' }).ok, false);
  assert.equal(readMetadataInput({}).ok, false);
});

test('Supabase errors read as plain words', () => {
  assert.match(signOnErrorText(404, { error_code: 'saml_provider_disabled', msg: 'SAML 2.0 is disabled' }), /not switched on for Survey yet/);
  assert.match(signOnErrorText(400, { msg: 'SAML 2.0 is disabled' }), /not switched on/);
  assert.match(signOnErrorText(422, { msg: 'Domain already added to another provider' }), /already connected to another company/);
  assert.match(signOnErrorText(400, { msg: 'Unable to parse metadata XML' }), /could not read the sign-on details/);
  assert.equal(signOnErrorText(500, null), 'Company sign-in could not be connected. Try again.');
});

test('the two details the IT person needs', () => {
  const links = signOnLinks('https://abc.supabase.co/');
  assert.deepEqual(links, {
    entityId: 'https://abc.supabase.co/auth/v1/sso/saml/metadata',
    acsUrl: 'https://abc.supabase.co/auth/v1/sso/saml/acs',
  });
  const text = itSetupText({ companyName: 'Acme', links, domains: ['acme.com'] });
  assert.match(text, /Entity ID .*: https:\/\/abc\.supabase\.co\/auth\/v1\/sso\/saml\/metadata/);
  assert.match(text, /ACS URL .*: https:\/\/abc\.supabase\.co\/auth\/v1\/sso\/saml\/acs/);
  assert.match(text, /acme\.com/);
  assert.doesNotMatch(text, /\n\n\n/);
});
