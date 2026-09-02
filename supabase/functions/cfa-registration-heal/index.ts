import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendInstitutionRosterConfirmation } from "../_shared/institutionRosterEmail.ts";

// Finds registrations the gateway has already charged but the site never
// finished — status 'enrollment_pending' with a paid_at and a transaction id —
// and finishes them: the same completion routine cfa-register runs, then the
// welcome (portal sign-in link, or the institution roster link). Both
// routines are safe to re-run. Anything it cannot finish, and anything whose
// payment result is itself unknown (no paid_at: held for review, void pending,
// gateway unreachable), is reported for a human instead — this function never
// touches the gateway.
//
// Born from the 2026-08-26 → 09-02 incident, when a broken completion routine
// left two paying customers without access for a day and nobody was looking.
//
// Guarded like cfa-learn-welcome: X-Cfa-Ops-Token, no CORS, no browser path.
// Deploy with --no-verify-jwt. The desktop cron cron-registration-heal.sh
// (sagerock repo) runs it hourly and heartbeats the Cron Monitor.

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const productionOrigin = "https://learn.centerforanthroposophy.org";
// Give cfa-register's own retries and slow gateway round-trips time to finish.
const STUCK_AFTER_MINUTES = 10;

type JsonRecord = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type AdminClient = any;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, maxLength: number) {
  return value == null ? "" : String(value).trim().slice(0, maxLength);
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${(local || "").slice(0, 2)}***@${domain || ""}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorText(error: unknown) {
  if (!error) return "";
  if (typeof error === "object" && error && "message" in error) return text((error as JsonRecord).message, 300);
  return text(String(error), 300);
}

async function healIndividual(admin: AdminClient, registration: JsonRecord, opsToken: string, supabaseUrl: string) {
  const email = String(registration.email);
  // cfa_complete_registration needs the Auth user to exist; creating an
  // existing one just errors, which is fine.
  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { first_name: registration.first_name, last_name: registration.last_name },
  });
  const { data: rows, error } = await admin.rpc("cfa_complete_registration", {
    requested_registration_id: registration.id,
    requested_gateway_transaction_id: registration.gateway_transaction_id,
    requested_gateway_response: registration.gateway_response ?? {},
  });
  if (error) return { ok: false, step: "complete", message: errorText(error) };
  const completion = Array.isArray(rows) ? rows[0] : rows;
  const enrollmentId = text((completion as JsonRecord | undefined)?.enrollment_id, 36);
  if (!enrollmentId) return { ok: false, step: "complete", message: "completion returned no enrollment id" };

  // The portal welcome via the same function the office uses to resend it, so
  // the delivery is recorded in cfa_learn_email_events like any other.
  let welcome = false;
  let welcomeMessage = "";
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/cfa-learn-welcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Cfa-Ops-Token": opsToken },
      body: JSON.stringify({ enrollment_id: enrollmentId }),
    });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    welcome = response.ok && payload.email_sent === true;
    if (!welcome) welcomeMessage = text(payload.error, 100) || `http ${response.status}`;
  } catch {
    welcomeMessage = "welcome request failed";
  }
  if (welcome) {
    await admin.from("registrations").update({ welcome_sent_at: new Date().toISOString() }).eq("id", registration.id);
  }
  return { ok: true, step: "complete", enrollment_id: enrollmentId, welcome, welcome_message: welcomeMessage };
}

