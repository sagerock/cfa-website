import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Lists the learn.* courses the signed-in person can open right now: published
// courses whose program they hold an active, unrevoked enrollment in. Staff
// accounts also see unpublished courses they are enrolled in, so a cohort can
// be checked end to end before it is published (same rule as cfa-learn-course).

const allowedOrigins = new Set([
  "https://learn.centerforanthroposophy.org",
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

const PREVIEW_DOMAINS = ["@sagerock.com", "@centerforanthroposophy.org"];

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
  const canPreview = PREVIEW_DOMAINS.some((domain) => email.endsWith(domain));

  let courseQuery = admin
    .from("cfa_learn_courses")
    .select("id, program_id, slug, title, subtitle, cohort, facilitator, image_url, published");
  if (!canPreview) courseQuery = courseQuery.eq("published", true);
  const { data: courses, error: courseError } = await courseQuery;
  if (courseError) return json({ error: "course_lookup_failed" }, 500, origin);

  const { data: identities, error: identityError } = await admin
    .from("client_auth_identities")
    .select("client_id, contact_id")
    .eq("user_id", authData.user.id);
  if (identityError) return json({ error: "identity_lookup_failed" }, 500, origin);

  const programIds = (courses || []).map((course) => course.program_id);
  const contactIds = (identities || []).map((identity) => identity.contact_id);
  if (!programIds.length || !contactIds.length) {
    return json({ learner: learnerOf(authData.user, null), courses: [] }, 200, origin);
  }

  const [enrollmentsResult, profileResult] = await Promise.all([
    admin
      .from("enrollments")
      .select("program_id, client_id, contact_id, access_starts_at, access_ends_at, revoked_at")
      .in("program_id", programIds)
      .in("contact_id", contactIds)
      .eq("status", "registered"),
    admin
      .from("cfa_learn_profiles")
      .select("display_name")
      .eq("user_id", authData.user.id)
      .maybeSingle(),
  ]);
  if (enrollmentsResult.error) return json({ error: "enrollment_lookup_failed" }, 500, origin);

  const now = Date.now();
  const identityKeys = new Set((identities || []).map((row) => `${row.client_id}:${row.contact_id}`));
  const openPrograms = new Map<string, string | null>();
  for (const enrollment of enrollmentsResult.data || []) {
    if (!identityKeys.has(`${enrollment.client_id}:${enrollment.contact_id}`)) continue;
    if (enrollment.revoked_at) continue;
    if (new Date(enrollment.access_starts_at).getTime() > now) continue;
    if (enrollment.access_ends_at && new Date(enrollment.access_ends_at).getTime() <= now) continue;
    openPrograms.set(enrollment.program_id, enrollment.access_ends_at);
  }

  const visible = (courses || [])
    .filter((course) => openPrograms.has(course.program_id))
    .map(({ id: _id, program_id, ...course }) => ({
      ...course,
      expires_at: openPrograms.get(program_id) ?? null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || (a.cohort || "").localeCompare(b.cohort || ""));

  return json({
    learner: learnerOf(authData.user, profileResult.data?.display_name ?? null),
    courses: visible,
  }, 200, origin);
});

function learnerOf(user: { email?: string }, displayName: string | null) {
  return { display_name: displayName || user.email?.split("@")[0] || "Learner" };
}
