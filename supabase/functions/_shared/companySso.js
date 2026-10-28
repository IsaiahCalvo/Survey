// Company sign-in setup (company-sso function): the DNS proof a company adds
// for its domain, and the checks on the sign-on details its IT person pastes.
// Plain JS so the node tests run it as is.

export const TXT_PREFIX = '_survey-verify';
export const TXT_VALUE_PREFIX = 'survey-verify=';
export const METADATA_XML_MAX = 200_000;

export const txtRecordName = (domain) => `${TXT_PREFIX}.${domain}`;
export const txtRecordValue = (token) => `${TXT_VALUE_PREFIX}${token}`;

// A DNS-over-HTTPS JSON answer (Cloudflare / Google shape) holds the proof.
// TXT data comes quoted and may be split into several quoted pieces.
export function dohAnswerHasToken(answer, token) {
  if (!token || !answer || !Array.isArray(answer.Answer)) return false;
  const want = txtRecordValue(token);
  return answer.Answer.some((row) => {
    if (row?.type !== 16 || typeof row.data !== 'string') return false;
    const joined = (row.data.match(/"((?:[^"\\]|\\.)*)"/g) || [row.data])
      .map((piece) => piece.replace(/^"|"$/g, ''))
      .join('');
    return joined.trim() === want;
  });
}

// What the IT person pasted: a metadata link (https only, never a private
// address, since the sign-in service fetches it) or the XML itself.
export function readMetadataInput({ metadataUrl, metadataXml } = {}) {
  const url = typeof metadataUrl === 'string' ? metadataUrl.trim() : '';
  const xml = typeof metadataXml === 'string' ? metadataXml.trim() : '';
  if (url && xml) return { ok: false, error: 'Paste the link or the XML, not both.' };
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { return { ok: false, error: 'That link does not look right.' }; }
    if (parsed.protocol !== 'https:') return { ok: false, error: 'The sign-on link must start with https://' };
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host)
        || host.endsWith('.local') || host.endsWith('.internal') || host.includes(':') || host === '[::1]') {
      return { ok: false, error: 'The sign-on link must be a public web address.' };
    }
    return { ok: true, value: { metadata_url: parsed.href } };
  }
  if (xml) {
    if (xml.length > METADATA_XML_MAX) return { ok: false, error: 'That XML is too long to be sign-on details.' };
    if (!/<(\w+:)?EntityDescriptor[\s>]/.test(xml)) {
      return { ok: false, error: 'That XML is not SAML sign-on details (no EntityDescriptor).' };
    }
    return { ok: true, value: { metadata_xml: xml } };
  }
  return { ok: false, error: 'Paste the sign-on link (metadata URL) or the XML from your IT person.' };
}

// Supabase Auth's answer turned into words for the admin.
export function signOnErrorText(status, body) {
  const code = String(body?.error_code || body?.code || '');
  const msg = String(body?.msg || body?.message || body?.error_description || body?.error || '');
  if (code === 'saml_provider_disabled' || /saml 2\.0 is disabled/i.test(msg) || status === 404 && /saml/i.test(msg)) {
    return 'Company sign-in is not switched on for Survey yet. Your setup is saved here; try Connect again later.';
  }
  if (/already|exists|in use/i.test(msg) && /domain/i.test(msg)) {
    return 'One of these domains is already connected to another company sign-in.';
  }
  if (/metadata/i.test(msg)) return `Survey could not read the sign-on details: ${msg}`;
  return msg ? `Company sign-in could not be connected: ${msg}` : 'Company sign-in could not be connected. Try again.';
}
