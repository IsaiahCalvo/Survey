import { createClient } from 'npm:@supabase/supabase-js@2.110.8'
import {
  renderEmailLayout,
  EMAIL_DANGER,
  EMAIL_GOLD,
  EMAIL_P_STYLE as P,
  EMAIL_FINE_STYLE as FINE,
} from '../_shared/emailLayout.ts'

// Transactional email via Brevo (consolidated to one email service 2026-07-05).
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')

const corsHeaders = {
  // ⚠️ INTENTIONAL — do NOT tighten to an origin allowlist (false positive if an
  // audit flags it). Same bundle ships to web + Electron prod (file:// → Origin:
  // null) + Capacitor iOS/Android; an allowlist CORS-breaks email/Excel/payments
  // on desktop+mobile, and Electron would then need Origin:null allowed — the very
  // hole tightening tries to close. Bearer-token auth (not cookies) ⇒ '*' is
  // non-exploitable. Why: CLAUDE.md "DO NOT BREAK" + HANDOFF-post-launch-hardening.md
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const escapeHtml = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create Supabase client with the user's auth token
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    // Verify the user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get request body
    const { changedFields } = await req.json()

    if (!changedFields || changedFields.length === 0) {
      return new Response(JSON.stringify({ error: 'No changed fields provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get user's email and name
    const userEmail = user.email
    const userName = user.user_metadata?.full_name || user.email

    // Create field list for email
    const fieldList = changedFields.map((field: string) => {
      if (field === 'name') return 'Name (First/Last)'
      if (field === 'password') return 'Password'
      return field
    }).join(' and ')

    // Email HTML content — rendered through the shared branded frame
    // (supabase/functions/_shared/emailLayout.ts, docs/design/email-style-guide.md).
    const emailHtml = renderEmailLayout({
      heading: 'Your account was updated',
      headingColor: EMAIL_DANGER,
      preheader: `Changed: ${fieldList}. If this wasn't you, act now.`,
      footerReason: `You're receiving this because your Survey account details changed.`,
      bodyHtml:
        `<p style="${P}">Hello ${escapeHtml(userName)},</p>` +
        `<p style="${P}">This email confirms that the following information on your Survey account was recently changed: <strong>${escapeHtml(fieldList)}</strong>. If you made this change, no action is needed.</p>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-tile" ` +
        `style="margin:20px 0 0;background-color:#faf9f6;border:1px solid #e5e0d4;border-left:4px solid ${EMAIL_GOLD};border-radius:8px;">` +
        `<tr><td style="padding:14px 16px;font-family:-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.5;">` +
        `<span class="em-ink" style="color:#1a1d24;"><strong>If this wasn't you:</strong> reset your password immediately and contact us at ` +
        `<strong>isaiahcalvo123@gmail.com</strong> &#8212; someone may have access to your account.</span>` +
        `</td></tr></table>` +
        `<p style="${FINE}" class="em-mut">This is an automated security notification from Survey.</p>`,
    })

    // Send email via Brevo transactional API (one email service across the app)
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Survey', email: 'no-reply@surveytool.app' },
        to: [{ email: userEmail }],
        subject: `Security Alert: Your ${fieldList} Was Changed`,
        htmlContent: emailHtml,
      }),
    })

    if (!res.ok) {
      const error = await res.text()
      console.error('Brevo API error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: error }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const data = await res.json()

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
