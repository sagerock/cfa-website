import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { buildWelcomeEmailText, type WelcomePlan, type WelcomeSession } from "./email.ts";
import { sendInstitutionRosterConfirmation } from "../_shared/institutionRosterEmail.ts";

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const STARLIGHT_PROGRAM_PLATFORM_ID = "3357450";
// Default $1; REGISTRATION_TEST_AMOUNT_CENTS overrides it for a single armed
// run when the merchant fraud filter holds small charges for review.
const PRODUCTION_TEST_AMOUNT_CENTS = Math.max(100,
  Number(Deno.env.get("REGISTRATION_TEST_AMOUNT_CENTS")) || 100);
const PRODUCTION_TEST_AMOUNT = (PRODUCTION_TEST_AMOUNT_CENTS / 100).toFixed(2);
const PRODUCTION_TEST_OFFER_CODES = new Set(["individual", "individual-plan"]);
const productionOrigin = "https://learn.centerforanthroposophy.org";
const productionHostname = new URL(productionOrigin).hostname;
const allowedOrigins = new Set([
  productionOrigin,
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

type JsonRecord = Record<string, unknown>;
// This project does not check generated database types into the public repo.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:"
      && url.hostname.endsWith(".cfa-website-bqx.pages.dev");
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin! : productionOrigin,
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info, x-registration-test",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function text(value: unknown, maxLength: number) {
  return value == null ? "" : String(value).trim().slice(0, maxLength);
}

const attributionFields = {
  captured_at: 40,
  landing_path: 500,
  referrer: 500,
  utm_source: 200,
  utm_medium: 200,
  utm_campaign: 300,
  utm_content: 300,
  utm_term: 300,
  fbclid: 500,
  gclid: 500,
  msclkid: 500,
} as const;

function registrationAttribution(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as JsonRecord;
  const attribution: Record<string, string> = {};
  for (const [key, maxLength] of Object.entries(attributionFields)) {
    const cleaned = text(source[key], maxLength);
    if (cleaned) attribution[key] = cleaned;
  }

  if (attribution.captured_at) {
    const parsed = new Date(attribution.captured_at);
    if (Number.isNaN(parsed.getTime())) delete attribution.captured_at;
    else attribution.captured_at = parsed.toISOString();
  }
  if (attribution.landing_path && !attribution.landing_path.startsWith("/")) {
    delete attribution.landing_path;
  }
  if (attribution.referrer) {
    try {
      const referrer = new URL(attribution.referrer);
      if (!['http:', 'https:'].includes(referrer.protocol)) throw new Error('invalid protocol');
      attribution.referrer = `${referrer.origin}${referrer.pathname}`.slice(0, attributionFields.referrer);
    } catch {
      delete attribution.referrer;
    }
  }
  return attribution;
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function reissueInstitutionRosterLink(
  admin: AdminClient,
  registrationId: string,
  firstName: string,
  email: string,
) {
  const { data: roster, error: rosterError } = await admin
    .from("institution_rosters")
    .select("id, organization, seat_limit")
    .eq("registration_id", registrationId)
    .maybeSingle();
  if (rosterError || !roster) return null;

  const rawToken = crypto.randomUUID().replaceAll("-", "")
    + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await sha256(rawToken);
  const { error: tokenError } = await admin.from("institution_rosters").update({
    token_hash: tokenHash,
    token_expires_at: "2027-03-31T23:59:59Z",
  }).eq("id", roster.id);
  if (tokenError) return null;

  const url = `${productionOrigin}/register/starlight-rays-2026-2027/roster#${rawToken}`;
  const confirmation = await sendInstitutionRosterConfirmation({
    email,
    firstName,
    organization: roster.organization,
    rosterUrl: url,
    seatLimit: roster.seat_limit,
  });
  await admin.from("institution_rosters").update({
    confirmation_sent_at: confirmation.ok ? new Date().toISOString() : null,
    confirmation_error: confirmation.ok ? null : confirmation.error,
  }).eq("id", roster.id);
  if (confirmation.ok) {
    await admin.from("registrations").update({
      welcome_sent_at: new Date().toISOString(),
    }).eq("id", registrationId);
  }
  return { url, emailSent: confirmation.ok };
}

function authorizeEnvironment() {
  return Deno.env.get("AUTHORIZE_NET_ENVIRONMENT")?.toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function registrationConfig() {
  const environment = authorizeEnvironment();
  const liveEnabled = Deno.env.get("REGISTRATION_LIVE")?.toLowerCase() === "true";
  const apiLoginId = Deno.env.get("AUTHORIZE_NET_API_LOGIN_ID") || "";
  const transactionKey = Deno.env.get("AUTHORIZE_NET_TRANSACTION_KEY") || "";
  const publicClientKey = Deno.env.get("AUTHORIZE_NET_PUBLIC_CLIENT_KEY") || "";
  const rateLimitSalt = Deno.env.get("REGISTRATION_RATE_LIMIT_SALT") || "";
  const turnstileSiteKey = Deno.env.get("TURNSTILE_SITE_KEY") || "";
  const turnstileConfigured = Boolean(turnstileSiteKey && Deno.env.get("TURNSTILE_SECRET_KEY"));
  const testToken = Deno.env.get("REGISTRATION_TEST_TOKEN") || "";
  const testMode = environment === "production"
    && Deno.env.get("REGISTRATION_TEST_MODE")?.toLowerCase() === "true"
    && Boolean(testToken);
  const configured = Boolean(apiLoginId && transactionKey && publicClientKey && rateLimitSalt);
  const enabled = configured && turnstileConfigured && environment === "production" && liveEnabled;
  return {
    environment,
    liveEnabled,
    apiLoginId,
    transactionKey,
    publicClientKey,
    rateLimitSalt,
    turnstileSiteKey,
    turnstileConfigured,
    testToken,
    testMode,
    enabled,
  };
}

function authorizeEndpoint(environment: string) {
  return environment === "production"
    ? "https://api.authorize.net/xml/v1/request.api"
    : "https://apitest.authorize.net/xml/v1/request.api";
}

function acceptScript(environment: string) {
  return environment === "production"
    ? "https://js.authorize.net/v3/AcceptUI.js"
    : "https://jstest.authorize.net/v3/AcceptUI.js";
}

async function discoverPublicClientKey(config: ReturnType<typeof registrationConfig>) {
  if (!config.apiLoginId || !config.transactionKey) return { valid: false, publicClientKey: "" };
  try {
    const response = await fetch(authorizeEndpoint(config.environment), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        getMerchantDetailsRequest: {
          merchantAuthentication: {
            name: config.apiLoginId,
            transactionKey: config.transactionKey,
          },
        },
      }),
    });
    const responseText = (await response.text()).replace(/^\uFEFF/, "");
    const payload = JSON.parse(responseText) as JsonRecord;
    const messages = payload.messages as JsonRecord | undefined;
    return {
      valid: response.ok && messages?.resultCode === "Ok",
      publicClientKey: text(payload.publicClientKey, 200),
    };
  } catch {
    return { valid: false, publicClientKey: "" };
  }
}

