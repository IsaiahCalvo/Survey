/**
 * phoneSign.js — sign on a phone, land in the computer's Add signature
 * dialog (Nightly 'phone-sign', Drawboard PDF Pro push 2026-11-12, row A8).
 *
 *   computer  makes a request row (a random token) and shows its link as a
 *             QR code, then reads the row every second or two.
 *   phone     opens /sign/<token> (no sign-in), draws, and sends the strokes
 *             through submit_phone_signature: once, within 10 minutes.
 *   computer  sees the strokes, puts them on its Draw pad and drops the row.
 *
 * Strokes travel in the pad's own 440 x 160 space, so both ends draw the
 * same shape whatever size the pad shows at.
 */
import { supabase } from '../supabaseClient.js';

export const PHONE_SIGN_PAD = Object.freeze({ width: 440, height: 160 });
export const PHONE_SIGN_MAX_POINTS = 5000;
export const PHONE_SIGN_POLL_MS = 1500;
export const PHONE_SIGN_LIFETIME_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clamp = (value, max) => Math.min(max, Math.max(0, value));
const round1 = (value) => Math.round(value * 10) / 10;

/** Strokes ([{x, y}] lists in pad space) as a small payload, capped and rounded. */
export function packStrokes(strokes) {
  const { width, height } = PHONE_SIGN_PAD;
  let budget = PHONE_SIGN_MAX_POINTS;
  const out = [];
  for (const stroke of Array.isArray(strokes) ? strokes : []) {
    if (budget <= 0) break;
    const flat = [];
    for (const point of Array.isArray(stroke) ? stroke : []) {
      if (budget <= 0) break;
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      flat.push(round1(clamp(x, width)), round1(clamp(y, height)));
      budget -= 1;
    }
    if (flat.length) out.push(flat);
  }
  return { v: 1, w: width, h: height, strokes: out };
}

/** The payload back as strokes, or null when it is not one of ours. */
export function unpackStrokes(payload) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.strokes)) return null;
  const { width, height } = PHONE_SIGN_PAD;
  const sx = Number(payload.w) > 0 ? width / Number(payload.w) : 1;
  const sy = Number(payload.h) > 0 ? height / Number(payload.h) : 1;
  let budget = PHONE_SIGN_MAX_POINTS;
  const strokes = [];
  for (const flat of payload.strokes) {
    if (!Array.isArray(flat) || budget <= 0) continue;
    const stroke = [];
    for (let i = 0; i + 1 < flat.length && budget > 0; i += 2) {
      const x = Number(flat[i]);
      const y = Number(flat[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      stroke.push({ x: clamp(x * sx, width), y: clamp(y * sy, height) });
      budget -= 1;
    }
    if (stroke.length) strokes.push(stroke);
  }
  return strokes.length ? strokes : null;
}

/** The token in /sign/<token>, or null. */
export function phoneSignTokenFromPath(pathname) {
  const match = /^\/sign\/([^/?#]+)\/?$/.exec(pathname || '');
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  return UUID_RE.test(token) ? token.toLowerCase() : null;
}

/**
 * The link the phone opens. A web page uses its own site (so Nightly sends
 * the phone to Nightly); the desktop and phone apps run from file:// or
 * localhost, which a phone can't reach, so they use surveytool.app.
 */
export function phoneSignUrl(token, win = (typeof window !== 'undefined' ? window : undefined)) {
  const loc = win?.location;
  const native = Boolean(win?.Capacitor?.isNativePlatform?.()) || Boolean(win?.electronAPI);
  const web = loc && /^https?:$/i.test(loc.protocol || '') && !native;
  const origin = web ? loc.origin : 'https://surveytool.app';
  return `${origin}/sign/${encodeURIComponent(token)}`;
}

const newToken = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null);

/** Make a request row for the signed-in user. Resolves to { token } or { error }. */
export async function createPhoneSignRequest(client = supabase) {
  if (!client) return { error: 'offline' };
  const { data } = await client.auth.getSession();
  const userId = data?.session?.user?.id;
  if (!userId) return { error: 'signed-out' };
  const token = newToken();
  if (!token) return { error: 'no-random' };
  const { error } = await client.from('phone_signatures').insert({ token, user_id: userId });
  if (error) return { error: error.message || 'insert-failed' };
  return { token };
}

/** The strokes the phone sent, or null while it hasn't. */
export async function readPhoneSignRequest(token, client = supabase) {
  if (!client || !token) return null;
  const { data, error } = await client
    .from('phone_signatures')
    .select('payload')
    .eq('token', token)
    .maybeSingle();
  if (error || !data?.payload) return null;
  return unpackStrokes(data.payload);
}

export async function dropPhoneSignRequest(token, client = supabase) {
  if (!client || !token) return;
  try {
    await client.from('phone_signatures').delete().eq('token', token);
  } catch (_e) { /* the server drops old rows itself */ }
}

/** Phone side: send the strokes. Resolves true once the computer can read them. */
export async function submitPhoneSignature(token, strokes, client = supabase) {
  if (!client || !token) return false;
  const payload = packStrokes(strokes);
  if (!payload.strokes.length) return false;
  const { data, error } = await client.rpc('submit_phone_signature', { p_token: token, p_payload: payload });
  return !error && data === true;
}
