import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Free-event reminders, ops-only (X-Cfa-Ops-Token). One registration per call;
// the sagerock-jobs runner (cfa-event-reminders) loops the eligible list.
//
// POST { reminder_key, registration_id }
//   Sends that reminder to that registrant, cc the reminder's cc list, from
//   CfA's address with replies to office@. The wording, cc and skip lists live
//   in cfa_event_reminders (migration 20261110120000).
//
// Never twice: a cfa_event_reminder_sends row is reserved BEFORE SendGrid is
// called. If one exists the call returns { ok: true, skipped: "already_sent" }
// (or "in_flight") and sends nothing. Only a 'failed' row, where SendGrid
// refused the message, is retried. Eligibility (not test, not voided, enrollment
// active, not on the skip list) comes from cfa_event_reminder_recipients, so a
// caller can't reach anyone outside it. The schedule (enabled, send_at,
// stop_at) is the runner's job; a one-off test send calls this directly.

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
  const reminderKey = typeof body.reminder_key === "string" ? body.reminder_key : "";
  const registrationId = typeof body.registration_id === "string" ? body.registration_id : "";
  if (!/^[a-z0-9][a-z0-9-]{2,99}$/.test(reminderKey) || !/^[0-9a-f-]{36}$/.test(registrationId)) {
    return json({ error: "invalid_request" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: reminder, error: reminderError } = await admin
    .from("cfa_event_reminders")
    .select("key, subject, body_template, cc_emails")
    .eq("key", reminderKey)
    .maybeSingle();
  if (reminderError) return json({ error: "reminder_lookup_failed" }, 500);
  if (!reminder) return json({ error: "reminder_not_found" }, 404);

  const { data: recipients, error: recipientsError } = await admin
    .rpc("cfa_event_reminder_recipients", { requested_key: reminderKey });
  if (recipientsError) return json({ error: "recipient_lookup_failed" }, 500);
  const recipient = (recipients as Array<{ registration_id: string; email: string; first_name: string | null }> || [])
    .find((row) => row.registration_id === registrationId);
  if (!recipient) return json({ error: "registration_not_eligible" }, 404);

  const to = recipient.email.trim().toLowerCase();
  // SendGrid rejects an address that appears in both to and cc.
  const cc = Array.from(new Set((reminder.cc_emails as string[] || [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && value !== to)));

  // Reserve. The unique (reminder_key, registration_id) key makes this the
  // one place that decides whether a send happens.
  const { data: reserved, error: reserveError } = await admin
    .from("cfa_event_reminder_sends")
    .insert({ reminder_key: reminderKey, registration_id: registrationId, recipient_email: to, cc_emails: cc })
    .select("id")
    .maybeSingle();
  let sendId = reserved?.id as string | undefined;
  if (reserveError) {
    if (reserveError.code !== "23505") return json({ error: "reserve_failed" }, 500);
    const { data: existing } = await admin
      .from("cfa_event_reminder_sends")
      .select("id, status, attempts")
      .eq("reminder_key", reminderKey)
      .eq("registration_id", registrationId)
      .maybeSingle();
    if (!existing) return json({ error: "reserve_failed" }, 500);
    if (existing.status !== "failed") {
      return json({
        ok: true,
        skipped: existing.status === "sent" ? "already_sent" : "in_flight",
        send_id: existing.id,
      });
    }
    // Retry a refused send, but only if nobody else claimed it first.
    const { data: retried } = await admin
      .from("cfa_event_reminder_sends")
      .update({ status: "sending", error: null, attempts: (existing.attempts || 1) + 1, recipient_email: to, cc_emails: cc })
      .eq("id", existing.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (!retried) return json({ ok: true, skipped: "in_flight", send_id: existing.id });
    sendId = retried.id;
  }

  const firstName = recipient.first_name || "friend";
  const text = String(reminder.body_template).replaceAll("{first_name}", firstName);
  const from = Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const personalization: Record<string, unknown> = { to: [{ email: to }] };
  if (cc.length) personalization.cc = cc.map((email) => ({ email }));

  let sent = false;
  let providerMessageId: string | null = null;
  let failure: string | null = null;
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${sendgridKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [personalization],
        from: parseFrom(from),
        reply_to: { email: "office@centerforanthroposophy.org", name: "Center for Anthroposophy" },
        subject: reminder.subject,
        content: [{ type: "text/plain", value: text }],
        tracking_settings: { click_tracking: { enable: false, enable_text: false } },
      }),
    });
    sent = response.ok;
    providerMessageId = response.headers.get("X-Message-Id");
    if (!sent) failure = `sendgrid_${response.status}: ${(await response.text()).slice(0, 300)}`;
  } catch (error) {
    // Delivery unknown: leave the row 'sending' so nobody retries it blindly.
    await admin.from("cfa_event_reminder_sends")
      .update({ error: `transport: ${String(error).slice(0, 300)}` })
      .eq("id", sendId);
    return json({ ok: false, error: "delivery_unknown", send_id: sendId }, 502);
  }

  await admin.from("cfa_event_reminder_sends").update({
    status: sent ? "sent" : "failed",
    provider_message_id: providerMessageId,
    error: failure,
    sent_at: sent ? new Date().toISOString() : null,
  }).eq("id", sendId);

  return json({ ok: sent, send_id: sendId, recipient: to, cc, reminder_key: reminderKey }, sent ? 200 : 502);
});
