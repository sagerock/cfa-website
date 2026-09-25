// cfa-donate: the unified donation form's backend. STAGED 2026-09-25, NOT DEPLOYED.
//
// GET  → public form configuration (active funds, amounts, and — only when the
//        live gate is fully open and the caller is the production origin — the
//        Authorize.Net public keys and Turnstile site key).
// POST → one gift: a card charge (one-time, or payment 1 of a monthly ARB
//        schedule), or a check pledge recorded without charging.
// POST with X-Donation-Staff-Token → staff marks a check received (a pledge or
//        a check that simply arrived in the mail); the donor receipt goes then.
//
// Nothing can charge until DONATIONS_LIVE=true AND the gateway is production AND
// every credential and the Turnstile secret are set AND the request comes from
// the exact DONATION_ORIGIN. The browser never supplies an amount the server
// uses: every figure is recomputed by ../_shared/donationMath.js.
//
// Modeled on cfa-register (same gateway calls, same decline/review handling)
// without sharing its state or changing its behavior.
//
// Deploy with --no-verify-jwt: the public form calls it without a Supabase key,
// and the staff path has its own token.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { DONATION_FUND_GROUPS, activeFunds, findFund } from "../_shared/donationFunds.js";
import {
  ABSOLUTE_MIN_GIFT_CENTS,
  CHECK_MAILING_ADDRESS,
  CHECK_PAYABLE_TO,
  MAX_CARD_CHARGE_CENTS,
  MIN_GIFT_CENTS,
  MONTH_OPTIONS,
  PROCESSING_FEE_BPS,
  SUGGESTED_AMOUNTS,
  addMonthsClamped,
  monthlySchedule,
  parseAmountToCents,
  validateDonation,
} from "../_shared/donationMath.js";
import {
  OFFICE_EMAIL,
  buildCardReceipt,
  buildCheckPledgeEmail,
  buildCheckReceipt,
  buildStaffNotice,
} from "../_shared/donationEmail.js";

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const DEFAULT_DONATION_ORIGIN = "https://learn.centerforanthroposophy.org";
// Exact origins only, no wildcards. These may read the public configuration
// (payment stays unavailable to them); only DONATION_ORIGIN may submit.
const READ_ONLY_ORIGINS = new Set([
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

type JsonRecord = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type AdminClient = any;
// deno-lint-ignore no-explicit-any
type Donation = any;

function text(value: unknown, maxLength: number) {
  return value == null ? "" : String(value).trim().slice(0, maxLength);
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function donationOrigin(): string | null {
  const configured = Deno.env.get("DONATION_ORIGIN") || DEFAULT_DONATION_ORIGIN;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" && url.pathname === "/" ? url.origin : null;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string | null) {
  return Boolean(origin) && (origin === donationOrigin() || READ_ONLY_ORIGINS.has(origin!));
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin! : (donationOrigin() || DEFAULT_DONATION_ORIGIN),
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function donationConfig() {
  const environment = Deno.env.get("AUTHORIZE_NET_ENVIRONMENT")?.toLowerCase() === "production"
    ? "production"
    : "sandbox";
  const liveEnabled = Deno.env.get("DONATIONS_LIVE")?.toLowerCase() === "true";
  const apiLoginId = Deno.env.get("AUTHORIZE_NET_API_LOGIN_ID") || "";
  const transactionKey = Deno.env.get("AUTHORIZE_NET_TRANSACTION_KEY") || "";
  const publicClientKey = Deno.env.get("AUTHORIZE_NET_PUBLIC_CLIENT_KEY") || "";
  const rateLimitSalt = Deno.env.get("DONATION_RATE_LIMIT_SALT") || "";
  const turnstileSiteKey = Deno.env.get("TURNSTILE_SITE_KEY") || "";
  const turnstileConfigured = Boolean(turnstileSiteKey && Deno.env.get("TURNSTILE_SECRET_KEY"));
  const origin = donationOrigin();
  const requestedMin = Number(Deno.env.get("DONATION_MIN_CENTS") || MIN_GIFT_CENTS);
  const minGiftCents = Number.isInteger(requestedMin)
    ? Math.max(ABSOLUTE_MIN_GIFT_CENTS, requestedMin)
    : MIN_GIFT_CENTS;
  const configured = Boolean(apiLoginId && transactionKey && publicClientKey && rateLimitSalt && origin);
  return {
    environment,
    liveEnabled,
    apiLoginId,
    transactionKey,
    publicClientKey,
    rateLimitSalt,
    turnstileSiteKey,
    turnstileConfigured,
    origin,
    minGiftCents,
    enabled: configured && turnstileConfigured && environment === "production" && liveEnabled,
  };
}
type Config = ReturnType<typeof donationConfig>;

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

async function authorizeApiRequest(config: Config, body: JsonRecord): Promise<JsonRecord | null> {
  try {
    const response = await fetch(authorizeEndpoint(config.environment), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify(body),
    });
    const responseText = (await response.text()).replace(/^\uFEFF/, "");
    return JSON.parse(responseText) as JsonRecord;
  } catch {
    return null;
  }
}

function merchantAuthentication(config: Config) {
  return { name: config.apiLoginId, transactionKey: config.transactionKey };
}

function gatewayMessage(payload: JsonRecord | null) {
  const messages = payload?.messages as JsonRecord | undefined;
  const first = Array.isArray(messages?.message) ? messages.message[0] as JsonRecord | undefined : undefined;
  return {
    ok: messages?.resultCode === "Ok",
    code: text(first?.code, 40) || (payload ? "" : "gateway_unreachable"),
    description: text(first?.text, 300) || (payload ? "" : "The gateway could not be reached."),
  };
}

function authorizeSummary(payload: JsonRecord) {
  const transaction = payload.transactionResponse as JsonRecord | undefined;
  const message = Array.isArray(transaction?.messages) ? transaction.messages[0] as JsonRecord | undefined : undefined;
  const error = Array.isArray(transaction?.errors) ? transaction.errors[0] as JsonRecord | undefined : undefined;
  const top = gatewayMessage(payload);
  return {
    response_code: text(transaction?.responseCode, 10),
    auth_code: text(transaction?.authCode, 30),
    avs_result_code: text(transaction?.avsResultCode, 10),
    cvv_result_code: text(transaction?.cvvResultCode, 10),
    account_number: text(transaction?.accountNumber, 30),
    account_type: text(transaction?.accountType, 30),
    code: text(message?.code || error?.errorCode || top.code, 40),
    description: text(message?.description || error?.errorText || top.description, 300),
  };
}

async function createCustomerProfileFromTransaction(
  config: Config,
  input: { refId: string; transactionId: string; email: string },
) {
  const payload = await authorizeApiRequest(config, {
    createCustomerProfileFromTransactionRequest: {
      merchantAuthentication: merchantAuthentication(config),
      transId: input.transactionId,
      customer: { merchantCustomerId: input.refId, description: "CfA monthly gift", email: input.email },
    },
  });
  const message = gatewayMessage(payload);
  const customerProfileId = text(payload?.customerProfileId, 40);
  const idList = payload?.customerPaymentProfileIdList;
  const paymentProfileId = Array.isArray(idList) ? text(idList[0], 40) : "";
  return { ok: message.ok && Boolean(customerProfileId && paymentProfileId), customerProfileId, paymentProfileId };
}

async function createMonthlySubscription(
  config: Config,
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
      merchantAuthentication: merchantAuthentication(config),
      refId: input.refId,
      subscription: {
        name: "CfA monthly gift",
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
  return { ok: message.ok && Boolean(subscriptionId), subscriptionId, message };
}

async function verifyTurnstile(token: string, remoteIp: string, expectedHostname: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
  if (!secret || !token) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    return result.success === true && result.hostname === expectedHostname && result.action === "donation";
  } catch {
    return false;
  }
}

function parseFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  return match ? { name: match[1].trim(), email: match[2].trim() } : { email: value.trim() };
}

function staffRecipients(): string[] {
  const raw = Deno.env.get("DONATION_NOTIFY_EMAILS") || OFFICE_EMAIL;
  return raw.split(",").map((item) => item.trim()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

async function sendEmail(to: string[], message: { subject: string; text: string }) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key || !to.length) return false;
  const from = Deno.env.get("DONATION_FROM")
    || Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        personalizations: [{ to: to.map((email) => ({ email })) }],
        from: parseFrom(from),
        reply_to: { email: OFFICE_EMAIL, name: "Center for Anthroposophy" },
        subject: message.subject,
        content: [{ type: "text/plain", value: message.text }],
        tracking_settings: { click_tracking: { enable: false, enable_text: false } },
      }),
    });
    if (!response.ok) console.error("donation_email_failed", response.status);
    return response.ok;
  } catch {
    console.error("donation_email_failed", "network");
    return false;
  }
}

