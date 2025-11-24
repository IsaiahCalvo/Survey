import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

serve(async (req) => {
  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get request body
    const { changedFields } = await req.json()

    if (!changedFields || changedFields.length === 0) {
      return new Response(JSON.stringify({ error: 'No changed fields provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
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

    // Email HTML content
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background: #4A90E2;
              color: white;
              padding: 20px;
              border-radius: 8px 8px 0 0;
              text-align: center;
            }
            .content {
              background: #f9f9f9;
              padding: 30px;
              border-radius: 0 0 8px 8px;
            }
            .alert-box {
              background: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 20px 0;
            }
            .footer {
              margin-top: 20px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
              font-size: 12px;
              color: #666;
              text-align: center;
            }
            .button {
              display: inline-block;
              padding: 12px 24px;
              background: #4A90E2;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Account Security Alert</h1>
          </div>
          <div class="content">
            <p>Hello ${userName},</p>

            <p>This email confirms that the following information on your Survey account was recently changed:</p>

            <p><strong>Changed: ${fieldList}</strong></p>

            <div class="alert-box">
              <strong>⚠️ If this wasn't you:</strong>
              <p>If you did not make this change, please contact us immediately at:</p>
              <p><strong>isaiahcalvo123@gmail.com</strong></p>
            </div>

            <p>For your security:</p>
            <ul>
              <li>Never share your password with anyone</li>
              <li>Use a strong, unique password</li>
              <li>Contact us if you notice any suspicious activity</li>
            </ul>

            <div class="footer">
              <p>This is an automated security notification from Survey.</p>
              <p>© ${new Date().getFullYear()} Survey. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `

    // Send email using Resend API
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Survey <onboarding@resend.dev>', // Update this with your verified domain
        to: [userEmail],
        subject: `Security Alert: Your ${fieldList} Was Changed`,
        html: emailHtml,
      }),
    })

    if (!res.ok) {
      const error = await res.text()
      console.error('Resend API error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: error }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const data = await res.json()

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
