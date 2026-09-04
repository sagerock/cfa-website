import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  asArray,
  batchRecords,
  batchTotals,
  cents,
  detailTransaction,
  isRecord,
  type JsonRecord,
  type LocalMatch,
  lastFour,
  reconcileStatus,
  reconciliationNote,
  safeIso,
  subscriptionId,
  text,
  transactionRecords,
} from "./logic.ts";

// Account-wide Authorize.Net reporting sync for CfA. Every permitted gateway
// request below is a reporting request: this function cannot charge, refund,
// void, alter a subscription, or update a customer profile.
const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const ALLOWED_REQUESTS = new Set([
  "getSettledBatchListRequest",
  "getTransactionListRequest",
  "getUnsettledTransactionListRequest",
  "getTransactionDetailsRequest",
]);

// This project does not check generated database types into the public repo.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function environment() {
  return Deno.env.get("AUTHORIZE_NET_ENVIRONMENT")?.toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function authorizeEndpoint() {
  return environment() === "production"
    ? "https://api.authorize.net/xml/v1/request.api"
    : "https://apitest.authorize.net/xml/v1/request.api";
}

function firstMessage(payload: JsonRecord) {
  const messages = isRecord(payload.messages) ? payload.messages : {};
  return asArray(messages.message)[0] || {};
}

async function reportingRequest(name: string, fields: JsonRecord = {}) {
  if (!ALLOWED_REQUESTS.has(name)) throw new Error("non_reporting_request_blocked");
  const apiLoginId = Deno.env.get("AUTHORIZE_NET_API_LOGIN_ID") || "";
  const transactionKey = Deno.env.get("AUTHORIZE_NET_TRANSACTION_KEY") || "";
  if (!apiLoginId || !transactionKey) throw new Error("gateway_credentials_missing");
  const response = await fetch(authorizeEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      [name]: {
        merchantAuthentication: { name: apiLoginId, transactionKey },
        ...fields,
      },
    }),
  });
  const responseText = (await response.text()).replace(/^\uFEFF/, "");
  let payload: JsonRecord;
  try {
    payload = JSON.parse(responseText) as JsonRecord;
  } catch {
    throw new Error(`gateway_invalid_json_${response.status}`);
  }
  const messages = isRecord(payload.messages) ? payload.messages : {};
  if (!response.ok || messages.resultCode !== "Ok") {
    const message = firstMessage(payload);
    throw new Error(`gateway_${text(message.code, 40) || response.status}_${text(message.text, 180) || "request_failed"}`);
  }
  return payload;
}

function parseInputDate(value: unknown, fallback: Date) {
  const raw = text(value, 40);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid_date");
  return parsed;
}

function rangeChunks(from: Date, to: Date) {
  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const end = new Date(Math.min(to.getTime(), cursor.getTime() + 29 * 24 * 60 * 60 * 1000));
    chunks.push({ from: new Date(cursor), to: end });
    cursor = new Date(end.getTime() + 1);
  }
  return chunks;
}

async function localMatches(admin: AdminClient) {
  const [registrationsResult, plansResult] = await Promise.all([
    admin.from("registrations")
      .select("id,status,gateway_transaction_id,amount_cents")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("gateway_environment", environment())
      .eq("is_test", false)
      .is("voided_at", null),
    admin.from("registration_payment_plans")
      .select("id,registration_id,subscription_id,first_installment_cents")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("gateway_environment", environment()),
  ]);
  if (registrationsResult.error || plansResult.error) {
    throw new Error("local_payment_records_unavailable");
  }

  const realRegistrationIds = new Set(
    (registrationsResult.data || []).map((registration: JsonRecord) => String(registration.id)),
  );
  const realPlans = (plansResult.data || []).filter((plan: JsonRecord) =>
    realRegistrationIds.has(String(plan.registration_id))
  );
  const planIds = realPlans.map((plan: JsonRecord) => String(plan.id));
  const installmentsResult = planIds.length
    ? await admin.from("registration_installments")
      .select("plan_id,gateway_transaction_id,amount_cents")
      .in("plan_id", planIds)
      .not("gateway_transaction_id", "is", null)
    : { data: [], error: null };
  if (installmentsResult.error) throw new Error("local_installments_unavailable");

  const plansById = new Map(realPlans.map((plan: JsonRecord) => [String(plan.id), plan]));
  const plansByRegistration = new Map(
    realPlans.map((plan: JsonRecord) => [String(plan.registration_id), plan]),
  );
  const registrationsById = new Map(
    (registrationsResult.data || []).map((registration: JsonRecord) =>
      [String(registration.id), registration]
    ),
  );
  const byTransaction = new Map<string, LocalMatch>();
  const bySubscription = new Map<string, LocalMatch>();

  for (const registration of registrationsResult.data || []) {
    const transactionId = text(registration.gateway_transaction_id, 80);
    if (!transactionId) continue;
    const plan = plansByRegistration.get(String(registration.id));
    byTransaction.set(transactionId, {
      registrationId: String(registration.id),
      registrationStatus: text(registration.status, 40),
      expectedAmountCents: plan
        ? Number(plan.first_installment_cents)
        : Number(registration.amount_cents),
      source: "registration",
    });
  }
  for (const installment of installmentsResult.data || []) {
    const transactionId = text(installment.gateway_transaction_id, 80);
    const plan = plansById.get(String(installment.plan_id));
    if (!transactionId || !plan) continue;
    byTransaction.set(transactionId, {
      registrationId: String(plan.registration_id),
      registrationStatus: text(registrationsById.get(String(plan.registration_id))?.status, 40),
      expectedAmountCents: Number(installment.amount_cents),
      source: "installment",
    });
  }
  for (const plan of realPlans) {
    const id = text(plan.subscription_id, 80);
    if (!id) continue;
    bySubscription.set(id, {
      registrationId: String(plan.registration_id),
      registrationStatus: text(registrationsById.get(String(plan.registration_id))?.status, 40),
      expectedAmountCents: null,
      source: "subscription",
    });
  }
  return { byTransaction, bySubscription };
}

