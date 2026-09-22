// Fictional walkthrough data only. These are not approved prices or award rules.
export const programs = [
  { id: 'example-course', name: 'Example professional development course', tuition: 3000 },
  { id: 'example-training', name: 'Example teacher training program', tuition: 4800 },
];
export const emptyApplication = () => ({ name: '', school: '', program: 'example-course', monthly: '', months: '10', support: '', household: '', income: '', circumstances: '', purpose: '', confirmed: false });
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
export function validateStep(application, step) {
  if (step === 0 && !application.name.trim()) return 'Please enter a name for this example.';
  if (step === 0 && !programs.some(p => p.id === application.program)) return 'Please choose a program.';
  if (step === 1 && !assessment(application, programs.find(p => p.id === application.program)?.tuition)) return 'Enter a monthly contribution and outside support of zero or more, and a whole number of months from 1 to 24.';
  if (step === 3 && !application.confirmed) return 'Please confirm that you have reviewed your answers.';
  return '';
}
export const sampleApplication = () => ({ ...emptyApplication(), name: 'Alex Sample', school: 'Example Community School', monthly: '150', months: '10', support: '300', household: '3', income: 'Prefer to discuss privately', circumstances: 'Reduced work hours this year. A predictable monthly payment would help.', purpose: 'To bring new approaches into my teaching practice.', confirmed: true });
export function guidance(application) {
  if (application.monthly === '') return 'What monthly contribution would feel manageable? Zero is an acceptable answer.';
  if (Number(application.monthly) === 0) return 'Thank you for letting us know. You can explain your circumstances, or ask to discuss them privately.';
  return `You have described ${money(Number(application.monthly))} a month. Include only outside support that is already confirmed; possible support can go in your notes.`;
}
