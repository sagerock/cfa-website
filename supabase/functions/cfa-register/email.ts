export type WelcomeSession = {
  title: string;
  startsAt: string;
  endsAt: string | null;
  zoomUrl: string | null;
};

export type WelcomePlan = {
  installmentCount: number;
  firstAmount: string;
  installmentAmount: string;
  nextChargeOn: string | null;
  finalChargeOn: string | null;
  scheduled: boolean;
};

export type WelcomeEmailInput = {
  firstName: string;
  offerName: string;
  amount: string;
  transactionId: string;
  signInLink: string;
  sessions: WelcomeSession[];
  plan?: WelcomePlan | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
});

const planDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/New_York",
});

function localTime(value: string) {
  const parts = timeFormatter.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return {
    clock: `${part("hour")}:${part("minute")}`,
    period: part("dayPeriod").toLowerCase(),
  };
}

function sessionSchedule(session: WelcomeSession) {
  const starts = new Date(session.startsAt);
  const startTime = localTime(session.startsAt);
  if (!session.endsAt) {
    return `${dateFormatter.format(starts)} · ${startTime.clock} ${startTime.period} ET`;
  }
  const endTime = localTime(session.endsAt);
  const timeRange = startTime.period === endTime.period
    ? `${startTime.clock}–${endTime.clock} ${endTime.period}`
    : `${startTime.clock} ${startTime.period}–${endTime.clock} ${endTime.period}`;
  return `${dateFormatter.format(starts)} · ${timeRange} ET`;
}

function sessionEmailLines(session: WelcomeSession) {
  const lines = [
    session.title,
    "",
    sessionSchedule(session),
  ];
  if (session.zoomUrl) {
    lines.push(
      "",
      "Join the live session here:",
      session.zoomUrl,
    );
  }
  lines.push(
    "",
    "The session recording will be added to your classroom after the seminar, so you can watch",
    "(or rewatch) anytime.",
  );
  return lines;
}

// Plan dates are calendar dates (YYYY-MM-DD) chosen server-side; format them
// as dates, not instants, so the day never shifts with a timezone.
function planDate(value: string | null) {
  return value ? planDateFormatter.format(new Date(`${value}T00:00:00Z`)) : "";
}

export function planEmailLines(plan: WelcomePlan) {
  const remaining = plan.installmentCount - 1;
  const lines = [
    `Payment plan: ${plan.installmentCount} monthly payments`,
    `Paid today: ${plan.firstAmount}`,
  ];
  if (plan.scheduled && plan.nextChargeOn) {
    lines.push(
      `Remaining: ${remaining} payments of ${plan.installmentAmount}, charged automatically to the same card`,
      `on ${planDate(plan.nextChargeOn)}${plan.finalChargeOn ? ` and monthly through ${planDate(plan.finalChargeOn)}` : ""}.`,
    );
  } else {
    lines.push(
      `Remaining: ${remaining} monthly payments of ${plan.installmentAmount}. The CfA office will confirm`,
      "your payment schedule separately.",
    );
  }
  return lines;
}

export function buildWelcomeEmailText(input: WelcomeEmailInput) {
  const sessionLines = input.sessions.length
    ? [
      "",
      input.sessions.length === 1 ? "Your live session:" : "Your included live sessions:",
      "",
      ...input.sessions.flatMap((session, index) => [
        ...(index > 0 ? [""] : []),
        ...sessionEmailLines(session),
      ]),
    ]
    : [];
  const planLines = input.plan ? ["", ...planEmailLines(input.plan)] : [];

  return [
    `Dear ${input.firstName},`,
    "",
    "Thank you for registering for Starlight Rays 2026–2027.",
    "",
    `Registration: ${input.offerName}`,
    `Amount: ${input.amount}`,
    `Transaction: ${input.transactionId}`,
    ...planLines,
    ...sessionLines,
    "",
    "Use this secure link to open your learning portal:",
    input.signInLink,
    "",
    "Cancellation policy: https://learn.centerforanthroposophy.org/policies/cancellation/#starlight-rays",
    "",
    "If you have questions, contact office@centerforanthroposophy.org.",
  ].join("\n");
}