async function saveBatch(admin: AdminClient, batch: JsonRecord) {
  const batchId = text(batch.batchId, 80);
  if (!batchId) return;
  const totals = batchTotals(batch);
  const { error } = await admin.from("authorize_net_settlement_batches").upsert({
    client_id: CFA_CLIENT_ID,
    gateway_environment: environment(),
    batch_id: batchId,
    settlement_time_utc: safeIso(batch.settlementTimeUTC),
    settlement_state: text(batch.settlementState, 80) || null,
    payment_method: text(batch.paymentMethod, 80) || null,
    market_type: text(batch.marketType, 80) || null,
    product: text(batch.product, 80) || null,
    ...totals,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: "client_id,gateway_environment,batch_id" });
  if (error) throw new Error(`batch_upsert_failed_${error.code || "unknown"}`);
}

async function detailFor(transactionId: string) {
  const payload = await reportingRequest("getTransactionDetailsRequest", { transId: transactionId });
  return detailTransaction(payload);
}

async function saveTransaction(
  admin: AdminClient,
  summary: JsonRecord,
  batch: JsonRecord | null,
  matches: Awaited<ReturnType<typeof localMatches>>,
) {
  const transactionId = text(summary.transId, 80);
  if (!transactionId || transactionId === "0") return null;
  const detail = await detailFor(transactionId);
  const order = isRecord(detail.order) ? detail.order : {};
  const customer = isRecord(detail.customer) ? detail.customer : {};
  const billTo = isRecord(detail.billTo) ? detail.billTo : {};
  const payment = isRecord(detail.payment) ? detail.payment : {};
  const creditCard = isRecord(payment.creditCard) ? payment.creditCard : {};
  const bankAccount = isRecord(payment.bankAccount) ? payment.bankAccount : {};
  const refTransactionId = text(detail.refTransId, 80);
  const gatewaySubscriptionId = subscriptionId(detail);
  let match = matches.byTransaction.get(transactionId) || null;
  if (!match && gatewaySubscriptionId) match = matches.bySubscription.get(gatewaySubscriptionId) || null;
  if (!match && refTransactionId) {
    const original = matches.byTransaction.get(refTransactionId);
    if (original) match = { ...original, expectedAmountCents: null, source: "refund" };
  }
  const transactionType = text(detail.transactionType, 100);
  const transactionStatus = text(detail.transactionStatus || summary.transactionStatus, 100) || "unknown";
  const settleAmount = cents(detail.settleAmount ?? summary.settleAmount);
  const authAmount = cents(detail.authAmount);
  // Pending transactions can report a zero settlement amount before the batch
  // closes. In that case the authorized amount is the meaningful comparison.
  const comparedAmount = settleAmount === 0 && (authAmount || 0) > 0
    ? authAmount
    : settleAmount ?? authAmount;
  const status = reconcileStatus({
    transactionType,
    transactionStatus,
    matched: Boolean(match),
    amountCents: comparedAmount,
    expectedAmountCents: match?.expectedAmountCents ?? null,
  });
  const batchDetails = isRecord(detail.batch) ? detail.batch : {};
  const batchId = text(batchDetails.batchId || batch?.batchId, 80);
  const responseReasonDescription = text(detail.responseReasonDescription, 500);
  const { error } = await admin.from("authorize_net_transactions").upsert({
    client_id: CFA_CLIENT_ID,
    gateway_environment: environment(),
    transaction_id: transactionId,
    batch_id: batchId || null,
    registration_id: match?.registrationId || null,
    ref_transaction_id: refTransactionId || null,
    subscription_id: gatewaySubscriptionId || null,
    transaction_type: transactionType || null,
    transaction_status: transactionStatus,
    response_code: text(detail.responseCode, 40) || null,
    response_reason_code: text(detail.responseReasonCode, 40) || null,
    response_reason_description: responseReasonDescription || null,
    submit_time_utc: safeIso(detail.submitTimeUTC || summary.submitTimeUTC),
    settlement_time_utc: safeIso(batchDetails.settlementTimeUTC || batch?.settlementTimeUTC),
    auth_amount_cents: authAmount,
    settle_amount_cents: settleAmount,
    expected_amount_cents: match?.expectedAmountCents ?? null,
    invoice_number: text(order.invoiceNumber || summary.invoiceNumber, 80) || null,
    description: text(order.description, 300) || null,
    customer_email: text(customer.email, 320).toLowerCase() || null,
    customer_first_name: text(billTo.firstName || summary.firstName, 120) || null,
    customer_last_name: text(billTo.lastName || summary.lastName, 120) || null,
    account_type: text(creditCard.cardType || summary.accountType || (Object.keys(bankAccount).length ? "eCheck" : ""), 80) || null,
    account_last_four: lastFour(creditCard.cardNumber || bankAccount.accountNumber || summary.accountNumber) || null,
    reconciliation_status: status,
    reconciliation_note: reconciliationNote({ status, match, amountCents: comparedAmount }),
    last_synced_at: new Date().toISOString(),
  }, { onConflict: "client_id,gateway_environment,transaction_id" });
  if (error) throw new Error(`transaction_upsert_failed_${error.code || "unknown"}`);
  const description = text(order.description, 300).toLowerCase();
  const nativeInvoice = text(order.invoiceNumber || summary.invoiceNumber, 80).startsWith("SR-")
    && !description.includes("production integration test");
  return {
    transactionId,
    status,
    matched: Boolean(match),
    nativeInvoice,
    localStatus: match?.registrationStatus || "",
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const opsToken = Deno.env.get("CFA_LEARN_OPS_TOKEN");
  if (!opsToken || request.headers.get("X-Cfa-Ops-Token") !== opsToken) {
    return json({ error: "unauthorized" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: JsonRecord = {};
  try {
    body = await request.json() as JsonRecord;
  } catch {
    body = {};
  }

  try {
    const now = new Date();
    const requestedDays = Math.min(180, Math.max(1, Number(body.days) || 7));
    const defaultFrom = new Date(now.getTime() - requestedDays * 24 * 60 * 60 * 1000);
    const from = parseInputDate(body.from, defaultFrom);
    const to = parseInputDate(body.to, now);
    if (from >= to || to.getTime() - from.getTime() > 181 * 24 * 60 * 60 * 1000) {
      return json({ error: "invalid_date_range" }, 400);
    }
    const matches = await localMatches(admin);
    const batches = new Map<string, JsonRecord>();
    for (const chunk of rangeChunks(from, to)) {
      const payload = await reportingRequest("getSettledBatchListRequest", {
        includeStatistics: true,
        firstSettlementDate: chunk.from.toISOString(),
        lastSettlementDate: chunk.to.toISOString(),
      });
      for (const batch of batchRecords(payload)) {
        const batchId = text(batch.batchId, 80);
        if (!batchId) continue;
        batches.set(batchId, batch);
        await saveBatch(admin, batch);
      }
    }

    const summaries = new Map<string, { summary: JsonRecord; batch: JsonRecord | null }>();
    for (const batch of batches.values()) {
      const batchId = text(batch.batchId, 80);
      const payload = await reportingRequest("getTransactionListRequest", { batchId });
      for (const summary of transactionRecords(payload)) {
        const transactionId = text(summary.transId, 80);
        if (transactionId && transactionId !== "0") summaries.set(transactionId, { summary, batch });
      }
    }
    const unsettledPayload = await reportingRequest("getUnsettledTransactionListRequest");
    for (const summary of transactionRecords(unsettledPayload)) {
      const transactionId = text(summary.transId, 80);
      if (transactionId && transactionId !== "0") summaries.set(transactionId, { summary, batch: null });
    }

    const results = [];
    for (const { summary, batch } of summaries.values()) {
      const result = await saveTransaction(admin, summary, batch, matches);
      if (result) results.push(result);
    }
    const counts = results.reduce<Record<string, number>>((all, result) => {
      all[result.status] = (all[result.status] || 0) + 1;
      return all;
    }, {});
    const exceptions = results.filter((result) =>
      (["amount_mismatch", "declined", "error"].includes(result.status) && result.matched)
      || (["refunded", "voided"].includes(result.status)
        && result.matched
        && !["refunded", "cancelled"].includes(result.localStatus))
      || (!result.matched && result.nativeInvoice)
    ).length;
    return json({
      ok: true,
      environment: environment(),
      from: from.toISOString(),
      to: to.toISOString(),
      batches: batches.size,
      transactions: results.length,
      matched: results.filter((result) => result.matched).length,
      gateway_only: counts.gateway_only || 0,
      exceptions,
      counts,
    }, 200);
  } catch (error) {
    console.error("cfa_payment_reconcile_failed", error instanceof Error ? error.message : "unknown");
    return json({
      error: "reconciliation_failed",
      detail: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    }, 502);
  }
});
