import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

  const slug = new URL(request.url).searchParams.get("slug")?.trim() || "starlight-rays-2026-2027";
  const { data: course, error: courseError } = await admin
    .from("cfa_learn_courses")
    .select("id, program_id, slug, title, former_name, subtitle, cohort, facilitator, image_url")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (courseError) return json({ error: "course_lookup_failed" }, 500, origin);
  if (!course) return json({ error: "course_not_found" }, 404, origin);

  const { data: program, error: programError } = await admin
    .from("programs")
    .select("id, client_id")
    .eq("id", course.program_id)
    .maybeSingle();

  if (programError) return json({ error: "program_lookup_failed" }, 500, origin);
  if (!program) return json({ error: "course_not_found" }, 404, origin);

  const { data: identity, error: identityError } = await admin
    .from("client_auth_identities")
    .select("contact_id")
    .eq("user_id", authData.user.id)
    .eq("client_id", program.client_id)
    .maybeSingle();

  if (identityError) return json({ error: "identity_lookup_failed" }, 500, origin);
  if (!identity) return json({ error: "enrollment_required" }, 403, origin);

  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id, enrolled_at, access_starts_at, access_ends_at, revoked_at")
    .eq("client_id", program.client_id)
    .eq("program_id", program.id)
    .eq("contact_id", identity.contact_id)
    .eq("status", "registered")
    .maybeSingle();

  if (enrollmentError) return json({ error: "enrollment_lookup_failed" }, 500, origin);
  const now = Date.now();
  const hasAccess = enrollment
    && !enrollment.revoked_at
    && new Date(enrollment.access_starts_at).getTime() <= now
    && (!enrollment.access_ends_at || new Date(enrollment.access_ends_at).getTime() > now);
  if (!hasAccess) return json({ error: "enrollment_required" }, 403, origin);

  const [sessionsResult, resourcesResult, profileResult] = await Promise.all([
    admin
      .from("cfa_learn_sessions")
      .select("id, slug, position, presenter, title, starts_at, ends_at, zoom_url")
      .eq("course_id", course.id)
      .eq("published", true)
      .order("position"),
    admin
      .from("cfa_learn_resources")
      .select("id, session_id, title, kind, body, position")
      .eq("course_id", course.id)
      .eq("published", true)
      .order("position"),
    admin
      .from("cfa_learn_profiles")
      .select("display_name")
      .eq("user_id", authData.user.id)
      .maybeSingle(),
  ]);

  if (sessionsResult.error || resourcesResult.error) {
    return json({ error: "course_content_failed" }, 500, origin);
  }

  return json({
    learner: {
      display_name: profileResult.data?.display_name
        || authData.user.email?.split("@")[0]
        || "Learner",
    },
    course,
    enrollment: { starts_at: enrollment.access_starts_at, expires_at: enrollment.access_ends_at },
    sessions: sessionsResult.data || [],
    resources: resourcesResult.data || [],
  }, 200, origin);
});
