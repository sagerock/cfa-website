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
    planHeading: (count) => `Payment plan: ${count} monthly payments`,
    planPaidToday: (amount) => `Paid today: ${amount}`,
    planScheduled: (remaining, amount, next, final) => [
      `Remaining: ${remaining} ${remaining === 1 ? 'payment' : 'payments'} of ${amount}, charged automatically to the same card`,
      `on ${next}${final ? ` and monthly through ${final}` : ''}.`,
    ],
    planUnscheduled: (remaining, amount) => [
      `Remaining: ${remaining} monthly ${remaining === 1 ? 'payment' : 'payments'} of ${amount}. The CfA office will confirm`,
      'your payment schedule separately.',
    ],
    dateLocale: 'en-US',
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
    planHeading: (count) => `Plan de pagos: ${count} pagos mensuales`,
    planPaidToday: (amount) => `Pagado hoy: ${amount} USD`,
    planScheduled: (remaining, amount, next, final) => [
      `Pendiente: ${remaining} ${remaining === 1 ? 'pago' : 'pagos'} de ${amount} USD, con cargo automático a la misma tarjeta`,
      `el ${next}${final ? `, y cada mes hasta el ${final}` : ''}.`,
    ],
    planUnscheduled: (remaining, amount) => [
      `Pendiente: ${remaining} ${remaining === 1 ? 'pago mensual' : 'pagos mensuales'} de ${amount} USD. La oficina de CfA`,
      'te confirmará el calendario de cobros por separado.',
    ],
    dateLocale: 'es',
    cancellation: (url) => `Política de cancelación: ${url}`,
    questions: (email) => `Si tienes preguntas, escribe a ${email}.`,
  },
};

function copyFor(locale) {
  return COPY[locale] || COPY.en;
}

// An installment buyer has paid a fraction of the tuition today and owes the
// rest. A receipt that prints only today's charge reads like the whole price,
// which is how someone ends up surprised by the second one.
function planLines(copy, plan) {
  if (!plan) return [];
  const remaining = Math.max(0, Number(plan.installmentCount) - 1);
  const formatDate = (value) => {
    if (!value) return '';
    return new Intl.DateTimeFormat(copy.dateLocale, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`));
  };
  return [
    '',
    copy.planHeading(plan.installmentCount),
    copy.planPaidToday(plan.firstAmount),
    ...(plan.scheduled && plan.nextChargeOn
      ? copy.planScheduled(
        remaining,
        plan.installmentAmount,
        formatDate(plan.nextChargeOn),
        plan.finalChargeOn ? formatDate(plan.finalChargeOn) : '',
      )
      : copy.planUnscheduled(remaining, plan.installmentAmount)),
  ];
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
    ...planLines(copy, input.plan),
    ...participantLines(copy, input.participants),
    ...(detailLines.length ? ['', ...detailLines] : []),
    '',
    copy.cancellation(input.cancellationUrl),
    '',
    copy.questions(input.contactEmail),
  ].join('\n');
}
