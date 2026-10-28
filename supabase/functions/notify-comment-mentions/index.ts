// Email the people @mentioned in a comment on a mark (mark_comments, Nightly
// flag 'mark-comments'). The app calls this right after posting. Only the
// comment's author may ask, once, within a few minutes of posting; the
// recipients come from the stored comment (add_mark_comment keeps only people
// on the document), never from the request. Each email counts against the
// author's hourly email allowance (claim_email_send).
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { parseBody, s } from '../_shared/inputSchema.js';
import {
  renderEmailLayout,
  emailButton,
  EMAIL_P_STYLE as P,
  EMAIL_FINE_STYLE as FINE,
} from '../_shared/emailLayout.ts';
import {
  commentExcerpt,
  commentLink,
  isUuid,
  mentionEmailRefusal,
  mentionRecipients,
} from '../_shared/commentMentions.js';
import { GUEST_REFUSED_MESSAGE, isGuestUser } from '../_shared/guestSession.js';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')?.trim() || null;
const EMAIL_SENDER = { name: 'Survey', email: 'no-reply@surveytool.app' };

const corsHeaders = {
  // ⚠️ INTENTIONAL — do NOT tighten to an origin allowlist (CLAUDE.md "DO NOT
  // BREAK"): one bundle runs on web, Electron (Origin: null) and Capacitor;
  // Bearer-token auth makes '*' safe.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const escapeHtml = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return reply({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return reply({ error: 'Unauthorized' }, 401);
  // A guest's comment sends no email (guests can mention, the team is not emailed by strangers).
  if (isGuestUser(user)) return reply({ error: GUEST_REFUSED_MESSAGE }, 403);

  const parsed = parseBody({
    commentId: s.string({ max: 64 }),
    origin: s.string({ max: 200, optional: true }),
  }, await req.json().catch(() => ({})));
  if (!parsed.ok || !isUuid(parsed.value.commentId as string)) return reply({ error: 'Bad request' }, 400);
  const { commentId, origin } = parsed.value as { commentId: string; origin?: string };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: comment } = await admin.from('mark_comments').select('*').eq('id', commentId).maybeSingle();
  const refusal = mentionEmailRefusal(comment, user.id);
  if (refusal) return reply({ sent: 0, reason: refusal }, refusal === 'not-found' || refusal === 'not-author' ? 404 : 200);
  const recipients = mentionRecipients(comment);
  if (recipients.length === 0) return reply({ sent: 0 });

  // Claim the comment first, so two calls never both send.
  const { data: claimed } = await admin.from('mark_comments')
    .update({ mentions_notified_at: new Date().toISOString() })
    .eq('id', commentId)
    .is('mentions_notified_at', null)
    .select('id');
  if (!claimed?.length) return reply({ sent: 0, reason: 'already-sent' });
  if (!BREVO_API_KEY) {
    console.error('[notify-comment-mentions] BREVO_API_KEY is not set');
    return reply({ error: 'Email is not set up' }, 500);
  }

  const { data: doc } = await admin.from('documents').select('id, name').eq('id', comment.document_id).maybeSingle();
  const authorName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Someone';
  const link = commentLink(origin, comment.document_id, comment.id);
  const docName = doc?.name || 'a document';
  const html = renderEmailLayout({
    heading: `${escapeHtml(authorName)} mentioned you`,
    preheader: escapeHtml(commentExcerpt(comment.body, 120)),
    bodyHtml:
      `<p style="${P}">${escapeHtml(authorName)} mentioned you in a comment on <strong>${escapeHtml(docName)}</strong>, page ${Number(comment.page_number) || 1}:</p>` +
      `<p style="${P}border-left:3px solid #d0d5dd;padding-left:12px;">${escapeHtml(commentExcerpt(comment.body))}</p>` +
      emailButton('Open the comment', escapeHtml(link)) +
      `<p style="${FINE}">You get this because someone on the document mentioned you.</p>`,
    footerReason: 'You were mentioned in a comment in Survey.',
  });
  const subject = `${authorName} mentioned you in ${docName}`.slice(0, 180);

  let sent = 0;
  for (const recipientId of recipients) {
    const { data: person } = await admin.auth.admin.getUserById(recipientId);
    const email = person?.user?.email;
    if (!email) continue;
    const { data: allowed, error: claimError } = await caller.rpc('claim_email_send', {
      p_template: 'comment-mention',
      p_recipient: email,
      p_is_invite: false,
    });
    if (claimError || allowed !== 'allowed') {
      console.warn('[notify-comment-mentions] not sent:', claimError?.message || allowed);
      continue;
    }
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: EMAIL_SENDER, to: [{ email }], subject, htmlContent: html }),
    });
    if (res.ok) sent += 1;
    else console.error('[notify-comment-mentions] Brevo error', res.status, await res.text());
  }
  return reply({ sent });
});
