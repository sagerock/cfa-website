import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Staged, closed pilot only. Does not change shared Auth email templates,
// attach identities to contacts, or grant enrollment/access entitlements.
Deno.serve(async (request: Request) => {
  const configuredOrigin = Deno.env.get('SCHOLARSHIP_ORIGIN') || '';
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Origin': configuredOrigin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (!configuredOrigin || origin !== configuredOrigin) return json({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (Deno.env.get('SCHOLARSHIP_PILOT_ENABLED') !== 'true') return json({ error: 'Intake is not open' }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 1024) return json({ error: 'Invalid request' }, 400);
    const body = JSON.parse(raw);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Invalid email' }, 400);
    // Required until abuse protection and real intake are approved. Never return
    // whether an address is on the invitation list.
    const invitees = (Deno.env.get('SCHOLARSHIP_PILOT_EMAILS') || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    if (!invitees.includes(email)) return json({ ok: true });
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const sendgrid = Deno.env.get('SENDGRID_API_KEY');
    const hashSecret = Deno.env.get('SCHOLARSHIP_RATE_SECRET');
    if (!url || !key || !sendgrid || !hashSecret) return json({ error: 'Service unavailable' }, 503);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(hashSecret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(email));
    const hash = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('');
    const quota = await admin.rpc('cfa_scholarship_claim_signin', { p_hash: hash });
    if (quota.error) return json({ error: 'Service unavailable' }, 503);
    if (!quota.data) return json({ ok: true });
    // generateLink creates the user when necessary, and gives an email OTP to
    // send ourselves. Supabase verifies expiry and single use via verifyOtp.
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data.properties?.email_otp) return json({ error: 'Unable to send code' }, 503);
    const code = data.properties.email_otp;
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { Authorization: `Bearer ${sendgrid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: 'no-reply@centerforanthroposophy.org', name: 'Center for Anthroposophy' },
        subject: 'Your CfA scholarship sign-in code',
        content: [{ type:'text/plain', value:`Your one-time sign-in code is: ${code}\n\nEnter it in the CfA scholarship portal. It expires according to the portal's sign-in settings and can be used once. Never share this code. If you did not request it, ignore this email.\n\nCenter for Anthroposophy` }],
        tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
      }),
    });
    if (!response.ok) return json({ error: 'Unable to send code' }, 503);
    return json({ ok: true });
  } catch { return json({ error: 'Unable to process request' }, 400); }
});
