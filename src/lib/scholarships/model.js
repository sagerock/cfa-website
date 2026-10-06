// Programs are CfA's real scholarship programs (Milan, 2026-09-23). Their dates come
// from the program calendar (src/data/calendar.js), so a director's correction there
// shows up here too. Applicant details in the preview are still fictional.
// Milan, 2026-10-04: the multi-year teacher trainings (Antioch, WHiSTEP) have
// their own, more in-depth application (teacher-training.js) and are not listed here.
import { CALENDAR, STATUS_LABEL } from '../../data/calendar.js';

// Tuition comes from each live program page (checked 2026-10-05) so the applicant
// never types a cost (Milan, 2026-10-05). Renewal 2027 tuition is not announced yet.
export const TUITION_CHECKED = '2026-10-05';
export const programs = [
  { id: 'building-bridges', name: 'Building Bridges', calendar: 'building-bridges', href: 'https://centerforanthroposophy.org/programs/building-bridges-to-waldorf-teacher-training-2/', tuition: [
    { id: 'bb-full', label: 'All 12 months, including Explorations', cost: 4450 },
    { id: 'bb-after-explorations', label: 'Already completed Explorations (foundational studies)', cost: 3600 } ] },
  { id: 'explorations-online', name: 'Explorations Online', calendar: 'explorations-online', href: 'https://centerforanthroposophy.org/programs/explorations-online/', tuition: [
    { id: 'explorations-full', label: 'Full course', cost: 950 } ] },
  { id: 'mentor-training', name: 'Mentor Training', calendar: 'mentor-training', href: 'https://centerforanthroposophy.org/programs/mentor-training/', tuition: [
    { id: 'mentor-full', label: '10-month program', cost: 2600 } ] },
  { id: 'renewal-courses', name: 'Renewal Courses', calendar: 'renewal-courses', href: 'https://centerforanthroposophy.org/programs/renewal-courses/', tuition: [] },
  { id: 'starlight-rays', name: 'Starlight Rays', calendar: 'starlight-rays', href: 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/starlight/', tuition: [
    { id: 'starlight-individual', label: 'Individual, full series', cost: 420 } ] },
  { id: 'waldorf-leadership-development', name: 'Waldorf Leadership Development', calendar: 'waldorf-leadership-development', href: 'https://centerforanthroposophy.org/programs/waldorf-administration-and-leadership-development-program/', tuition: [
    { id: 'wlcd-full', label: 'Full program', cost: 2650 },
    { id: 'wlcd-online', label: 'Online classes only', cost: 1250 },
    { id: 'wlcd-residency', label: 'Residency only', cost: 850 } ] },
];

export const TEACHER_TRAINING_URL = '/scholarships/teacher-training/';

// The teacher-training question follows CfA's existing per-program financial aid
// forms (Gravity Forms 11, 84-87, 125).
export const TEACHER_TRAINING_PLANS = ['Yes', 'No', 'Not sure yet', 'Already teaching or working in a Waldorf school'];
export const NEXT_RUN = 'next';

