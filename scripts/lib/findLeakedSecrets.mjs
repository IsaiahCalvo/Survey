// Finds server-only secrets in shipped client files. The public Supabase anon
// key is expected in the bundle; a service_role key, Stripe secret, webhook
// secret or email/model API key is not.
const PATTERNS = [
  // New-style Supabase service key; the sb_publishable_ key is public.
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}/g],
  ['Stripe secret or restricted key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{20,}/g],
  ['Brevo API key', /\bxkeysib-[a-f0-9]{40,}/g],
  ['Groq API key', /\bgsk_[A-Za-z0-9]{40,}/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g],
];

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

function jwtRole(payload) {
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role;
  } catch {
    return null;
  }
}

/** Returns [{ kind, sample }] for every secret found in `text`. */
export function findLeakedSecrets(text) {
  const found = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push({ kind, sample: `${match[0].slice(0, 12)}…` });
  }
  for (const match of text.matchAll(JWT)) {
    const role = jwtRole(match[1]);
    if (role && role !== 'anon') found.push({ kind: `Supabase ${role} key`, sample: `${match[0].slice(0, 12)}…` });
  }
  return found;
}