function authorizeSummary(payload: JsonRecord) {
  const transaction = payload.transactionResponse as JsonRecord | undefined;
  const message = Array.isArray(transaction?.messages)
    ? transaction.messages[0] as JsonRecord | undefined
    : undefined;
  const error = Array.isArray(transaction?.errors)
    ? transaction.errors[0] as JsonRecord | undefined
    : undefined;
  const messages = payload.messages as JsonRecord | undefined;
  const topMessage = Array.isArray(messages?.message)
    ? messages.message[0] as JsonRecord | undefined
    : undefined;
  return {
    response_code: text(transaction?.responseCode, 10),
    auth_code: text(transaction?.authCode, 30),
    avs_result_code: text(transaction?.avsResultCode, 10),
    cvv_result_code: text(transaction?.cvvResultCode, 10),
    account_number: text(transaction?.accountNumber, 30),
    account_type: text(transaction?.accountType, 30),
    code: text(message?.code || error?.errorCode || topMessage?.code, 40),
    description: text(message?.description || error?.errorText || topMessage?.text, 300),
  };
}

async function voidAuthorizeTransaction(
  config: ReturnType<typeof registrationConfig>,
  transactionId: string,
) {
  try {
    const response = await fetch(authorizeEndpoint(config.environment), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createTransactionRequest: {
          merchantAuthentication: {
            name: config.apiLoginId,
            transactionKey: config.transactionKey,
          },
          transactionRequest: {
            transactionType: "voidTransaction",
            refTransId: transactionId,
          },
        },
      }),
    });
    const responseText = (await response.text()).replace(/^\uFEFF/, "");
    const payload = JSON.parse(responseText) as JsonRecord;
    const transaction = payload.transactionResponse as JsonRecord | undefined;
    const messages = payload.messages as JsonRecord | undefined;
    return {
      approved: response.ok
        && messages?.resultCode === "Ok"
        && transaction?.responseCode === "1",
      summary: authorizeSummary(payload),
    };
  } catch {
    return {
      approved: false,
      summary: { code: "void_response_unknown", description: "The void response could not be confirmed." },
    };
  }
}

async function getAuthorizeTransactionStatus(
  config: ReturnType<typeof registrationConfig>,
  transactionId: string,
) {
  try {
    const response = await fetch(authorizeEndpoint(config.environment), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        getTransactionDetailsRequest: {
          merchantAuthentication: {
            name: config.apiLoginId,
            transactionKey: config.transactionKey,
          },
          transId: transactionId,
        },
      }),
    });
    const responseText = (await response.text()).replace(/^\uFEFF/, "");
    const payload = JSON.parse(responseText) as JsonRecord;
    const transaction = payload.transaction as JsonRecord | undefined;
    return text(transaction?.transactionStatus, 80);
  } catch {
    return "";
  }
}

async function voidIsConfirmed(
  config: ReturnType<typeof registrationConfig>,
  transactionId: string,
) {
  const voidResult = await voidAuthorizeTransaction(config, transactionId);
  if (voidResult.approved) return { confirmed: true, summary: voidResult.summary };
  const transactionStatus = await getAuthorizeTransactionStatus(config, transactionId);
  return {
    confirmed: transactionStatus === "voided",
    summary: {
      ...voidResult.summary,
      transaction_status: transactionStatus || "unknown",
    },
  };
}

// ---- Payment plans (CIM profile + ARB schedule) ------------------------------
//
// A plan offer charges installment 1 with the Accept.js nonce exactly like a
// one-time purchase, builds a customer payment profile from that transaction,
// then schedules the remaining installments as an ARB subscription on it.
// Authorize.Net's JSON API is XML underneath: object key order is significant
// and must follow the schema, which is why these builders spell out fields in
// order rather than spreading.

type PlanContext = {
  id: string;
  customerProfileId: string;
  paymentProfileId: string;
  subscriptionId: string;
};

type GatewayMessage = { code: string; description: string };

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Same calendar day N months out, clamped to the last day of shorter months
// (a January 31 purchase bills February 28, then March 31 as ARB does).
function addMonthsClamped(date: Date, months: number) {
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

async function authorizeApiRequest(
  config: ReturnType<typeof registrationConfig>,
  body: JsonRecord,
): Promise<JsonRecord | null> {
  try {
    const response = await fetch(authorizeEndpoint(config.environment), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const responseText = (await response.text()).replace(/^\uFEFF/, "");
    return JSON.parse(responseText) as JsonRecord;
  } catch {
    return null;
  }
}

function gatewayMessage(payload: JsonRecord | null): GatewayMessage & { ok: boolean } {
  const messages = payload?.messages as JsonRecord | undefined;
  const first = Array.isArray(messages?.message) ? messages.message[0] as JsonRecord | undefined : undefined;
  return {
    ok: messages?.resultCode === "Ok",
    code: text(first?.code, 40) || (payload ? "" : "gateway_unreachable"),
    description: text(first?.text, 300) || (payload ? "" : "The gateway could not be reached."),
  };
}

async function createCustomerProfileFromTransaction(
  config: ReturnType<typeof registrationConfig>,
  input: { refId: string; transactionId: string; email: string },
) {
  const payload = await authorizeApiRequest(config, {
    createCustomerProfileFromTransactionRequest: {
      merchantAuthentication: {
        name: config.apiLoginId,
        transactionKey: config.transactionKey,
      },
      transId: input.transactionId,
      customer: {
        merchantCustomerId: input.refId,
        description: "Starlight Rays 2026-2027 payment plan",
        email: input.email,
      },
    },
  });
  const message = gatewayMessage(payload);
  const customerProfileId = text(payload?.customerProfileId, 40);
  const idList = payload?.customerPaymentProfileIdList;
  const paymentProfileId = Array.isArray(idList) ? text(idList[0], 40) : "";
  return {
    ok: message.ok && Boolean(customerProfileId && paymentProfileId),
    customerProfileId,
    paymentProfileId,
    message: { code: message.code, description: message.description },
  };
}

async function createInstallmentSubscription(
  config: ReturnType<typeof registrationConfig>,
  input: {
    refId: string;
    customerProfileId: string;
    paymentProfileId: string;
    amountCents: number;
    occurrences: number;
    startDate: string;
    invoiceNumber: string;
    description: string;
  },
) {
  const payload = await authorizeApiRequest(config, {
    ARBCreateSubscriptionRequest: {
      merchantAuthentication: {
        name: config.apiLoginId,
        transactionKey: config.transactionKey,
      },
      refId: input.refId,
      subscription: {
        name: "Starlight Rays 2026-27 plan",
        paymentSchedule: {
          interval: { length: "1", unit: "months" },
          startDate: input.startDate,
          totalOccurrences: String(input.occurrences),
        },
        amount: (input.amountCents / 100).toFixed(2),
        // Schema order: order precedes profile (E00003 otherwise).
        order: { invoiceNumber: input.invoiceNumber, description: input.description },
        profile: {
          customerProfileId: input.customerProfileId,
          customerPaymentProfileId: input.paymentProfileId,
        },
      },
    },
  });
  const message = gatewayMessage(payload);
  const subscriptionId = text(payload?.subscriptionId, 40);
  return {
    ok: message.ok && Boolean(subscriptionId),
    subscriptionId,
    message: { code: message.code, description: message.description },
  };
}

async function cancelInstallmentSubscription(
  config: ReturnType<typeof registrationConfig>,
  subscriptionId: string,
) {
  const payload = await authorizeApiRequest(config, {
    ARBCancelSubscriptionRequest: {
      merchantAuthentication: {
        name: config.apiLoginId,
        transactionKey: config.transactionKey,
      },
      subscriptionId,
    },
  });
  return gatewayMessage(payload).ok;
}

async function deleteCustomerProfile(
  config: ReturnType<typeof registrationConfig>,
  customerProfileId: string,
) {
  const payload = await authorizeApiRequest(config, {
    deleteCustomerProfileRequest: {
      merchantAuthentication: {
        name: config.apiLoginId,
        transactionKey: config.transactionKey,
      },
      customerProfileId,
    },
  });
  return gatewayMessage(payload).ok;
}

async function verifyTurnstile(token: string, remoteIp: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
  if (!secret) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });
    if (!response.ok) return false;
    const result = await response.json() as {
      success?: boolean;
      hostname?: string;
      action?: string;
      "error-codes"?: string[];
    };
    const verified = result.success === true
      && result.hostname === productionHostname
      && result.action === "registration";
    if (!verified) {
      console.error("turnstile_verification_failed", JSON.stringify({
        success: result.success,
        hostname: result.hostname,
        action: result.action,
        error_codes: result["error-codes"],
      }));
    }
    return verified;
  } catch {
    return false;
  }
}

function parseFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  return match
    ? { name: match[1].trim(), email: match[2].trim() }
    : { email: value.trim() };
}

async function sendWelcomeEmail(input: {
  email: string;
  firstName: string;
  offerName: string;
  amountCents: number;
  transactionId: string;
  signInLink: string;
  sessions: WelcomeSession[];
  plan?: WelcomePlan | null;
}) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) return false;
  const from = Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(input.amountCents / 100);
  const emailText = buildWelcomeEmailText({
    firstName: input.firstName,
    offerName: input.offerName,
    amount,
    transactionId: input.transactionId,
    signInLink: input.signInLink,
    sessions: input.sessions,
    plan: input.plan ?? null,
  });
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.email }] }],
      from: parseFrom(from),
      reply_to: { email: "office@centerforanthroposophy.org", name: "Center for Anthroposophy" },
      subject: "Your Starlight Rays registration",
      content: [{ type: "text/plain", value: emailText }],
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    }),
  });
  return response.ok;
}

// Money problems must reach a person. Plan scheduling failures go to the CfA
// office (override with PLAN_ALERT_EMAIL); delivery failure is logged, never
// surfaced to the registrant, who has already paid and been granted access.
async function sendOpsAlert(subject: string, body: string) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) return false;
  const from = Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const to = Deno.env.get("PLAN_ALERT_EMAIL") || "office@centerforanthroposophy.org";
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: parseFrom(from),
        subject: `[Starlight registration] ${subject}`,
        content: [{ type: "text/plain", value: body }],
        tracking_settings: { click_tracking: { enable: false, enable_text: false } },
      }),
    });
    if (!response.ok) console.error("ops_alert_failed", response.status);
    return response.ok;
  } catch {
    console.error("ops_alert_failed", "network");
    return false;
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (!isAllowedOrigin(origin)) return json({ error: "origin_not_allowed" }, 403, origin);
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration" }, 500, origin);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: program, error: programError } = await admin
    .from("programs")
    .select("id, name, client_id")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("platform", "thinkific")
    .eq("platform_id", STARLIGHT_PROGRAM_PLATFORM_ID)
    .maybeSingle();
  if (programError || !program) return json({ error: "program_unavailable" }, 503, origin);

  const now = new Date().toISOString();
  const { data: offers, error: offerError } = await admin
    .from("program_offers")
    .select("id, code, name, description, amount_cents, currency, seat_count, access_scope, installment_count")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("program_id", program.id)
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("amount_cents");
  if (offerError) return json({ error: "offers_unavailable" }, 503, origin);

  const offerIds = (offers || []).map((offer) => offer.id);
  const { data: offerSessionRows, error: offerSessionError } = offerIds.length
    ? await admin
      .from("program_offer_sessions")
      .select("offer_id, session_id")
      .in("offer_id", offerIds)
    : { data: [], error: null };
  const sessionIds = [...new Set((offerSessionRows || []).map((row) => row.session_id))];
  const { data: includedSessions, error: includedSessionError } = sessionIds.length
    ? await admin
      .from("cfa_learn_sessions")
      .select("id, slug, presenter, title, starts_at, ends_at, zoom_url")
      .in("id", sessionIds)
    : { data: [], error: null };
  if (offerSessionError || includedSessionError) {
    return json({ error: "offer_sessions_unavailable" }, 503, origin);
  }
  const sessionById = new Map((includedSessions || []).map((session) => [session.id, session]));
  // Signature series offers (access_scope 'all') come first so the full series is the default
  // selection; single sessions and the bundle follow. Price order is kept within each group.
  // Requested by Elsy Ayoub 2026-08-26.
  const groupRank = (offer: { access_scope?: string | null }) => (offer.access_scope === "all" ? 0 : 1);
  // A payment plan sorts directly after the one-time offer it splits.
  const orderedOffers = [...(offers || [])].sort((a, b) =>
    groupRank(a) - groupRank(b)
    || a.amount_cents - b.amount_cents
    || (a.installment_count ?? 1) - (b.installment_count ?? 1)
  );
  const offersWithSessions = orderedOffers.map((offer) => ({
    ...offer,
    included_sessions: (offerSessionRows || [])
      .filter((row) => row.offer_id === offer.id)
      .map((row) => sessionById.get(row.session_id))
      .filter(Boolean)
      .sort((a, b) => String(a!.starts_at).localeCompare(String(b!.starts_at)))
      .map((session) => ({
        id: session!.id,
        slug: session!.slug,
        presenter: session!.presenter,
        title: session!.title,
        starts_at: session!.starts_at,
        ends_at: session!.ends_at,
      })),
  }));

  const config = registrationConfig();
  const headerTestToken = request.headers.get("X-Registration-Test") || "";
  const headerTestAuthorized = config.testMode
    && headerTestToken.length > 0
    && headerTestToken === config.testToken;
  if (request.method === "GET") {
    const discovered = !config.publicClientKey
      ? await discoverPublicClientKey(config)
      : { valid: true, publicClientKey: config.publicClientKey };
    const paymentAvailable = (config.enabled && origin === productionOrigin) || headerTestAuthorized;
    const responseOffers = headerTestAuthorized
      ? offersWithSessions
        .filter((offer) => PRODUCTION_TEST_OFFER_CODES.has(offer.code))
        .map((offer) => ({
          ...offer,
          name: (offer.installment_count ?? 1) > 1
            ? "Authorized production integration test (payment plan)"
            : "Authorized production integration test",
          description: (offer.installment_count ?? 1) > 1
            ? `$${PRODUCTION_TEST_AMOUNT} split ${offer.installment_count} ways: first installment charged and voided, schedule created and cancelled, stored card deleted.`
            : `$${PRODUCTION_TEST_AMOUNT} charge followed by an immediate automatic void.`,
          amount_cents: PRODUCTION_TEST_AMOUNT_CENTS,
        }))
      : offersWithSessions;
    const couponParam = text(new URL(request.url).searchParams.get("coupon") || "", 40).trim().toUpperCase();
    let couponInfo: JsonRecord | null = null;
    if (couponParam) {
      const { data: couponRow } = await admin
        .from("program_coupons")
        .select("code, percent_off, active, starts_at, ends_at, max_uses, use_count")
        .eq("client_id", CFA_CLIENT_ID)
        .eq("program_id", program.id)
        .eq("code", couponParam)
        .maybeSingle();
      const nowMs = Date.now();
      const couponUsable = couponRow
        && couponRow.active
        && (!couponRow.starts_at || new Date(couponRow.starts_at).getTime() <= nowMs)
        && (!couponRow.ends_at || new Date(couponRow.ends_at).getTime() > nowMs)
        && (couponRow.max_uses === null || couponRow.use_count < couponRow.max_uses);
      couponInfo = couponUsable
        ? { code: couponRow.code, percent_off: couponRow.percent_off, valid: true }
        : { code: couponParam, valid: false };
    }
    return json({
      program: { name: program.name },
      offers: responseOffers,
      coupon: couponInfo,
      payment: {
        available: paymentAvailable,
        environment: config.environment,
        credentials_valid: discovered.valid,
        test_mode: headerTestAuthorized,
        api_login_id: paymentAvailable ? config.apiLoginId : null,
        public_client_key: paymentAvailable ? discovered.publicClientKey || null : null,
        accept_script: acceptScript(config.environment),
      },
      turnstile_site_key: config.liveEnabled ? config.turnstileSiteKey || null : null,
      turnstile_configured: config.turnstileConfigured,
    }, 200, origin);
  }

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }
  const bodyTestToken = text(body.test_token, 200);
  const testAuthorized = config.testMode
    && bodyTestToken.length > 0
    && bodyTestToken === config.testToken;
  if (!testAuthorized && origin !== productionOrigin) {
    return json({ error: "payment_origin_not_allowed" }, 403, origin);
  }
  if (!config.enabled && !testAuthorized) {
    return json({ error: "registration_not_configured" }, 503, origin);
  }

  if (body.action === "void_test") {
    if (!testAuthorized) return json({ error: "test_authorization_required" }, 403, origin);
    const registrationId = text(body.registration_id, 36);
    if (!validUuid(registrationId)) return json({ error: "invalid_registration" }, 400, origin);
    const { data: testRegistration, error: testRegistrationError } = await admin
      .from("registrations")
      .select("id, is_test, status, gateway_transaction_id")
      .eq("id", registrationId)
      .maybeSingle();
    if (testRegistrationError || !testRegistration?.is_test) {
      return json({ error: "test_registration_not_found" }, 404, origin);
    }
    if (testRegistration.status === "voided") {
      return json({ ok: true, test_mode: true, voided: true, registration_id: registrationId }, 200, origin);
    }
    if (!testRegistration.gateway_transaction_id) {
      return json({ error: "test_transaction_not_recorded" }, 409, origin);
    }
    const voidResult = await voidIsConfirmed(config, testRegistration.gateway_transaction_id);
    if (!voidResult.confirmed) {
      return json({ error: "void_pending", registration_id: registrationId }, 202, origin);
    }
    const { error: cleanupError } = await admin.rpc("cfa_void_test_registration", {
      requested_registration_id: registrationId,
      requested_void_response: voidResult.summary,
    });
    if (cleanupError) return json({ error: "void_cleanup_pending", registration_id: registrationId }, 202, origin);
    return json({ ok: true, test_mode: true, voided: true, registration_id: registrationId }, 200, origin);
  }

  if (text(body.company, 100)) return json({ ok: true }, 200, origin);

  const idempotencyKey = text(body.idempotency_key, 36);
  const offerCode = text(body.offer_code, 60);
  const firstName = text(body.first_name, 100);
  const lastName = text(body.last_name, 100);
  const email = text(body.email, 254).toLowerCase();
  const phone = text(body.phone, 50);
  const organization = text(body.organization, 200);
  const marketingOptIn = body.marketing_opt_in === true;
  const termsAccepted = body.terms_accepted === true;
  const attribution = registrationAttribution(body.attribution);
  const billing = body.billing_address && typeof body.billing_address === "object"
    ? body.billing_address as JsonRecord
    : {};
  const billingAddress = {
    address: text(billing.address, 200),
    city: text(billing.city, 100),
    state: text(billing.state, 100),
    zip: text(billing.zip, 30),
    country: text(billing.country, 2).toUpperCase() || "US",
  };
  const opaqueData = body.opaque_data && typeof body.opaque_data === "object"
    ? body.opaque_data as JsonRecord
    : {};
  const dataDescriptor = text(opaqueData.dataDescriptor, 100);
  const dataValue = text(opaqueData.dataValue, 4096);

  if (!validUuid(idempotencyKey) || !offerCode || !firstName || !lastName || !validEmail(email) || !termsAccepted) {
    return json({ error: "invalid_registration_details" }, 400, origin);
  }
  if (offerCode === "institution" && !organization) {
    return json({ error: "organization_required" }, 400, origin);
  }

  const remoteIp = text(request.headers.get("CF-Connecting-IP") || "unknown", 100);
  if (config.liveEnabled && !testAuthorized) {
    const turnstileToken = text(body.turnstile_token, 2048);
    if (!turnstileToken || !(await verifyTurnstile(turnstileToken, remoteIp))) {
      return json({ error: "verification_failed" }, 400, origin);
    }
  }

  const ipHash = await sha256(`${config.rateLimitSalt}:${remoteIp}`);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [emailRate, ipRate] = await Promise.all([
    admin.from("registrations").select("id", { count: "exact", head: true })
      .eq("client_id", CFA_CLIENT_ID).eq("email", email).gte("created_at", cutoff),
    admin.from("registrations").select("id", { count: "exact", head: true })
      .eq("client_id", CFA_CLIENT_ID).eq("ip_hash", ipHash).gte("created_at", cutoff),
  ]);
  if ((emailRate.count || 0) >= 5 || (ipRate.count || 0) >= 10) {
    return json({ error: "too_many_attempts" }, 429, origin);
  }

  const requestOffers = testAuthorized
    ? offersWithSessions
      .filter((offer) => PRODUCTION_TEST_OFFER_CODES.has(offer.code))
      .map((offer) => ({ ...offer, amount_cents: PRODUCTION_TEST_AMOUNT_CENTS }))
    : offersWithSessions;
  const selectedOffer = requestOffers.find((offer) => offer.code === offerCode);
  if (!selectedOffer) return json({ error: "offer_unavailable" }, 400, origin);

  const couponCode = text(body.coupon_code, 40).trim().toUpperCase();
  let coupon: { id: string; code: string; percent_off: number } | null = null;
  if (couponCode && !testAuthorized) {
    const { data: couponRow, error: couponError } = await admin
      .from("program_coupons")
      .select("id, code, percent_off, active, starts_at, ends_at, max_uses, use_count")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("program_id", program.id)
      .eq("code", couponCode)
      .maybeSingle();
    if (couponError) return json({ error: "coupon_lookup_failed" }, 500, origin);
    const nowMs = Date.now();
    const couponUsable = couponRow
      && couponRow.active
      && (!couponRow.starts_at || new Date(couponRow.starts_at).getTime() <= nowMs)
      && (!couponRow.ends_at || new Date(couponRow.ends_at).getTime() > nowMs)
      && (couponRow.max_uses === null || couponRow.use_count < couponRow.max_uses);
    if (!couponUsable) return json({ error: "coupon_invalid" }, 400, origin);
    coupon = { id: couponRow.id, code: couponRow.code, percent_off: couponRow.percent_off };
  }
  const discountCents = coupon
    ? Math.min(selectedOffer.amount_cents, Math.round(selectedOffer.amount_cents * coupon.percent_off / 100))
    : 0;
  const chargeAmountCents = selectedOffer.amount_cents - discountCents;
  // Installments split the (possibly discounted) total evenly, remainder on
  // the first charge. A split that would produce a sub-cent installment falls
  // back to a single charge rather than failing at the gateway.
  const requestedInstallments = Number(selectedOffer.installment_count ?? 1);
  const installmentCount = requestedInstallments > 1
      && chargeAmountCents > 0
      && Math.floor(chargeAmountCents / requestedInstallments) >= 1
    ? requestedInstallments
    : 1;
  const installmentCents = installmentCount > 1
    ? Math.floor(chargeAmountCents / installmentCount)
    : chargeAmountCents;
  const firstInstallmentCents = installmentCount > 1
    ? chargeAmountCents - installmentCents * (installmentCount - 1)
    : chargeAmountCents;
  if (chargeAmountCents > 0 && (dataDescriptor !== "COMMON.ACCEPT.INAPP.PAYMENT" || !dataValue)) {
    return json({ error: "invalid_payment_token" }, 400, origin);
  }
  if (chargeAmountCents > 0
    && (!billingAddress.address || !billingAddress.city || !billingAddress.state || !billingAddress.zip)) {
    return json({ error: "invalid_billing_address" }, 400, origin);
  }

  if (selectedOffer.code !== "institution") {
    const { data: alreadyEnrolled, error: enrollmentAccessError } = await admin.rpc(
      "cfa_registration_has_offer_access",
      {
        requested_client_id: CFA_CLIENT_ID,
        requested_program_id: program.id,
        requested_offer_id: selectedOffer.id,
        requested_email: email,
      },
    );
    if (enrollmentAccessError) return json({ error: "enrollment_lookup_failed" }, 500, origin);
    if (alreadyEnrolled === true) {
      return json({ error: "already_enrolled", redirect: "/learn/sign-in?registered=1" }, 409, origin);
    }
  }

  const { data: existing, error: existingError } = await admin
    .from("registrations")
    .select("id, status, email, offer_id, amount_cents, welcome_sent_at")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) return json({ error: "registration_lookup_failed" }, 500, origin);
  if (existing && (
    existing.email !== email
    || existing.offer_id !== selectedOffer.id
    || existing.amount_cents !== chargeAmountCents
  )) {
    return json({ error: "idempotency_conflict" }, 409, origin);
  }
  if (existing?.status === "paid") {
    if (selectedOffer.code === "institution") {
      const rosterLink = await reissueInstitutionRosterLink(admin, existing.id, firstName, email);
      if (!rosterLink) {
        return json({ error: "access_pending", registration_id: existing.id }, 202, origin);
      }
      return json({
        ok: true,
        replayed: true,
        institution: true,
        registration_id: existing.id,
        email_sent: rosterLink.emailSent,
        amount_cents: existing.amount_cents,
        roster_url: rosterLink.url,
        redirect: null,
      }, 200, origin);
    }
    return json({
      ok: true,
      replayed: true,
      registration_id: existing.id,
      email_sent: Boolean(existing.welcome_sent_at),
      institution: selectedOffer.code === "institution",
      redirect: selectedOffer.code === "institution" ? null : "/learn/sign-in?registered=1",
    }, 200, origin);
  }
  if (existing && ["processing", "enrollment_pending"].includes(existing.status)) {
    return json({ error: "registration_pending", registration_id: existing.id }, 409, origin);
  }
  if (existing && existing.status !== "failed") {
    return json({ error: "idempotency_conflict" }, 409, origin);
  }

  const [pendingRegistrationResult, paidOfferResult] = await Promise.all([
    admin
      .from("registrations")
      .select("id, status")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("program_id", program.id)
      .eq("email", email)
      .in("status", ["processing", "enrollment_pending"])
      .neq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("registrations")
      .select("id, status")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("program_id", program.id)
      .eq("offer_id", selectedOffer.id)
      .eq("email", email)
      .eq("status", "paid")
      .neq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (pendingRegistrationResult.error || paidOfferResult.error) {
    return json({ error: "registration_lookup_failed" }, 500, origin);
  }
  if (paidOfferResult.data) {
    if (selectedOffer.code === "institution") {
      const rosterLink = await reissueInstitutionRosterLink(
        admin,
        paidOfferResult.data.id,
        firstName,
        email,
      );
      if (!rosterLink) {
        return json({ error: "access_pending", registration_id: paidOfferResult.data.id }, 202, origin);
      }
      return json({
        ok: true,
        replayed: true,
        institution: true,
        registration_id: paidOfferResult.data.id,
        email_sent: rosterLink.emailSent,
        roster_url: rosterLink.url,
        redirect: null,
      }, 200, origin);
    }
    return json({ error: "already_registered", redirect: "/learn/sign-in?registered=1" }, 409, origin);
  }
  if (pendingRegistrationResult.data) {
    return json({ error: "registration_pending", registration_id: pendingRegistrationResult.data.id }, 409, origin);
  }

  const registrationValues = {
    client_id: CFA_CLIENT_ID,
    program_id: program.id,
    offer_id: selectedOffer.id,
    idempotency_key: idempotencyKey,
    status: "processing",
    email,
    first_name: firstName,
    last_name: lastName,
    phone: phone || null,
    organization: organization || null,
    billing_address: billingAddress,
    amount_cents: chargeAmountCents,
    currency: selectedOffer.currency,
    seat_count: selectedOffer.seat_count,
    coupon_code: coupon?.code ?? null,
    discount_cents: discountCents,
    marketing_opt_in: marketingOptIn,
    terms_accepted_at: new Date().toISOString(),
    gateway_environment: config.environment,
    is_test: testAuthorized,
    gateway_response: {},
    failure_code: null,
    failure_message: null,
    ip_hash: ipHash,
    attribution,
  };
  const registrationResult = existing
    ? await admin.from("registrations").update(registrationValues)
      .eq("id", existing.id).eq("status", "failed").select("id").single()
    : await admin.from("registrations").insert(registrationValues).select("id").single();
  if (registrationResult.error || !registrationResult.data) {
    if (existing && registrationResult.error?.code === "PGRST116") {
      return json({ error: "registration_pending", registration_id: existing.id }, 409, origin);
    }
    if (registrationResult.error?.code === "23505") {
      return json({ error: "registration_unavailable" }, 409, origin);
    }
    return json({ error: "registration_save_failed" }, 500, origin);
  }
  const registrationId = registrationResult.data.id as string;

  if (testAuthorized) {
    const tokenHash = await sha256(bodyTestToken);
    const { data: claimed, error: claimError } = await admin.rpc("cfa_claim_payment_test", {
      requested_token_hash: tokenHash,
      requested_registration_id: registrationId,
    });
    if (claimError || claimed !== true) {
      await admin.from("registrations").update({
        status: "cancelled",
        failure_code: "test_authorization_used",
        failure_message: "The one-time production test authorization is no longer available.",
      }).eq("id", registrationId);
      return json({ error: "test_authorization_used" }, 409, origin);
    }
  }

  if (coupon) {
    const { data: couponClaimed, error: couponClaimError } = await admin.rpc("cfa_claim_coupon", {
      requested_coupon_id: coupon.id,
      requested_registration_id: registrationId,
    });
    if (couponClaimError || couponClaimed !== true) {
      await admin.from("registrations").update({
        status: "cancelled",
        failure_code: "coupon_unavailable",
        failure_message: "The coupon code is no longer available.",
      }).eq("id", registrationId);
      return json({ error: "coupon_invalid" }, 409, origin);
    }
  }

  // A fully discounted registration never touches the gateway; the synthetic
  // transaction reference keeps completion and audit records consistent.
  let transactionId = `comp-${registrationId.replaceAll("-", "").slice(0, 16)}`;
  let summary: JsonRecord = {
    code: "coupon_comp",
    description: `Registered with ${coupon?.percent_off ?? 100}% coupon ${coupon?.code ?? ""}`.trim(),
  };
  // Payment-plan context outlives the charge block: schedule creation, the
  // welcome email, and test cleanup all need the profile and subscription ids.
  let plan: PlanContext | null = null;
  const refId = registrationId.replaceAll("-", "").slice(0, 20);
  const invoiceNumber = `SR-${registrationId.replaceAll("-", "").slice(0, 15)}`;

  // Controlled production tests leave nothing behind at the gateway either:
  // the schedule is cancelled and the stored card deleted.
  async function cleanupPlanTest() {
    if (!plan) return null;
    const subscriptionCancelled = plan.subscriptionId
      ? await cancelInstallmentSubscription(config, plan.subscriptionId)
      : null;
    const profileDeleted = plan.customerProfileId
      ? await deleteCustomerProfile(config, plan.customerProfileId)
      : null;
    const { data: current } = await admin
      .from("registration_payment_plans").select("notes").eq("id", plan.id).maybeSingle();
    await admin.from("registration_payment_plans").update({
      status: "cancelled",
      notes: [
        current?.notes,
        `Production integration test. subscription_created=${Boolean(plan.subscriptionId)} `
          + `subscription_cancelled=${subscriptionCancelled} profile_deleted=${profileDeleted}`,
      ].filter(Boolean).join(" || "),
    }).eq("id", plan.id);
    await admin.from("registration_installments").update({ status: "voided" }).eq("plan_id", plan.id);
    return {
      subscription_created: Boolean(plan.subscriptionId),
      subscription_cancelled: subscriptionCancelled,
      profile_deleted: profileDeleted,
    };
  }

  if (chargeAmountCents > 0) {
  const chargeRequest = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: config.apiLoginId,
        transactionKey: config.transactionKey,
      },
      refId,
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: (firstInstallmentCents / 100).toFixed(2),
        payment: { opaqueData: { dataDescriptor, dataValue } },
        order: {
          invoiceNumber,
          description: testAuthorized
            ? "Starlight production integration test"
            : plan
            ? `Starlight Rays 2026-2027 · payment 1 of ${installmentCount}`
            : "Starlight Rays 2026-2027",
        },
        customer: { email },
        billTo: {
          firstName,
          lastName,
          company: organization,
          address: billingAddress.address,
          city: billingAddress.city,
          state: billingAddress.state,
          zip: billingAddress.zip,
          country: billingAddress.country,
        },
        transactionSettings: {
          setting: [{ settingName: "duplicateWindow", settingValue: "300" }],
        },
      },
    },
  };

  let chargePayload: JsonRecord;
  try {
    const chargeResponse = await fetch(authorizeEndpoint(config.environment), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chargeRequest),
    });
    const responseText = (await chargeResponse.text()).replace(/^\uFEFF/, "");
    chargePayload = JSON.parse(responseText) as JsonRecord;
  } catch {
    await admin.from("registrations").update({
      status: "enrollment_pending",
      failure_code: "gateway_response_unknown",
      failure_message: "The gateway response could not be confirmed; manual review is required.",
    }).eq("id", registrationId);
    return json({ error: "payment_status_unknown", registration_id: registrationId }, 202, origin);
  }

  const transaction = chargePayload.transactionResponse as JsonRecord | undefined;
  const messages = chargePayload.messages as JsonRecord | undefined;
  transactionId = text(transaction?.transId, 40);
  // The merchant account's fraud filter parks the $1 production test as
  // "held for review" (responseCode 4, reason 252), which a real purchase
  // does not trigger. A held transaction can still be voided, so in test mode
  // it counts as approved: otherwise the harness would void and stop before
  // exercising anything past the charge (schedule creation, cleanup).
  const heldForReview = transaction?.responseCode === "4"
    && Boolean(transactionId)
    && transactionId !== "0";
  const approved = (messages?.resultCode === "Ok"
    && transaction?.responseCode === "1"
    && Boolean(transactionId)
    && transactionId !== "0")
    || (testAuthorized && heldForReview);
  summary = authorizeSummary(chargePayload);
  if (!approved) {
    if (testAuthorized && transactionId && transactionId !== "0") {
      await admin.from("registrations").update({
        status: "enrollment_pending",
        gateway_transaction_id: transactionId,
        gateway_response: summary,
        failure_code: summary.code || "payment_review",
        failure_message: summary.description || "The payment result requires manual review.",
      }).eq("id", registrationId);
      const voidResult = await voidIsConfirmed(config, transactionId);
      if (!voidResult.confirmed) {
        await admin.from("registrations").update({
          failure_code: "void_pending",
          failure_message: "The production test transaction requires a void retry.",
        }).eq("id", registrationId);
        return json({ error: "void_pending", registration_id: registrationId }, 202, origin);
      }
      const { error: cleanupError } = await admin.rpc("cfa_void_test_registration", {
        requested_registration_id: registrationId,
        requested_void_response: voidResult.summary,
      });
      if (cleanupError) {
        return json({ error: "void_cleanup_pending", registration_id: registrationId }, 202, origin);
      }
      return json({
        ok: true,
        test_mode: true,
        voided: true,
        registration_id: registrationId,
        transaction_id: transactionId,
        email_sent: false,
        plan_test: await cleanupPlanTest(),
      }, 200, origin);
    }
    const definitelyDeclined = transaction?.responseCode === "2" && (!transactionId || transactionId === "0");
    const needsReview = !definitelyDeclined;
    await admin.from("registrations").update({
      status: needsReview ? "enrollment_pending" : "failed",
      gateway_transaction_id: transactionId && transactionId !== "0" ? transactionId : null,
      gateway_response: summary,
      failure_code: summary.code || (needsReview ? "payment_review" : "payment_declined"),
      failure_message: summary.description || (needsReview
        ? "The payment result requires manual review."
        : "The payment was declined."),
    }).eq("id", registrationId);
    if (needsReview) {
      return json({
        error: "payment_review",
        registration_id: registrationId,
      }, 202, origin);
    }
    return json({
      error: "payment_declined",
      message: summary.description || "The payment was declined.",
    }, 402, origin);
  }
  }

  const { error: paymentRecordError } = await admin.from("registrations").update({
    status: "enrollment_pending",
    gateway_transaction_id: transactionId,
    gateway_response: summary,
    paid_at: new Date().toISOString(),
    failure_code: null,
    failure_message: null,
  }).eq("id", registrationId);
  if (paymentRecordError) {
    if (testAuthorized) {
      const voidResult = await voidIsConfirmed(config, transactionId);
      if (!voidResult.confirmed) {
        return json({ error: "void_pending", registration_id: registrationId }, 202, origin);
      }
      const { error: recoveryRecordError } = await admin.from("registrations").update({
        status: "enrollment_pending",
        gateway_transaction_id: transactionId,
        gateway_response: summary,
        paid_at: new Date().toISOString(),
      }).eq("id", registrationId);
      if (recoveryRecordError) {
        return json({ error: "void_record_pending", registration_id: registrationId }, 202, origin);
      }
      const { error: cleanupError } = await admin.rpc("cfa_void_test_registration", {
        requested_registration_id: registrationId,
        requested_void_response: voidResult.summary,
      });
      if (cleanupError) {
        return json({ error: "void_cleanup_pending", registration_id: registrationId }, 202, origin);
      }
      return json({
        ok: true,
        test_mode: true,
        voided: true,
        registration_id: registrationId,
        transaction_id: transactionId,
        email_sent: false,
        plan_test: await cleanupPlanTest(),
      }, 200, origin);
    }
    return json({ error: "payment_status_unknown", registration_id: registrationId }, 202, origin);
  }

  // Installment 1 has settled through the same nonce charge as a one-time
  // purchase (CVV present, proven path). Now keep the card: Authorize.Net
  // builds the customer payment profile from that transaction, and the
  // remaining installments become an ARB subscription on it. This runs before
  // portal access is provisioned — the participant is on the plan regardless
  // of whether the access step succeeds — and any failure here is flagged for
  // the office, never charged again.
  let welcomePlan: WelcomePlan | null = null;
  if (installmentCount > 1) {
    const purchasedOn = new Date();
    const nextChargeOn = isoDate(addMonthsClamped(purchasedOn, 1));
    const finalChargeOn = isoDate(addMonthsClamped(purchasedOn, installmentCount - 1));
    const profile = await createCustomerProfileFromTransaction(config, { refId, transactionId, email });
    const { data: planRow, error: planError } = await admin
      .from("registration_payment_plans")
      .insert({
        registration_id: registrationId,
        client_id: CFA_CLIENT_ID,
        gateway_environment: config.environment,
        customer_profile_id: profile.ok ? profile.customerProfileId : null,
        payment_profile_id: profile.ok ? profile.paymentProfileId : null,
        total_cents: chargeAmountCents,
        installment_count: installmentCount,
        installment_cents: installmentCents,
        first_installment_cents: firstInstallmentCents,
        paid_installments: 1,
        paid_cents: firstInstallmentCents,
        next_charge_on: nextChargeOn,
        final_charge_on: finalChargeOn,
        status: "pending",
      })
      .select("id")
      .single();
    let subscription = { ok: false, subscriptionId: "", message: profile.message };
    if (planError || !planRow) {
      console.error("payment_plan_record_failed", JSON.stringify({ registration_id: registrationId }));
    } else {
      plan = {
        id: planRow.id as string,
        customerProfileId: profile.ok ? profile.customerProfileId : "",
        paymentProfileId: profile.ok ? profile.paymentProfileId : "",
        subscriptionId: "",
      };
      if (profile.ok) {
        subscription = await createInstallmentSubscription(config, {
          refId,
          customerProfileId: profile.customerProfileId,
          paymentProfileId: profile.paymentProfileId,
          amountCents: installmentCents,
          occurrences: installmentCount - 1,
          startDate: nextChargeOn,
          invoiceNumber,
          description: testAuthorized
            ? "Starlight production integration test (plan)"
            : `Starlight Rays 2026-2027 · payments 2-${installmentCount} of ${installmentCount}`,
        });
        plan.subscriptionId = subscription.subscriptionId;
      }
      const settledAt = new Date().toISOString();
      const installmentRows = Array.from({ length: installmentCount }, (_, index) => ({
        plan_id: plan!.id,
        sequence: index + 1,
        amount_cents: index === 0 ? firstInstallmentCents : installmentCents,
        due_on: isoDate(addMonthsClamped(purchasedOn, index)),
        status: index === 0 ? "paid" : "scheduled",
        gateway_transaction_id: index === 0 ? transactionId : null,
        gateway_response: index === 0 ? summary : {},
        attempted_at: index === 0 ? settledAt : null,
        paid_at: index === 0 ? settledAt : null,
      }));
      const { error: installmentError } = await admin.from("registration_installments").insert(installmentRows);
      const scheduleNote = subscription.ok
        ? null
        : `${profile.ok ? "ARB creation" : "Profile creation"} failed: ${subscription.message.code} ${subscription.message.description}`.trim();
      await admin.from("registration_payment_plans").update({
        status: subscription.ok ? "active" : "schedule_pending",
        subscription_id: subscription.ok ? subscription.subscriptionId : null,
        gateway_status: subscription.ok ? "active" : null,
        notes: [scheduleNote, installmentError ? "Installment rows could not be written." : null]
          .filter(Boolean).join(" ") || null,
      }).eq("id", plan.id);
    }
    if (!subscription.ok) {
      console.error("payment_plan_schedule_failed", JSON.stringify({
        registration_id: registrationId,
        plan_id: plan?.id ?? null,
        test_mode: testAuthorized,
        profile_ok: profile.ok,
        profile_message: profile.message,
        message: subscription.message,
      }));
    }
    if (!subscription.ok && !testAuthorized) {
      await sendOpsAlert(
        "Starlight payment plan needs a schedule",
        [
          `Registration ${registrationId} paid installment 1 (${formatMoney(firstInstallmentCents)}, transaction ${transactionId})`,
          `but the recurring schedule for the remaining ${installmentCount - 1} payments of ${formatMoney(installmentCents)}`,
          "was not created.",
          "",
          `Gateway message: ${subscription.message.code} ${subscription.message.description}`.trim(),
          plan?.customerProfileId
            ? `Customer profile: ${plan.customerProfileId} / payment profile ${plan.paymentProfileId}`
            : "No customer profile was created; build one from the transaction in the merchant interface.",
          "",
          `Create the ARB subscription from that profile, starting ${nextChargeOn}, then record its id on`,
          "registration_payment_plans and run cfa-plan-sync.",
        ].join("\n"),
      );
    }
    welcomePlan = {
      installmentCount,
      firstAmount: formatMoney(firstInstallmentCents),
      installmentAmount: formatMoney(installmentCents),
      nextChargeOn,
      finalChargeOn,
      scheduled: subscription.ok,
    };
  }

  if (testAuthorized) {
    const voidResult = await voidIsConfirmed(config, transactionId);
    if (!voidResult.confirmed) {
      await admin.from("registrations").update({
        status: "enrollment_pending",
        failure_code: "void_pending",
        failure_message: "The production test charge succeeded, but its void requires retry.",
      }).eq("id", registrationId);
      return json({ error: "void_pending", registration_id: registrationId }, 202, origin);
    }
    const { error: cleanupError } = await admin.rpc("cfa_void_test_registration", {
      requested_registration_id: registrationId,
      requested_void_response: voidResult.summary,
    });
    if (cleanupError) {
      return json({ error: "void_cleanup_pending", registration_id: registrationId }, 202, origin);
    }
    return json({
      ok: true,
      test_mode: true,
      voided: true,
      registration_id: registrationId,
      transaction_id: transactionId,
      email_sent: false,
      plan_test: await cleanupPlanTest(),
    }, 200, origin);
  }

  if (selectedOffer.code === "institution") {
    const rawRosterToken = crypto.randomUUID().replaceAll("-", "")
      + crypto.randomUUID().replaceAll("-", "");
    const rosterTokenHash = await sha256(rawRosterToken);
    const rosterTokenExpiresAt = "2027-03-31T23:59:59Z";
    const { data: completionRows, error: completionError } = await admin.rpc(
      "cfa_complete_institution_registration",
      {
        requested_registration_id: registrationId,
        requested_gateway_transaction_id: transactionId,
        requested_gateway_response: summary,
        requested_roster_token_hash: rosterTokenHash,
        requested_token_expires_at: rosterTokenExpiresAt,
      },
    );
    if (completionError) {
      await admin.from("registrations").update({
        status: "enrollment_pending",
        gateway_transaction_id: transactionId,
        gateway_response: summary,
        failure_code: "institution_roster_failed",
        failure_message: "Payment succeeded, but the institution roster requires manual review.",
      }).eq("id", registrationId);
      return json({ error: "access_pending", registration_id: registrationId }, 202, origin);
    }

    const completion = Array.isArray(completionRows) ? completionRows[0] : completionRows;
    const rosterId = completion && typeof completion === "object"
      ? text((completion as JsonRecord).roster_id, 36)
      : "";
    const rosterUrl = `${productionOrigin}/register/starlight-rays-2026-2027/roster#${rawRosterToken}`;
    const confirmation = await sendInstitutionRosterConfirmation({
      email,
      firstName,
      organization,
      rosterUrl,
      seatLimit: selectedOffer.seat_count,
    });
    if (rosterId) {
      await admin.from("institution_rosters").update({
        confirmation_sent_at: confirmation.ok ? new Date().toISOString() : null,
        confirmation_error: confirmation.ok ? null : confirmation.error,
      }).eq("id", rosterId);
    }
    if (confirmation.ok) {
      await admin.from("registrations").update({
        welcome_sent_at: new Date().toISOString(),
      }).eq("id", registrationId);
    }

    return json({
      ok: true,
      institution: true,
      registration_id: registrationId,
      transaction_id: transactionId,
      email_sent: confirmation.ok,
      amount_cents: chargeAmountCents,
      coupon: coupon?.code ?? null,
      roster_url: rosterUrl,
      redirect: null,
    }, 200, origin);
  }

  const redirectTo = Deno.env.get("LEARN_REDIRECT_URL")
    || `${productionOrigin}/learn/auth?next=/learn/starlight-rays-2026-2027`;
  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo,
      data: { first_name: firstName, last_name: lastName },
    },
  });
  if (linkError || !linkData.user || !linkData.properties?.hashed_token) {
    await admin.from("registrations").update({
      status: "enrollment_pending",
      gateway_transaction_id: transactionId,
      gateway_response: summary,
      failure_code: "auth_provisioning_failed",
      failure_message: "Payment succeeded, but portal access requires manual review.",
    }).eq("id", registrationId);
    return json({ error: "access_pending", registration_id: registrationId }, 202, origin);
  }

  const signInUrl = new URL(`${productionOrigin}/learn/auth`);
  signInUrl.searchParams.set("token_hash", linkData.properties.hashed_token);
  signInUrl.searchParams.set("type", "email");

  const { error: completionError } = await admin.rpc("cfa_complete_registration", {
    requested_registration_id: registrationId,
    requested_gateway_transaction_id: transactionId,
    requested_gateway_response: summary,
  });
  if (completionError) {
    await admin.from("registrations").update({
      status: "enrollment_pending",
      gateway_transaction_id: transactionId,
      gateway_response: summary,
      failure_code: "enrollment_failed",
      failure_message: "Payment succeeded, but portal access requires manual review.",
    }).eq("id", registrationId);
    return json({ error: "access_pending", registration_id: registrationId }, 202, origin);
  }

  let emailSent = false;
  try {
    const purchasedSessions: WelcomeSession[] = selectedOffer.access_scope === "sessions"
      ? (offerSessionRows || [])
        .filter((row) => row.offer_id === selectedOffer.id)
        .map((row) => sessionById.get(row.session_id))
        .filter(Boolean)
        .sort((a, b) => String(a!.starts_at).localeCompare(String(b!.starts_at)))
        .map((session) => ({
          title: String(session!.title),
          startsAt: String(session!.starts_at),
          endsAt: session!.ends_at ? String(session!.ends_at) : null,
          zoomUrl: session!.zoom_url ? String(session!.zoom_url) : null,
        }))
      : [];
    emailSent = await sendWelcomeEmail({
      email,
      firstName,
      offerName: coupon
        ? `${selectedOffer.name} (coupon ${coupon.code}, ${coupon.percent_off}% off)`
        : selectedOffer.name,
      amountCents: chargeAmountCents,
      transactionId,
      signInLink: signInUrl.toString(),
      sessions: purchasedSessions,
      plan: welcomePlan,
    });
  } catch {
    emailSent = false;
  }
  if (emailSent) {
    await admin.from("registrations").update({ welcome_sent_at: new Date().toISOString() }).eq("id", registrationId);
  }

  return json({
    ok: true,
    registration_id: registrationId,
    transaction_id: transactionId,
    email_sent: emailSent,
    amount_cents: chargeAmountCents,
    coupon: coupon?.code ?? null,
    plan: welcomePlan,
    redirect: "/learn/sign-in?registered=1",
  }, 200, origin);
});
