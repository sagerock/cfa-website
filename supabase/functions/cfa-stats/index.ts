import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

// Viewer tokens for the read-only dashboard: DASHBOARD_TOKENS secret, comma-separated,
// one per person (e.g. "sage-xxx,sascha-yyy") so any one can be revoked alone. The page
// never embeds them; the viewer supplies one in the URL hash. Falls back to the legacy
// single DASHBOARD_TOKEN secret.
function allowedTokens(): string[] {
  const raw = Deno.env.get("DASHBOARD_TOKENS") || Deno.env.get("DASHBOARD_TOKEN") || "";
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
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
  const token = url.searchParams.get("token") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !allowedTokens().includes(token)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("cfa_dashboard_stats");
  if (error) return new Response(JSON.stringify({ error: "stats failed" }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  // Mask lead emails before they leave the server.
  const out = data as Record<string, unknown>;
  const rl = (out.recent_leads as Array<Record<string, string>>) || [];
  for (const l of rl) l.email = maskEmail(l.email);
  return new Response(JSON.stringify(out), { headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });
});
