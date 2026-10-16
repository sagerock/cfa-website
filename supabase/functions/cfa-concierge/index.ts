import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import catalog from "../../../src/data/concierge-programs.json" with { type: "json" };

// Site concierge: Jax as a chat assistant on the website (Milan's go 2026-10-10).
//
// A visitor's message comes in; the whole transcript lives server-side in
// cfa_concierge_messages and the browser keeps only the session id. The model gets
// the operating rules (cfa_concierge_config, kept out of this public repo) plus the
// program catalog (src/data/concierge-programs.json) as one cached system block, and
// a small set of tools. Answers stream back as server-sent events.
//
// Hard limits live here, not in the prompt: personal tools refuse without an emailed
// code, Kairos programs are never priced or looked up (a named open course gets its own page link, per the prompt), coupons are only
// checked (never listed), and the only write besides the transcript is a hand-off
// email to the registrar.

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const productionOrigin = "https://learn.centerforanthroposophy.org";
const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 4;
const MESSAGE_MAX_CHARS = 4000;
const SESSION_MAX_MESSAGES = 40;
const IP_MAX_MESSAGES_PER_HOUR = 60;
const VERIFY_SENDS_PER_EMAIL_PER_DAY = 5;
const VERIFY_SENDS_PER_SESSION = 3;
const CODE_ATTEMPTS = 5;
const COUPON_CHECKS_PER_SESSION = 5;
const HANDOFFS_PER_SESSION = 2;
const CONFIG_CACHE_MS = 10 * 60 * 1000;
const HANDOFF_TO = "jax@centerforanthroposophy.org";
const LIMIT_TEXT =
  "I've reached the limit of what I can do in this chat. Please email jax@centerforanthroposophy.org and a person at CfA will help.";
const FAILURE_TEXT =
  "Sorry, I'm having trouble right now. Please email jax@centerforanthroposophy.org and a person at CfA will help.";

// Pinned hostnames, never a wildcard. The WordPress origins join at Phase 1.
const allowedOrigins = new Set([
  productionOrigin,
  "https://cfa-website-bqx.pages.dev",
  "https://concierge.cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);

// deno-lint-ignore no-explicit-any
type AdminClient = any;
type JsonRecord = Record<string, unknown>;
type CatalogProgram = (typeof catalog.programs)[number];

const programsByKey = new Map<string, CatalogProgram>(catalog.programs.map((program) => [program.key, program]));
const kairosKeys = new Set(catalog.programs.filter((program) => program.kairos).map((program) => program.key));

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : productionOrigin,
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const turnstileHostnames = new Set([
  "learn.centerforanthroposophy.org",
  "centerforanthroposophy.org",
  "www.centerforanthroposophy.org",
]);

async function verifyTurnstile(token: string, remoteIp: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
  if (!secret || !token) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };
    const ok = result.success === true && turnstileHostnames.has(result.hostname || "") && result.action === "concierge";
    if (!ok) console.error("concierge_turnstile_failed", JSON.stringify({ hostname: result.hostname, action: result.action, error_codes: result["error-codes"] }));
    return ok;
  } catch {
    return false;
  }
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isEmail(value: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && value.length <= 254;
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isKairosProgram(program: { tag?: string | null; name?: string | null }) {
  return kairosKeys.has(program.tag || "") || /kairos/i.test(program.name || "");
}

function easternDateLine(now: Date) {
  return now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseFrom(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  return match ? { name: match[1].trim(), email: match[2].trim() } : { email: value.trim() };
}

async function sendMail(input: { to: string; subject: string; body: string; replyTo?: string | null }) {
  const key = Deno.env.get("SENDGRID_API_KEY") || "";
  if (!key) return false;
  const from = Deno.env.get("REGISTRATION_FROM") || "Center for Anthroposophy <no-reply@centerforanthroposophy.org>";
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: parseFrom(from),
      reply_to: input.replyTo
        ? { email: input.replyTo }
        : { email: "office@centerforanthroposophy.org", name: "Center for Anthroposophy" },
      subject: input.subject,
      content: [{ type: "text/plain", value: input.body }],
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    }),
  });
  return response.ok;
}

// ---------------------------------------------------------------------------
// System prompt: rules from the database (10-minute cache) + catalog from the repo.

let configCache: { prompt: string; loadedAt: number } | null = null;

async function systemPrompt(admin: AdminClient) {
  if (configCache && Date.now() - configCache.loadedAt < CONFIG_CACHE_MS) return configCache.prompt;
  const { data, error } = await admin.from("cfa_concierge_config").select("system_prompt").eq("id", 1).maybeSingle();
  if (error || !data?.system_prompt) throw new Error("concierge_config_missing");
  const prompt = [
    data.system_prompt.trim(),
    "## Policies",
    JSON.stringify(catalog.policies),
    "## Program catalog",
    "Each entry's register.kind says how people sign up: native (a sign-up page on learn.centerforanthroposophy.org with live prices from get_offers), thinkific or external (another site), inquire (no sign-up; contact the director).",
    JSON.stringify(catalog.programs),
  ].join("\n\n");
  configCache = { prompt, loadedAt: Date.now() };
  return prompt;
}

// ---------------------------------------------------------------------------
// Tools. Every schema is strict; optional inputs are nullable and still required.

