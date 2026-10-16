// cfa-forms: no-payment Kairos forms on learn.* (financial aid, inquiry).
// GET  ?form=<key>  -> { turnstile_site_key }
// POST { form, turnstile_token, company (honeypot), source_path, ...fields }
// Saves to cfa_form_submissions, then emails the form's recipients through SendGrid
// with Reply-To set to the applicant. Field definitions and recipients live in
// ../_shared/kairosForms.js.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { KAIROS_FORMS, submissionText, validateSubmission } from "../_shared/kairosForms.js";

const productionOrigin = "https://learn.centerforanthroposophy.org";
const productionHostname = new URL(productionOrigin).hostname;
const allowedOrigins = new Set([productionOrigin, "https://cfa-website-bqx.pages.dev", "http://localhost:4321"]);

function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".cfa-website-bqx.pages.dev");
  } catch {
    return false;
  }
}

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin! : productionOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
    "Vary": "Origin",
  };
}

function json(obj: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors(origin), "content-type": "application/json" } });
}

function parseFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  return match ? { name: match[1].trim(), email: match[2].trim() } : { email: value.trim() };
}

function recipients(formKey: string): string[] {
  const envKey = "FORM_NOTIFY_" + formKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const override = (Deno.env.get(envKey) || "").split(",").map((s) => s.trim()).filter(Boolean);
  return override.length ? override : KAIROS_FORMS[formKey as keyof typeof KAIROS_FORMS].notify;
}

async function verifyTurnstile(token: string, remoteIp: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
  if (!secret) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };
    const ok = result.success === true && result.hostname === productionHostname && result.action === "form";
    if (!ok) console.error("turnstile_verification_failed", JSON.stringify({ success: result.success, hostname: result.hostname, action: result.action, error_codes: result["error-codes"] }));
    return ok;
  } catch {
    return false;
  }
}

async function notify(formKey: string, values: Record<string, string>) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) return { sent: false, error: "no SENDGRID_API_KEY" };
  const form = KAIROS_FORMS[formKey as keyof typeof KAIROS_FORMS];
  const from = Deno.env.get("REGISTRATION_FROM") || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const name = `${values.first_name} ${values.last_name}`.trim();
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: recipients(formKey).map((email) => ({ email })) }],
      from: parseFrom(from),
      reply_to: { email: values.email, name },
      subject: `${form.subject}: ${name}`,
      content: [{ type: "text/plain", value: submissionText(formKey, values) }],
    }),
  });
  return res.ok ? { sent: true } : { sent: false, error: `sendgrid ${res.status}: ${(await res.text()).slice(0, 300)}` };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });

  if (req.method === "GET") {
    const formKey = new URL(req.url).searchParams.get("form") || "";
    if (!(formKey in KAIROS_FORMS)) return json({ ok: false, error: "Unknown form." }, 404, origin);
    const siteKey = Deno.env.get("TURNSTILE_SITE_KEY") || "";
    const configured = Boolean(siteKey && Deno.env.get("TURNSTILE_SECRET_KEY"));
    return json({ ok: true, turnstile_site_key: configured ? siteKey : null }, 200, origin);
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, origin);
  if (!isAllowedOrigin(origin)) return json({ ok: false, error: "Forbidden." }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Bad request." }, 400, origin); }
  if (body.company) return json({ ok: true }, 200, origin); // honeypot

  const formKey = String(body.form || "");
  const checked = validateSubmission(formKey, body);
  if (!checked.ok) return json({ ok: false, error: checked.error }, 400, origin);

  const turnstileOn = Boolean(Deno.env.get("TURNSTILE_SITE_KEY") && Deno.env.get("TURNSTILE_SECRET_KEY"));
  if (turnstileOn) {
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const token = String(body.turnstile_token || "");
    if (!token || !(await verifyTurnstile(token, ip))) {
      return json({ ok: false, error: "We could not confirm you are not a robot. Please try again." }, 400, origin);
    }
  }

  const values = checked.values as Record<string, string>;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: row, error } = await supabase.from("cfa_form_submissions").insert({
    form_key: formKey,
    email: values.email.toLowerCase(),
    first_name: values.first_name,
    last_name: values.last_name,
    data: values,
    source_path: String(body.source_path || "").slice(0, 300),
  }).select("id").single();
  if (error) {
    console.error("form_save_failed", formKey, error.message);
    return json({ ok: false, error: "We could not save your form. Please try again, or email lisl@centerforanthroposophy.org." }, 500, origin);
  }

  let mail: { sent: boolean; error?: string };
  try { mail = await notify(formKey, values); } catch (e) { mail = { sent: false, error: String(e).slice(0, 300) }; }
  await supabase.from("cfa_form_submissions").update({ notified: mail.sent, notify_error: mail.error || null }).eq("id", row.id);
  if (!mail.sent) console.error("form_notify_failed", formKey, row.id, mail.error);

  return json({ ok: true }, 200, origin);
});
