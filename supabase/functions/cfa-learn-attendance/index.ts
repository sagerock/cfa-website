import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Returns the signed-in student's own class attendance, grouped by cohort, with the
// percentage against the 80% certificate line (Jax item #4141, Milan 2026-11-17).
// No rows for their email -> status not_yet_available.

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

const CERTIFICATE_LINE = 0.8;

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json({ error: "authentication_required" }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration" }, 500, origin);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "invalid_session" }, 401, origin);
  const email = (authData.user.email || "").toLowerCase();
  if (!email) return json({ status: "not_yet_available", cohorts: [] }, 200, origin);

  // Only this student's rows: filter is the verified session email, never a query parameter.
  const { data: rows, error } = await admin
    .from("cfa_learn_attendance")
    .select("cohort, cohort_title, session_date, minutes, status, updated_at")
    .eq("email", email)
    .order("session_date", { ascending: true });
  if (error) return json({ error: "attendance_lookup_failed" }, 500, origin);
  if (!rows || !rows.length) return json({ status: "not_yet_available", cohorts: [] }, 200, origin);

  const byCohort = new Map<string, any>();
  for (const row of rows) {
    if (!byCohort.has(row.cohort)) {
      byCohort.set(row.cohort, { cohort: row.cohort, title: row.cohort_title, sessions: [], updated_at: row.updated_at });
    }
    const c = byCohort.get(row.cohort);
    c.sessions.push({ date: row.session_date, minutes: row.minutes, status: row.status });
    if (row.updated_at > c.updated_at) c.updated_at = row.updated_at;
  }
  const cohorts = [...byCohort.values()].map((c) => {
    const held = c.sessions.length;
    const counted = c.sessions.filter((s: any) => s.status === "present" || s.status === "excused").length;
    const ratio = held ? counted / held : 0;
    return {
      ...c,
      held,
      present: c.sessions.filter((s: any) => s.status === "present").length,
      excused: c.sessions.filter((s: any) => s.status === "excused").length,
      percent: Math.round(ratio * 100),
      certificate_line: Math.round(CERTIFICATE_LINE * 100),
      on_track: ratio >= CERTIFICATE_LINE,
    };
  });
  return json({ status: "ok", cohorts }, 200, origin);
});