async function healInstitution(admin: AdminClient, registration: JsonRecord, seatLimit: number) {
  const rawToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const { data: rows, error } = await admin.rpc("cfa_complete_institution_registration", {
    requested_registration_id: registration.id,
    requested_gateway_transaction_id: registration.gateway_transaction_id,
    requested_gateway_response: registration.gateway_response ?? {},
    requested_roster_token_hash: await sha256(rawToken),
    requested_token_expires_at: "2027-03-31T23:59:59Z",
  });
  if (error) return { ok: false, step: "complete", message: errorText(error) };
  const completion = Array.isArray(rows) ? rows[0] : rows;
  const rosterId = text((completion as JsonRecord | undefined)?.roster_id, 36);
  const rosterUrl = `${productionOrigin}/register/starlight-rays-2026-2027/roster#${rawToken}`;
  const confirmation = await sendInstitutionRosterConfirmation({
    email: String(registration.email),
    firstName: String(registration.first_name),
    organization: String(registration.organization || ""),
    rosterUrl,
    seatLimit,
  });
  if (rosterId) {
    await admin.from("institution_rosters").update({
      confirmation_sent_at: confirmation.ok ? new Date().toISOString() : null,
      confirmation_error: confirmation.ok ? null : confirmation.error,
    }).eq("id", rosterId);
  }
  if (confirmation.ok) {
    await admin.from("registrations").update({ welcome_sent_at: new Date().toISOString() }).eq("id", registration.id);
  }
  return { ok: true, step: "complete", roster_id: rosterId, welcome: confirmation.ok, welcome_message: confirmation.ok ? "" : text(confirmation.error, 100) };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const opsToken = Deno.env.get("CFA_LEARN_OPS_TOKEN") || "";
  if (!opsToken || request.headers.get("X-Cfa-Ops-Token") !== opsToken) {
    return json({ error: "unauthorized" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000).toISOString();
  const { data: pending, error: pendingError } = await admin
    .from("registrations")
    .select("id, created_at, status, email, first_name, last_name, organization, offer_id, amount_cents, paid_at, gateway_transaction_id, gateway_response, failure_code, failure_message, updated_at")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("is_test", false)
    .in("status", ["enrollment_pending", "processing"])
    .lt("updated_at", cutoff)
    .order("created_at");
  if (pendingError) return json({ error: "registrations_unavailable" }, 500);

  const offerIds = [...new Set((pending || []).map((row: JsonRecord) => row.offer_id))];
  const { data: offers } = offerIds.length
    ? await admin.from("program_offers").select("id, code, seat_count").in("id", offerIds)
    : { data: [] };
  const offerById = new Map((offers || []).map((offer: JsonRecord) => [offer.id, offer]));

  const healed: JsonRecord[] = [];
  const failed: JsonRecord[] = [];
  const attention: JsonRecord[] = [];
  for (const registration of (pending || []) as JsonRecord[]) {
    const offer = offerById.get(registration.offer_id) as JsonRecord | undefined;
    const summary = {
      registration_id: registration.id,
      email: maskEmail(String(registration.email)),
      offer: offer?.code ?? "?",
      amount_cents: registration.amount_cents,
      since: registration.updated_at,
      failure_code: registration.failure_code,
    };
    // Charged and confirmed by the gateway: safe to finish.
    const charged = registration.status === "enrollment_pending"
      && Boolean(registration.paid_at)
      && Boolean(registration.gateway_transaction_id);
    if (!charged) {
      // 'processing' that never returned, held for review, void pending,
      // unknown gateway result: a person has to look at the gateway first.
      attention.push({ ...summary, reason: registration.status === "processing" ? "stuck_in_processing" : "payment_result_unknown" });
      continue;
    }
    const result = offer?.code === "institution"
      ? await healInstitution(admin, registration, Number(offer?.seat_count ?? 20))
      : await healIndividual(admin, registration, opsToken, supabaseUrl);
    if (result.ok) {
      healed.push({ ...summary, welcome: result.welcome, welcome_message: result.welcome_message });
    } else {
      failed.push({ ...summary, step: result.step, message: result.message });
    }
  }

  console.log("registration_heal", JSON.stringify({ checked: (pending || []).length, healed: healed.length, failed: failed.length, attention: attention.length }));
  return json({
    ok: true,
    checked: (pending || []).length,
    healed,
    failed,
    attention,
  }, 200);
});
