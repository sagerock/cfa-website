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
  const expected = Deno.env.get("DASHBOARD_TOKEN") || "";
  const token = url.searchParams.get("token")
    || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || token !== expected) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: course } = await admin
    .from("cfa_learn_courses")
    .select("program_id, title")
    .eq("slug", COURSE_SLUG)
    .maybeSingle();
  if (!course) return json({ error: "course_not_found" }, 500);

  const [registrationsResult, enrollmentsResult, offersResult] = await Promise.all([
    admin
      .from("registrations")
      .select("created_at, paid_at, status, first_name, last_name, email, organization, offer_id, amount_cents, discount_cents, coupon_code, is_test")
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

  const enrollments = enrollmentsResult.data || [];
  const active = enrollments.filter((e) => e.status === "registered" && !e.revoked_at);
  const bySource: Record<string, number> = {};
  for (const e of active) bySource[e.source || "unknown"] = (bySource[e.source || "unknown"] || 0) + 1;

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
    registrations,
  });
});
