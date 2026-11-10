// The MCP connector answers at its function address and at surveytool.app/mcp
// (vercel.json rewrite with ?via=site). Agents refuse sign-in metadata whose
// resource is not the address they connected to, so each must get its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mcpMetadataUrl, mcpPublicUrl, SITE_MCP_URL } from '../supabase/functions/_shared/mcpPublicUrl.js';

const FN = 'https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/survey-mcp';

test('a request through the site rewrite is answered with the site address', () => {
  assert.equal(mcpPublicUrl(`${FN}?via=site`, FN), SITE_MCP_URL);
  assert.equal(mcpPublicUrl(`${FN}/.well-known/oauth-protected-resource?via=site`, FN), SITE_MCP_URL);
  assert.equal(mcpMetadataUrl(SITE_MCP_URL), 'https://surveytool.app/mcp/.well-known/oauth-protected-resource');
});

test('the old function address keeps its own address', () => {
  assert.equal(mcpPublicUrl(FN, FN), FN);
  assert.equal(mcpPublicUrl(`${FN}?via=other`, FN), FN);
  assert.equal(mcpMetadataUrl(FN), `${FN}/.well-known/oauth-protected-resource`);
});

test('vercel.json sends /mcp and its metadata paths to the function, before the app catch-all', () => {
  const { rewrites } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const at = (source) => rewrites.findIndex((r) => r.source === source);
  const catchAll = rewrites.findIndex((r) => r.destination === '/index.html');
  for (const [source, dest] of [
    ['/mcp', `${FN}?via=site`],
    ['/mcp/.well-known/oauth-protected-resource', `${FN}/.well-known/oauth-protected-resource?via=site`],
    ['/.well-known/oauth-protected-resource/mcp', `${FN}/.well-known/oauth-protected-resource?via=site`],
  ]) {
    const i = at(source);
    assert.ok(i >= 0, `${source} rewrite missing`);
    assert.equal(rewrites[i].destination, dest);
    assert.ok(i < catchAll, `${source} must come before the app catch-all`);
  }
});

test('survey-mcp names the address each request came through', () => {
  const src = readFileSync(new URL('../supabase/functions/survey-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(src, /const publicUrl = mcpPublicUrl\(req\.url, functionUrl\(\)\)/);
  assert.match(src, /resource: publicUrl,/);
  assert.doesNotMatch(src, /return unauthorized\(\)/);
});
