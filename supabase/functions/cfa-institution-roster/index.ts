import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  sendInstitutionParticipantWelcome,
  sendInstitutionRosterConfirmation,
} from "../_shared/institutionRosterEmail.ts";

const productionOrigin = "https://learn.centerforanthroposophy.org";
const allowedOrigins = new Set([
  productionOrigin,
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

type JsonRecord = Record<string, unknown>;
// This shared project has no generated Database type in this public repo.
// Keep the client dynamic, matching the existing Edge Functions.
// deno-lint-ignore no-explicit-any
type AdminClient = any;
type RosterRecord = {
  id: string;
  registration_id: string;
  client_id: string;
  program_id: string;
  organization: string;
  token_expires_at: string | null;
  seat_limit: number;
  status: string;
  confirmation_sent_at: string | null;
  confirmation_error: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
type MemberRecord = {
  id: string;
  roster_id: string;
  sort_order: number;
  first_name: string;
  last_name: string;
  email: string;
  title_role: string;
  completed_teacher_training: boolean;
  status: string;
  enrollment_id: string | null;
  welcome_sent_at: string | null;
  error_code: string | null;
  error_message: string | null;
};

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : productionOrigin;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, content-type, x-roster-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      "Referrer-Policy": "no-referrer",
    },
  });
}

function text(value: unknown, maxLength: number) {
  return value == null ? "" : String(value).trim().slice(0, maxLength);
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function newToken() {
  return crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
}

function rosterUrl(rawToken: string) {
  return `${productionOrigin}/register/starlight-rays-2026-2027/roster#${rawToken}`;
}

async function findRosterByToken(admin: AdminClient, rawToken: string) {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(rawToken)) return null;
  const tokenHash = await sha256(rawToken);
  const { data, error } = await admin
    .from("institution_rosters")
    .select(
      "id, registration_id, client_id, program_id, organization, token_expires_at, seat_limit, status, confirmation_sent_at, confirmation_error, submitted_at, completed_at, created_at, updated_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  if (
    data.token_expires_at &&
    new Date(data.token_expires_at).getTime() <= Date.now()
  ) return null;
  return data as RosterRecord;
}

async function rosterPayload(admin: AdminClient, roster: RosterRecord) {
  const [{ data: members }, { data: registration }] = await Promise.all([
    admin
      .from("institution_roster_members")
      .select(
        "id, roster_id, sort_order, first_name, last_name, email, title_role, completed_teacher_training, status, enrollment_id, welcome_sent_at, error_code, error_message",
      )
      .eq("roster_id", roster.id)
      .order("sort_order"),
    admin
      .from("registrations")
      .select("first_name, last_name, email, paid_at")
      .eq("id", roster.registration_id)
      .maybeSingle(),
  ]);
  return {
    id: roster.id,
    organization: roster.organization,
    seat_limit: roster.seat_limit,
    status: roster.status,
    submitted_at: roster.submitted_at,
    completed_at: roster.completed_at,
    representative: registration
      ? {
        name: `${registration.first_name || ""} ${registration.last_name || ""}`
          .trim(),
        email: registration.email,
      }
      : null,
    members: ((members || []) as MemberRecord[]).map((
      member: MemberRecord,
    ) => ({
      id: member.id,
      sort_order: member.sort_order,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      title_role: member.title_role,
      completed_teacher_training: member.completed_teacher_training,
      status: member.status,
      welcome_sent_at: member.welcome_sent_at,
      needs_attention: member.status === "failed",
    })),
  };
}

async function refreshRosterStatus(admin: AdminClient, rosterId: string) {
  const { data: members } = await admin
    .from("institution_roster_members")
    .select("status")
    .eq("roster_id", rosterId);
  const statuses: string[] = ((members || []) as Array<{ status: string }>).map(
    (member) => member.status,
  );
  const now = new Date().toISOString();
  const status = statuses.length === 0
    ? "pending"
    : statuses.some((value) => value === "failed")
    ? "needs_attention"
    : statuses.every((value) => value === "invited")
    ? "complete"
    : "processing";
  await admin.from("institution_rosters").update({
    status,
    completed_at: status === "complete" ? now : null,
  }).eq("id", rosterId);
  return status;
}

