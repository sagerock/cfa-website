// The one list of places a gift to CfA can go. Both the /donate page and the
// cfa-donate edge function read it, so the form can never offer a fund the
// server would refuse, and the server never trusts a fund name from the browser.
//
// It is the union of the four WordPress Gravity Forms the unified form replaces:
//   GF 97  "Please make your donation now"  (the main form)
//   GF 114 "Support Kairos Institute"
//   GF 5   "Donate-Authorize"               (legacy)
//   GF 96  "Donations - Alumni"             (no designation: general support)
//
// `active: false` keeps a fund on record without offering it. Every fund marked
// `confirm: true` is waiting on CfA to say whether it is still taking gifts; see
// docs/donation-preview.md. Do not flip one to active without that answer.
//
// `named: true` marks the five named funds CfA highlights, per Torin Finser
// (2026-09-26, a recent Finance Committee decision): Locher, KMF Renewal,
// Gerwin, Kairos and Research. That is a highlight list, NOT the whole list of
// designations - the Programs and Diversity Scholarships designations are still
// current and are simply not "named funds". Torin's wording for all five is
// articulated in the annual appeal at the end of October, after the board
// ratifies strategic goals on October 17, so nothing here changes the page yet.
//
// `aliases` are extra slugs a deep link may use (?fund=kairos).
// Slugs are stored on every donation row, so never rename one: add an alias.

export const DONATION_FUND_GROUPS = [
  { id: 'general', label: 'Where it is needed most' },
  { id: 'programs', label: 'Programs' },
  { id: 'kairos', label: 'Kairos Institute' },
  { id: 'research', label: 'Research' },
  { id: 'scholarships', label: 'Scholarship funds' },
];

export const DONATION_FUNDS = [
  {
    slug: 'general-support',
    name: 'General Support',
    short: 'Where it is needed most',
    group: 'general',
    active: true,
    confirm: false,
    sources: ['GF 97', 'GF 5 (General Fund)', 'GF 96'],
    aliases: ['general', 'general-fund', 'alumni'],
  },
  {
    slug: 'building-bridges',
    name: 'Building Bridges',
    group: 'programs',
    active: true,
    confirm: false,
    sources: ['GF 97'],
    aliases: [],
  },
  {
    slug: 'explorations',
    name: 'Explorations',
    group: 'programs',
    active: true,
    confirm: false,
    sources: ['GF 97'],
    aliases: [],
  },
  {
    slug: 'mentor-training',
    name: 'Mentor Training',
    group: 'programs',
    active: true,
    confirm: false,
    sources: ['GF 97'],
    aliases: [],
  },
  {
    slug: 'renewal-courses',
    name: 'Renewal Courses',
    group: 'programs',
    active: true,
    confirm: false,
    sources: ['GF 97'],
    aliases: ['renewal'],
  },
  {
    slug: 'waldorf-leadership-development',
    name: 'Waldorf Leadership Development',
    group: 'programs',
    active: true,
    confirm: false,
    sources: ['GF 97'],
    aliases: ['wlcd', 'leadership'],
  },
  {
    slug: 'creative-speech',
    name: 'Creative Speech',
    group: 'programs',
    active: false,
    confirm: true,
    sources: ['GF 5'],
    aliases: [],
  },
  {
    slug: 'kairos-institute',
    name: 'Kairos Institute',
    short: 'All the work we do: art therapy and traumatology training',
    group: 'kairos',
    active: true,
    confirm: false,
    named: true,
    sources: ['GF 97', 'GF 114'],
    aliases: ['kairos'],
  },
  {
    slug: 'kairos-scholarships',
    name: 'Kairos Scholarships',
    group: 'kairos',
    active: true,
    confirm: false,
    sources: ['GF 114'],
    aliases: [],
  },
  {
    // New with the same FC decision (Torin Finser, 2026-09-26), so it exists but
    // has never had a Gravity Form. Held inactive on purpose: we do not yet have
    // CfA's own wording for it, and a donor-facing fund should not carry a name
    // we invented. Torin: the appeal at the end of October articulates all five.
    slug: 'research',
    name: 'Research',
    group: 'research',
    active: false,
    confirm: true,
    named: true,
    sources: [],
    aliases: ['research-fund'],
  },
  {
    // Not one of the five named funds, and not retired either - a current GF 97
    // designation, like the Programs. Torin has not been asked to confirm it.
    slug: 'diversity-scholarships',
    name: 'Diversity Scholarships',
    group: 'scholarships',
    active: true,
    confirm: false,
    sources: ['GF 97'],
    aliases: ['diversity'],
  },
  {
    slug: 'douglas-gerwin-scholarship',
    name: 'Douglas Gerwin High School Teacher Education Scholarship Fund',
    group: 'scholarships',
    active: true,
    confirm: false,
    named: true,
    sources: ['GF 97'],
    aliases: ['gerwin', 'high-school-scholarship'],
  },
  {
    slug: 'georg-locher-scholarship',
    name: 'Georg Locher Elementary Teacher Education Scholarship Fund',
    group: 'scholarships',
    active: true,
    confirm: false,
    named: true,
    sources: ['GF 97'],
    aliases: ['locher', 'elementary-scholarship'],
  },
  {
    // Torin Finser, 2026-09-26: one of CfA's five named funds after a recent FC
    // decision, so the "is it still taking gifts?" question is answered yes.
    slug: 'karine-munk-finser-renewal-scholarship',
    name: 'Karine Munk Finser Renewal Scholarship Fund',
    group: 'scholarships',
    active: true,
    confirm: false,
    named: true,
    sources: ['GF 5'],
    aliases: ['kmf-renewal', 'kmf'],
  },
  {
    slug: 'explorations-pay-forward',
    name: 'Explorations International "Pay Forward" Fund',
    group: 'scholarships',
    active: false,
    confirm: true,
    sources: ['GF 5'],
    aliases: ['pay-forward'],
  },
];

export const DEFAULT_FUND_SLUG = 'general-support';

export function activeFunds() {
  return DONATION_FUNDS.filter((fund) => fund.active);
}

// CfA's five named funds, in Torin's order. Not the same as the offered list:
// Research is on record but not offered yet, and the Programs and Diversity
// Scholarships designations are offered but are not named funds.
export function namedFunds() {
  return DONATION_FUNDS.filter((fund) => fund.named);
}

// Resolves a slug or alias to a fund record, active or not. Case-insensitive.
export function findFund(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return null;
  return DONATION_FUNDS.find((fund) => fund.slug === key || fund.aliases.includes(key)) || null;
}

export function fundLabel(fund) {
  if (!fund) return '';
  return fund.short ? `${fund.name} (${fund.short})` : fund.name;
}
