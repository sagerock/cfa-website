import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const STARLIGHT_PROGRAM_PLATFORM_ID = "3357450";
const PRODUCTION_TEST_AMOUNT_CENTS = 100;
const productionOrigin = "https://learn.centerforanthroposophy.org";
const productionHostname = new URL(productionOrigin).hostname;
const allowedOrigins = new Set([
  productionOrigin,
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

type JsonRecord = Record<string, unknown>;

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
    };
    return result.success === true
      && result.hostname === productionHostname
      && result.action === "registration";
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
}) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) return false;
  const from = Deno.env.get("REGISTRATION_FROM")
    || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(input.amountCents / 100);
  const emailText = [
    `Dear ${input.firstName},`,
    "",
    "Thank you for registering for Starlight Rays 2026–2027.",
    "",
    `Registration: ${input.offerName}`,
    `Amount: ${amount}`,
    `Transaction: ${input.transactionId}`,
    "",
    "Use this secure link to open your learning portal:",
    input.signInLink,
    "",
    "If you have questions, contact office@centerforanthroposophy.org.",
  ].join("\n");
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
    .select("id, code, name, description, amount_cents, currency, seat_count")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("program_id", program.id)
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("amount_cents");
  if (offerError) return json({ error: "offers_unavailable" }, 503, origin);

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
      ? (offers || [])
        .filter((offer) => offer.code === "individual")
        .map((offer) => ({
          ...offer,
          name: "Authorized production integration test",
          description: "$1 charge followed by an immediate automatic void.",
          amount_cents: PRODUCTION_TEST_AMOUNT_CENTS,
        }))
      : offers || [];
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
  if (!billingAddress.address || !billingAddress.city || !billingAddress.state || !billingAddress.zip) {
    return json({ error: "invalid_billing_address" }, 400, origin);
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
    ? (offers || [])
      .filter((offer) => offer.code === "individual")
      .map((offer) => ({ ...offer, amount_cents: PRODUCTION_TEST_AMOUNT_CENTS }))
    : offers || [];
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
  if (chargeAmountCents > 0 && (dataDescriptor !== "COMMON.ACCEPT.INAPP.PAYMENT" || !dataValue)) {
    return json({ error: "invalid_payment_token" }, 400, origin);
  }

  const { data: alreadyEnrolled, error: enrollmentAccessError } = await admin.rpc(
    "cfa_registration_has_access",
    {
      requested_client_id: CFA_CLIENT_ID,
      requested_program_id: program.id,
      requested_email: email,
    },
  );
  if (enrollmentAccessError) return json({ error: "enrollment_lookup_failed" }, 500, origin);
  if (alreadyEnrolled === true) {
    return json({ error: "already_enrolled", redirect: "/learn/sign-in?registered=1" }, 409, origin);
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
    || existing.amount_cents !== selectedOffer.amount_cents
  )) {
    return json({ error: "idempotency_conflict" }, 409, origin);
  }
  if (existing?.status === "paid") {
    return json({
      ok: true,
      registration_id: existing.id,
      email_sent: Boolean(existing.welcome_sent_at),
      redirect: "/learn/sign-in?registered=1",
    }, 200, origin);
  }
  if (existing && ["processing", "enrollment_pending"].includes(existing.status)) {
    return json({ error: "registration_pending", registration_id: existing.id }, 409, origin);
  }
  if (existing && existing.status !== "failed") {
    return json({ error: "idempotency_conflict" }, 409, origin);
  }

  const { data: duplicateRegistration, error: duplicateError } = await admin
    .from("registrations")
    .select("id, status")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("program_id", program.id)
    .eq("email", email)
    .in("status", ["paid", "processing", "enrollment_pending"])
    .neq("idempotency_key", idempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (duplicateError) return json({ error: "registration_lookup_failed" }, 500, origin);
  if (duplicateRegistration?.status === "paid") {
    return json({ error: "already_registered", redirect: "/learn/sign-in?registered=1" }, 409, origin);
  }
  if (duplicateRegistration) {
    return json({ error: "registration_pending", registration_id: duplicateRegistration.id }, 409, origin);
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
  if (chargeAmountCents > 0) {
  const chargeRequest = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: config.apiLoginId,
        transactionKey: config.transactionKey,
      },
      refId: registrationId.replaceAll("-", "").slice(0, 20),
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: (chargeAmountCents / 100).toFixed(2),
        payment: { opaqueData: { dataDescriptor, dataValue } },
        order: {
          invoiceNumber: `SR-${registrationId.replaceAll("-", "").slice(0, 15)}`,
          description: testAuthorized ? "Starlight production integration test" : "Starlight Rays 2026-2027",
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
  const approved = messages?.resultCode === "Ok"
    && transaction?.responseCode === "1"
    && Boolean(transactionId)
    && transactionId !== "0";
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
      }, 200, origin);
    }
    return json({ error: "payment_status_unknown", registration_id: registrationId }, 202, origin);
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
    emailSent = await sendWelcomeEmail({
      email,
      firstName,
      offerName: coupon
        ? `${selectedOffer.name} (coupon ${coupon.code}, ${coupon.percent_off}% off)`
        : selectedOffer.name,
      amountCents: chargeAmountCents,
      transactionId,
      signInLink: signInUrl.toString(),
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
    redirect: "/learn/sign-in?registered=1",
  }, 200, origin);
});
