import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// Reconciles Starlight payment plans against Authorize.Net ARB.
//
// Authorize.Net owns the installment schedule; this function pulls each
// subscription's status and transaction list back into
// registration_payment_plans / registration_installments so the office can
// see who is paid up, who is past due, and who is finished — without anyone
// logging into the merchant interface. It never charges, cancels, or changes
// anything at the gateway.
//
// Guarded like cfa-learn-welcome: callers present the dedicated
// CFA_LEARN_OPS_TOKEN header; there is deliberately no CORS and no browser
// path. Run it by hand or from a scheduler:
//
//   curl -X POST https://<project>.supabase.co/functions/v1/cfa-plan-sync \
//     -H "Authorization: Bearer <anon key>" -H "X-Cfa-Ops-Token: $CFA_LEARN_OPS_TOKEN" \
//     -H "Content-Type: application/json" -d '{}'
//
// Body may carry {"registration_id": "<uuid>"} to sync one plan.

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";

type JsonRecord = Record<string, unknown>;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, maxLength: number) {
  return value == null ? "" : String(value).trim().slice(0, maxLength);
}

function authorizeEndpoint() {
  return Deno.env.get("AUTHORIZE_NET_ENVIRONMENT")?.toLowerCase() === "production"
    ? "https://api.authorize.net/xml/v1/request.api"
    : "https://apitest.authorize.net/xml/v1/request.api";
}

function environment() {
  return Deno.env.get("AUTHORIZE_NET_ENVIRONMENT")?.toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

async function getSubscription(subscriptionId: string) {
  try {
    const response = await fetch(authorizeEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ARBGetSubscriptionRequest: {
          merchantAuthentication: {
            name: Deno.env.get("AUTHORIZE_NET_API_LOGIN_ID") || "",
            transactionKey: Deno.env.get("AUTHORIZE_NET_TRANSACTION_KEY") || "",
          },
          subscriptionId,
          includeTransactions: true,
        },
      }),
    });
    const responseText = (await response.text()).replace(/^﻿/, "");
    return JSON.parse(responseText) as JsonRecord;
  } catch {
    return null;
  }
}

// ARB subscription statuses: active, expired (all occurrences billed),
// suspended (a payment failed and Authorize.Net stopped), canceled, terminated.
function planStatusFor(gatewayStatus: string, allPaid: boolean) {
  if (allPaid || gatewayStatus === "expired") return allPaid ? "completed" : "needs_attention";
  if (gatewayStatus === "active") return "active";
  if (gatewayStatus === "suspended") return "past_due";
  if (gatewayStatus === "canceled" || gatewayStatus === "terminated") return "cancelled";
  return "needs_attention";
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
  const registrationId = text(body.registration_id, 36);

  let query = admin
    .from("registration_payment_plans")
    .select("id, registration_id, subscription_id, installment_count, installment_cents, first_installment_cents, status, gateway_environment")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("gateway_environment", environment())
    .not("subscription_id", "is", null)
    .in("status", ["active", "past_due", "needs_attention", "schedule_pending"]);
  if (registrationId) query = query.eq("registration_id", registrationId);
  const { data: plans, error: planError } = await query;
  if (planError) return json({ error: "plans_unavailable" }, 500);

  const results: JsonRecord[] = [];
  for (const plan of plans || []) {
    const payload = await getSubscription(String(plan.subscription_id));
    const messages = payload?.messages as JsonRecord | undefined;
    if (!payload || messages?.resultCode !== "Ok") {
      const first = Array.isArray(messages?.message) ? messages.message[0] as JsonRecord : undefined;
      results.push({
        registration_id: plan.registration_id,
        synced: false,
        error: text(first?.text, 200) || "gateway_unreachable",
      });
      continue;
    }
    const subscription = payload.subscription as JsonRecord;
    const gatewayStatus = text(subscription.status, 40).toLowerCase();
    const transactionsWrapper = subscription.arbTransactions as JsonRecord | undefined;
    const transactions = Array.isArray(transactionsWrapper?.arbTransaction)
      ? transactionsWrapper.arbTransaction as JsonRecord[]
      : [];

    // ARB payNum 1 is the plan's installment 2: installment 1 was charged
    // directly before the subscription existed.
    let paidRemaining = 0;
    let paidRemainingCents = 0;
    for (const transaction of transactions) {
      const payNum = Number(transaction.payNum) || 0;
      if (payNum < 1) continue;
      const sequence = payNum + 1;
      const response = text(transaction.response, 80).toLowerCase();
      const approved = response.startsWith("approv");
      const transId = text(transaction.transId, 40);
      const submitted = text(transaction.submitTimeUTC, 40);
      const attemptedAt = submitted ? new Date(submitted).toISOString() : new Date().toISOString();
      if (approved) {
        paidRemaining += 1;
        paidRemainingCents += Number(plan.installment_cents);
      }
      await admin.from("registration_installments").update({
        status: approved ? "paid" : "failed",
        gateway_transaction_id: transId && transId !== "0" ? transId : null,
        gateway_response: {
          response,
          pay_num: payNum,
          attempt_num: Number(transaction.attemptNum) || null,
        },
        attempted_at: attemptedAt,
        paid_at: approved ? attemptedAt : null,
      }).eq("plan_id", plan.id).eq("sequence", sequence);
    }

    const allPaid = paidRemaining >= Number(plan.installment_count) - 1;
    const status = planStatusFor(gatewayStatus, allPaid);
    const nextScheduled = await admin
      .from("registration_installments")
      .select("due_on")
      .eq("plan_id", plan.id)
      .eq("status", "scheduled")
      .order("sequence")
      .limit(1)
      .maybeSingle();
    await admin.from("registration_payment_plans").update({
      status,
      gateway_status: gatewayStatus,
      paid_installments: 1 + paidRemaining,
      paid_cents: Number(plan.first_installment_cents) + paidRemainingCents,
      next_charge_on: status === "completed" ? null : nextScheduled.data?.due_on ?? null,
      last_synced_at: new Date().toISOString(),
    }).eq("id", plan.id);
    results.push({
      registration_id: plan.registration_id,
      synced: true,
      gateway_status: gatewayStatus,
      status,
      paid_installments: 1 + paidRemaining,
      installment_count: plan.installment_count,
    });
  }

  return json({
    ok: true,
    environment: environment(),
    plans: results.length,
    past_due: results.filter((row) => row.status === "past_due").length,
    needs_attention: results.filter((row) => row.status === "needs_attention" || row.synced === false).length,
    results,
  }, 200);
});
