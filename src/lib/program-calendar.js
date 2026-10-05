// Public program calendar, fed from Caitlin Rooney's "CfA Programs and Events" Google
// Calendar, which Sage made CfA's master calendar on 2026-10-02.
//
// Caitlin, 2026-10-05: the public page shows program run dates only. Registration
// cut-offs, "registration opens" reminders, TENTATIVE save-the-dates and promotion
// entries are internal and never leave her calendar. isPublic() is that rule; the
// sync script applies it before anything is written into this (public) repository.

const INTERNAL = [
  /\bTENTATIVE\b/i,
  /^\s*Registration\s+(Cut-?off|Opens)\b/i,
  /^\s*Promotion\b/i,
];
export const isPublic = (title) => !!title && !INTERNAL.some((re) => re.test(title));

// Where each program's "program page" link goes: the live page CfA sends people to.
const PROGRAMS = [
  [/^Starlight Rays\b/i, 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/starlight/'],
  [/^WLD\b/i, 'https://centerforanthroposophy.org/programs/waldorf-administration-and-leadership-development-program/'],
  [/^Explorations\b/i, 'https://centerforanthroposophy.org/programs/explorations-online/'],
  [/^Building Bridges\b/i, 'https://centerforanthroposophy.org/programs/building-bridges-to-waldorf-teacher-training-2/'],
  [/^Mentor Training\b/i, 'https://centerforanthroposophy.org/programs/mentor-training/'],
  [/^Renewal\b/i, 'https://centerforanthroposophy.org/programs/renewal-courses/'],
  [/^WHiSTEP\b/i, 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/whistep/'],
  [/^Biograf/i, '/biografia'],
  [/Glöckler/i, 'https://centerforanthroposophy.org/the-bridge-lectures-with-dr-michaela-gloeckler/'],
  [/Dyson/i, 'https://centerforanthroposophy.org/mental-health-from-an-anthroposophic-perspective-with-dr-james-dyson/'],
  [/^Kairos\b/i, 'https://centerforanthroposophy.org/programs/kairos-institute/'],
];
export const programHref = (title) => PROGRAMS.find(([re]) => re.test(title))?.[1] ?? null;

// Event times are stored as Google gives them (RFC 3339 with the calendar owner's
// offset); the page shows them in Eastern time, as every CfA program page does.
const ET = 'America/New_York';
const etParts = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, ampm: p.dayPeriod.toLowerCase() };
};
const prevDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

// One Google event -> { title, date, end (inclusive, multi-day only), time (ET text) }.
export function normalize(ev) {
  if (!ev.start.includes('T')) {
    const last = prevDay(ev.end); // Google all-day ends are exclusive
    return { title: ev.title, date: ev.start, end: last > ev.start ? last : undefined };
  }
  const a = etParts(ev.start), b = etParts(ev.end);
  const time = a.ampm === b.ampm ? `${a.time}–${b.time} ${b.ampm} ET` : `${a.time} ${a.ampm}–${b.time} ${b.ampm} ET`;
  return { title: ev.title, date: a.date, end: b.date > a.date ? b.date : undefined, time };
}

// Month view: each month lists each program (by event title) with its dates that month.
export function months(events, today) {
  const map = new Map();
  for (const e of events.filter((x) => isPublic(x.title)).map(normalize)) {
    if ((e.end ?? e.date) < today) continue;
    const key = e.date.slice(0, 7);
    if (!map.has(key)) map.set(key, new Map());
    const rows = map.get(key);
    if (!rows.has(e.title)) rows.set(e.title, { title: e.title, href: programHref(e.title), sessions: [] });
    rows.get(e.title).sessions.push(e);
  }
  return [...map.keys()].sort().map((key) => ({
    key,
    rows: [...map.get(key).values()].sort((a, b) => a.sessions[0].date.localeCompare(b.sessions[0].date) || a.title.localeCompare(b.title)),
  }));
}
