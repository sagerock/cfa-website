import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// Read-only transcript feed for /dashboard/concierge. Gated by CONCIERGE_ADMIN_TOKENS
// (comma-separated, one per person, so any one can be revoked alone). Deliberately not
// the shared DASHBOARD_TOKENS: chat transcripts carry visitors' own words and verified
// identities, and the website dashboard token is held more widely.
//
//   GET ?token=...                      -> recent sessions, newest first
//       &before=<iso>&include_test=1    -> paging and test-page sessions
//   GET ?token=...&session=<uuid>       -> one session's full transcript

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const PAGE_SIZE = 50;
// Opus 5.5 list prices per million tokens, for a rough per-session figure. The
// Anthropic Console workspace is the billing authority.
const PRICE = { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 };

const allowedOrigins = new Set([
  "https://learn.centerforanthroposophy.org",
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

type JsonRecord = Record<string, unknown>;

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://learn.centerforanthroposophy.org",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json", "cache-control": "no-store" },
  });
}

function costOf(usage: JsonRecord | null) {
  if (!usage) return 0;
  const n = (key: string) => Number(usage[key] || 0);
  return (n("input_tokens") * PRICE.input
    + n("cache_read_input_tokens") * PRICE.cacheRead
    + n("cache_creation_input_tokens") * PRICE.cacheWrite
    + n("output_tokens") * PRICE.output) / 1_000_000;
}

// What the visitor saw from Jax, plus a plain account of each lookup. Verification
// codes are never echoed back, even expired ones.
function describeToolUse(block: JsonRecord) {
  const input = (block.input || {}) as JsonRecord;
  switch (block.name) {
    case "send_verification_code": return `Sent a verification code to ${input.email}`;
    case "verify_code": return "Checked a verification code";
    case "get_offers": return `Looked up prices for ${input.program_key}`;
    case "check_coupon": return `Checked coupon ${input.code} for ${input.program_key}`;
    case "build_signup_link": return `Built a sign-up link for ${input.program_key}`;
    case "my_registrations": return "Looked up the verified person's registrations";
    case "my_payment_plan": return "Looked up the verified person's payment plan";
    case "resend_sign_in_link": return "Resent a portal sign-in link";
    case "hand_off": return `Handed off to the registration desk: ${input.reason}`;
    default: return `Used ${block.name}`;
  }
}

function summarizeResult(name: string, content: string) {
  let parsed: JsonRecord = {};
  try { parsed = JSON.parse(content); } catch { return null; }
  if (name === "verify_code") return parsed.verified ? "verified" : `not verified (${parsed.reason || "wrong code"})`;
  if (name === "check_coupon") return parsed.valid ? `valid, ${parsed.percent_off}% off` : "not valid";
  if (name === "build_signup_link") {
    if (parsed.error) return String(parsed.error);
    return parsed.price_line ? String(parsed.price_line) : String(parsed.kind || "");
  }
  if (name === "hand_off") return parsed.filed ? "email filed" : "not filed";
  if (parsed.error) return String(parsed.error);
  return null;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);

  const url = new URL(request.url);
  const allowed = (Deno.env.get("CONCIERGE_ADMIN_TOKENS") || "").split(",").map((t) => t.trim()).filter(Boolean);
  const token = url.searchParams.get("token") || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !allowed.includes(token)) return json({ error: "unauthorized" }, 401, origin);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sessionId = url.searchParams.get("session");
  if (sessionId) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: "invalid_session" }, 400, origin);
    const [{ data: session }, { data: rows, error }] = await Promise.all([
      admin.from("cfa_concierge_sessions")
        .select("id, created_at, last_message_at, page_path, origin, is_test, message_count, verified_email, verified_at, handed_off_at")
        .eq("id", sessionId).eq("client_id", CFA_CLIENT_ID).maybeSingle(),
      admin.from("cfa_concierge_messages")
        .select("id, created_at, role, content, visitor_text, usage")
        .eq("session_id", sessionId).order("id"),
    ]);
    if (error) return json({ error: "transcript_failed" }, 500, origin);
    if (!session) return json({ error: "not_found" }, 404, origin);

    const toolNames = new Map<string, string>();
    const turns: JsonRecord[] = [];
    let cost = 0;
    for (const row of rows || []) {
      if (row.role === "user") {
        if (row.visitor_text) {
          turns.push({ who: "visitor", at: row.created_at, text: row.visitor_text });
          continue;
        }
        for (const block of (row.content || []) as JsonRecord[]) {
          if (block.type !== "tool_result") continue;
          const name = toolNames.get(String(block.tool_use_id)) || "";
          const summary = summarizeResult(name, String(block.content || ""));
          if (summary) turns.push({ who: "result", at: row.created_at, text: summary, error: block.is_error === true });
          if (name === "build_signup_link") {
            try {
              const parsed = JSON.parse(String(block.content));
              if (parsed.shown_to_visitor) turns.push({ who: "link", at: row.created_at, text: parsed.price_line || parsed.kind });
            } catch { /* ignore */ }
          }
        }
        continue;
      }
      cost += costOf(row.usage as JsonRecord);
      for (const block of (row.content || []) as JsonRecord[]) {
        if (block.type === "text" && String(block.text || "").trim()) {
          turns.push({ who: "jax", at: row.created_at, text: block.text });
        } else if (block.type === "tool_use") {
          toolNames.set(String(block.id), String(block.name));
          turns.push({ who: "tool", at: row.created_at, text: describeToolUse(block) });
        }
      }
    }
    return json({ session: { ...session, approx_cost_usd: Math.round(cost * 1000) / 1000 }, turns }, 200, origin);
  }

  const before = url.searchParams.get("before");
  const includeTest = url.searchParams.get("include_test") === "1";
  let query = admin.from("cfa_concierge_sessions")
    .select("id, created_at, last_message_at, page_path, is_test, message_count, verified_email, handed_off_at")
    .eq("client_id", CFA_CLIENT_ID)
    .gt("message_count", 0)
    .order("last_message_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (!includeTest) query = query.eq("is_test", false);
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt("last_message_at", before);
  const { data: sessions, error } = await query;
  if (error) return json({ error: "sessions_failed" }, 500, origin);

  // First visitor message of each session, as its title.
  const ids = (sessions || []).map((row) => row.id);
  const firstBySession = new Map<string, string>();
  if (ids.length) {
    const { data: firsts } = await admin.from("cfa_concierge_messages")
      .select("session_id, visitor_text, id")
      .in("session_id", ids)
      .not("visitor_text", "is", null)
      .order("id");
    for (const row of firsts || []) {
      if (!firstBySession.has(row.session_id)) firstBySession.set(row.session_id, String(row.visitor_text).slice(0, 160));
    }
  }

  const { data: totals } = await admin.from("cfa_concierge_sessions")
    .select("is_test, verified_at, handed_off_at, message_count")
    .eq("client_id", CFA_CLIENT_ID)
    .gt("message_count", 0)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const real = (totals || []).filter((row) => includeTest || !row.is_test);

  return json({
    summary_30_days: {
      conversations: real.length,
      visitor_messages: real.reduce((sum, row) => sum + Number(row.message_count || 0), 0),
      verified: real.filter((row) => row.verified_at).length,
      handed_off: real.filter((row) => row.handed_off_at).length,
    },
    sessions: (sessions || []).map((row) => ({ ...row, first_message: firstBySession.get(row.id) || "" })),
    next_before: sessions && sessions.length === PAGE_SIZE ? sessions[sessions.length - 1].last_message_at : null,
  }, 200, origin);
});
