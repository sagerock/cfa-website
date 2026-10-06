// Teacher Training scholarship application (Milan, 2026-10-04): the multi-year programs
// get their own, more in-depth application, kept apart from the short universal form.
// Questions are a simplified version of CfA's Waldorf Fellowship form (Gravity Form 16),
// plus the "What would feel manageable?" step Milan asked to keep from the universal form.
// Milan, 2026-10-05: TSHE no longer exists, so it is off the program list; added the
// year of study, anticipated graduation and three written answers AWSNA's TELG loan and
// CPT grant forms ask for.
// Applicant details in the preview are fictional.
import { assessment, money } from './model.js';

export { assessment, money };

export const ttPrograms = [
  { id: 'antioch', name: 'Antioch Waldorf Teacher Training', href: 'https://centerforanthroposophy.org/programs/antioch-university-waldorf-teacher-education-program/' },
  { id: 'whistep', name: 'CfA Waldorf High School Teacher Education (WHiSTEP)', href: 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/whistep/' },
];

export const YEARS = ['Year 1', 'Year 2', 'Year 3'];
export const STAGES = ['Starting a new cohort', 'Continuing in my current cohort'];
export const INCOME_RANGES = ['Under $20,000', '$20,000 – $29,999', '$30,000 – $39,999', '$40,000 – $49,999', '$50,000 – $74,999', '$75,000 – $99,999', '$100,000 – $149,999', '$150,000 or more', 'Prefer not to answer'];
export const HOUSING = ['Own', 'Rent', 'Live with family', 'Other'];
export const TAX_FILED = ['This year', 'Last year', 'Did not file'];
export const YES_NO = ['No', 'Yes'];

export const STEPS = ['You and your program', 'Your path', 'What’s manageable', 'Household and finances', 'Documents and references', 'Review & submit'];

export const emptyTT = () => ({
  name: '', email: '', phone: '', program: '', stage: '', year: '', graduation: '', diversity: '',
  plans: '', background: '', involvement: '',
  employer: '', position: '', yearsThere: '',
  tuition: '', monthly: '', months: '12', support: '',
  dependents: '', housing: '', income: '', expenses: '', schoolTuition: '', assets: '', liabilities: '',
  defaulted: '', bankruptcy: '', explain: '',
  taxFiled: '', referenceName: '', referenceContact: '', referenceRelation: '', notes: '',
  affirmed: false,
});

export const TT_MONEY_FIELDS = ['tuition', 'monthly', 'support', 'expenses', 'schoolTuition', 'assets', 'liabilities'];

// David, 2026-10-06: Safari and Firefox show the month picker as a plain text box, so
// "July 2028", "07/2028" and "07/28" were all refused. Accept the ways people write a
// month and year; returns "YYYY-MM" or null.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function parseMonthYear(value) {
  const s = String(value ?? '').trim().toLowerCase();
  let month; let year;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) { year = m[1]; month = Number(m[2]); }
  else if ((m = s.match(/^(\d{1,2})\s*[-/.]\s*(\d{2}|\d{4})$/))) { month = Number(m[1]); year = m[2]; }
  else if ((m = s.match(/^([a-z]{3,})\.?,?\s*(?:of\s+)?'?(\d{2}|\d{4})$/))) { month = MONTHS.findIndex(name => name.startsWith(m[1]) || (m[1] === 'sept' && name === 'september')) + 1; year = m[2]; }
  else return null;
  if (year.length === 2) year = `20${year}`;
  if (!(month >= 1 && month <= 12) || Number(year) < 2000 || Number(year) > 2099) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

const nonNegative = (v) => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0;

export function validateTT(a, step) {
  if (step === 0) {
    if (!a.name.trim()) return 'Please enter a name for this example.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email.trim())) return 'Please enter an email address (fictional is fine).';
    if (!ttPrograms.some(p => p.id === a.program)) return 'Please choose a program.';
    if (!STAGES.includes(a.stage)) return 'Please tell us whether you are starting or continuing.';
    if (!YEARS.includes(a.year)) return 'Please choose your year of study.';
    if (!parseMonthYear(a.graduation)) return 'Please enter your anticipated graduation month and year, for example July 2028.';
    if (!YES_NO.includes(a.diversity)) return 'Please answer the Diversity Scholarship question.';
  }
  if (step === 1) {
    for (const [field, label] of [['plans', 'plans after graduating'], ['background', 'employment and educational background'], ['involvement', 'involvement with Waldorf education and anthroposophy']]) {
      if (!a[field].trim()) return `Please tell us about your ${label}.`;
    }
  }
  if (step === 2) {
    if (!(Number(a.tuition) > 0 && Number.isFinite(Number(a.tuition)))) return 'Please enter the program cost you are applying for help with.';
    if (!assessment(a, a.tuition)) return 'Enter a monthly contribution and outside support of zero or more, and a whole number of months from 1 to 24.';
  }
  if (step === 3) {
    if (!INCOME_RANGES.includes(a.income)) return 'Please choose an annual income range. “Prefer not to answer” is fine.';
    for (const [field, label] of [['expenses', 'estimated annual living expenses'], ['assets', 'total assets'], ['liabilities', 'total debts']]) {
      if (!nonNegative(a[field])) return `Please enter your ${label} (0 if none).`;
    }
    if (!YES_NO.includes(a.defaulted) || !YES_NO.includes(a.bankruptcy)) return 'Please answer the student loan and bankruptcy questions.';
    if ((a.defaulted === 'Yes' || a.bankruptcy === 'Yes') && !a.explain.trim()) return 'Please add a short explanation for the “yes” answer.';
  }
  if (step === 4 && !TAX_FILED.includes(a.taxFiled)) return 'Please tell us when you last filed a tax return.';
  if (step === 5 && !a.affirmed) return 'Please confirm the statement before submitting.';
  return '';
}

export function ttGuidance(a) {
  if (a.tuition === '') return 'Start with the cost on the program page for the year you are applying for. If you are not sure, give your best estimate and say so in your notes.';
  if (a.monthly === '') return 'What monthly contribution would feel manageable? Zero is an acceptable answer.';
  if (Number(a.monthly) === 0) return 'Thank you for letting us know. You can explain your circumstances in the next steps.';
  return `You have described ${money(Number(a.monthly))} a month. Include only outside support that is already confirmed; possible support can go in your notes.`;
}

export const sampleTT = () => ({
  ...emptyTT(),
  name: 'Jordan Sample', email: 'jordan@example.com', phone: '555-0100', program: 'whistep', stage: 'Starting a new cohort', year: 'Year 1', graduation: '2029-07', diversity: 'No',
  plans: 'Teach high school humanities at my school and take on a class sponsorship.',
  background: 'BA in history; three years teaching humanities at a Waldorf high school.',
  involvement: 'Waldorf parent for six years; two summers of Renewal courses.',
  employer: 'Example Waldorf School', position: 'High school humanities teacher', yearsThere: '3',
  tuition: '6400', monthly: '150', months: '12', support: '1500',
  dependents: '1', housing: 'Rent', income: '$50,000 – $74,999', expenses: '52000', schoolTuition: '0', assets: '9000', liabilities: '14000',
  defaulted: 'No', bankruptcy: 'No', explain: '',
  taxFiled: 'This year', referenceName: 'Sam Reference', referenceContact: 'sam@example.com', referenceRelation: 'Colleague',
  notes: 'My school has confirmed $1,500 for the first summer.', affirmed: true,
});
