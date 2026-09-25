// Plain-text emails for the unified donation form: the donor's acknowledgment
// (card gift, or a check once it arrives), the check pledge confirmation (not a
// receipt), and the staff notice to the office. Pure functions so the tests and
// the /donate preview render exactly what the edge function would send.
//
// Donor mail is signed by the Center for Anthroposophy: it is CfA's receipt,
// not a personal note from anyone.

import { findFund, fundLabel } from './donationFunds.js';
import { CFA_TAX_ID, CHECK_MAILING_ADDRESS, CHECK_PAYABLE_TO, formatUsd } from './donationMath.js';

export const OFFICE_EMAIL = 'office@centerforanthroposophy.org';
export const OFFICE_PHONE = '603-654-2566';

// Open decision (docs/donation-preview.md): when a donor covers the card fee,
// the receipt currently acknowledges the full amount paid as the contribution
// and names the fee portion. Flip this to false to acknowledge the gift alone.
export const RECEIPT_INCLUDES_COVERED_FEE = true;

const longDate = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatReceiptDate(isoDate) {
  const date = typeof isoDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? new Date(`${isoDate}T12:00:00Z`)
    : new Date(isoDate);
  return longDate.format(date);
}

function fundName(slug) {
  return fundLabel(findFund(slug)) || 'General Support';
}

function tributeLine(donation) {
  if (!donation.tributeType || !donation.tributeName) return null;
  return donation.tributeType === 'memory'
    ? `Your gift was made in memory of ${donation.tributeName}.`
    : `Your gift was made in honor of ${donation.tributeName}.`;
}

// null/false lines are omitted; '' is a paragraph break, never doubled.
function compose(lines) {
  return lines
    .filter((line) => line !== null && line !== undefined && line !== false)
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .trim();
}

const SIGNATURE = [
  'With gratitude,',
  'Center for Anthroposophy',
  `${OFFICE_EMAIL} · ${OFFICE_PHONE}`,
];

const TAX_LINES = [
  'No goods or services were provided in exchange for this contribution.',
  `The Center for Anthroposophy is a 501(c)(3) nonprofit organization. Federal tax ID: ${CFA_TAX_ID}.`,
  'Please keep this email for your tax records.',
];

function receiptAmountLines(amountCents, feeCents) {
  if (feeCents > 0 && RECEIPT_INCLUDES_COVERED_FEE) {
    return [
      `Amount: ${formatUsd(amountCents + feeCents)}`,
      `  (a ${formatUsd(amountCents)} gift plus ${formatUsd(feeCents)} you added to cover card processing)`,
    ];
  }
  return [`Amount: ${formatUsd(amountCents)}`];
}

// Card gift, charged today. `donation` is the validated value from
// validateDonation plus { date, transactionId, cardLast4, schedule }.
export function buildCardReceipt(donation) {
  const ledger = donation.ledger;
  const monthly = donation.frequency === 'monthly';
  const lines = [
    `Dear ${donation.firstName},`,
    '',
    monthly
      ? `Thank you for your monthly gift to the Center for Anthroposophy. Your support helps Waldorf educators carry the work forward.`
      : `Thank you for your gift to the Center for Anthroposophy. Your support helps Waldorf educators carry the work forward.`,
    tributeLine(donation),
    '',
    'GIFT RECEIPT',
    `Date: ${formatReceiptDate(donation.date)}`,
    ...receiptAmountLines(ledger.giftCents, ledger.feeCents),
    `Designated to: ${fundName(donation.fund)}`,
    `Paid by: card${donation.cardLast4 ? ` ending in ${donation.cardLast4}` : ''}`,
    donation.transactionId ? `Transaction: ${donation.transactionId}` : null,
    '',
  ];
  if (monthly) {
    const remaining = (donation.schedule || []).slice(1);
    lines.push(
      `This is payment 1 of ${ledger.payments}. Each monthly payment of ${formatUsd(ledger.chargeCents)} is a separate gift to the same fund.`,
      remaining.length
        ? `The remaining ${remaining.length} will be charged on ${formatReceiptDate(remaining[0])} and monthly after that, with the last on ${formatReceiptDate(remaining[remaining.length - 1])}.`
        : null,
      `To change or stop your monthly gift, reply to this email or write to ${OFFICE_EMAIL}.`,
      '',
    );
  }
  lines.push(...TAX_LINES, '', ...SIGNATURE);
  return {
    subject: monthly
      ? 'Your monthly gift to the Center for Anthroposophy'
      : 'Thank you for your gift to the Center for Anthroposophy',
    text: compose(lines),
  };
}

