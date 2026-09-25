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
// `aliases` are extra slugs a deep link may use (?fund=kairos).
// Slugs are stored on every donation row, so never rename one: add an alias.

export const DONATION_FUND_GROUPS = [
  { id: 'general', label: 'Where it is needed most' },
  { id: 'programs', label: 'Programs' },
  { id: 'kairos', label: 'Kairos Institute' },
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
    sources: ['GF 97'],
    aliases: ['gerwin', 'high-school-scholarship'],
  },
  {
    slug: 'georg-locher-scholarship',
    name: 'Georg Locher Elementary Teacher Education Scholarship Fund',
    group: 'scholarships',
    active: true,
    confirm: false,
    sources: ['GF 97'],
    aliases: ['locher', 'elementary-scholarship'],
  },
  {
    slug: 'karine-munk-finser-renewal-scholarship',
    name: 'Karine Munk Finser Renewal Scholarship Fund',
    group: 'scholarships',
    active: false,
    confirm: true,
    sources: ['GF 5'],
    aliases: [],
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
