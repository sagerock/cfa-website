import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@5";

const TOKEN_TTL_SECONDS = 3600;

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
  const signingKeyId = Deno.env.get("MUX_SIGNING_KEY_ID");
  const signingPrivateKeyBase64 = Deno.env.get("MUX_SIGNING_PRIVATE_KEY");
  if (!supabaseUrl || !serviceRoleKey || !signingKeyId || !signingPrivateKeyBase64) {
    return json({ error: "server_configuration" }, 500, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "invalid_session" }, 401, origin);

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim() || "starlight-rays-2026-2027";
  const sessionId = url.searchParams.get("session")?.trim() || "";
  if (!sessionId) return json({ error: "session_required" }, 400, origin);

  const { data: course, error: courseError } = await admin
    .from("cfa_learn_courses")
    .select("id, program_id")
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
    .select("id, access_starts_at, access_ends_at, revoked_at, access_scope")
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

  if (enrollment.access_scope === "sessions") {
    const { data: sessionAccess, error: sessionAccessError } = await admin
      .from("enrollment_session_access")
      .select("session_id")
      .eq("enrollment_id", enrollment.id)
      .eq("session_id", sessionId)
      .maybeSingle();
    if (sessionAccessError) return json({ error: "session_access_lookup_failed" }, 500, origin);
    if (!sessionAccess) return json({ error: "session_access_required" }, 403, origin);
  }

  const { data: session, error: sessionError } = await admin
    .from("cfa_learn_sessions")
    .select("id, mux_playback_id")
    .eq("course_id", course.id)
    .eq("id", sessionId)
    .eq("published", true)
    .maybeSingle();

  if (sessionError) return json({ error: "session_lookup_failed" }, 500, origin);
  if (!session || !session.mux_playback_id) return json({ error: "recording_not_available" }, 404, origin);

  const privateKeyPem = atob(signingPrivateKeyBase64);
  const privateKey = await importPKCS8(privateKeyPem, "RS256");
  const expiresAt = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const signPlayback = (audience: string) =>
    new SignJWT({ sub: session.mux_playback_id, aud: audience, exp: expiresAt })
      .setProtectedHeader({ alg: "RS256", kid: signingKeyId })
      .sign(privateKey);

  const [video, thumbnail, storyboard] = await Promise.all([
    signPlayback("v"),
    signPlayback("t"),
    signPlayback("s"),
  ]);

  return json({
    playback_id: session.mux_playback_id,
    tokens: { video, thumbnail, storyboard },
    expires_at: new Date(expiresAt * 1000).toISOString(),
  }, 200, origin);
});
