import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Durable personal classroom links.
//
// POST {token}            (public, CORS-limited): exchange a durable token for a
//                         fresh one-time magic-link token-hash the browser can
//                         verify into a session. Reusable until revoked/expired.
// POST {action:"create"}  (X-Cfa-Ops-Token): mint a link for an enrollment.
//                         Prior links stay valid (each email hands out its own
//                         door) unless rotate:true, which revokes them — the
//                         security response for a leaked link. Returns the raw
//                         URL once; only the hash is stored.

const productionOrigin = "https://learn.centerforanthroposophy.org";
const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";

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
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cfa-ops-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const opsToken = Deno.env.get("CFA_LEARN_OPS_TOKEN");
  if (!supabaseUrl || !serviceRoleKey || !opsToken) {
    return json({ error: "server_configuration" }, 500, origin);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }

  // --- Ops: mint (and rotate) a durable link for an enrollment ---
  if (body.action === "create") {
    const presented = request.headers.get("X-Cfa-Ops-Token") ?? "";
    if (!presented || presented !== opsToken) {
      return json({ error: "service_authorization_required" }, 401, origin);
    }
    const enrollmentId = typeof body.enrollment_id === "string" ? body.enrollment_id : "";
    if (!/^[0-9a-f-]{36}$/.test(enrollmentId)) return json({ error: "invalid_enrollment" }, 400, origin);
    const expiresAt = typeof body.expires_at === "string" && body.expires_at ? body.expires_at : null;

    const { data: enrollment, error: enrollmentError } = await admin
      .from("enrollments")
      .select("id, client_id, contact_id, status, revoked_at")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (enrollmentError) return json({ error: "enrollment_lookup_failed" }, 500, origin);
    if (!enrollment || enrollment.status !== "registered" || enrollment.revoked_at) {
      return json({ error: "enrollment_not_active" }, 404, origin);
    }

    const rawToken = crypto.randomUUID().replaceAll("-", "")
      + crypto.randomUUID().replaceAll("-", "");
    const tokenHash = await sha256(rawToken);

    if (body.rotate === true) {
      const { error: revokeError } = await admin
        .from("cfa_learn_access_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("enrollment_id", enrollment.id)
        .is("revoked_at", null);
      if (revokeError) return json({ error: "link_rotate_failed" }, 500, origin);
    }

    const { error: insertError } = await admin.from("cfa_learn_access_links").insert({
      client_id: enrollment.client_id,
      contact_id: enrollment.contact_id,
      enrollment_id: enrollment.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insertError) return json({ error: "link_create_failed" }, 500, origin);

    return json({
      ok: true,
      url: `${productionOrigin}/learn/go?k=${rawToken}`,
      expires_at: expiresAt,
    }, 200, origin);
  }

  // --- Public: exchange a durable token for a session token-hash ---
  const rawToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(rawToken)) return json({ error: "invalid_link" }, 400, origin);
  const tokenHash = await sha256(rawToken);

  const { data: link, error: linkError } = await admin
    .from("cfa_learn_access_links")
    .select("id, client_id, contact_id, enrollment_id, expires_at, revoked_at, use_count")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (linkError) return json({ error: "link_lookup_failed" }, 500, origin);
  const now = Date.now();
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at).getTime() <= now)) {
    return json({ error: "invalid_link" }, 404, origin);
  }

  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id, program_id, status, revoked_at, access_starts_at, access_ends_at")
    .eq("id", link.enrollment_id)
    .maybeSingle();
  if (enrollmentError) return json({ error: "enrollment_lookup_failed" }, 500, origin);
  const active = enrollment
    && enrollment.status === "registered"
    && !enrollment.revoked_at
    && new Date(enrollment.access_starts_at).getTime() <= now
    && (!enrollment.access_ends_at || new Date(enrollment.access_ends_at).getTime() > now);
  if (!active) return json({ error: "invalid_link" }, 404, origin);

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, email, first_name, last_name")
    .eq("id", link.contact_id)
    .eq("client_id", link.client_id)
    .maybeSingle();
  if (contactError || !contact?.email) return json({ error: "contact_lookup_failed" }, 500, origin);

  await admin.auth.admin.createUser({
    email: contact.email,
    email_confirm: true,
    user_metadata: { first_name: contact.first_name, last_name: contact.last_name },
  });
  const { data: linkData, error: generateError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: contact.email,
    options: { redirectTo: `${productionOrigin}/learn/auth` },
  });
  if (generateError || !linkData.user || !linkData.properties?.hashed_token) {
    return json({ error: "session_mint_failed" }, 500, origin);
  }

  const { data: identity, error: identityError } = await admin
    .from("client_auth_identities")
    .select("contact_id")
    .eq("user_id", linkData.user.id)
    .eq("client_id", link.client_id)
    .maybeSingle();
  if (identityError) return json({ error: "identity_lookup_failed" }, 500, origin);
  if (identity && identity.contact_id !== link.contact_id) {
    return json({ error: "invalid_link" }, 409, origin);
  }
  if (!identity) {
    const { error: identityInsertError } = await admin
      .from("client_auth_identities")
      .insert({ client_id: link.client_id, contact_id: link.contact_id, user_id: linkData.user.id });
    if (identityInsertError) return json({ error: "invalid_link" }, 409, origin);
  }

  await admin
    .from("cfa_learn_access_links")
    .update({ use_count: link.use_count + 1, last_used_at: new Date().toISOString() })
    .eq("id", link.id);

  const { data: course } = await admin
    .from("cfa_learn_courses")
    .select("slug")
    .eq("program_id", enrollment.program_id)
    .eq("published", true)
    .maybeSingle();

  return json({
    ok: true,
    token_hash: linkData.properties.hashed_token,
    next: course ? `/learn/${course.slug}` : "/learn",
  }, 200, origin);
});
