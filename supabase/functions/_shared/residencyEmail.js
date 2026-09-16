// Confirmation email for a program with no portal behind it — a residency
// someone drives to, or a live Zoom course with nothing to log into. No
// sign-in link, because there is nothing to sign into: what the reader needs
// is the dates, the place, and who to ask.
//
// A program declares its own language. CfA's Spanish course is taught,
// advertised and registered in Spanish, so its receipt is too; an English
// receipt for a Spanish course is the same broken promise as an English page.

const COPY = {
  en: {
    salutation: (firstName) => `Dear ${firstName},`,
    thanks: (programTitle) => `Thank you for registering for ${programTitle}.`,
    registration: (offerName) => `Registration: ${offerName}`,
    amount: (amount) => `Amount: ${amount}`,
    amountForSeats: (amount, seats) => `Amount: ${amount} for ${seats} people`,
    transaction: (transactionId) => `Transaction: ${transactionId}`,
    registered: 'Registered:',
    cancellation: (url) => `Cancellation policy: ${url}`,
    questions: (email) => `If you have questions, contact ${email}.`,
  },
  es: {
    salutation: (firstName) => `Hola ${firstName}:`,
    thanks: (programTitle) => `Gracias por inscribirte en ${programTitle}.`,
    registration: (offerName) => `Inscripción: ${offerName}`,
    amount: (amount) => `Importe: ${amount} USD`,
    amountForSeats: (amount, seats) => `Importe: ${amount} USD por ${seats} personas`,
    transaction: (transactionId) => `Transacción: ${transactionId}`,
    registered: 'Personas inscritas:',
    cancellation: (url) => `Política de cancelación: ${url}`,
    questions: (email) => `Si tienes preguntas, escribe a ${email}.`,
  },
};

function copyFor(locale) {
  return COPY[locale] || COPY.en;
}

function moneyLine(copy, amount, seats) {
  return seats > 1 ? copy.amountForSeats(amount, seats) : copy.amount(amount);
}

function participantLines(copy, participants) {
  const named = (participants || []).filter((person) => person && (person.first_name || person.last_name));
  if (!named.length) return [];
  return [
    '',
    copy.registered,
    ...named.map((person) => {
      const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
      return person.email ? `  ${name} — ${person.email}` : `  ${name}`;
    }),
  ];
}

export function buildResidencyEmailText(input) {
  const copy = copyFor(input.locale);
  const seats = Math.max(1, Number(input.seats) || 1);
  const detailLines = (input.details || []).flatMap((line) => [line]);
  return [
    copy.salutation(input.firstName),
    '',
    copy.thanks(input.programTitle),
    '',
    copy.registration(input.offerName),
    moneyLine(copy, input.amount, seats),
    copy.transaction(input.transactionId),
    ...participantLines(copy, input.participants),
    ...(detailLines.length ? ['', ...detailLines] : []),
    '',
    copy.cancellation(input.cancellationUrl),
    '',
    copy.questions(input.contactEmail),
  ].join('\n');
}
