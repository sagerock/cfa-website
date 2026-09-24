// Programs are CfA's real scholarship programs (Milan, 2026-09-23). Their dates come
// from the program calendar (src/data/calendar.js), so a director's correction there
// shows up here too. Applicant details in the preview are still fictional.
import { CALENDAR, STATUS_LABEL } from '../../data/calendar.js';

export const GROUPS = ['Professional Development', 'Teacher Training'];

// `calendar` is the program key in calendar.js. Antioch has no public dates on the
// calendar, so it offers only "next cohort".
export const programs = [
  { id: 'building-bridges', name: 'Building Bridges', group: 'Professional Development', calendar: 'building-bridges', href: 'https://centerforanthroposophy.org/programs/building-bridges-to-waldorf-teacher-training-2/' },
  { id: 'explorations-online', name: 'Explorations Online', group: 'Professional Development', calendar: 'explorations-online', href: 'https://centerforanthroposophy.org/programs/explorations-online/' },
  { id: 'mentor-training', name: 'Mentor Training', group: 'Professional Development', calendar: 'mentor-training', href: 'https://centerforanthroposophy.org/programs/mentor-training/' },
  { id: 'renewal-courses', name: 'Renewal Courses', group: 'Professional Development', calendar: 'renewal-courses', href: 'https://centerforanthroposophy.org/programs/renewal-courses/' },
  { id: 'starlight-rays', name: 'Starlight Rays', group: 'Professional Development', calendar: 'starlight-rays', href: 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/starlight/' },
  { id: 'waldorf-leadership-development', name: 'Waldorf Leadership Development', group: 'Professional Development', calendar: 'waldorf-leadership-development', href: 'https://centerforanthroposophy.org/programs/waldorf-administration-and-leadership-development-program/' },
  { id: 'antioch', name: 'Antioch Waldorf Teacher Training', group: 'Teacher Training', calendar: null, href: 'https://centerforanthroposophy.org/programs/antioch-university-waldorf-teacher-education-program/' },
  { id: 'whistep', name: 'Waldorf High School Teacher Education (WHiSTEP)', group: 'Teacher Training', calendar: 'waldorf-high-school', href: 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/whistep/' },
];

export const TUITION_ASSISTANCE_URL = 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/tuition/tuition-assistance/';
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

export const emptyApplication = () => ({ name: '', school: '', program: '', run: '', tuition: '', monthly: '', months: '10', support: '', household: '', income: '', circumstances: '', purpose: '', confirmed: false });
export function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}
export function assessment(application, tuition) {
  const number = (value) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0;
  if (!number(tuition) || !number(application.monthly) || !number(application.support) || !number(application.months) || !Number.isInteger(Number(application.months)) || Number(application.months) < 1 || Number(application.months) > 24) return null;
  const tuitionCents = Math.round(Number(tuition) * 100);
  const contributionCents = Math.round(Number(application.monthly) * 100) * Number(application.months);
  const supportCents = Math.round(Number(application.support) * 100);
  const gapCents = Math.max(0, tuitionCents - contributionCents - supportCents);
  return { tuition: tuitionCents / 100, contribution: contributionCents / 100, support: supportCents / 100, gap: gapCents / 100, percent: tuitionCents ? gapCents / tuitionCents * 100 : 0 };
}
export function validateStep(application, step, today) {
  if (step === 0 && !application.name.trim()) return 'Please enter a name for this example.';
  if (step === 0 && !programs.some(p => p.id === application.program)) return 'Please choose a program.';
  if (step === 0 && !runsFor(application.program, today).some(r => r.id === application.run)) return 'Please choose the dates you are applying for.';
  if (step === 1 && !(Number(application.tuition) > 0 && Number.isFinite(Number(application.tuition)))) return 'Please enter the program cost you are applying for help with.';
  if (step === 1 && !assessment(application, application.tuition)) return 'Enter a monthly contribution and outside support of zero or more, and a whole number of months from 1 to 24.';
  if (step === 3 && !application.confirmed) return 'Please confirm that you have reviewed your answers.';
  return '';
}
export const sampleApplication = () => ({ ...emptyApplication(), name: 'Alex Sample', school: 'Example Community School', program: 'waldorf-leadership-development', run: 'wlcd-fall-residency-2026', tuition: '850', monthly: '50', months: '6', support: '200', household: '3', income: 'Prefer to discuss privately', circumstances: 'Reduced work hours this year. A predictable monthly payment would help.', purpose: 'To bring new approaches into my work as a school leader.', confirmed: true });
export function guidance(application) {
  if (application.tuition === '') return 'Start with the cost shown on the program page for the dates you chose. If you are not sure, give your best estimate and say so in your notes.';
  if (application.monthly === '') return 'What monthly contribution would feel manageable? Zero is an acceptable answer.';
  if (Number(application.monthly) === 0) return 'Thank you for letting us know. You can explain your circumstances, or ask to discuss them privately.';
  return `You have described ${money(Number(application.monthly))} a month. Include only outside support that is already confirmed; possible support can go in your notes.`;
}
