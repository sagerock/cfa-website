// Teacher Training scholarship application (Milan, 2026-10-04): the multi-year programs
// get their own, more in-depth application, kept apart from the short universal form.
// Questions are a simplified version of CfA's Waldorf Fellowship form (Gravity Form 16),
// plus the "What would feel manageable?" step Milan asked to keep from the universal form.
// Applicant details in the preview are fictional.
import { assessment, money } from './model.js';

export { assessment, money };

export const ttPrograms = [
  { id: 'antioch', name: 'Antioch Waldorf Teacher Training', href: 'https://centerforanthroposophy.org/programs/antioch-university-waldorf-teacher-education-program/' },
  { id: 'whistep', name: 'CfA Waldorf High School Teacher Education (WHiSTEP)', href: 'https://centerforanthroposophy.org/programs/waldorf-high-school-teacher-education/whistep/' },
  { id: 'tshe', name: 'Transdisciplinary Studies in Healing Education (TSHE)', href: null },
];

export const STAGES = ['Starting a new cohort', 'Continuing in my current cohort'];
export const INCOME_RANGES = ['Under $20,000', '$20,000 – $29,999', '$30,000 – $39,999', '$40,000 – $49,999', '$50,000 – $74,999', '$75,000 – $99,999', '$100,000 – $149,999', '$150,000 or more', 'Prefer not to answer'];
export const HOUSING = ['Own', 'Rent', 'Live with family', 'Other'];
export const TAX_FILED = ['This year', 'Last year', 'Did not file'];
export const YES_NO = ['No', 'Yes'];

export const STEPS = ['You and your program', 'What’s manageable', 'Household and finances', 'Documents and references', 'Review & submit'];

export const emptyTT = () => ({
  name: '', email: '', phone: '', program: '', stage: '', diversity: '',
  employer: '', position: '', yearsThere: '',
  tuition: '', monthly: '', months: '12', support: '',
  dependents: '', housing: '', income: '', expenses: '', schoolTuition: '', assets: '', liabilities: '',
  defaulted: '', bankruptcy: '', explain: '',
  taxFiled: '', referenceName: '', referenceContact: '', referenceRelation: '', notes: '',
  affirmed: false,
});

const nonNegative = (v) => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0;

export function validateTT(a, step) {
  if (step === 0) {
    if (!a.name.trim()) return 'Please enter a name for this example.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email.trim())) return 'Please enter an email address (fictional is fine).';
    if (!ttPrograms.some(p => p.id === a.program)) return 'Please choose a program.';
    if (!STAGES.includes(a.stage)) return 'Please tell us whether you are starting or continuing.';
    if (!YES_NO.includes(a.diversity)) return 'Please answer the Diversity Scholarship question.';
  }
  if (step === 1) {
    if (!(Number(a.tuition) > 0 && Number.isFinite(Number(a.tuition)))) return 'Please enter the program cost you are applying for help with.';
    if (!assessment(a, a.tuition)) return 'Enter a monthly contribution and outside support of zero or more, and a whole number of months from 1 to 24.';
  }
  if (step === 2) {
    if (!INCOME_RANGES.includes(a.income)) return 'Please choose an annual income range. “Prefer not to answer” is fine.';
    for (const [field, label] of [['expenses', 'estimated annual living expenses'], ['assets', 'total assets'], ['liabilities', 'total debts']]) {
      if (!nonNegative(a[field])) return `Please enter your ${label} (0 if none).`;
    }
    if (!YES_NO.includes(a.defaulted) || !YES_NO.includes(a.bankruptcy)) return 'Please answer the student loan and bankruptcy questions.';
    if ((a.defaulted === 'Yes' || a.bankruptcy === 'Yes') && !a.explain.trim()) return 'Please add a short explanation for the “yes” answer.';
  }
  if (step === 3 && !TAX_FILED.includes(a.taxFiled)) return 'Please tell us when you last filed a tax return.';
  if (step === 4 && !a.affirmed) return 'Please confirm the statement before submitting.';
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
  name: 'Jordan Sample', email: 'jordan@example.com', phone: '555-0100', program: 'whistep', stage: 'Starting a new cohort', diversity: 'No',
  employer: 'Example Waldorf School', position: 'High school humanities teacher', yearsThere: '3',
  tuition: '6400', monthly: '150', months: '12', support: '1500',
  dependents: '1', housing: 'Rent', income: '$50,000 – $74,999', expenses: '52000', schoolTuition: '0', assets: '9000', liabilities: '14000',
  defaulted: 'No', bankruptcy: 'No', explain: '',
  taxFiled: 'This year', referenceName: 'Sam Reference', referenceContact: 'sam@example.com', referenceRelation: 'Colleague',
  notes: 'My school has confirmed $1,500 for the first summer.', affirmed: true,
});
