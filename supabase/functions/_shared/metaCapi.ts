// Meta Conversions API: the server-side copy of the browser Purchase event.
// Added 2026-09-29 on Sage's go after HolyOps (Sascha) asked for it: browser-only
// pixel events vanish behind ad blockers and Safari tracking prevention, and
// Meta could not see Biografía registrations the ads had driven.
//
// Dedupe: the browser fires fbq('track', 'Purchase', ..., { eventID }) with the
// same `purchase-<registration id>` this sends, so Meta counts one purchase.
// Never throws and never holds a registration up for long: a Meta outage costs
// a tracking event, not a registrant.
//
// Secret: META_CAPI_TOKEN (Supabase function secret). No token, no call.

const DEFAULT_PIXEL_ID = "1802139657408971"; // CFA Pixel, ad account act_45601263
const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 2500;

export type MetaPurchase = {
  eventId: string;
  sourceUrl: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  clientIp?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  valueCents: number;
  currency?: string;
  contentName: string;
  contentId?: string;
};

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Meta's normalisation rules: lowercase, trimmed; phone digits only; names
// without punctuation; zip without spaces; country as the 2-letter code.
async function hashed(value: string | undefined, normalise: (v: string) => string = (v) => v) {
  const cleaned = normalise(String(value ?? "").trim().toLowerCase());
  return cleaned ? [await sha256Hex(cleaned)] : undefined;
}

export function metaCookieIds(value: unknown, fbclid?: string, capturedAt?: string) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const clean = (v: unknown) => {
    const s = v == null ? "" : String(v).trim().slice(0, 500);
    return /^fb\.\d\.\d+\.[\w.-]+$/.test(s) ? s : "";
  };
  const fbp = clean(source.fbp);
  let fbc = clean(source.fbc);
  // No _fbc cookie (blocked, or the pixel never loaded) but the ad click id
  // survived in the landing URL: rebuild it in Meta's documented format.
  if (!fbc && fbclid && /^[\w-]+$/.test(fbclid)) {
    const at = capturedAt ? Date.parse(capturedAt) : NaN;
    fbc = `fb.1.${Number.isNaN(at) ? Date.now() : at}.${fbclid}`;
  }
  return { fbp: fbp || undefined, fbc: fbc || undefined };
}

export async function sendMetaPurchase(event: MetaPurchase) {
  const token = Deno.env.get("META_CAPI_TOKEN") || "";
  if (!token) return { ok: false, skipped: "no_token" };
  const pixelId = Deno.env.get("META_PIXEL_ID") || DEFAULT_PIXEL_ID;

  try {
    const userData: Record<string, unknown> = {
      em: await hashed(event.email),
      ph: await hashed(event.phone, (v) => v.replace(/\D/g, "")),
      fn: await hashed(event.firstName, (v) => v.replace(/[^\p{L}]/gu, "")),
      ln: await hashed(event.lastName, (v) => v.replace(/[^\p{L}]/gu, "")),
      ct: await hashed(event.city, (v) => v.replace(/[^\p{L}]/gu, "")),
      st: await hashed(event.state, (v) => v.replace(/[^\p{L}]/gu, "")),
      zp: await hashed(event.zip, (v) => v.replace(/\s/g, "")),
      country: await hashed(event.country),
      client_ip_address: event.clientIp && event.clientIp !== "unknown" ? event.clientIp : undefined,
      client_user_agent: event.userAgent || undefined,
      fbp: event.fbp,
      fbc: event.fbc,
    };
    const payload: Record<string, unknown> = {
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        event_source_url: event.sourceUrl,
        action_source: "website",
        user_data: userData,
        custom_data: {
          value: event.valueCents / 100,
          currency: event.currency || "USD",
          content_name: event.contentName,
          content_ids: event.contentId ? [event.contentId] : undefined,
          content_type: "product",
        },
      }],
    };
    const testCode = Deno.env.get("META_CAPI_TEST_EVENT_CODE");
    if (testCode) payload.test_event_code = testCode;

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("meta_capi_failed", JSON.stringify({ event_id: event.eventId, status: response.status, error: result?.error?.message }));
      return { ok: false, status: response.status };
    }
    return { ok: true, received: result?.events_received ?? 0 };
  } catch (error) {
    console.error("meta_capi_error", JSON.stringify({ event_id: event.eventId, message: String(error) }));
    return { ok: false };
  }
}