const nullableString = { type: ["string", "null"] };

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_offers",
    description:
      "Live registration options and prices for a program whose register.kind is native. Returns each option's code, name, price, payment-plan installments and included sessions, plus automatic discounts. Never use for Kairos programs.",
    input_schema: {
      type: "object",
      properties: { program_key: { type: "string", description: "Catalog key of the program." } },
      required: ["program_key"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "check_coupon",
    description:
      "Check whether a discount code the visitor gave you is valid for a native program. Only for codes the visitor typed; never guess codes.",
    input_schema: {
      type: "object",
      properties: {
        program_key: { type: "string" },
        code: { type: "string", description: "The code exactly as the visitor gave it." },
      },
      required: ["program_key", "code"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "build_signup_link",
    description:
      "Build the sign-up link for a program. The visitor sees it as a button. For native programs you may preselect an option code from get_offers and a coupon that check_coupon confirmed, and prefill name and email if the visitor gave them. Pass null for anything you don't have.",
    input_schema: {
      type: "object",
      properties: {
        program_key: { type: "string" },
        offer_code: nullableString,
        coupon: nullableString,
        email: nullableString,
        first_name: nullableString,
        last_name: nullableString,
      },
      required: ["program_key", "offer_code", "coupon", "email", "first_name", "last_name"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "send_verification_code",
    description:
      "Email a six-digit code to the address the visitor gave, so they can prove it is theirs. Always returns ok, whether or not the address is on file.",
    input_schema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "verify_code",
    description: "Check the six-digit code the visitor typed. On success the visitor is verified for this chat.",
    input_schema: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "my_registrations",
    description:
      "Verified visitors only. Their own registrations on the learn.centerforanthroposophy.org platform: program, option, access dates, and the next session with its Zoom link when they are entitled to it.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "my_payment_plan",
    description:
      "Verified visitors only. Their own payment plans: installments paid and remaining, next charge date and amount, and whether a payment is past due.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "resend_sign_in_link",
    description:
      "Verified visitors only. Email them a fresh sign-in link for the learning portal (only sent if they have current portal access).",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "hand_off",
    description:
      "Pass the conversation to CfA's registration desk by email. Use only after the visitor agreed. reason is a few words; summary is two factual sentences.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        summary: { type: "string" },
        visitor_email: nullableString,
        program_key: nullableString,
      },
      required: ["reason", "summary", "visitor_email", "program_key"],
      additionalProperties: false,
    },
    strict: true,
  },
];

type Session = {
  id: string;
  contact_id: string | null;
  verified_email: string | null;
  message_count: number;
  is_test: boolean;
};

type ToolContext = {
  admin: AdminClient;
  session: Session;
  salt: string;
  emit: (event: string, data: unknown) => void;
};

// `link` is what the visitor saw as a sign-up button; it is stored with the tool result (as
// `_link`, stripped before replay) so a reloaded chat can show the button again.
type ToolOutcome = { result: unknown; isError?: boolean; link?: JsonRecord };

const offersCache = new Map<string, { at: number; value: JsonRecord }>();

async function lookupProgram(admin: AdminClient, programKey: string) {
  const { data } = await admin
    .from("programs")
    .select("id, name, tag")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("tag", programKey)
    .limit(2);
  return data && data.length === 1 ? data[0] : null;
}

function nativeEntry(programKey: string): CatalogProgram | null {
  const entry = programsByKey.get(programKey);
  if (!entry || entry.kairos || entry.register.kind !== "native") return null;
  return entry;
}

async function liveOffers(admin: AdminClient, programKey: string): Promise<JsonRecord | null> {
  const cached = offersCache.get(programKey);
  if (cached && Date.now() - cached.at < CONFIG_CACHE_MS) return cached.value;
  const program = await lookupProgram(admin, programKey);
  if (!program) return null;
  const now = new Date().toISOString();
  const { data: offers, error } = await admin
    .from("program_offers")
    .select("id, code, name, description, amount_cents, seat_count, access_scope, installment_count, per_seat, min_seats, max_seats")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("program_id", program.id)
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("amount_cents");
  if (error) return null;
  const offerIds = (offers || []).map((offer: JsonRecord) => offer.id);
  const { data: offerSessions } = offerIds.length
    ? await admin.from("program_offer_sessions").select("offer_id, session_id").in("offer_id", offerIds)
    : { data: [] };
  const sessionIds = [...new Set((offerSessions || []).map((row: JsonRecord) => row.session_id))];
  const { data: sessions } = sessionIds.length
    ? await admin.from("cfa_learn_sessions").select("id, presenter, title, starts_at").in("id", sessionIds)
    : { data: [] };
  const sessionById = new Map((sessions || []).map((session: JsonRecord) => [session.id, session]));
  const { data: discounts } = await admin
    .from("automatic_discounts")
    .select("label, country_code, percent_off, starts_at, ends_at")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("active", true);
  const nowMs = Date.now();
  const value = {
    program: program.name,
    offers: (offers || []).map((offer: JsonRecord) => {
      const installments = Number(offer.installment_count || 1);
      const amount = Number(offer.amount_cents);
      return {
        code: offer.code,
        name: offer.name,
        description: offer.description || null,
        price: money(amount) + (offer.per_seat ? " per seat" : ""),
        payment_plan: installments > 1
          ? `${installments} payments of about ${money(Math.round(amount / installments))}`
          : null,
        seats: offer.per_seat ? { min: offer.min_seats, max: offer.max_seats } : null,
        sessions_included: (offerSessions || [])
          .filter((row: JsonRecord) => row.offer_id === offer.id)
          .map((row: JsonRecord) => sessionById.get(row.session_id) as JsonRecord | undefined)
          .filter(Boolean)
          .sort((a: JsonRecord, b: JsonRecord) => String(a.starts_at).localeCompare(String(b.starts_at)))
          .map((session: JsonRecord) => ({
            title: session.title,
            presenter: session.presenter,
            starts: session.starts_at ? easternDateLine(new Date(String(session.starts_at))) + " ET" : null,
          })),
      };
    }),
    automatic_discounts: (discounts || [])
      .filter((rule: JsonRecord) =>
        (!rule.starts_at || new Date(String(rule.starts_at)).getTime() <= nowMs)
        && (!rule.ends_at || new Date(String(rule.ends_at)).getTime() > nowMs)
      )
      .map((rule: JsonRecord) => ({ label: rule.label, country: rule.country_code, percent_off: rule.percent_off })),
  };
  offersCache.set(programKey, { at: Date.now(), value });
  return value;
}

async function couponValid(admin: AdminClient, programKey: string, code: string) {
  const program = await lookupProgram(admin, programKey);
  if (!program) return null;
  const { data: row } = await admin
    .from("program_coupons")
    .select("code, percent_off, active, starts_at, ends_at, max_uses, use_count")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("program_id", program.id)
    .eq("code", code)
    .maybeSingle();
  const nowMs = Date.now();
  const usable = row
    && row.active
    && (!row.starts_at || new Date(row.starts_at).getTime() <= nowMs)
    && (!row.ends_at || new Date(row.ends_at).getTime() > nowMs)
    && (row.max_uses === null || row.use_count < row.max_uses);
  return usable ? { code: row.code as string, percent_off: row.percent_off as number } : null;
}

async function runTool(name: string, input: JsonRecord, ctx: ToolContext): Promise<ToolOutcome> {
  const { admin, session } = ctx;
  const programKey = text(input.program_key, 80);

  switch (name) {
    case "get_offers": {
      if (kairosKeys.has(programKey)) return { result: { error: "kairos_program", say: "Point to the Kairos page and Lisl and Karine." }, isError: true };
      if (!nativeEntry(programKey)) return { result: { error: "not_a_native_program" }, isError: true };
      const offers = await liveOffers(admin, programKey);
      if (!offers) return { result: { error: "offers_unavailable" }, isError: true };
      if (!(offers.offers as unknown[]).length) return { result: { ...offers, note: "No registration options are open right now." } };
      return { result: offers };
    }

    case "check_coupon": {
      if (!nativeEntry(programKey)) return { result: { error: "not_a_native_program" }, isError: true };
      // Counted from the stored transcript so the limit holds across messages; the
      // call being handled is already stored, so it counts itself.
      const { count: checks } = await admin
        .from("cfa_concierge_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.id)
        .eq("role", "assistant")
        .contains("content", [{ type: "tool_use", name: "check_coupon" }]);
      if ((checks || 0) > COUPON_CHECKS_PER_SESSION) {
        return { result: { error: "too_many_checks", say: "Ask them to write to jax@centerforanthroposophy.org." }, isError: true };
      }
      const code = text(input.code, 40).toUpperCase();
      if (!code) return { result: { valid: false } };
      const coupon = await couponValid(admin, programKey, code);
      return { result: coupon ? { valid: true, code: coupon.code, percent_off: coupon.percent_off } : { valid: false } };
    }

    case "build_signup_link": {
      const entry = programsByKey.get(programKey);
      if (!entry) return { result: { error: "unknown_program" }, isError: true };
      if (entry.kairos) {
        // Kairos is a pointer, never a sign-up.
        const kairos = programsByKey.get("kairos-institute");
        return {
          result: {
            kind: "kairos_pointer",
            page_url: kairos?.page_url || entry.page_url,
            say: "Kairos questions go to Lisl Hofer and Karine Munk Finser.",
          },
        };
      }
      if (!entry.open) return { result: { error: "registration_closed", page_url: entry.page_url } };
      const register = entry.register as JsonRecord;
      let url = "";
      let priceLine: string | null = null;
      let note: string | null = null;
      if (register.kind === "native") {
        const offers = await liveOffers(admin, programKey);
        const target = new URL(String(register.page));
        const offerCode = text(input.offer_code, 60);
        const offer = offerCode
          ? ((offers?.offers || []) as JsonRecord[]).find((candidate) => candidate.code === offerCode)
          : null;
        if (offer) {
          target.searchParams.set("offer", offerCode);
          priceLine = `${offer.name}: ${offer.price}`;
        } else if (offerCode) {
          note = "That option code is not open; the page will show every open option.";
        }
        const couponCode = text(input.coupon, 40).toUpperCase();
        if (couponCode) {
          const coupon = await couponValid(admin, programKey, couponCode);
          if (coupon) {
            target.searchParams.set("coupon", coupon.code);
            priceLine = `${priceLine ? priceLine + " · " : ""}${coupon.percent_off}% off with ${coupon.code}`;
          } else {
            note = "The coupon is not valid, so it was left off the link.";
          }
        }
        const email = text(input.email, 254).toLowerCase();
        if (email && isEmail(email)) target.searchParams.set("email", email);
        const first = text(input.first_name, 80);
        const last = text(input.last_name, 80);
        if (first) target.searchParams.set("first_name", first);
        if (last) target.searchParams.set("last_name", last);
        url = target.toString();
      } else if (register.kind === "thinkific") {
        url = String(register.checkout_url);
        if (text(input.coupon, 40)) note = "Coupons can't be put in this link; the visitor types the code at checkout.";
      } else if (register.kind === "external") {
        url = String(register.url);
      } else {
        return { result: { kind: "inquire", page_url: entry.page_url, director: entry.director } };
      }
      const link = { name: entry.name, url, price_line: priceLine, kind: register.kind };
      ctx.emit("link", link);
      return { result: { shown_to_visitor: true, kind: register.kind, price_line: priceLine, note }, link };
    }

    case "send_verification_code": {
      const email = text(input.email, 254).toLowerCase();
      if (!isEmail(email)) return { result: { error: "invalid_email" }, isError: true };
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [{ count: emailSends }, { count: sessionSends }] = await Promise.all([
        admin.from("cfa_concierge_verifications").select("id", { count: "exact", head: true })
          .eq("email", email).gte("created_at", dayAgo),
        admin.from("cfa_concierge_verifications").select("id", { count: "exact", head: true })
          .eq("session_id", session.id),
      ]);
      ctx.emit("verify_prompt", {});
      // Same answer whatever happens below, so the chat never reveals who is on file.
      const ok = { result: { ok: true } };
      if ((emailSends || 0) >= VERIFY_SENDS_PER_EMAIL_PER_DAY || (sessionSends || 0) >= VERIFY_SENDS_PER_SESSION) return ok;
      const { data: contact } = await admin
        .from("contacts")
        .select("id, first_name")
        .eq("client_id", CFA_CLIENT_ID)
        .eq("email", email)
        .maybeSingle();
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      await admin.from("cfa_concierge_verifications").insert({
        session_id: session.id,
        email,
        contact_id: contact?.id || null,
        code_hash: contact ? await sha256(`${ctx.salt}:${session.id}:${code}`) : null,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      if (contact) {
        await sendMail({
          to: email,
          subject: `Your Center for Anthroposophy code: ${code}`,
          body: [
            `Dear ${contact.first_name || "friend"},`,
            "",
            `Your code for the chat on the Center for Anthroposophy website is ${code}.`,
            "Type it into the chat. It expires in 10 minutes.",
            "",
            "If you didn't ask for this, you can ignore this email.",
            "",
            "Center for Anthroposophy",
            "office@centerforanthroposophy.org",
          ].join("\n"),
        });
      }
      return ok;
    }

    case "verify_code": {
      if (session.contact_id) return { result: { verified: true, note: "Already verified." } };
      const code = text(input.code, 20).replace(/\D/g, "");
      const { data: pending } = await admin
        .from("cfa_concierge_verifications")
        .select("id, contact_id, email, code_hash, attempts, expires_at")
        .eq("session_id", session.id)
        .is("verified_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) {
        return { result: { verified: false, reason: "no_current_code", say: "Offer to send a new code." } };
      }
      if (pending.attempts >= CODE_ATTEMPTS) {
        return { result: { verified: false, reason: "locked", say: "Too many tries. Offer a hand-off or jax@centerforanthroposophy.org." } };
      }
      await admin.from("cfa_concierge_verifications").update({ attempts: pending.attempts + 1 }).eq("id", pending.id);
      const matches = pending.code_hash && code.length === 6
        && pending.code_hash === await sha256(`${ctx.salt}:${session.id}:${code}`);
      if (!matches) {
        return { result: { verified: false, reason: "wrong_code", attempts_left: Math.max(0, CODE_ATTEMPTS - pending.attempts - 1) } };
      }
      const verifiedAt = new Date().toISOString();
      await Promise.all([
        admin.from("cfa_concierge_verifications").update({ verified_at: verifiedAt }).eq("id", pending.id),
        admin.from("cfa_concierge_sessions").update({
          contact_id: pending.contact_id,
          verified_email: pending.email,
          verified_at: verifiedAt,
        }).eq("id", session.id),
      ]);
      session.contact_id = pending.contact_id;
      session.verified_email = pending.email;
      return { result: { verified: true } };
    }

    case "my_registrations": {
      if (!session.contact_id) return { result: { error: "not_verified" }, isError: true };
      const { data: enrollments } = await admin
        .from("enrollments")
        .select("id, program_id, status, access_starts_at, access_ends_at, revoked_at, access_scope")
        .eq("client_id", CFA_CLIENT_ID)
        .eq("contact_id", session.contact_id);
      const programIds = [...new Set((enrollments || []).map((row: JsonRecord) => row.program_id))];
      const [{ data: programs }, { data: courses }, { data: registrations }] = await Promise.all([
        programIds.length
          ? admin.from("programs").select("id, name, tag, platform").in("id", programIds)
          : Promise.resolve({ data: [] }),
        programIds.length
          ? admin.from("cfa_learn_courses").select("id, program_id, slug").eq("published", true).in("program_id", programIds)
          : Promise.resolve({ data: [] }),
        admin.from("registrations")
          .select("enrollment_id, offer_id, status, paid_at")
          .eq("client_id", CFA_CLIENT_ID)
          .eq("contact_id", session.contact_id)
          .eq("is_test", false),
      ]);
      const programById = new Map((programs || []).map((program: JsonRecord) => [program.id, program]));
      const courseByProgram = new Map((courses || []).map((course: JsonRecord) => [course.program_id, course]));
      const offerIds = [...new Set((registrations || []).map((row: JsonRecord) => row.offer_id).filter(Boolean))];
      const { data: offers } = offerIds.length
        ? await admin.from("program_offers").select("id, name").in("id", offerIds)
        : { data: [] };
      const offerName = new Map((offers || []).map((offer: JsonRecord) => [offer.id, offer.name]));
      const nowMs = Date.now();
      let kairosHidden = false;
      const results = [];
      for (const enrollment of enrollments || []) {
        const program = programById.get(enrollment.program_id) as JsonRecord | undefined;
        if (!program) continue;
        if (isKairosProgram(program as { tag?: string; name?: string })) {
          kairosHidden = true;
          continue;
        }
        const course = courseByProgram.get(enrollment.program_id) as JsonRecord | undefined;
        // The native platform is what we can speak for: our own programs, plus any
        // program whose course lives on learn.* (imported Starlight and Explorations).
        if (program.platform !== "native" && !course) continue;
        const active = enrollment.status === "registered"
          && !enrollment.revoked_at
          && new Date(enrollment.access_starts_at).getTime() <= nowMs
          && (!enrollment.access_ends_at || new Date(enrollment.access_ends_at).getTime() > nowMs);
        const registration = (registrations || []).find((row: JsonRecord) => row.enrollment_id === enrollment.id);
        let nextSession: JsonRecord | null = null;
        if (course) {
          const { data: sessions } = await admin
            .from("cfa_learn_sessions")
            .select("id, title, presenter, starts_at, ends_at, zoom_url")
            .eq("course_id", course.id)
            .eq("published", true)
            .gte("ends_at", new Date(nowMs - 60 * 60 * 1000).toISOString())
            .order("starts_at")
            .limit(12);
          let entitled = new Set<string>();
          if (enrollment.access_scope !== "all") {
            const { data: access } = await admin
              .from("enrollment_session_access")
              .select("session_id")
              .eq("enrollment_id", enrollment.id);
            entitled = new Set((access || []).map((row: JsonRecord) => String(row.session_id)));
          }
          const upcoming = (sessions || []).find((row: JsonRecord) =>
            enrollment.access_scope === "all" || entitled.has(String(row.id))
          );
          if (upcoming) {
            nextSession = {
              title: upcoming.title,
              presenter: upcoming.presenter,
              starts: upcoming.starts_at ? easternDateLine(new Date(upcoming.starts_at)) + " ET" : null,
              zoom_link: active && upcoming.zoom_url ? upcoming.zoom_url : null,
            };
          }
        }
        results.push({
          program: program.name,
          option: registration?.offer_id ? offerName.get(registration.offer_id) || null : null,
          status: active ? "active" : enrollment.revoked_at ? "access paused or ended" : enrollment.status,
          access_until: enrollment.access_ends_at ? String(enrollment.access_ends_at).slice(0, 10) : null,
          access: enrollment.access_scope === "all" ? "full series" : "selected sessions",
          portal: course ? `${productionOrigin}/learn/sign-in` : null,
          next_session: nextSession,
        });
      }
      return {
        result: {
          registrations: results,
          kairos_registrations_hidden: kairosHidden
            ? "There are Kairos registrations; send them to Lisl Hofer and Karine Munk Finser."
            : null,
          note: results.length ? null : "No registrations on the learn.centerforanthroposophy.org platform for this address.",
        },
      };
    }

    case "my_payment_plan": {
      if (!session.contact_id) return { result: { error: "not_verified" }, isError: true };
      const { data: registrations } = await admin
        .from("registrations")
        .select("id, program_id")
        .eq("client_id", CFA_CLIENT_ID)
        .eq("contact_id", session.contact_id)
        .eq("is_test", false);
      const registrationIds = (registrations || []).map((row: JsonRecord) => row.id);
      if (!registrationIds.length) return { result: { plans: [] } };
      const programIds = [...new Set((registrations || []).map((row: JsonRecord) => row.program_id))];
      const [{ data: plans }, { data: programs }] = await Promise.all([
        admin.from("registration_payment_plans")
          .select("id, registration_id, total_cents, installment_count, paid_installments, paid_cents, next_charge_on, final_charge_on, status")
          .in("registration_id", registrationIds),
        admin.from("programs").select("id, name, tag").in("id", programIds),
      ]);
      const programById = new Map((programs || []).map((program: JsonRecord) => [program.id, program]));
      const planIds = (plans || []).map((plan: JsonRecord) => plan.id);
      const { data: installments } = planIds.length
        ? await admin.from("registration_installments")
          .select("plan_id, sequence, amount_cents, due_on, status")
          .in("plan_id", planIds)
          .order("sequence")
        : { data: [] };
      let kairosHidden = false;
      const results = [];
      for (const plan of plans || []) {
        const registration = (registrations || []).find((row: JsonRecord) => row.id === plan.registration_id);
        const program = programById.get(registration?.program_id) as JsonRecord | undefined;
        if (!program) continue;
        if (isKairosProgram(program as { tag?: string; name?: string })) {
          kairosHidden = true;
          continue;
        }
        const next = (installments || []).find((row: JsonRecord) =>
          row.plan_id === plan.id && !["paid", "settled", "void", "voided"].includes(String(row.status))
        );
        results.push({
          program: program.name,
          status: plan.status,
          total: money(plan.total_cents),
          paid: `${plan.paid_installments} of ${plan.installment_count} installments (${money(plan.paid_cents)})`,
          remaining: money(Math.max(0, plan.total_cents - plan.paid_cents)),
          next_charge: plan.status === "active" && next
            ? { date: next.due_on || plan.next_charge_on, amount: money(next.amount_cents) }
            : null,
          past_due: plan.status === "past_due",
          say_if_past_due: plan.status === "past_due"
            ? "Say the office will help update the card, and offer a hand-off."
            : null,
        });
      }
      return {
        result: {
          plans: results,
          kairos_plans_hidden: kairosHidden ? "Kairos payment questions go to jax@centerforanthroposophy.org by email." : null,
          note: "This covers payment plans made on the learn.centerforanthroposophy.org sign-up pages only, not invoices.",
        },
      };
    }

    case "resend_sign_in_link": {
      if (!session.contact_id || !session.verified_email) return { result: { error: "not_verified" }, isError: true };
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const response = await fetch(`${supabaseUrl}/functions/v1/cfa-learn-signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": productionOrigin },
        body: JSON.stringify({ email: session.verified_email }),
      });
      return {
        result: {
          ok: response.ok,
          say: "If they have current portal access, a sign-in link is on its way to their email; it expires shortly.",
        },
      };
    }

    case "hand_off": {
      const { count } = await admin
        .from("cfa_concierge_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.id)
        .eq("role", "assistant")
        .contains("content", [{ type: "tool_use", name: "hand_off" }]);
      // The call being handled is already stored, so it counts itself.
      if ((count || 0) > HANDOFFS_PER_SESSION) {
        return { result: { filed: false, error: "already_handed_off" }, isError: true };
      }
      const visitorEmail = text(input.visitor_email, 254).toLowerCase() || session.verified_email || "";
      const reason = text(input.reason, 120) || "question";
      const summary = text(input.summary, 1200);
      const { data: rows } = await admin
        .from("cfa_concierge_messages")
        .select("role, visitor_text, content")
        .eq("session_id", session.id)
        .order("id", { ascending: false })
        .limit(40);
      const transcript = (rows || [])
        .reverse()
        .map((row: JsonRecord) => {
          if (row.role === "user") return row.visitor_text ? `Visitor: ${row.visitor_text}` : null;
          const said = ((row.content || []) as JsonRecord[])
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(" ")
            .trim();
          return said ? `Jax: ${said}` : null;
        })
        .filter(Boolean)
        .slice(-20)
        .join("\n\n");
      const filed = await sendMail({
        to: HANDOFF_TO,
        replyTo: isEmail(visitorEmail) ? visitorEmail : null,
        subject: `${session.is_test ? "[Concierge test] " : ""}Site concierge hand-off: ${reason}`,
        body: [
          `Reason: ${reason}`,
          `Visitor email: ${visitorEmail || "not given"}${session.verified_email === visitorEmail && visitorEmail ? " (verified in chat)" : ""}`,
          `Program: ${text(input.program_key, 80) || "not named"}`,
          `Session: ${session.id}${session.is_test ? " (test page)" : ""}`,
          "",
          "Summary:",
          summary,
          "",
          "Last turns:",
          transcript,
        ].join("\n"),
      });
      if (filed) {
        await admin.from("cfa_concierge_sessions").update({ handed_off_at: new Date().toISOString() }).eq("id", session.id);
        if (isEmail(visitorEmail) && !session.is_test) {
          await admin.rpc("cfa_website_lead", {
            p_email: visitorEmail,
            p_first: "",
            p_last: "",
            p_phone: "",
            p_program: text(input.program_key, 80),
            p_message: summary,
            p_source: "concierge",
            p_channel: "concierge",
            p_utm: {},
          });
        }
      }
      ctx.emit("handoff", { filed });
      return { result: { filed } };
    }
  }
  return { result: { error: "unknown_tool" }, isError: true };
}

// ---------------------------------------------------------------------------
// Transcript helpers.

type StoredRow = { role: "user" | "assistant"; content: Anthropic.Beta.BetaContentBlockParam[] };

// After a mid-output fallback, blocks the declined model produced before the last
// fallback marker must not be echoed back (thinking, tool calls).
function sanitizeAssistantContent(content: JsonRecord[]) {
  const lastFallback = content.map((block) => block.type).lastIndexOf("fallback");
  if (lastFallback < 0) return content;
  return content.filter((block, index) =>
    index > lastFallback || !["thinking", "redacted_thinking", "tool_use"].includes(String(block.type))
  );
}

// A crash between a tool call and its result would leave the transcript unreplayable;
// answer any dangling tool_use with an error result before continuing.
function repairTranscript(storedRows: StoredRow[]) {
  // Our own bookkeeping keys (`_link`) never go to the API.
  const rows = storedRows.map((row) => row.role !== "user" ? row : {
    ...row,
    content: (row.content as JsonRecord[]).map((block) => block.type !== "tool_result" ? block
      : Object.fromEntries(Object.entries(block).filter(([key]) => !key.startsWith("_")))),
  } as StoredRow);
  const messages: StoredRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    messages.push(row);
    if (row.role !== "assistant") continue;
    const toolUses = (row.content as JsonRecord[]).filter((block) => block.type === "tool_use");
    if (!toolUses.length) continue;
    const next = rows[index + 1];
    const answered = next?.role === "user"
      && (next.content as JsonRecord[]).some((block) => block.type === "tool_result");
    if (!answered) {
      messages.push({
        role: "user",
        content: toolUses.map((block) => ({
          type: "tool_result",
          tool_use_id: String(block.id),
          content: JSON.stringify({ error: "interrupted" }),
          is_error: true,
        })) as Anthropic.Beta.BetaContentBlockParam[],
      });
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (!origin || !allowedOrigins.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const apiKey = Deno.env.get("CFA_CONCIERGE_ANTHROPIC_API_KEY") || "";
  const salt = Deno.env.get("REGISTRATION_RATE_LIMIT_SALT") || "";
  if (!supabaseUrl || !serviceRoleKey || !apiKey || !salt) return json({ error: "server_configuration" }, 500, origin);

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const remoteIp = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "")
    .split(",")[0].trim();
  const ipHash = await sha256(`${salt}:concierge:${remoteIp}`);
  const turnstileRequired = Deno.env.get("CONCIERGE_REQUIRE_TURNSTILE") === "1";

  // Page load: what the visitor already said in this tab's conversation, and whether a
  // spam check is needed before a new one starts. Same-IP rule as messages.
  if (body.history === true) {
    const turns: JsonRecord[] = [];
    const sessionId = text(body.session_id, 64);
    if (/^[0-9a-f-]{36}$/i.test(sessionId)) {
      const { data: owned } = await admin.from("cfa_concierge_sessions").select("id, ip_hash")
        .eq("id", sessionId).eq("client_id", CFA_CLIENT_ID).maybeSingle();
      if (owned && owned.ip_hash === ipHash) {
        const { data: rows } = await admin.from("cfa_concierge_messages").select("role, content, visitor_text")
          .eq("session_id", sessionId).order("id");
        for (const row of rows || []) {
          if (row.role === "user") {
            if (row.visitor_text) turns.push({ who: "visitor", text: row.visitor_text });
            for (const block of (row.content || []) as JsonRecord[]) {
              if (block.type === "tool_result" && block._link) turns.push({ who: "link", link: block._link });
            }
            continue;
          }
          const said = ((row.content || []) as JsonRecord[])
            .filter((block) => block.type === "text").map((block) => String(block.text || "")).join("").trim();
          if (said) turns.push({ who: "jax", text: said });
        }
      }
    }
    return json({
      turns,
      turnstile_site_key: turnstileRequired ? Deno.env.get("TURNSTILE_SITE_KEY") || null : null,
    }, 200, origin);
  }

  const visitorText = typeof body.message === "string" ? body.message.trim() : "";
  if (!visitorText) return json({ error: "empty_message" }, 400, origin);
  if (visitorText.length > MESSAGE_MAX_CHARS) return json({ error: "message_too_long", limit: MESSAGE_MAX_CHARS }, 400, origin);

  // Per-IP hourly limit across sessions.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentSessions } = await admin
    .from("cfa_concierge_sessions")
    .select("id")
    .eq("ip_hash", ipHash)
    .gte("last_message_at", hourAgo);
  const recentIds = (recentSessions || []).map((row: JsonRecord) => row.id);
  if (recentIds.length) {
    const { count } = await admin
      .from("cfa_concierge_messages")
      .select("id", { count: "exact", head: true })
      .in("session_id", recentIds)
      .not("visitor_text", "is", null)
      .gte("created_at", hourAgo);
    if ((count || 0) >= IP_MAX_MESSAGES_PER_HOUR) return json({ error: "rate_limited", message: LIMIT_TEXT }, 429, origin);
  }

  // Load or start the session. A session id is only honoured from the same IP hash.
  let session: Session | null = null;
  const requestedId = text(body.session_id, 64);
  if (/^[0-9a-f-]{36}$/i.test(requestedId)) {
    const { data } = await admin
      .from("cfa_concierge_sessions")
      .select("id, contact_id, verified_email, message_count, is_test, ip_hash")
      .eq("id", requestedId)
      .eq("client_id", CFA_CLIENT_ID)
      .maybeSingle();
    if (data && data.ip_hash === ipHash) session = data as Session;
  }
  const isFirstTurn = !session;
  if (!session && turnstileRequired) {
    // A new conversation needs a passed Cloudflare Turnstile check, so bots can't spend the
    // budget. Our own eval runner carries a secret header instead.
    const evalToken = Deno.env.get("CONCIERGE_EVAL_TOKEN") || "";
    const isEval = evalToken.length >= 24 && request.headers.get("x-concierge-eval") === evalToken;
    if (!isEval && !(await verifyTurnstile(text(body.turnstile_token, 4096), remoteIp))) {
      return json({ error: "verification_required", message: "Please confirm you're not a robot, then send your message again." }, 403, origin);
    }
  }
  if (!session) {
    const { data, error } = await admin
      .from("cfa_concierge_sessions")
      .insert({
        client_id: CFA_CLIENT_ID,
        ip_hash: ipHash,
        origin,
        page_path: text(body.page_path, 300) || null,
        is_test: body.test === true,
      })
      .select("id, contact_id, verified_email, message_count, is_test")
      .single();
    if (error || !data) return json({ error: "session_failed" }, 500, origin);
    session = data as Session;
  }
  if (session.message_count >= SESSION_MAX_MESSAGES) {
    return json({ error: "session_limit", message: LIMIT_TEXT, session_id: session.id }, 429, origin);
  }

  let system: string;
  try {
    system = await systemPrompt(admin);
  } catch {
    return json({ error: "server_configuration" }, 500, origin);
  }

  const { data: storedRows, error: transcriptError } = await admin
    .from("cfa_concierge_messages")
    .select("role, content")
    .eq("session_id", session.id)
    .order("id");
  if (transcriptError) return json({ error: "transcript_failed" }, 500, origin);
  const messages = repairTranscript((storedRows || []) as StoredRow[]);

  // Date and page go in the visitor's first turn, never in the cached system prompt.
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (isFirstTurn) {
    userContent.push({
      type: "text",
      text: `[Website context, not from the visitor: it is ${easternDateLine(new Date())} Eastern time. The visitor is on ${text(body.page_path, 300) || "the website"}.]`,
    });
  }
  userContent.push({ type: "text", text: visitorText });
  const userRow: StoredRow = { role: "user", content: userContent };
  messages.push(userRow);
  await Promise.all([
    admin.from("cfa_concierge_messages").insert({
      session_id: session.id,
      role: "user",
      content: userContent,
      visitor_text: visitorText,
    }),
    admin.from("cfa_concierge_sessions").update({
      message_count: session.message_count + 1,
      last_message_at: new Date().toISOString(),
    }).eq("id", session.id),
  ]);

  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  const encoder = new TextEncoder();
  const activeSession = session;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      emit("session", { session_id: activeSession.id });
      const ctx: ToolContext = { admin, session: activeSession, salt, emit };
      let spokeText = false;
      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          const lastRound = round === MAX_TOOL_ROUNDS;
          const params = {
            model: MODEL,
            max_tokens: 2000,
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            tools,
            tool_choice: lastRound ? { type: "none" } : { type: "auto" },
            output_config: { effort: "low" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages,
          };
          // deno-lint-ignore no-explicit-any
          const messageStream = client.beta.messages.stream(params as any);
          messageStream.on("text", (delta: string) => {
            spokeText = true;
            emit("token", { text: delta });
          });
          const message = await messageStream.finalMessage();
          const content = sanitizeAssistantContent(message.content as unknown as JsonRecord[]);

          if (message.stop_reason === "refusal") {
            const fallbackText = FAILURE_TEXT;
            const stored = [{ type: "text", text: fallbackText }];
            await admin.from("cfa_concierge_messages").insert({
              session_id: activeSession.id, role: "assistant", content: stored,
              model: message.model, stop_reason: "refusal", usage: message.usage,
            });
            emit("token", { text: (spokeText ? "\n\n" : "") + fallbackText });
            break;
          }

          await admin.from("cfa_concierge_messages").insert({
            session_id: activeSession.id,
            role: "assistant",
            content,
            model: message.model,
            stop_reason: message.stop_reason,
            usage: message.usage,
          });
          messages.push({ role: "assistant", content: content as unknown as Anthropic.Beta.BetaContentBlockParam[] });

          const toolUses = content.filter((block) => block.type === "tool_use");
          if (message.stop_reason !== "tool_use" || !toolUses.length) break;

          const results = await Promise.all(toolUses.map(async (block) => {
            let outcome: ToolOutcome;
            try {
              const input = (typeof block.input === "string" ? JSON.parse(block.input) : block.input) as JsonRecord;
              outcome = await runTool(String(block.name), input || {}, ctx);
            } catch (error) {
              console.error("concierge_tool_failed", String(block.name), String(error));
              outcome = { result: { error: "tool_failed" }, isError: true };
            }
            return {
              type: "tool_result",
              tool_use_id: String(block.id),
              content: JSON.stringify(outcome.result),
              ...(outcome.isError ? { is_error: true } : {}),
              ...(outcome.link ? { _link: outcome.link } : {}),
            };
          }));
          await admin.from("cfa_concierge_messages").insert({
            session_id: activeSession.id,
            role: "user",
            content: results,
          });
          const apiResults = results.map((block) =>
            Object.fromEntries(Object.entries(block).filter(([key]) => !key.startsWith("_")))
          );
          messages.push({ role: "user", content: apiResults as unknown as Anthropic.Beta.BetaContentBlockParam[] });
          if (spokeText) emit("token", { text: "\n\n" });
          spokeText = false;
        }
        emit("done", {});
      } catch (error) {
        console.error("concierge_failed", error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : String(error));
        emit("error", { message: FAILURE_TEXT });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
