// Upcoming programs calendar: the one list the /calendar page and the
// /calendar.ics subscribe feed both read. Directors' corrections land here.
//
// `href` is the page CfA actually sends people to today (live WordPress, the
// HolyOps Explorations funnel, or this site for Biografía), not this site's copy.
//
// Each entry is one program run. `sessions` are the dated meetings; a session
// with `end` is a multi-day block (residency, intensive). Dates are ISO
// YYYY-MM-DD; `time` is display text, written the way the program page says it.
// `tentative: true` marks a date the program page itself calls TBD or "possibly".
//
// status:
//   open    - anyone can register now
//   cohort  - running for an enrolled group; not open to new registrants
//   save    - dates announced, registration not open yet
//
// Only public program dates belong here. No staff meetings, no internal dates.

export const CHECKED = '2026-09-24';

export const CALENDAR = [
  {
    id: 'starlight-2026-27',
    title: 'Starlight Rays: Seminars on Contemporary Topics',
    program: 'starlight-rays',
    status: 'open',
    format: 'Online (Zoom)',
    time: 'Saturdays, 3:00–4:30 pm ET',
    contact: 'David Barham',
    summary: 'Twelve seminars for Waldorf teachers, leaders and parents, each with a guest speaker.',
    href: 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/starlight/',
    register: '/register/starlight-rays-2026-2027',
    sessions: [
      { date: '2026-09-26', note: 'Vicki Larson and Heather Scott: Stepping Into Life' },
      { date: '2026-10-10', note: 'Carol Bärtges: What Have They Been Doing in the Lower School?' },
      { date: '2026-10-31', note: 'Dr. Adam Blanning: A Healthy Sensory Diet for the Modern Adolescent' },
      { date: '2026-11-07', note: "Alison Davis: Let's Get Real About Burnout" },
      { date: '2026-11-21', note: 'Sven Saar: Does Spirit Matter?' },
      { date: '2026-12-12', note: 'Cedar Oliver: “True Equality”' },
      { date: '2026-12-19', note: 'Dr. Constanza Kaliks: Citizenship and the Search for Knowledge' },
      { date: '2027-01-09', note: "Liz Beaven: Talkin' 'bout My Generation" },
      { date: '2027-01-23', note: 'Nathan Wilcox: Solid Foundations' },
      { date: '2027-02-13', note: 'Beverly Amico: Education in a Time of Systemic Change' },
      { date: '2027-02-27', note: 'David Barham: Instilling Social Impulses in an Antisocial Age' },
    ],
  },
  {
    id: 'kairos-dyson-2026',
    title: 'Kairos: Seminars with Dr. James Dyson',
    program: 'kairos-institute',
    status: 'open',
    format: 'Online (Zoom)',
    time: 'Saturdays, 3:00–5:00 pm ET',
    contact: 'Lisl Hofer',
    summary: 'A four-part seminar series open to the general public. $350.',
    href: 'https://centerforanthroposophy.org/mental-health-from-an-anthroposophic-perspective-with-dr-james-dyson/',
    register: 'https://centerforanthroposophy.org/kairos-general-public-oen-course-registration/',
    sessions: [
      { date: '2026-09-26' },
      { date: '2026-10-24' },
      { date: '2026-10-31' },
      { date: '2026-11-07' },
    ],
  },
  {
    id: 'biografia-2026',
    title: 'Biografía y Arte Social (en español)',
    program: 'biografia',
    status: 'open',
    format: 'En línea (Zoom), en español',
    time: 'Miércoles, 7:00–8:30 pm hora del Este',
    contact: 'Magnolia Ríos',
    summary: 'Ocho encuentros sobre biografía y arte social, en español.',
    href: '/biografia',
    register: '/biografia',
    sessions: [
      { date: '2026-10-07' },
      { date: '2026-10-14' },
      { date: '2026-10-21' },
      { date: '2026-10-28' },
      { date: '2026-11-04' },
      { date: '2026-11-11' },
      { date: '2026-11-18' },
      { date: '2026-11-25' },
    ],
  },
  {
    id: 'wlcd-fall-residency-2026',
    title: 'Waldorf Leadership Development: Fall Residency',
    program: 'waldorf-leadership-development',
    status: 'open',
    format: 'In person, Gathering Waters Charter School, Keene, NH',
    time: 'Friday evening to Tuesday noon',
    contact: 'Torin Finser',
    summary: 'The fall residency of the 2026–27 cycle, now also open on its own to people not in the full program. $850.',
    href: 'https://centerforanthroposophy.org/programs/waldorf-administration-and-leadership-development-program/',
    register: '/register/wlcd-october-2026',
    sessions: [{ date: '2026-10-09', end: '2026-10-13' }],
  },
  {
    id: 'wlcd-online-sessions-2026-27',
    title: 'Waldorf Leadership Development: Online Sessions',
    program: 'waldorf-leadership-development',
    status: 'cohort',
    format: 'Online (Zoom)',
    time: 'Saturdays, 3:00–4:15 pm ET',
    contact: 'Karen Atkinson',
    summary:
      'The fall, winter and spring online sessions of the 2026–27 cycle. Part of the full program and of the online-only track.',
    href: 'https://centerforanthroposophy.org/programs/waldorf-administration-and-leadership-development-program/',
    sessions: [
      { date: '2026-10-17', note: 'Mark Finser: Working with Money and Social Finance' },
      { date: '2026-11-14', note: 'Heather Scott: DEI in the Workplace' },
      {
        date: '2026-12-05',
        note: 'Caleb Buckley: Leadership for Independent and Public Waldorf Charter Schools',
      },
      { date: '2026-12-12', note: 'Torin Finser: Karmic Leadership' },
      { date: '2027-01-23', note: 'Jody Spanglet: Financial Management' },
      { date: '2027-02-06', note: 'Kim John Payne: Collegial Relationships and Social Wellbeing' },
      { date: '2027-02-20', note: 'Cathie Foote: The Art of Leading a Difficult Conversation' },
      { date: '2027-03-13', note: 'Valerie Colis: Effective Board Leadership' },
    ],
  },
  {
    id: 'wlcd-spring-residency-2027',
    title: 'Waldorf Leadership Development: Spring Residency',
    program: 'waldorf-leadership-development',
    status: 'save',
    format: 'In person, Gathering Waters Charter School, Keene, NH',
    time: 'Friday evening to Tuesday noon',
    contact: 'Torin Finser',
    summary: 'The spring residency of the 2026–27 cycle, confirmed by the program schedule.',
    href: 'https://centerforanthroposophy.org/programs/waldorf-administration-and-leadership-development-program/',
    sessions: [{ date: '2027-04-23', end: '2027-04-27' }],
  },
  {
    id: 'kairos-ruf-module-7',
    title: 'Kairos: Trauma Pedagogy with Dr. Bernd Ruf, Module 7',
    program: 'kairos-institute',
    status: 'open',
    format: 'Online (Zoom)',
    time: 'Fri 3:00–4:30 pm ET; Sat 9:00 am–4:00 pm ET',
    contact: 'Karine Munk Finser',
    summary: 'Open to the general public. $350, with an optional $45 certificate.',
    href: 'https://centerforanthroposophy.org/programs/kairos-institute/kairos-courses-for-general-public/',
    register: 'https://centerforanthroposophy.org/kairos-general-public-oen-course-registration/',
    sessions: [{ date: '2027-01-15', end: '2027-01-16' }],
  },
  {
    id: 'kairos-glockler-2027',
    title: 'Kairos: Bridge Lectures with Dr. Michaela Glöckler',
    program: 'kairos-institute',
    status: 'open',
    format: 'Online (Zoom)',
    time: 'Sundays, 11:00 am–12:30 pm and 1:30–3:00 pm ET',
    contact: 'Lisl Hofer',
    summary: 'A three-part lecture series open to the general public. $350.',
    href: 'https://centerforanthroposophy.org/the-bridge-lectures-with-dr-michaela-gloeckler/',
    register: 'https://centerforanthroposophy.org/kairos-general-public-oen-course-registration/',
    sessions: [{ date: '2027-01-24' }, { date: '2027-02-14' }, { date: '2027-02-21' }],
  },
  {
    id: 'renewal-2027-in-person',
    title: 'Renewal Courses 2027: In Person',
    program: 'renewal-courses',
    status: 'save',
    format: 'In person, Wilton, NH',
    contact: 'Karen Atkinson',
    summary: 'Summer courses for Waldorf teachers. Courses, tuition and registration will be announced in the new year.',
    href: 'https://centerforanthroposophy.org/programs/renewal-courses/',
    sessions: [{ date: '2027-06-27', end: '2027-07-02' }],
  },
  {
    id: 'renewal-2027-online',
    title: 'Renewal Courses 2027: Online',
    program: 'renewal-courses',
    status: 'save',
    format: 'Online',
    contact: 'Karen Atkinson',
    summary: 'The online week of Renewal. Courses, tuition and registration will be announced in the new year.',
    href: 'https://centerforanthroposophy.org/programs/renewal-courses/',
    sessions: [{ date: '2027-07-05', end: '2027-07-09' }],
  },

  // Programs running for an enrolled group. Listed so the whole year is visible
  // in one place; they are not open to new registrants.
  {
    id: 'explorations-2026-27',
    title: 'Explorations Online: 2026–27 Cycle',
    program: 'explorations-online',
    status: 'cohort',
    format: 'Online (Zoom)',
    time: 'Saturdays and Sundays, 12:00–2:00 pm ET',
    contact: 'Deborah Dornemann',
    summary: 'The foundation course in Waldorf education and anthroposophy. This year’s cycle is under way; free open houses with Deborah are offered on the Explorations page.',
    href: 'https://centerforanthroposophy.org/programs/explorations-online/',
    sessions: [
      '2026-10-03', '2026-10-04', '2026-10-17', '2026-11-07', '2026-11-08', '2026-11-14',
      '2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13', '2027-01-09', '2027-01-10',
      '2027-01-23', '2027-01-24', '2027-02-06', '2027-02-07', '2027-02-20', '2027-03-06',
      '2027-03-13', '2027-03-14', '2027-04-03', '2027-04-04', '2027-04-10', '2027-04-11',
      '2027-05-15', '2027-05-16',
    ].map((date) => ({ date })),
  },
  {
    id: 'building-bridges-2026-27',
    title: 'Building Bridges (Denver area)',
    program: 'building-bridges',
    status: 'cohort',
    format: 'In person, Mountain Phoenix Community School, Wheat Ridge, CO',
    contact: 'Torin Finser',
    summary: 'Weekend intensives for the current Building Bridges group.',
    href: 'https://centerforanthroposophy.org/programs/building-bridges-to-waldorf-teacher-training-2/',
    sessions: [
      { date: '2026-10-08', end: '2026-10-11', note: 'Speech and Storytelling with Debbie Spitulnik' },
      { date: '2027-02-12', end: '2027-02-14' },
      { date: '2027-04-30', end: '2027-05-01', note: 'Make-up session, if needed' },
    ],
  },
  {
    id: 'mentor-training-2026',
    title: 'Mentor Training: 2026 Cohort',
    program: 'mentor-training',
    status: 'cohort',
    format: 'Online (Zoom)',
    time: 'Saturdays, 12:00–2:00 pm ET',
    contact: 'Karen Atkinson',
    summary: 'The 2026 cohort’s closing sessions. Ask the director about future cohorts.',
    href: 'https://centerforanthroposophy.org/programs/mentor-training/',
    sessions: [
      {
        date: '2026-10-17',
        note: 'Carol Bartges: Presentation and Workshop on Producing — Translating Insights into a Professional Development Resource',
      },
      {
        date: '2026-11-14',
        note: 'Lori Kran and Karen Atkinson: Program culmination — Bringing the work into the World',
      },
    ],
  },
  {
    id: 'whistep-2026-cohort',
    title: 'Waldorf High School Teacher Education (WHiSTEP)',
    program: 'waldorf-high-school',
    status: 'cohort',
    format: 'Online seminars, then summer intensives in southern New Hampshire',
    contact: 'David Barham',
    summary: 'The 2026 cohort’s three-summer program. Online subject seminars run in November, January and March between summers.',
    href: 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/whistep/',
    sessions: [
      { date: '2027-07-10', end: '2027-07-25', note: 'Summer II, two weeks in person' },
      { date: '2028-07-15', end: '2028-07-30', note: 'Summer III, three weeks in person' },
    ],
  },
];

export const STATUS_LABEL = {
  open: 'Open for registration',
  cohort: 'Current students only',
  save: 'Save the date',
};

const firstDate = (e) => e.sessions[0].date;
const lastDate = (e) => {
  const s = e.sessions[e.sessions.length - 1];
  return s.end ?? s.date;
};

// Entries with anything left on or after `today`, sessions trimmed to what's ahead.
export function upcoming(today) {
  return CALENDAR.map((e) => ({
    ...e,
    sessions: e.sessions.filter((s) => (s.end ?? s.date) >= today),
  }))
    .filter((e) => e.sessions.length > 0)
    .sort((a, b) => firstDate(a).localeCompare(firstDate(b)) || lastDate(a).localeCompare(lastDate(b)));
}

export { firstDate, lastDate };
