import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Season reminder emails, ops-only. One enrollment per call; the driver script
// loops the roster. Three templates:
//   template "launch"  — the Mon Aug 31 "begins this Saturday" email (also the
//                        invitation: first the cohort hears of the portal).
//   template "session" — the T-24h reminder with the Zoom link in the email.
//   template "session_1h" — the T-1h reminder with the Zoom link in the email.
// Every email's main button is a fresh durable classroom link (prior links
// stay valid). Every send is recorded in cfa_learn_email_events.

const productionOrigin = "https://learn.centerforanthroposophy.org";
const LINK_EXPIRES_AT = "2027-03-31T00:00:00Z";

function json(body: unknown, status = 200) {
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

function launchEmail(firstName: string, classroomLink: string, sessionLine: string) {
  return {
    subject: "Starlight Rays begins this Saturday",
    text: [
      `Dear ${firstName},`,
      "",
      `Starlight Rays in Darkened Times begins this Saturday, ${sessionLine}.`,
      "",
      "Everything for the seminar lives in your learning portal — the link to",
      "join live, the full season schedule, and your welcome letter. Recordings",
      "will appear there after each session.",
      "",
      "Open your classroom:",
      classroomLink,
      "",
      "Tip: bookmark the page it opens — that's your permanent way in.",
      "",
      "We look forward to seeing you Saturday.",
      "",
      "Warmly,",
      "David Barham and Elsy Ayoub",
      "Center for Anthroposophy",
      "",
      `Lost this email? Sign in any time at ${productionOrigin}/learn/sign-in`,
      "Trouble signing in? Email sage@centerforanthroposophy.org",
    ].join("\n"),
  };
}

function sessionEmail(firstName: string, classroomLink: string, sessionLine: string, zoomUrl: string) {
  return {
    subject: `Starlight Rays is tomorrow — ${sessionLine.split(" with ")[0]}`,
    text: [
      `Dear ${firstName},`,
      "",
      `Starlight Rays meets tomorrow, ${sessionLine}.`,
      "",
      "Join the live seminar here:",
      zoomUrl,
      "",
      "Your classroom — schedule, materials, and the recording afterward:",
      classroomLink,
      "",
      "See you there.",
      "",
      "Warmly,",
      "David Barham and Elsy Ayoub",
      "Center for Anthroposophy",
      "",
      `Lost this email? Sign in any time at ${productionOrigin}/learn/sign-in`,
      "Trouble signing in? Email sage@centerforanthroposophy.org",
    ].join("\n"),
  };
}

function sessionOneHourEmail(firstName: string, classroomLink: string, sessionLine: string, zoomUrl: string) {
  return {
    subject: `Starlight Rays starts in one hour — ${sessionLine.split(" with ")[0]}`,
    text: [
      `Dear ${firstName},`,
      "",
      `Starlight Rays starts in one hour, ${sessionLine}.`,
      "",
      "Join the live seminar here:",
      zoomUrl,
      "",
      "Your classroom — schedule, materials, and the recording afterward:",
      classroomLink,
      "",
      "See you soon.",
      "",
      "Warmly,",
      "David Barham and Elsy Ayoub",
      "Center for Anthroposophy",
      "",
      `Lost this email? Sign in any time at ${productionOrigin}/learn/sign-in`,
      "Trouble signing in? Email sage@centerforanthroposophy.org",
    ].join("\n"),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const opsToken = Deno.env.get("CFA_LEARN_OPS_TOKEN");
  const sendgridKey = Deno.env.get("SENDGRID_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !opsToken || !sendgridKey) {
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
  const template = body.template === "session"
    ? "session"
    : body.template === "session_1h"
      ? "session_1h"
      : body.template === "launch"
        ? "launch"
        : "";
  const sessionLine = typeof body.session_line === "string" ? body.session_line.slice(0, 200) : "";
  const sessionSlug = typeof body.session_slug === "string" ? body.session_slug.slice(0, 100) : "";
  const overrideEmail = typeof body.override_recipient === "string" ? body.override_recipient.trim().toLowerCase() : "";
  if (!/^[0-9a-f-]{36}$/.test(enrollmentId) || !template || !sessionLine || !sessionSlug) {
    return json({ error: "invalid_request" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id, client_id, contact_id, program_id, status, revoked_at, access_scope, access_starts_at, access_ends_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (enrollmentError) return json({ error: "enrollment_lookup_failed" }, 500);
  const now = Date.now();
  if (!enrollment
    || enrollment.status !== "registered"
    || enrollment.revoked_at
    || new Date(enrollment.access_starts_at).getTime() > now
    || (enrollment.access_ends_at && new Date(enrollment.access_ends_at).getTime() <= now)) {
    return json({ error: "enrollment_not_active" }, 404);
  }
  const { data: course, error: courseError } = await admin
    .from("cfa_learn_courses")
    .select("id")
    .eq("program_id", enrollment.program_id)
    .eq("published", true)
    .maybeSingle();
  if (courseError || !course) return json({ error: "course_lookup_failed" }, 500);
  const { data: session, error: sessionError } = await admin
    .from("cfa_learn_sessions")
    .select("id, zoom_url")
    .eq("course_id", course.id)
    .eq("slug", sessionSlug)
    .eq("published", true)
    .maybeSingle();
  if (sessionError || !session) return json({ error: "session_lookup_failed" }, 500);
  if (template !== "launch" && !session.zoom_url) {
    return json({ error: "session_join_link_missing" }, 409);
  }
  if (enrollment.access_scope === "sessions") {
    const { data: sessionAccess, error: sessionAccessError } = await admin
      .from("enrollment_session_access")
      .select("session_id")
      .eq("enrollment_id", enrollment.id)
      .eq("session_id", session.id)
      .maybeSingle();
    if (sessionAccessError) return json({ error: "session_access_lookup_failed" }, 500);
    if (!sessionAccess) return json({ error: "session_access_required" }, 403);
  }
  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, email, first_name")
    .eq("id", enrollment.contact_id)
    .eq("client_id", enrollment.client_id)
    .maybeSingle();
  if (contactError || !contact?.email) return json({ error: "contact_lookup_failed" }, 500);

  // Fresh durable link for this email; earlier links stay valid.
  const rawToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const { error: linkInsertError } = await admin.from("cfa_learn_access_links").insert({
    client_id: enrollment.client_id,
    contact_id: enrollment.contact_id,
    enrollment_id: enrollment.id,
    token_hash: tokenHash,
    expires_at: LINK_EXPIRES_AT,
  });
  if (linkInsertError) return json({ error: "link_create_failed" }, 500);
  const classroomLink = `${productionOrigin}/learn/go?k=${rawToken}`;

  const firstName = contact.first_name || "colleague";
  const message = template === "launch"
    ? launchEmail(firstName, classroomLink, sessionLine)
    : template === "session_1h"
      ? sessionOneHourEmail(firstName, classroomLink, sessionLine, session.zoom_url!)
      : sessionEmail(firstName, classroomLink, sessionLine, session.zoom_url!);
  const recipient = overrideEmail || contact.email;

  const from = Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { "Authorization": `Bearer ${sendgridKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: recipient }] }],
      from: parseFrom(from),
      reply_to: { email: "office@centerforanthroposophy.org", name: "Center for Anthroposophy" },
      subject: message.subject,
      content: [{ type: "text/plain", value: message.text }],
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    }),
  });
  const sent = response.ok;
  const providerMessageId = response.headers.get("X-Message-Id");

  const { data: event, error: eventError } = await admin
    .from("cfa_learn_email_events")
    .insert({
      enrollment_id: enrollment.id,
      message_type: template === "launch" ? "welcome" : "session_reminder",
      status: sent ? "sent" : "failed",
      provider_message_id: providerMessageId,
      sent_at: sent ? new Date().toISOString() : null,
      recipient_email: recipient,
    })
    .select("id")
    .single();
  if (eventError) return json({ error: "event_record_failed", email_sent: sent }, 500);

  return json({ ok: sent, event_id: event.id, recipient, template }, sent ? 200 : 502);
});