async function provisionMember(
  admin: AdminClient,
  roster: RosterRecord,
  member: MemberRecord,
) {
  await admin.from("institution_roster_members").update({
    status: "provisioning",
    error_code: null,
    error_message: null,
  }).eq("id", member.id);

  try {
    await admin.auth.admin.createUser({
      email: member.email,
      email_confirm: true,
      user_metadata: {
        first_name: member.first_name,
        last_name: member.last_name,
      },
    });
    const redirectTo =
      `${productionOrigin}/learn/auth?next=/learn/starlight-rays-2026-2027`;
    const { data: linkData, error: linkError } = await admin.auth.admin
      .generateLink({
        type: "magiclink",
        email: member.email,
        options: {
          redirectTo,
          data: { first_name: member.first_name, last_name: member.last_name },
        },
      });
    if (linkError || !linkData.user || !linkData.properties?.hashed_token) {
      throw new Error("auth_provisioning_failed");
    }

    const { data: provisionRows, error: provisionError } = await admin.rpc(
      "cfa_provision_institution_roster_member",
      {
        requested_roster_id: roster.id,
        requested_member_id: member.id,
        requested_user_id: linkData.user.id,
      },
    );
    if (provisionError) throw new Error("enrollment_provisioning_failed");
    const provision = Array.isArray(provisionRows)
      ? provisionRows[0]
      : provisionRows;
    const enrollmentId = provision && typeof provision === "object"
      ? text((provision as JsonRecord).enrollment_id, 36)
      : "";
    if (!validUuid(enrollmentId)) {
      throw new Error("enrollment_provisioning_failed");
    }

    const signInUrl = new URL(`${productionOrigin}/learn/auth`);
    signInUrl.searchParams.set("token_hash", linkData.properties.hashed_token);
    signInUrl.searchParams.set("type", "email");

    const { data: priorEvent } = await admin
      .from("cfa_learn_email_events")
      .select("id")
      .eq("enrollment_id", enrollmentId)
      .eq("message_type", "welcome")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sent = await sendInstitutionParticipantWelcome({
      email: member.email,
      firstName: member.first_name,
      organization: roster.organization,
      signInLink: signInUrl.toString(),
    });
    const { data: event, error: eventError } = await admin
      .from("cfa_learn_email_events")
      .insert({
        enrollment_id: enrollmentId,
        message_type: "welcome",
        status: sent.ok ? "sent" : "failed",
        provider_message_id: sent.providerMessageId,
        sent_at: sent.ok ? new Date().toISOString() : null,
        recipient_email: member.email,
        resend_of: priorEvent?.id ?? null,
      })
      .select("id")
      .single();
    if (eventError) throw new Error("email_event_failed");
    if (!sent.ok) throw new Error(sent.error || "welcome_email_failed");

    await admin.from("institution_roster_members").update({
      status: "invited",
      welcome_sent_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    }).eq("id", member.id);
    return { id: member.id, ok: true };
  } catch (error) {
    const code = error instanceof Error
      ? text(error.message, 80)
      : "provisioning_failed";
    await admin.from("institution_roster_members").update({
      status: "failed",
      error_code: code,
      error_message: "Access or email delivery needs staff review.",
    }).eq("id", member.id);
    return { id: member.id, ok: false };
  }
}

async function runInChunks<T>(
  items: T[],
  size: number,
  task: (item: T) => Promise<unknown>,
) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(task));
  }
}

