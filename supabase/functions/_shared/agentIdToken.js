// Checks an AgentID (AgentMail) id_token: an OpenID Connect token naming an
// AI agent and the person who answers for it. Plain WebCrypto, so the same
// code runs in the edge function (Deno) and the node tests.
// Rules from AgentID's docs: ES256 signature from the issuer's JWKS (by kid),
// iss exactly https://auth.agentid.com, aud exactly our client_id, not
// expired, actor_type "agent". Claims they didn't grant are left out, not null.

export const AGENTID_ISSUER = 'https://auth.agentid.com';
export const AGENTID_JWKS_URL = `${AGENTID_ISSUER}/v0/jwks.json`;
// An open AgentID client is identified by an https origin we own.
export const AGENTID_CLIENT_ID = 'https://surveytool.app';
export const AGENTID_REDIRECT_URI = 'https://surveytool.app/agentid/callback';

const CLOCK_SKEW_SECONDS = 60;

function b64urlBytes(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const b64urlJson = (part) => JSON.parse(new TextDecoder().decode(b64urlBytes(part)));

/**
 * @param {string} idToken
 * @param {{ audience?: string, fetchJwks: () => Promise<any>, now?: number }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function verifyAgentIdToken(idToken, { audience = AGENTID_CLIENT_ID, fetchJwks, now = Date.now() }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('not a token');
  let header;
  let claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new Error('not a token');
  }
  if (header.alg !== 'ES256') throw new Error('wrong signing method');

  const jwks = await fetchJwks();
  const jwk = (jwks?.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlBytes(parts[2]), signed);
  if (!ok) throw new Error('bad signature');

  const nowSeconds = Math.floor(now / 1000);
  if (claims.iss !== AGENTID_ISSUER) throw new Error('wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new Error('not meant for Survey');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new Error('expired');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) throw new Error('issued in the future');
  if (claims.actor_type !== 'agent') throw new Error('not an agent');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('no agent id');
  return claims;
}

// What Survey keeps: who the agent is and who answers for it.
export function agentIdRecord(claims) {
  const text = (v) => (typeof v === 'string' && v ? v.slice(0, 320) : null);
  return {
    agentid_sub: claims.sub,
    agent_email: text(claims.email),
    agent_name: text(claims.name) || text(claims.preferred_username),
    owner_sub: text(claims.owner_sub),
    owner_email: text(claims.owner_email),
    owner_human_verified: claims.owner_human_verified === true,
  };
}
