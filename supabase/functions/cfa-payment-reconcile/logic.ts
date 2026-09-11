export type JsonRecord = Record<string, unknown>;

export type LocalMatch = {
  registrationId: string;
  registrationStatus: string;
  expectedAmountCents: number | null;
  source: "registration" | "installment" | "subscription" | "refund";
};

export function text(value: unknown, maxLength = 500) {
  return value == null ? "" : String(value).trim().slice(0, maxLength);
}

export function asArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function safeIso(value: unknown): string | null {
  const raw = text(value, 80);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function lastFour(value: unknown): string {
  const digits = text(value, 40).replace(/\D/g, "");
  return digits.slice(-4);
}

export function transactionRecords(payload: JsonRecord): JsonRecord[] {
  // The JSON endpoint returns a direct array; XML-to-object SDKs commonly
  // expose the same XSD node as { transaction: [...] }. Accept both.
  if (Array.isArray(payload.transactions)) return asArray(payload.transactions);
  const wrapper = isRecord(payload.transactions) ? payload.transactions : {};
  return asArray(wrapper.transaction);
}

export function batchRecords(payload: JsonRecord): JsonRecord[] {
  if (Array.isArray(payload.batchList)) return asArray(payload.batchList);
  const wrapper = isRecord(payload.batchList) ? payload.batchList : {};
  return asArray(wrapper.batch);
}

export function batchTotals(batch: JsonRecord) {
  const statistics = Array.isArray(batch.statistics)
    ? asArray(batch.statistics)
    : asArray(isRecord(batch.statistics) ? batch.statistics.statistic : null);
  const sum = (field: string) => statistics.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  return {
    charge_count: Math.round(sum("chargeCount")),
    charge_amount_cents: Math.round(sum("chargeAmount") * 100),
    refund_count: Math.round(sum("refundCount")),
    refund_amount_cents: Math.round(sum("refundAmount") * 100),
    void_count: Math.round(sum("voidCount")),
    decline_count: Math.round(sum("declineCount")),
    error_count: Math.round(sum("errorCount")),
    returned_item_count: Math.round(sum("returnedItemCount")),
    returned_item_amount_cents: Math.round(sum("returnedItemAmount") * 100),
    chargeback_count: Math.round(sum("chargebackCount")),
    chargeback_amount_cents: Math.round(sum("chargebackAmount") * 100),
  };
}

export function detailTransaction(payload: JsonRecord): JsonRecord {
  return isRecord(payload.transaction) ? payload.transaction : {};
}

export function subscriptionId(transaction: JsonRecord): string {
  const subscription = isRecord(transaction.subscription) ? transaction.subscription : {};
  return text(subscription.id || subscription.subscriptionId, 80);
}

export function transactionTypeIsMoneyOut(transactionType: string) {
  const normalized = transactionType.toLowerCase();
  return normalized.includes("refund") || normalized.includes("credit");
}

export function reconcileStatus(input: {
  transactionType: string;
  transactionStatus: string;
  matched: boolean;
  amountCents: number | null;
  expectedAmountCents: number | null;
}) {
  const type = input.transactionType.toLowerCase();
  const status = input.transactionStatus.toLowerCase();
  const amountComparable = input.matched
    && input.expectedAmountCents != null
    && input.amountCents != null
    && !transactionTypeIsMoneyOut(type)
    && !type.includes("void");
  if (amountComparable && Math.abs(input.amountCents! - input.expectedAmountCents!) > 0) {
    return "amount_mismatch";
  }
  if (type.includes("refund") || type.includes("credit") || status.includes("refund")) return "refunded";
  if (type.includes("void") || status.includes("void")) return "voided";
  if (status.includes("declin")) return "declined";
  if (status.includes("error") || status.includes("fail")) return "error";
  if (status.includes("pending") || status.includes("authorizedpending")) {
    return input.matched ? "pending" : "gateway_only";
  }
  if (status.includes("settledsuccessfully")) return input.matched ? "settled" : "gateway_only";
  return input.matched ? "matched" : "gateway_only";
}

export function reconciliationNote(input: {
  status: string;
  match: LocalMatch | null;
  amountCents: number | null;
}) {
  if (!input.match) return "No native registration or installment matched this gateway transaction.";
  if (input.status === "amount_mismatch") {
    return `Gateway amount ${input.amountCents ?? "unknown"} cents; expected ${input.match.expectedAmountCents ?? "unknown"} cents.`;
  }
  if (input.match.source === "refund") return "Matched through the original transaction being refunded.";
  return `Matched to native ${input.match.source}.`;
}