function normalizeMembers(value: unknown, seatLimit: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > seatLimit) {
    return null;
  }
  const normalized = value.map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as JsonRecord : {};
    const training = item.completed_teacher_training;
    return {
      id: text(item.id, 36),
      sort_order: index + 1,
      first_name: text(item.first_name, 100),
      last_name: text(item.last_name, 100),
      email: text(item.email, 254).toLowerCase(),
      title_role: text(item.title_role, 120),
      completed_teacher_training: typeof training === "boolean"
        ? training
        : null,
    };
  });
  const valid = normalized.every((member) =>
    member.first_name &&
    member.last_name &&
    validEmail(member.email) &&
    member.title_role &&
    member.completed_teacher_training !== null &&
    (!member.id || validUuid(member.id))
  );
  if (
    !valid ||
    new Set(normalized.map((member) => member.email)).size !== normalized.length
  ) {
    return null;
  }
  return normalized;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (origin && !allowedOrigins.has(origin)) {
    return json({ error: "origin_not_allowed" }, 403, origin);
  }
  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server_configuration" }, 500, origin);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (request.method === "GET") {
    const rawToken = request.headers.get("X-Roster-Token")?.trim() || "";
    const roster = await findRosterByToken(admin, rawToken);
    if (!roster) return json({ error: "invalid_roster_link" }, 404, origin);
    await admin.from("institution_rosters").update({
      last_opened_at: new Date().toISOString(),
    }).eq("id", roster.id);
    return json(
      { ok: true, roster: await rosterPayload(admin, roster) },
      200,
      origin,
    );
  }

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }

  const dashboardToken = Deno.env.get("DASHBOARD_TOKEN") || "";
  const bearer = (request.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const opsAuthorized = Boolean(dashboardToken && bearer === dashboardToken);

  if (body.action === "resend_roster_link" || body.action === "retry_member") {
    if (!opsAuthorized) {
      return json({ error: "staff_authorization_required" }, 401, origin);
    }

    if (body.action === "resend_roster_link") {
      const rosterId = text(body.roster_id, 36);
      if (!validUuid(rosterId)) {
        return json({ error: "invalid_roster" }, 400, origin);
      }
      const { data: roster, error: rosterError } = await admin
        .from("institution_rosters")
        .select("id, registration_id, organization, seat_limit")
        .eq("id", rosterId)
        .maybeSingle();
      if (rosterError || !roster) {
        return json({ error: "roster_not_found" }, 404, origin);
      }
      const { data: registration } = await admin
        .from("registrations")
        .select("first_name, email")
        .eq("id", roster.registration_id)
        .eq("status", "paid")
        .maybeSingle();
      if (!registration) {
        return json({ error: "registration_not_paid" }, 409, origin);
      }

      const rawToken = newToken();
      const tokenHash = await sha256(rawToken);
      const sent = await sendInstitutionRosterConfirmation({
        email: registration.email,
        firstName: registration.first_name,
        organization: roster.organization,
        rosterUrl: rosterUrl(rawToken),
        seatLimit: roster.seat_limit,
      });
      await admin.from("institution_rosters").update({
        token_hash: tokenHash,
        token_expires_at: "2027-03-31T23:59:59Z",
        confirmation_sent_at: sent.ok ? new Date().toISOString() : null,
        confirmation_error: sent.ok ? null : sent.error,
      }).eq("id", roster.id);
      return json(
        { ok: sent.ok, email_sent: sent.ok },
        sent.ok ? 200 : 502,
        origin,
      );
    }

    const memberId = text(body.member_id, 36);
    if (!validUuid(memberId)) {
      return json({ error: "invalid_member" }, 400, origin);
    }
    const { data: member } = await admin
      .from("institution_roster_members")
      .select(
        "id, roster_id, sort_order, first_name, last_name, email, title_role, completed_teacher_training, status, enrollment_id, welcome_sent_at, error_code, error_message",
      )
      .eq("id", memberId)
      .maybeSingle();
    if (!member) return json({ error: "member_not_found" }, 404, origin);
    const { data: roster } = await admin
      .from("institution_rosters")
      .select(
        "id, registration_id, client_id, program_id, organization, token_expires_at, seat_limit, status, confirmation_sent_at, confirmation_error, submitted_at, completed_at, created_at, updated_at",
      )
      .eq("id", member.roster_id)
      .maybeSingle();
    if (!roster) return json({ error: "roster_not_found" }, 404, origin);
    const result = await provisionMember(
      admin,
      roster as RosterRecord,
      member as MemberRecord,
    );
    await refreshRosterStatus(admin, roster.id);
    return json({ ok: result.ok }, result.ok ? 200 : 502, origin);
  }

  if (body.action !== "submit") {
    return json({ error: "invalid_action" }, 400, origin);
  }
  const rawToken = request.headers.get("X-Roster-Token")?.trim() || "";
  const roster = await findRosterByToken(admin, rawToken);
  if (!roster) return json({ error: "invalid_roster_link" }, 404, origin);
  const members = normalizeMembers(body.members, roster.seat_limit);
  if (!members) return json({ error: "invalid_roster_members" }, 400, origin);
  const { error: saveError } = await admin.rpc("cfa_save_institution_roster", {
    requested_roster_id: roster.id,
    requested_members: members,
  });
  if (saveError) {
    if (/institution_roster_processing/.test(saveError.message || "")) {
      return json({ error: "roster_processing" }, 409, origin);
    }
    const conflict = /cannot_be_removed|cannot_change|member_reference/.test(
      saveError.message || "",
    );
    return json(
      { error: conflict ? "roster_conflict" : "roster_update_failed" },
      conflict ? 409 : 500,
      origin,
    );
  }

  const { data: rowsToProvision } = await admin
    .from("institution_roster_members")
    .select(
      "id, roster_id, sort_order, first_name, last_name, email, title_role, completed_teacher_training, status, enrollment_id, welcome_sent_at, error_code, error_message",
    )
    .eq("roster_id", roster.id)
    .in("status", ["pending", "failed"])
    .order("sort_order");
  await runInChunks(
    (rowsToProvision || []) as MemberRecord[],
    4,
    (member) => provisionMember(admin, roster, member),
  );
  await refreshRosterStatus(admin, roster.id);
  const { data: refreshed } = await admin
    .from("institution_rosters")
    .select(
      "id, registration_id, client_id, program_id, organization, token_expires_at, seat_limit, status, confirmation_sent_at, confirmation_error, submitted_at, completed_at, created_at, updated_at",
    )
    .eq("id", roster.id)
    .single();
  return json(
    {
      ok: true,
      roster: await rosterPayload(admin, refreshed as RosterRecord),
    },
    200,
    origin,
  );
});