// A stored row back into the shape the email builders take.
function donationFromRow(row: Donation) {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone || "",
    address: row.mailing_address || {},
    fund: row.fund,
    note: row.fund_note || "",
    frequency: row.frequency,
    method: row.method,
    tributeType: row.tribute_type,
    tributeName: row.tribute_name,
    anonymous: row.anonymous,
    newsletter: row.newsletter_opt_in,
    plannedGivingInfo: row.planned_giving_info,
    ledger: {
      giftCents: row.gift_cents,
      feeCents: row.fee_covered_cents,
      chargeCents: row.total_cents,
      payments: row.months,
      giftTotalCents: row.gift_cents * row.months,
      feeTotalCents: row.fee_covered_cents * row.months,
      scheduleTotalCents: row.schedule_total_cents,
    },
  };
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Staff: a check arrived. Called from a terminal or an ops script, not a browser.
async function handleCheckReceived(request: Request, admin: AdminClient) {
  const respond = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const expected = Deno.env.get("DONATION_STAFF_TOKEN") || "";
  const presented = request.headers.get("X-Donation-Staff-Token") || "";
  if (expected.length < 32 || !constantTimeEqual(await sha256(presented), await sha256(expected))) {
    return respond({ error: "staff_token_invalid" }, 403);
  }
  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return respond({ error: "invalid_request" }, 400);
  }
  if (body.action !== "check_received") return respond({ error: "unknown_action" }, 400);

  const donationId = text(body.donation_id, 36);
  const checkNumber = text(body.check_number, 40);
  const receivedOn = text(body.received_on, 10);
  const amountCents = parseAmountToCents(String(body.amount ?? ""));
  if ((donationId && !validUuid(donationId)) || !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) || !Number.isInteger(amountCents) || amountCents <= 0) {
    return respond({ error: "invalid_check_details" }, 400);
  }
  let donor: JsonRecord | null = null;
  if (!donationId) {
    const raw = body.donor && typeof body.donor === "object" ? body.donor as JsonRecord : {};
    const fund = findFund(text(raw.fund, 80) || "general-support");
    if (!fund) return respond({ error: "unknown_fund" }, 400);
    const address = raw.address && typeof raw.address === "object" ? raw.address as JsonRecord : {};
    donor = {
      first_name: text(raw.first_name, 100),
      last_name: text(raw.last_name, 100),
      email: text(raw.email, 254),
      phone: text(raw.phone, 50),
      fund: fund.slug,
      note: text(raw.note, 1000),
      anonymous: raw.anonymous === true,
      address: {
        address: text(address.address, 200),
        city: text(address.city, 100),
        state: text(address.state, 100),
        zip: text(address.zip, 30),
        country: text(address.country || "US", 2).toUpperCase(),
      },
    };
  }

  const { data, error } = await admin.rpc("cfa_mark_donation_check_received", {
    requested_client_id: CFA_CLIENT_ID,
    requested_donation_id: donationId || null,
    requested_check_number: checkNumber,
    requested_received_on: receivedOn,
    requested_amount_cents: amountCents,
    requested_donor: donor,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return respond({ error: "check_not_recorded", detail: text(error?.message, 200) }, 409);

  let receiptSent = Boolean(row.receipt_sent_at);
  if (!receiptSent && body.send_receipt !== false) {
    receiptSent = await sendEmail([row.email], buildCheckReceipt(donationFromRow(row), {
      amountCents: row.check_amount_cents,
      receivedOn: row.check_received_on,
      checkNumber: row.check_number,
    }));
    if (receiptSent) {
      await admin.from("donations").update({ receipt_sent_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
  return respond({ ok: true, donation_id: row.id, status: row.status, receipt_sent: receiptSent }, 200);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (request.method === "POST" && request.headers.has("X-Donation-Staff-Token")) {
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration" }, 500, null);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return handleCheckReceived(request, admin);
  }

  if (!isAllowedOrigin(origin)) return json({ error: "origin_not_allowed" }, 403, origin);
  if (!["GET", "POST"].includes(request.method)) return json({ error: "method_not_allowed" }, 405, origin);

  const config = donationConfig();
  const productionCaller = Boolean(config.origin) && origin === config.origin;

  if (request.method === "GET") {
    const paymentAvailable = config.enabled && productionCaller;
    return json({
      groups: DONATION_FUND_GROUPS,
      funds: activeFunds().map((fund) => ({ slug: fund.slug, name: fund.name, short: fund.short || null, group: fund.group })),
      suggested_amounts: SUGGESTED_AMOUNTS,
      month_options: MONTH_OPTIONS,
      processing_fee_bps: PROCESSING_FEE_BPS,
      min_gift_cents: config.minGiftCents,
      max_card_charge_cents: MAX_CARD_CHARGE_CENTS,
      check: { payable_to: CHECK_PAYABLE_TO, mailing_address: CHECK_MAILING_ADDRESS },
      payment: {
        available: paymentAvailable,
        environment: config.environment,
        api_login_id: paymentAvailable ? config.apiLoginId : null,
        public_client_key: paymentAvailable ? config.publicClientKey : null,
        accept_script: acceptScript(config.environment),
      },
      turnstile_site_key: paymentAvailable ? config.turnstileSiteKey : null,
    }, 200, origin);
  }

  // POST: a gift. Only the production origin, only with the gate fully open.
  if (!productionCaller) return json({ error: "payment_origin_not_allowed" }, 403, origin);
  if (!config.enabled) return json({ error: "donations_not_enabled" }, 503, origin);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration" }, 500, origin);
  const admin: AdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }
  if (text(body.company, 100)) return json({ ok: true }, 200, origin); // honeypot

  const idempotencyKey = text(body.idempotency_key, 36);
  if (!validUuid(idempotencyKey)) return json({ error: "invalid_request" }, 400, origin);
  const validation = validateDonation(body, { minGiftCents: config.minGiftCents });
  if (!validation.ok) return json({ error: "invalid_donation", fields: validation.errors }, 400, origin);
  const gift = validation.value;
  // validateDonation only returns ok with a ledger, fund and schedule set.
  const ledger = gift.ledger!;
  const months: number = gift.months!;

  const remoteIp = text(request.headers.get("CF-Connecting-IP") || "unknown", 100);
  if (!(await verifyTurnstile(text(body.turnstile_token, 2048), remoteIp, new URL(config.origin!).hostname))) {
    return json({ error: "verification_failed" }, 400, origin);
  }

  const ipHash = await sha256(`${config.rateLimitSalt}:${remoteIp}`);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [emailRate, ipRate] = await Promise.all([
    admin.from("donations").select("id", { count: "exact", head: true })
      .eq("client_id", CFA_CLIENT_ID).eq("email", gift.email).gte("created_at", cutoff),
    admin.from("donations").select("id", { count: "exact", head: true })
      .eq("client_id", CFA_CLIENT_ID).eq("ip_hash", ipHash).gte("created_at", cutoff),
  ]);
  if (emailRate.error || ipRate.error) return json({ error: "donation_lookup_failed" }, 500, origin);
  if ((emailRate.count || 0) >= 5 || (ipRate.count || 0) >= 8) {
    return json({ error: "too_many_attempts" }, 429, origin);
  }

  // Idempotency: one key, one gift. A retry of a finished gift replays its
  // result; a retry of a declined one may try again; anything else waits.
  const { data: existing, error: existingError } = await admin
    .from("donations")
    .select("id, status, email, method, fund, frequency, months, total_cents, receipt_sent_at, pledge_email_sent_at")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) return json({ error: "donation_lookup_failed" }, 500, origin);
  if (existing && (
    existing.email !== gift.email || existing.method !== gift.method || existing.fund !== gift.fund
    || existing.frequency !== gift.frequency || existing.months !== gift.months
    || existing.total_cents !== ledger.chargeCents
  )) {
    return json({ error: "idempotency_conflict" }, 409, origin);
  }
  if (existing && ["paid", "pledged", "check_received"].includes(existing.status)) {
    return json({
      ok: true,
      replayed: true,
      donation_id: existing.id,
      method: existing.method,
      frequency: existing.frequency,
      email_sent: Boolean(existing.receipt_sent_at || existing.pledge_email_sent_at),
    }, 200, origin);
  }
  if (existing && existing.status !== "failed") {
    return json({ error: "donation_pending", donation_id: existing.id }, 409, origin);
  }

  const attribution = body.attribution && typeof body.attribution === "object" && !Array.isArray(body.attribution)
    ? Object.fromEntries(Object.entries(body.attribution as JsonRecord).slice(0, 12).map(([k, v]) => [text(k, 40), text(v, 500)]))
    : {};
  const isCheck = gift.method === "check";
  const values = {
    client_id: CFA_CLIENT_ID,
    idempotency_key: idempotencyKey,
    source: "web",
    status: isCheck ? "pledged" : "processing",
    fund: gift.fund,
    fund_note: gift.note || null,
    frequency: gift.frequency,
    months: gift.months,
    method: gift.method,
    gift_cents: ledger.giftCents,
    fee_covered_cents: ledger.feeCents,
    total_cents: ledger.chargeCents,
    schedule_total_cents: ledger.scheduleTotalCents,
    first_name: gift.firstName,
    last_name: gift.lastName,
    email: gift.email,
    phone: gift.phone || null,
    mailing_address: gift.address,
    anonymous: gift.anonymous,
    newsletter_opt_in: gift.newsletter,
    planned_giving_info: gift.plannedGivingInfo,
    tribute_type: gift.tributeType,
    tribute_name: gift.tributeType ? gift.tributeName : null,
    gateway_environment: isCheck ? null : config.environment,
    pledged_at: isCheck ? new Date().toISOString() : null,
    failure_code: null,
    failure_message: null,
    ip_hash: ipHash,
    attribution,
  };
  const saved = existing
    ? await admin.from("donations").update(values).eq("id", existing.id).eq("status", "failed").select("id").single()
    : await admin.from("donations").insert(values).select("id").single();
  if (saved.error || !saved.data) {
    // 23505: a concurrent request with the same key won the insert.
    if (saved.error?.code === "23505") return json({ error: "donation_pending" }, 409, origin);
    return json({ error: "donation_not_recorded" }, 500, origin);
  }
  const donationId: string = saved.data.id;
  const today = new Date();

  if (isCheck) {
    const emailSent = await sendEmail([gift.email], buildCheckPledgeEmail(gift));
    const staffSent = await sendEmail(staffRecipients(), buildStaffNotice(gift, { donationId }));
    await admin.from("donations").update({
      pledge_email_sent_at: emailSent ? new Date().toISOString() : null,
      staff_notified_at: staffSent ? new Date().toISOString() : null,
    }).eq("id", donationId);
    return json({ ok: true, method: "check", donation_id: donationId, email_sent: emailSent }, 200, origin);
  }

  // Card. Payment 1 now through the opaque-data (AcceptUI) nonce; for a monthly
  // gift the rest become an ARB subscription on a profile built from this charge.
  const opaque = body.opaque_data && typeof body.opaque_data === "object" ? body.opaque_data as JsonRecord : {};
  const dataDescriptor = text(opaque.dataDescriptor, 100);
  const dataValue = text(opaque.dataValue, 4096);
  if (!dataDescriptor || !dataValue) {
    await admin.from("donations").update({ status: "failed", failure_code: "card_missing" }).eq("id", donationId);
    return json({ error: "card_missing" }, 400, origin);
  }
  const fund = findFund(gift.fund)!;
  const monthly = gift.frequency === "monthly";
  const refId = donationId.replace(/-/g, "").slice(0, 20);
  const invoiceNumber = `GIFT-${donationId.slice(0, 8).toUpperCase()}`;
  const description = `Gift to the Center for Anthroposophy: ${fund.name}${monthly ? ` · payment 1 of ${months}` : ""}`.slice(0, 255);
  const chargePayload = await authorizeApiRequest(config, {
    createTransactionRequest: {
      merchantAuthentication: merchantAuthentication(config),
      refId,
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: (ledger.chargeCents / 100).toFixed(2),
        payment: { opaqueData: { dataDescriptor, dataValue } },
        order: { invoiceNumber, description },
        customer: { email: gift.email },
        billTo: {
          firstName: gift.firstName,
          lastName: gift.lastName,
          address: gift.address.address,
          city: gift.address.city,
          state: gift.address.state,
          zip: gift.address.zip,
          country: gift.address.country,
        },
        transactionSettings: { setting: [{ settingName: "duplicateWindow", settingValue: "300" }] },
      },
    },
  });
  if (!chargePayload) {
    await admin.from("donations").update({
      status: "needs_review",
      failure_code: "gateway_response_unknown",
      failure_message: "The gateway response could not be confirmed; check Authorize.Net before contacting the donor.",
    }).eq("id", donationId);
    return json({ error: "payment_status_unknown", donation_id: donationId }, 202, origin);
  }
  const transaction = chargePayload.transactionResponse as JsonRecord | undefined;
  const transactionId = text(transaction?.transId, 40);
  const summary = authorizeSummary(chargePayload);
  const approved = gatewayMessage(chargePayload).ok && transaction?.responseCode === "1"
    && Boolean(transactionId) && transactionId !== "0";
  if (!approved) {
    // responseCode 2 is a final decline: the donor may simply try another card
    // (see cfa-register, 2026-09-04). Held (4) or error (3) need a person.
    const declined = transaction?.responseCode === "2";
    await admin.from("donations").update({
      status: declined ? "failed" : "needs_review",
      gateway_transaction_id: transactionId && transactionId !== "0" ? transactionId : null,
      gateway_response: summary,
      failure_code: summary.code || (declined ? "payment_declined" : "payment_review"),
      failure_message: summary.description || null,
    }).eq("id", donationId);
    return declined
      ? json({ error: "payment_declined", message: summary.description || "The card was declined." }, 402, origin)
      : json({ error: "payment_review", donation_id: donationId }, 202, origin);
  }

  const paidUpdate: JsonRecord = {
    status: "paid",
    gateway_transaction_id: transactionId,
    gateway_response: summary,
    paid_at: new Date().toISOString(),
  };
  let subscriptionId = "";
  let scheduleProblem = false;
  const schedule = monthly ? monthlySchedule(today, months) : [];
  if (monthly) {
    const profile = await createCustomerProfileFromTransaction(config, { refId, transactionId, email: gift.email });
    const subscription = profile.ok
      ? await createMonthlySubscription(config, {
        refId,
        customerProfileId: profile.customerProfileId,
        paymentProfileId: profile.paymentProfileId,
        amountCents: ledger.chargeCents,
        occurrences: months - 1,
        startDate: addMonthsClamped(today, 1).toISOString().slice(0, 10),
        invoiceNumber,
        description: `Monthly gift to the Center for Anthroposophy: ${fund.name}`.slice(0, 255),
      })
      : null;
    subscriptionId = subscription?.ok ? subscription.subscriptionId : "";
    scheduleProblem = !subscriptionId;
    Object.assign(paidUpdate, {
      customer_profile_id: profile.ok ? profile.customerProfileId : null,
      payment_profile_id: profile.ok ? profile.paymentProfileId : null,
      subscription_id: subscriptionId || null,
      schedule_status: subscriptionId ? "active" : "needs_attention",
      next_charge_on: schedule[1] || null,
      final_charge_on: schedule[schedule.length - 1] || null,
    });
  }
  const { error: paidError } = await admin.from("donations").update(paidUpdate).eq("id", donationId);
  if (paidError) console.error("donation_paid_record_failed", donationId);

  const cardLast4 = summary.account_number.replace(/\D/g, "").slice(-4);
  const receiptSent = await sendEmail([gift.email], buildCardReceipt({
    ...gift,
    date: today.toISOString().slice(0, 10),
    transactionId,
    cardLast4,
    schedule,
  }));
  const staffSent = await sendEmail(staffRecipients(), buildStaffNotice(gift, {
    donationId,
    transactionId,
    subscriptionId,
    scheduleProblem,
    receiptSent,
  }));
  await admin.from("donations").update({
    receipt_sent_at: receiptSent ? new Date().toISOString() : null,
    staff_notified_at: staffSent ? new Date().toISOString() : null,
  }).eq("id", donationId);

  return json({
    ok: true,
    method: "card",
    frequency: gift.frequency,
    donation_id: donationId,
    amount_cents: ledger.chargeCents,
    email_sent: receiptSent,
    schedule_active: monthly ? !scheduleProblem : null,
  }, 200, origin);
});