const fmt = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
function dateRange(run) {
  const first = run.sessions[0].date;
  const last = run.sessions[run.sessions.length - 1];
  const end = last.end ?? last.date;
  if (first === end) return fmt(first, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(first, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// Calendar runs for a program with anything on or after `today`, plus "next cohort".
export function runsFor(programId, today) {
  const program = programs.find(p => p.id === programId);
  const runs = !program?.calendar ? [] : CALENDAR.filter(e => e.program === program.calendar)
    .map(e => ({ ...e, sessions: e.sessions.filter(s => (s.end ?? s.date) >= today) }))
    .filter(e => e.sessions.length)
    .map(e => ({ id: e.id, label: `${e.title} · ${dateRange(e)}`, status: STATUS_LABEL[e.status], dates: dateRange(e), format: e.format, contact: e.contact }));
  return [...runs, { id: NEXT_RUN, label: 'A future session or cohort (dates not yet announced)', status: 'Not yet scheduled' }];
}

// Milan, 2026-10-05: no payment-plan step (people often apply close to the program).
// Cost fills in from the program; the applicant says how much aid they need and gives
// monthly income, expenses, savings and employment. Applicants outside the US get
// their own finance page, in their own currency, because the exchange rate into US
// dollars is often the real barrier.
export const US = 'United States';
export const COUNTRIES = [US, 'Canada', 'Mexico', 'Argentina', 'Brazil', 'Chile', 'Colombia', 'Peru', 'United Kingdom', 'Germany', 'South Africa', 'Kenya', 'India', 'Philippines', 'China', 'Taiwan', 'Japan', 'Australia', 'New Zealand', 'Another country'];
export const EMPLOYMENT = ['Employed full time', 'Employed part time', 'Self-employed', 'Not currently employed', 'Retired', 'Student'];
export const STEPS = ['About you', 'Your request', 'Your finances', 'Review & submit'];
export const isInternational = (a) => !!a.country && a.country !== US;

export const emptyApplication = () => ({ name: '', school: '', country: '', otherCountry: '', program: '', run: '', option: '', aid: '', employment: '', household: '', income: '', expenses: '', assets: '', currency: '', payUsd: '', exchange: '', teacherTraining: '', circumstances: '', confirmed: false });
// David, 2026-10-06: "10,000" was refused. Money fields are plain text boxes now, and
// what the applicant types is stored as a bare number: $, spaces and thousands commas
// go, and so do dots when there are several (1.500.000 written abroad).
export const MONEY_FIELDS = ['aid', 'income', 'expenses', 'assets', 'payUsd'];
export function cleanAmount(value) {
  let s = String(value ?? '').replace(/[\s$,]/g, '');
  if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return s;
}
export function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}
export const amount = (value, currency = '') => {
  const n = Number(value);
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)}${currency ? ` ${currency}` : ''}`;
};
const isAmount = (value) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0;

// The tuition options for a program, and the one the applicant picked.
export const tuitionFor = (programId) => programs.find(p => p.id === programId)?.tuition ?? [];
export function costOf(a) {
  const options = tuitionFor(a.program);
  if (!options.length) return null;
  const chosen = options.length === 1 ? options[0] : options.find(o => o.id === a.option);
  return chosen ? chosen.cost : undefined;
}

// What staff see first: cost, aid asked for, and what that leaves the applicant.
export function request(a) {
  const cost = costOf(a);
  if (!isAmount(a.aid) || cost === undefined) return null;
  const aid = Math.round(Number(a.aid) * 100) / 100;
  if (cost === null) return { cost: null, aid, share: null, percent: null };
  return { cost, aid, share: Math.max(0, Math.round((cost - aid) * 100) / 100), percent: cost ? aid / cost * 100 : 0 };
}

// Kept for the Teacher Training form, which still has the payment-plan step.
export function assessment(application, tuition) {
  if (!isAmount(tuition) || !isAmount(application.monthly) || !isAmount(application.support) || !isAmount(application.months) || !Number.isInteger(Number(application.months)) || Number(application.months) < 1 || Number(application.months) > 24) return null;
  const tuitionCents = Math.round(Number(tuition) * 100);
  const contributionCents = Math.round(Number(application.monthly) * 100) * Number(application.months);
  const supportCents = Math.round(Number(application.support) * 100);
  const gapCents = Math.max(0, tuitionCents - contributionCents - supportCents);
  return { tuition: tuitionCents / 100, contribution: contributionCents / 100, support: supportCents / 100, gap: gapCents / 100, percent: tuitionCents ? gapCents / tuitionCents * 100 : 0 };
}

export function validateStep(a, step, today) {
  if (step === 0) {
    if (!a.name.trim()) return 'Please enter a name for this example.';
    if (!COUNTRIES.includes(a.country)) return 'Please choose the country you live in.';
    if (a.country === 'Another country' && !a.otherCountry.trim()) return 'Please tell us which country you live in.';
    if (!programs.some(p => p.id === a.program)) return 'Please choose a program.';
    if (!runsFor(a.program, today).some(r => r.id === a.run)) return 'Please choose the dates you are applying for.';
    if (costOf(a) === undefined) return 'Please choose which tuition option you are applying for.';
  }
  if (step === 1) {
    const cost = costOf(a);
    if (!(isAmount(a.aid) && Number(a.aid) > 0)) return 'Please enter how much financial aid you are asking for, in US dollars.';
    if (cost && Number(a.aid) > cost) return `The aid you ask for can be at most the program cost, ${money(cost)}.`;
    if (!TEACHER_TRAINING_PLANS.includes(a.teacherTraining)) return 'Please tell us whether you plan to pursue Waldorf teacher training.';
  }
  if (step === 2) {
    if (!EMPLOYMENT.includes(a.employment)) return 'Please tell us whether you are currently employed.';
    if (isInternational(a) && !a.currency.trim()) return 'Please tell us which currency you are paid in.';
    if (!isAmount(a.income)) return 'Please enter your family’s monthly income. Zero is an acceptable answer.';
    if (!isAmount(a.expenses)) return 'Please enter your family’s monthly expenses.';
    if (!isAmount(a.assets)) return 'Please enter your savings, investments and other assets. Zero is an acceptable answer.';
    if (isInternational(a) && !isAmount(a.payUsd)) return 'Please enter what you could pay in US dollars. Zero is an acceptable answer.';
  }
  if (step === 3 && !a.confirmed) return 'Please confirm that you have reviewed your answers.';
  return '';
}
export const sampleApplication = () => ({ ...emptyApplication(), name: 'Alex Sample', school: 'Example Community School', country: US, program: 'waldorf-leadership-development', run: 'wlcd-fall-residency-2026', option: 'wlcd-residency', aid: '400', employment: 'Employed part time', household: '3', income: '3200', expenses: '3000', assets: '6000', teacherTraining: 'Already teaching or working in a Waldorf school', circumstances: 'Reduced work hours this year.', confirmed: true });
export const sampleInternational = () => ({ ...emptyApplication(), name: 'Mariana Ejemplo', school: 'Escuela Waldorf de Ejemplo', country: 'Argentina', program: 'explorations-online', run: NEXT_RUN, option: 'explorations-full', aid: '700', employment: 'Employed full time', household: '4', currency: 'Argentine peso (ARS)', income: '1500000', expenses: '1400000', assets: '500000', payUsd: '250', exchange: 'My salary is good locally, but in US dollars it covers very little.', teacherTraining: 'Yes', circumstances: '', confirmed: true });
export function guidance(a) {
  const cost = costOf(a);
  if (cost === null) return 'Renewal 2027 tuition is not published yet. Tell us the aid you hope for; CfA will confirm the cost.';
  if (a.aid === '') return `The ${cost ? money(cost) : 'program'} cost comes from the program page. How much of it are you asking CfA to cover?`;
  const r = request(a);
  return r && r.share !== null ? `You are asking for ${money(r.aid)}, which leaves ${money(r.share)} for you to pay.` : 'Thank you. Your notes can explain anything the numbers leave out.';
}
