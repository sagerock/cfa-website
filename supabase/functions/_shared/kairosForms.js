// Kairos information forms on learn.* (no payment). One definition drives both the
// page (src/components/KairosInfoForm.astro) and the server (cfa-forms), so a field
// added here is rendered, validated and emailed without touching either.
//
// Replaces WordPress Gravity Forms (2026-10-16, Sage: "get these other forms set up
// on Learn"):
//   financial-aid  <- 84 Kairos Financial Aid Application (Milan, Karine) and
//                     125 EP Module Financial Aid Application (Milan, Lisl)
//   inquiry        <- 94 Kairos Inquiry (Karine)
// Recipients can be overridden per form with the FORM_NOTIFY_<KEY> secret
// (comma-separated), e.g. FORM_NOTIFY_KAIROS_FINANCIAL_AID.

export const KAIROS_FORMS = {
  'kairos-financial-aid': {
    title: 'Kairos financial aid application',
    subject: 'Kairos financial aid application',
    notify: [
      'milan@centerforanthroposophy.org',
      'karine@centerforanthroposophy.org',
      'lisl@centerforanthroposophy.org',
    ],
    thanks:
      'Thank you for your financial aid application. It has gone to the Kairos team, who will write to you by email about your award.',
    fields: [
      { name: 'first_name', label: 'First name', type: 'text', required: true, row: 'name' },
      { name: 'last_name', label: 'Last name', type: 'text', required: true, row: 'name' },
      { name: 'email', label: 'Email', type: 'email', required: true, row: 'contact' },
      { name: 'phone', label: 'Phone', type: 'tel', row: 'contact' },
      { name: 'street', label: 'Street address', type: 'text' },
      { name: 'city', label: 'City', type: 'text', row: 'city' },
      { name: 'region', label: 'State / province', type: 'text', row: 'city' },
      { name: 'postal_code', label: 'ZIP / postal code', type: 'text', row: 'country' },
      { name: 'country', label: 'Country', type: 'text', row: 'country' },
      {
        name: 'program', label: 'Which program do you wish to take?', type: 'radio', required: true,
        options: [
          'Entire 2026-27 Kairos Year',
          'Emergency Pedagogy Module 7 (January 2027)',
          'Selected individual online classes only',
        ],
      },
      {
        name: 'student_status', label: 'Please select one of the options below', type: 'radio', required: true,
        options: [
          'I am a continuing Kairos / iARTe student',
          'I am a Friend of Kairos taking individual courses',
        ],
      },
      {
        name: 'family_income', label: 'Your annual family income', type: 'radio', required: true,
        options: [
          'Under $20,000',
          '$20,000 – $29,999',
          '$30,000 – $39,999',
          '$40,000 – $49,999',
          '$50,000 – $74,999',
          '$75,000 – $99,999',
          '$100,000 – $150,000',
          'Over $150,000',
        ],
      },
      { name: 'family_size', label: 'How many in the family?', type: 'text', required: true, row: 'money1' },
      {
        name: 'annual_income', label: 'Your annual income', type: 'text', required: true, row: 'money1',
        help: 'Please include all household members.',
      },
      { name: 'annual_expenses', label: 'Estimated annual expenses', type: 'text', required: true, row: 'money2' },
      { name: 'family_assets', label: 'Estimated value of your family assets', type: 'text', required: true, row: 'money2' },
      { name: 'minimum_aid', label: 'What is the minimum amount of financial aid you hope for?', type: 'text' },
      {
        name: 'circumstances', label: 'Please describe in more detail your circumstances and needs', type: 'textarea',
        help: 'Please include anything else you wish to share in support of your application.',
      },
    ],
  },
  'kairos-inquiry': {
    title: 'Kairos Institute inquiry',
    subject: 'Kairos inquiry',
    notify: [
      'karine@centerforanthroposophy.org',
      'lisl@centerforanthroposophy.org',
    ],
    thanks: 'Thank you for writing. Your message has gone to Karine Munk Finser and Lisl Hofer at the Kairos Institute.',
    fields: [
      { name: 'first_name', label: 'First name', type: 'text', required: true, row: 'name' },
      { name: 'last_name', label: 'Last name', type: 'text', required: true, row: 'name' },
      { name: 'email', label: 'Email', type: 'email', required: true, row: 'contact' },
      { name: 'phone', label: 'Phone', type: 'tel', row: 'contact' },
      { name: 'message', label: 'Please write your questions below', type: 'textarea', required: true },
    ],
  },
};

const MAX = { text: 300, email: 200, tel: 60, textarea: 6000, radio: 200 };

// Server-side check. Returns { ok, values, error }. Unknown fields are dropped and
// radio answers must be one of the listed options.
export function validateSubmission(formKey, body) {
  const form = KAIROS_FORMS[formKey];
  if (!form) return { ok: false, error: 'Unknown form.' };
  const values = {};
  for (const field of form.fields) {
    const raw = body?.[field.name];
    const value = (raw == null ? '' : String(raw)).trim().slice(0, MAX[field.type] || 300);
    if (field.required && !value) return { ok: false, error: `Please fill in "${field.label}".` };
    if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { ok: false, error: 'Please enter a valid email address.' };
    }
    if (value && field.type === 'radio' && !field.options.includes(value)) {
      return { ok: false, error: `Please choose an option for "${field.label}".` };
    }
    values[field.name] = value;
  }
  return { ok: true, values };
}

// Plain-text notification body, one "Label: value" line per answered field.
export function submissionText(formKey, values) {
  const form = KAIROS_FORMS[formKey];
  const lines = [`New ${form.title} from the learn.centerforanthroposophy.org website.`, ''];
  for (const field of form.fields) {
    const value = values[field.name];
    if (!value) continue;
    lines.push(field.type === 'textarea' ? `${field.label}:\n${value}\n` : `${field.label}: ${value}`);
  }
  lines.push('', `Reply to this email to answer ${values.first_name} ${values.last_name} directly.`);
  return lines.join('\n');
}
