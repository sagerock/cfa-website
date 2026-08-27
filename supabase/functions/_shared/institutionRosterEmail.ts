const productionOrigin = "https://learn.centerforanthroposophy.org";

function parseFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  return match
    ? { name: match[1].trim(), email: match[2].trim() }
    : { email: value.trim() };
}

async function sendTextEmail(input: {
  to: string;
  subject: string;
  text: string;
}) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) {
    return {
      ok: false,
      providerMessageId: null,
      error: "email_not_configured",
    };
  }
  const from = Deno.env.get("REGISTRATION_FROM") ||
    "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: parseFrom(from),
        reply_to: {
          email: "office@centerforanthroposophy.org",
          name: "Center for Anthroposophy",
        },
        subject: input.subject,
        content: [{ type: "text/plain", value: input.text }],
        tracking_settings: {
          click_tracking: { enable: false, enable_text: false },
        },
      }),
    });
    return {
      ok: response.ok,
      providerMessageId: response.headers.get("X-Message-Id"),
      error: response.ok ? null : `sendgrid_${response.status}`,
    };
  } catch {
    return {
      ok: false,
      providerMessageId: null,
      error: "email_request_failed",
    };
  }
}

export async function sendInstitutionRosterConfirmation(input: {
  email: string;
  firstName: string;
  organization: string;
  rosterUrl: string;
  seatLimit: number;
}) {
  const text = [
    `Dear ${input.firstName},`,
    "",
    `Thank you for registering ${input.organization} for Starlight Rays 2026–2027.`,
    "",
    "You're almost there!",
    "",
    "To complete your school/team registration, please share your roster below so that each participant can receive individual access.",
    "",
    input.rosterUrl,
    "",
    `You can enter up to ${input.seatLimit} participants directly or import a prepared CSV or Excel (.xlsx) spreadsheet. You'll review the roster before access is created.`,
    "",
    "For each participant, please include:",
    "- First name",
    "- Last name",
    "- Email address",
    "- Title or role",
    "- Whether they completed middle or high school teacher training",
    "",
    "Once you submit the roster, the platform will create each participant's course access and send their personal sign-in email automatically.",
    "",
    "Keep this private roster link. You can return to it if you need to add another participant later.",
    "",
    "If you have questions, contact office@centerforanthroposophy.org.",
    "",
    "With gratitude,",
    "Elsy Ayoub and David Barham",
    "Center for Anthroposophy",
  ].join("\n");
  return sendTextEmail({
    to: input.email,
    subject: "Complete your Starlight Rays institutional registration",
    text,
  });
}

export async function sendInstitutionParticipantWelcome(input: {
  email: string;
  firstName: string;
  organization: string;
  signInLink: string;
}) {
  const text = [
    `Dear ${input.firstName},`,
    "",
    `${input.organization} has included you in Starlight Rays 2026–2027.`,
    "",
    "Your learning portal holds all 12 live-seminar Zoom links, session recordings, and course resources.",
    "",
    "Use this personal secure link to open your learning portal:",
    input.signInLink,
    "",
    "If the link expires, request a fresh one any time at",
    `${productionOrigin}/learn/sign-in`,
    "",
    "If you have questions, contact office@centerforanthroposophy.org.",
    "Trouble signing in? Email sage@centerforanthroposophy.org.",
    "",
    "With gratitude,",
    "Elsy Ayoub and David Barham",
    "Center for Anthroposophy",
  ].join("\n");
  return sendTextEmail({
    to: input.email,
    subject: "Your Starlight Rays learning portal",
    text,
  });
}
