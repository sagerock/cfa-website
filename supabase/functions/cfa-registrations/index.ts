import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Read-only registrations & roster feed for the /dashboard page, gated by the
// same viewer token as cfa-stats (served from the secret store here, never
// committed — this repo is public). Emails are masked before leaving the
// server, matching the dashboard's house style.

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const COURSE_SLUG = "starlight-rays-2026-2027";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function maskEmail(e: string): string {
  const [u, d] = String(e || "").split("@");
  if (!d) return "—";
  const shown = u.slice(0, Math.min(2, u.length));
  return `${shown}${"•".repeat(Math.max(1, u.length - shown.length))}@${d}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const allowed = (Deno.env.get("DASHBOARD_TOKENS") || Deno.env.get("DASHBOARD_TOKEN") || "")
    .split(",").map((t) => t.trim()).filter(Boolean);
  const token = url.searchParams.get("token")
    || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !allowed.includes(token)) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Per-program roster, fetched lazily when a program is expanded.
  const rosterProgramId = url.searchParams.get("roster");
  if (rosterProgramId) {
    if (!/^[0-9a-f-]{36}$/.test(rosterProgramId)) return json({ error: "invalid_program" }, 400);
    const { data: rosterRows, error: rosterError } = await admin
      .from("enrollments")
      .select("contact_id, source, raw_data")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("program_id", rosterProgramId)
      .eq("status", "registered")
      .is("revoked_at", null);
    if (rosterError) return json({ error: "roster_failed" }, 500);
    const contactIds = (rosterRows || []).map((row) => row.contact_id);
    const { data: contactRows, error: contactError } = contactIds.length
      ? await admin
        .from("contacts")
        .select("id, first_name, last_name, email, company")
        .eq("client_id", CFA_CLIENT_ID)
        .in("id", contactIds)
      : { data: [], error: null };
    if (contactError) return json({ error: "roster_failed" }, 500);
    const contactsById = new Map((contactRows || []).map((c) => [c.id, c]));
    const people = (rosterRows || []).map((row) => {
      const contact = contactsById.get(row.contact_id);
      const rawData = row.raw_data && typeof row.raw_data === "object"
        ? row.raw_data as Record<string, unknown>
        : {};
      const isGroup = rawData.registration_type === "group";
      const groupName = isGroup && typeof rawData.group_name === "string"
        ? rawData.group_name
        : null;
      return {
        name: contact ? `${contact.first_name || ""} ${contact.last_name || ""}`.trim() : "—",
        email: maskEmail(contact?.email || ""),
        organization: groupName || contact?.company || null,
        registration_type: isGroup ? "group" : "individual",
        group_payment_type: isGroup && typeof rawData.group_payment_type === "string"
          ? rawData.group_payment_type
          : null,
        source: row.source,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return json({ people });
  }

  const { data: course } = await admin
    .from("cfa_learn_courses")
    .select("program_id, title")
    .eq("slug", COURSE_SLUG)
    .maybeSingle();
  if (!course) return json({ error: "course_not_found" }, 500);

  const [registrationsResult, enrollmentsResult, offersResult] = await Promise.all([
    admin
      .from("registrations")
      .select("id, created_at, paid_at, status, first_name, last_name, email, organization, offer_id, amount_cents, discount_cents, coupon_code, is_test")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("program_id", course.program_id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("enrollments")
      .select("source, status, revoked_at")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("program_id", course.program_id),
    admin
      .from("program_offers")
      .select("id, name, code")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("program_id", course.program_id),
  ]);
  if (registrationsResult.error || enrollmentsResult.error || offersResult.error) {
    return json({ error: "query_failed" }, 500);
  }

  const offerNames = new Map((offersResult.data || []).map((o) => [o.id, o.name]));
  const registrations = (registrationsResult.data || [])
    .filter((r) => !r.is_test)
    .map((r) => ({
      created_at: r.created_at,
      paid_at: r.paid_at,
      status: r.status,
      name: `${r.first_name} ${r.last_name}`.trim(),
      email: maskEmail(r.email),
      organization: r.organization,
      offer: offerNames.get(r.offer_id) || "—",
      amount_cents: r.amount_cents,
      discount_cents: r.discount_cents,
      coupon_code: r.coupon_code,
    }));

  const { data: institutionRosterRows, error: institutionRosterError } = await admin
    .from("institution_rosters")
    .select("id, registration_id, organization, seat_limit, status, confirmation_sent_at, confirmation_error, last_opened_at, submitted_at, completed_at, created_at, updated_at")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("program_id", course.program_id)
    .order("created_at", { ascending: false });
  if (institutionRosterError) return json({ error: "institution_rosters_failed" }, 500);
  const institutionRosterIds = (institutionRosterRows || []).map((roster) => roster.id);
  const { data: institutionMemberRows, error: institutionMemberError } = institutionRosterIds.length
    ? await admin
      .from("institution_roster_members")
      .select("id, roster_id, first_name, last_name, email, status, error_code, welcome_sent_at")
      .in("roster_id", institutionRosterIds)
    : { data: [], error: null };
  if (institutionMemberError) return json({ error: "institution_roster_members_failed" }, 500);
  const registrationsById = new Map(
    (registrationsResult.data || []).map((registration) => [registration.id, registration]),
  );
  const institutionRosters = (institutionRosterRows || []).map((roster) => {
    const registration = registrationsById.get(roster.registration_id);
    const members = (institutionMemberRows || []).filter((member) => member.roster_id === roster.id);
    return {
      id: roster.id,
      organization: roster.organization,
      seat_limit: roster.seat_limit,
      status: roster.status,
      confirmation_sent: Boolean(roster.confirmation_sent_at),
      confirmation_error: roster.confirmation_error,
      last_opened_at: roster.last_opened_at,
      submitted_at: roster.submitted_at,
      completed_at: roster.completed_at,
      created_at: roster.created_at,
      updated_at: roster.updated_at,
      purchaser: registration
        ? {
          name: `${registration.first_name || ""} ${registration.last_name || ""}`.trim(),
          email: maskEmail(registration.email),
        }
        : null,
      counts: {
        total: members.length,
        invited: members.filter((member) => member.status === "invited").length,
        failed: members.filter((member) => member.status === "failed").length,
        processing: members.filter((member) => ["pending", "provisioning", "provisioned"].includes(member.status)).length,
      },
      failed_members: members
        .filter((member) => member.status === "failed")
        .map((member) => ({
          id: member.id,
          name: `${member.first_name || ""} ${member.last_name || ""}`.trim(),
          email: maskEmail(member.email),
          error_code: member.error_code,
        })),
    };
  });

  const enrollments = enrollmentsResult.data || [];
  const active = enrollments.filter((e) => e.status === "registered" && !e.revoked_at);
  const bySource: Record<string, number> = {};
  for (const e of active) bySource[e.source || "unknown"] = (bySource[e.source || "unknown"] || 0) + 1;

  const [programNamesResult, allEnrollmentsResult] = await Promise.all([
    admin.from("programs").select("id, name").eq("client_id", CFA_CLIENT_ID),
    admin
      .from("enrollments")
      .select("program_id")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("status", "registered")
      .is("revoked_at", null)
      .limit(10000),
  ]);
  const countByProgram = new Map<string, number>();
  for (const row of allEnrollmentsResult.data || []) {
    countByProgram.set(row.program_id, (countByProgram.get(row.program_id) || 0) + 1);
  }
  const programs = (programNamesResult.data || [])
    .map((program) => ({
      id: program.id,
      name: program.name,
      active: countByProgram.get(program.id) || 0,
    }))
    .filter((program) => program.active > 0)
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));

  const paid = registrations.filter((r) => r.status === "paid");
  return json({
    generated_at: new Date().toISOString(),
    course: course.title,
    totals: {
      active_enrollments: active.length,
      paid_registrations: paid.filter((r) => r.amount_cents > 0).length,
      comped_registrations: paid.filter((r) => r.amount_cents === 0).length,
      pending_review: registrations.filter((r) => r.status === "enrollment_pending").length,
      net_revenue_cents: paid.reduce((sum, r) => sum + r.amount_cents, 0),
    },
    enrollment_sources: bySource,
    institution_rosters: institutionRosters,
    programs,
    registrations,
  });
});