// Check pledge. Deliberately NOT a receipt: nothing has been received yet.
export function buildCheckPledgeEmail(donation) {
  const lines = [
    `Dear ${donation.firstName},`,
    '',
    `Thank you for your pledge of ${formatUsd(donation.ledger.giftCents)} to the Center for Anthroposophy, designated to ${fundName(donation.fund)}.`,
    tributeLine(donation),
    '',
    'TO COMPLETE YOUR GIFT',
    `Please make your check payable to "${CHECK_PAYABLE_TO}" and mail it to:`,
    '',
    CHECK_PAYABLE_TO,
    ...CHECK_MAILING_ADDRESS,
    '',
    `Writing "${findFund(donation.fund)?.name || 'General Support'}" on the memo line helps us direct it correctly.`,
    '',
    'This email is not a tax receipt. We will send your receipt when your check arrives.',
    '',
    ...SIGNATURE,
  ];
  return {
    subject: 'Your pledge to the Center for Anthroposophy',
    text: compose(lines),
  };
}

// Receipt for a check CfA has received, whether pledged online or simply mailed.
// `check` = { amountCents, receivedOn, checkNumber }.
export function buildCheckReceipt(donation, check) {
  const lines = [
    `Dear ${donation.firstName},`,
    '',
    'Your check has arrived. Thank you for your gift to the Center for Anthroposophy.',
    tributeLine(donation),
    '',
    'GIFT RECEIPT',
    `Date received: ${formatReceiptDate(check.receivedOn)}`,
    `Amount: ${formatUsd(check.amountCents)}`,
    `Designated to: ${fundName(donation.fund)}`,
    `Paid by: check${check.checkNumber ? ` #${check.checkNumber}` : ''}`,
    '',
    ...TAX_LINES,
    '',
    ...SIGNATURE,
  ];
  return {
    subject: 'Your gift receipt from the Center for Anthroposophy',
    text: compose(lines),
  };
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

// Notice to the office for every card gift and check pledge.
export function buildStaffNotice(donation, extra = {}) {
  const ledger = donation.ledger;
  const name = `${donation.firstName} ${donation.lastName}`;
  const monthly = donation.frequency === 'monthly';
  const address = donation.address || {};
  const kind = donation.method === 'check'
    ? 'pledged a gift by check'
    : monthly ? 'started a monthly gift' : 'made a gift';
  const lines = [
    `${name} ${kind}.`,
    '',
    `Gift: ${formatUsd(ledger.giftCents)}${monthly ? ` a month for ${ledger.payments} months (${formatUsd(ledger.giftTotalCents)} in all)` : ''}`,
    `Fund: ${fundName(donation.fund)}`,
    donation.method === 'card'
      ? `Card fee covered by donor: ${ledger.feeCents ? formatUsd(ledger.feeCents) + (monthly ? ' a month' : '') : 'no'}`
      : null,
    donation.method === 'card' ? `Charged today: ${formatUsd(ledger.chargeCents)}` : 'Charged today: nothing (check to follow)',
    donation.note ? `Donor's note on the purpose: ${donation.note}` : null,
    donation.tributeType ? `In ${donation.tributeType === 'memory' ? 'memory' : 'honor'} of: ${donation.tributeName}` : null,
    '',
    `Email: ${donation.email}`,
    donation.phone ? `Phone: ${donation.phone}` : null,
    `Address: ${[address.address, address.address2, address.city, address.state, address.zip, address.country].filter(Boolean).join(', ')}`,
    '',
    `Keep anonymous: ${yesNo(donation.anonymous)}`,
    `Newsletter: ${yesNo(donation.newsletter)}`,
    `Wants information on a bequest or planned gift: ${yesNo(donation.plannedGivingInfo)}`,
    '',
    extra.transactionId ? `Transaction: ${extra.transactionId}` : null,
    extra.subscriptionId ? `Monthly subscription: ${extra.subscriptionId}` : null,
    extra.scheduleProblem ? 'The monthly schedule could not be created automatically. The first payment went through; the rest need setting up by hand.' : null,
    extra.receiptSent === false && donation.method === 'card' ? 'The donor receipt email did not send. Please send one by hand.' : null,
    `Donation: ${extra.donationId || ''}`,
    '',
    donation.method === 'check'
      ? 'When the check arrives, mark it received with the check number, and the donor receipt goes out then.'
      : 'The donor has been sent a receipt. Nothing else is needed unless a line above says so.',
    '',
    'Jax, Sage’s assistant',
  ];
  const subject = donation.method === 'check'
    ? `Check pledge: ${formatUsd(ledger.giftCents)} to ${findFund(donation.fund)?.name || 'General Support'} from ${name}`
    : `New ${monthly ? 'monthly ' : ''}gift: ${formatUsd(ledger.giftCents)} to ${findFund(donation.fund)?.name || 'General Support'} from ${name}`;
  return {
    subject,
    text: compose(lines),
  };
}
