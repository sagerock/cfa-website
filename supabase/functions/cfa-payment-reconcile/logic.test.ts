import assert from "node:assert/strict";
import test from "node:test";
import {
  batchRecords,
  batchTotals,
  cents,
  isException,
  lastFour,
  reconcileStatus,
  reconciliationNote,
  transactionRecords,
} from "./logic.ts";

test("money and masked account values are normalized", () => {
  assert.equal(cents("84.10"), 8410);
  assert.equal(cents(0), 0);
  assert.equal(cents(""), null);
  assert.equal(lastFour("XXXX1111"), "1111");
});

test("batch totals combine statistics across card types", () => {
  assert.deepEqual(batchTotals({
    statistics: [
      { chargeCount: 2, chargeAmount: 100.25, refundCount: 1, refundAmount: 10 },
      { chargeCount: 1, chargeAmount: 44, voidCount: 1, chargebackAmount: 5.5, chargebackCount: 1 },
    ],
  }), {
    charge_count: 3,
    charge_amount_cents: 14425,
    refund_count: 1,
    refund_amount_cents: 1000,
    void_count: 1,
    decline_count: 0,
    error_count: 0,
    returned_item_count: 0,
    returned_item_amount_cents: 0,
    chargeback_count: 1,
    chargeback_amount_cents: 550,
  });
});

test("live JSON arrays and SDK-style wrappers are both accepted", () => {
  const transaction = { transId: "1" };
  const batch = { batchId: "2" };
  assert.deepEqual(transactionRecords({ transactions: [transaction] }), [transaction]);
  assert.deepEqual(transactionRecords({ transactions: { transaction: [transaction] } }), [transaction]);
  assert.deepEqual(batchRecords({ batchList: [batch] }), [batch]);
  assert.deepEqual(batchRecords({ batchList: { batch: [batch] } }), [batch]);
});

test("matched settled charges and amount mismatches are distinguished", () => {
  assert.equal(reconcileStatus({
    transactionType: "authCaptureTransaction",
    transactionStatus: "settledSuccessfully",
    matched: true,
    amountCents: 8400,
    expectedAmountCents: 8400,
  }), "settled");
  assert.equal(reconcileStatus({
    transactionType: "authCaptureTransaction",
    transactionStatus: "settledSuccessfully",
    matched: true,
    amountCents: 42000,
    expectedAmountCents: 8400,
  }), "amount_mismatch");
});

test("refunds match through the original transaction without amount comparison", () => {
  const match = {
    registrationId: "registration",
    registrationStatus: "paid",
    expectedAmountCents: null,
    source: "refund" as const,
  };
  assert.equal(reconcileStatus({
    transactionType: "refundTransaction",
    transactionStatus: "refundSettledSuccessfully",
    matched: true,
    amountCents: 4400,
    expectedAmountCents: null,
  }), "refunded");
  assert.equal(reconciliationNote({ status: "refunded", match, amountCents: 4400 }),
    "Matched through the original transaction being refunded.");
});

test("a decline the local record already calls failed is not an exception", () => {
  // 2026-09-26: two $378 Starlight attempts from one registrant were declined at
  // 01:14 and 01:15 UTC and captured on the third try at 01:18. Both declines are
  // matched to registrations already marked "failed", so the gateway and the
  // database agree — yet the rolling 7-day window re-flagged them every morning.
  const declined = { status: "declined", matched: true, nativeInvoice: true };
  assert.equal(isException({ ...declined, localStatus: "failed" }), false);
  assert.equal(isException({ ...declined, localStatus: "cancelled" }), false);
  // A decline against a registration we believe is paid is real disagreement.
  assert.equal(isException({ ...declined, localStatus: "paid" }), true);
  assert.equal(isException({ ...declined, localStatus: "" }), true);
  assert.equal(isException({ ...declined, status: "error", localStatus: "failed" }), false);
  assert.equal(isException({ ...declined, status: "error", localStatus: "paid" }), true);
});

test("the other exception rules are unchanged by the decline suppression", () => {
  assert.equal(isException({
    status: "amount_mismatch", matched: true, nativeInvoice: false, localStatus: "failed",
  }), true);
  assert.equal(isException({
    status: "refunded", matched: true, nativeInvoice: false, localStatus: "paid",
  }), true);
  assert.equal(isException({
    status: "refunded", matched: true, nativeInvoice: false, localStatus: "refunded",
  }), false);
  assert.equal(isException({
    status: "voided", matched: true, nativeInvoice: false, localStatus: "cancelled",
  }), false);
  assert.equal(isException({
    status: "gateway_only", matched: false, nativeInvoice: true, localStatus: "",
  }), true);
  assert.equal(isException({
    status: "gateway_only", matched: false, nativeInvoice: false, localStatus: "",
  }), false);
  assert.equal(isException({
    status: "settled", matched: true, nativeInvoice: true, localStatus: "paid",
  }), false);
});

test("unmatched account activity is reviewable but not called an application error", () => {
  assert.equal(reconcileStatus({
    transactionType: "authCaptureTransaction",
    transactionStatus: "settledSuccessfully",
    matched: false,
    amountCents: 10000,
    expectedAmountCents: null,
  }), "gateway_only");
});
