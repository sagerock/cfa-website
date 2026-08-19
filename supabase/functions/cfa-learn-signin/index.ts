import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Self-service sign-in links for the learning portal, CfA-branded and sent via
// SendGrid so the shared project's Supabase Auth template (branded for other
// apps) is never involved. Anti-enumeration: the response is {ok:true} for
// every well-formed request; only enrolled participants actually receive mail.
// Recorded sends double as the rate-limit state (3 per address per 15 min).

const productionOrigin = "https://learn.centerforanthroposophy.org";
const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const RATE_LIMIT_PER_WINDOW = 3;
const RATE_WINDOW_MINUTES = 15;

const allowedOrigins = new Set([
  "https://learn.centerforanthroposophy.org",
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : "https://learn.centerforanthroposophy.org";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function parseFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  return match
    ? { name: match[1].trim(), email: match[2].trim() }
    : { email: value.trim() };
}

async function sendSignInEmail(email: string, firstName: string, signInLink: string) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) return { ok: false, providerMessageId: null };
  const from = Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const emailText = [
    `Dear ${firstName},`,
    "",
    "Here is your secure sign-in link for the Center for Anthroposophy",
    "learning portal:",
    "",
    signInLink,
    "",
    "The link is personal to you and expires shortly. If it has expired,",
    `request a fresh one any time at ${productionOrigin}/learn/sign-in`,
    "",
    "If you didn't request this, you can safely ignore this email.",
    "",
    "Warmly,",
    "Center for Anthroposophy",
    "office@centerforanthroposophy.org",
  ].join("\n");
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: parseFrom(from),
      reply_to: { email: "office@centerforanthroposophy.org", name: "Center for Anthroposophy" },
      subject: "Your Center for Anthroposophy sign-in link",
      content: [{ type: "text/plain", value: emailText }],
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    }),
  });
  return { ok: response.ok, providerMessageId: response.headers.get("X-Message-Id") };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration" }, 500, origin);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return json({ error: "invalid_email" }, 400, origin);
  }

  // Every path below returns the same success body so the endpoint does not
  // reveal who is enrolled.
  const anonymousOk = json({ ok: true }, 200, origin);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: contact } = await admin
    .from("contacts")
    .select("id, first_name")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("email", email)
    .maybeSingle();
  if (!contact) return anonymousOk;

  const { data: courses } = await admin
    .from("cfa_learn_courses")
    .select("program_id")
    .eq("published", true);
  const programIds = (courses || []).map((course) => course.program_id);
  if (!programIds.length) return anonymousOk;

  const now = new Date().toISOString();
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id, access_starts_at, access_ends_at, revoked_at")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("contact_id", contact.id)
    .eq("status", "registered")
    .in("program_id", programIds)
    .is("revoked_at", null)
    .lte("access_starts_at", now)
    .order("access_starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!enrollment) return anonymousOk;
  if (enrollment.access_ends_at && new Date(enrollment.access_ends_at).getTime() <= Date.now()) {
    return anonymousOk;
  }

  const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count: recentSends } = await admin
    .from("cfa_learn_email_events")
    .select("id", { count: "exact", head: true })
    .eq("recipient_email", email)
    .eq("message_type", "sign_in_link")
    .gte("created_at", windowStart);
  if ((recentSends || 0) >= RATE_LIMIT_PER_WINDOW) return anonymousOk;

  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { first_name: contact.first_name },
  });
  const redirectTo = Deno.env.get("LEARN_REDIRECT_URL") || `${productionOrigin}/learn/auth`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (linkError || !linkData.user || !linkData.properties?.hashed_token) return anonymousOk;

  const { data: identity } = await admin
    .from("client_auth_identities")
    .select("contact_id")
    .eq("user_id", linkData.user.id)
    .eq("client_id", CFA_CLIENT_ID)
    .maybeSingle();
  if (identity && identity.contact_id !== contact.id) return anonymousOk;
  if (!identity) {
    const { error: identityInsertError } = await admin
      .from("client_auth_identities")
      .insert({ client_id: CFA_CLIENT_ID, contact_id: contact.id, user_id: linkData.user.id });
    if (identityInsertError) return anonymousOk;
  }

  const signInUrl = new URL(`${productionOrigin}/learn/auth`);
  signInUrl.searchParams.set("token_hash", linkData.properties.hashed_token);
  signInUrl.searchParams.set("type", "email");

  const sendResult = await sendSignInEmail(email, contact.first_name || "colleague", signInUrl.toString());

  await admin.from("cfa_learn_email_events").insert({
    enrollment_id: enrollment.id,
    message_type: "sign_in_link",
    status: sendResult.ok ? "sent" : "failed",
    provider_message_id: sendResult.providerMessageId,
    sent_at: sendResult.ok ? new Date().toISOString() : null,
    recipient_email: email,
  });

  return anonymousOk;
});
