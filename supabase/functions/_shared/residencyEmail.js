// Confirmation email for an in-person program — a residency someone drives to,
// not a course they log into. No sign-in link, because there is nothing to sign
// into: what the reader needs is the dates, the place, and who to ask.

function moneyLine(amount, seats) {
  return seats > 1 ? `Amount: ${amount} for ${seats} people` : `Amount: ${amount}`;
}

function participantLines(participants) {
  const named = (participants || []).filter((person) => person && (person.first_name || person.last_name));
  if (!named.length) return [];
  return [
    '',
    'Registered:',
    ...named.map((person) => {
      const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
      return person.email ? `  ${name} — ${person.email}` : `  ${name}`;
    }),
  ];
}

export function buildResidencyEmailText(input) {
  const seats = Math.max(1, Number(input.seats) || 1);
  const detailLines = (input.details || []).flatMap((line) => [line]);
  return [
    `Dear ${input.firstName},`,
    '',
    `Thank you for registering for ${input.programTitle}.`,
    '',
    `Registration: ${input.offerName}`,
    moneyLine(input.amount, seats),
    `Transaction: ${input.transactionId}`,
    ...participantLines(input.participants),
    ...(detailLines.length ? ['', ...detailLines] : []),
    '',
    `Cancellation policy: ${input.cancellationUrl}`,
    '',
    `If you have questions, contact ${input.contactEmail}.`,
  ].join('\n');
}
