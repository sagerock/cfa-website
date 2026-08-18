import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Operations-only endpoint: sends (or resends) the portal welcome email for one
// central enrollment and records the delivery in cfa_learn_email_events.
// Callers must present the dedicated CFA_LEARN_OPS_TOKEN; there is deliberately
// no CORS support and no browser path. Used by the gate-4 check and the
// invitation wave.

const productionOrigin = "https://learn.centerforanthroposophy.org";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function parseFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  return match
    ? { name: match[1].trim(), email: match[2].trim() }
    : { email: value.trim() };
}

async function sendPortalWelcome(input: {
  email: string;
  firstName: string;
  courseTitle: string;
  signInLink: string;
}): Promise<{ ok: boolean; providerMessageId: string | null }> {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) return { ok: false, providerMessageId: null };
  const from = Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const emailText = [
    `Dear ${input.firstName},`,
    "",
    `Welcome to ${input.courseTitle}.`,
    "",
    "Your learning portal holds the live-seminar Zoom link, session recordings,",
    "and course resources. Use this secure link to sign in — no password needed:",
    "",
    input.signInLink,
    "",
    "The link is personal to you. If it expires, request a fresh one any time at",
    `${productionOrigin}/learn/sign-in`,
    "",
    "If you have questions, contact office@centerforanthroposophy.org.",
    "",
    "Warmly,",
    "David Barham and Elsy Ayoub",
    "Center for Anthroposophy",
  ].join("\n");
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.email }] }],
      from: parseFrom(from),
      reply_to: { email: "office@centerforanthroposophy.org", name: "Center for Anthroposophy" },
      subject: `Your ${input.courseTitle} learning portal`,
      content: [{ type: "text/plain", value: emailText }],
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    }),
  });
  return {
    ok: response.ok,
    providerMessageId: response.headers.get("X-Message-Id"),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const opsToken = Deno.env.get("CFA_LEARN_OPS_TOKEN");
  if (!supabaseUrl || !serviceRoleKey || !opsToken) {
    return json({ error: "server_configuration" }, 500);
  }

  const presented = request.headers.get("X-Cfa-Ops-Token") ?? "";
  if (!presented || presented !== opsToken) {
    return json({ error: "service_authorization_required" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const enrollmentId = typeof body.enrollment_id === "string" ? body.enrollment_id : "";
  if (!/^[0-9a-f-]{36}$/.test(enrollmentId)) return json({ error: "invalid_enrollment" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id, client_id, program_id, contact_id, status, revoked_at, access_starts_at, access_ends_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (enrollmentError) return json({ error: "enrollment_lookup_failed" }, 500);
  if (!enrollment || enrollment.status !== "registered" || enrollment.revoked_at) {
    return json({ error: "enrollment_not_active" }, 404);
  }

  const { data: course, error: courseError } = await admin
    .from("cfa_learn_courses")
    .select("slug, title")
    .eq("program_id", enrollment.program_id)
    .eq("published", true)
    .maybeSingle();
  if (courseError || !course) return json({ error: "course_lookup_failed" }, 500);

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, email, first_name, last_name")
    .eq("id", enrollment.contact_id)
    .eq("client_id", enrollment.client_id)
    .maybeSingle();
  if (contactError || !contact?.email) return json({ error: "contact_lookup_failed" }, 500);

  // Ensure the Auth user exists (idempotent: creation failure for an existing
  // address is fine because generateLink resolves the user by email).
  await admin.auth.admin.createUser({
    email: contact.email,
    email_confirm: true,
    user_metadata: { first_name: contact.first_name, last_name: contact.last_name },
  });
  const redirectTo = Deno.env.get("LEARN_REDIRECT_URL")
    || `${productionOrigin}/learn/auth?next=/learn/${course.slug}`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: contact.email,
    options: { redirectTo },
  });
  if (linkError || !linkData.user || !linkData.properties?.hashed_token) {
    return json({ error: "auth_provisioning_failed" }, 500);
  }

  // Ensure the client-scoped identity bridge; never silently re-link an
  // identity that already points elsewhere.
  const { data: identity, error: identityError } = await admin
    .from("client_auth_identities")
    .select("contact_id")
    .eq("user_id", linkData.user.id)
    .eq("client_id", enrollment.client_id)
    .maybeSingle();
  if (identityError) return json({ error: "identity_lookup_failed" }, 500);
  if (identity && identity.contact_id !== enrollment.contact_id) {
    return json({ error: "identity_conflict" }, 409);
  }
  if (!identity) {
    const { error: identityInsertError } = await admin
      .from("client_auth_identities")
      .insert({
        client_id: enrollment.client_id,
        contact_id: enrollment.contact_id,
        user_id: linkData.user.id,
      });
    if (identityInsertError) return json({ error: "identity_conflict" }, 409);
  }

  const signInUrl = new URL(`${productionOrigin}/learn/auth`);
  signInUrl.searchParams.set("token_hash", linkData.properties.hashed_token);
  signInUrl.searchParams.set("type", "email");

  const { data: priorEvent } = await admin
    .from("cfa_learn_email_events")
    .select("id")
    .eq("enrollment_id", enrollment.id)
    .eq("message_type", "welcome")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sendResult = await sendPortalWelcome({
    email: contact.email,
    firstName: contact.first_name || "colleague",
    courseTitle: course.title,
    signInLink: signInUrl.toString(),
  });

  const { data: event, error: eventError } = await admin
    .from("cfa_learn_email_events")
    .insert({
      enrollment_id: enrollment.id,
      message_type: "welcome",
      status: sendResult.ok ? "sent" : "failed",
      provider_message_id: sendResult.providerMessageId,
      sent_at: sendResult.ok ? new Date().toISOString() : null,
      recipient_email: contact.email,
      resend_of: priorEvent?.id ?? null,
    })
    .select("id")
    .single();
  if (eventError) return json({ error: "event_record_failed", email_sent: sendResult.ok }, 500);

  return json({
    ok: sendResult.ok,
    event_id: event.id,
    resend_of: priorEvent?.id ?? null,
    email_sent: sendResult.ok,
  }, sendResult.ok ? 200 : 502);
});
