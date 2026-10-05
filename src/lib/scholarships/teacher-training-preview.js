import { ttPrograms, STAGES, INCOME_RANGES, HOUSING, TAX_FILED, YES_NO, STEPS, emptyTT, sampleTT, validateTT, ttGuidance, assessment, money } from './teacher-training.js';
const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = 'cfa-tt-scholarship-preview-v1';
const LAST = STEPS.length - 1;
let state = { application: emptyTT(), step: 0, submitted: false, history: [] };
try { const saved = JSON.parse(sessionStorage.getItem(key)); if (saved?.application && Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= LAST && Array.isArray(saved.history)) state = saved; } catch { /* Storage is optional for the demo. */ }
function save() { let ok = true; try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { ok = false; } $('save-status').textContent = ok ? 'Example saved in this tab.' : 'Browser storage is unavailable. Keep this page open to retain your example.'; }
function show(view) { ['welcome','application','submitted','review'].forEach(id => $(id).hidden = id !== view); const reviewing = view === 'review'; $('reviewer-tab').classList.toggle('active', reviewing); $('applicant-tab').classList.toggle('active', !reviewing); $('reviewer-tab').setAttribute('aria-pressed', String(reviewing)); $('applicant-tab').setAttribute('aria-pressed', String(!reviewing)); if (view === 'welcome') $('resume').hidden = !state.application.name; }

const a = () => state.application;
const input = (name, label, type = 'text', attrs = '') => `<label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escape(a()[name])}" ${attrs}/>`;
const money$ = (name, label, attrs = 'min="0" max="100000000" step="1" required') => input(name, label, 'number', attrs);
const textarea = (name, label) => `<label for="field-${name}">${label}</label><textarea id="field-${name}" name="${name}" maxlength="3000">${escape(a()[name])}</textarea>`;
const select = (name, label, choices) => `<label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" required><option value="" ${a()[name] ? '' : 'selected'} disabled>Choose one…</option>${choices.map(c => `<option ${a()[name] === c ? 'selected' : ''}>${escape(c)}</option>`).join('')}</select>`;
const radios = (name, legend, choices) => `<fieldset class="runs"><legend>${legend}</legend>${choices.map(([value, text]) => `<label class="run"><input type="radio" name="${name}" value="${escape(value)}" ${a()[name] === value ? 'checked' : ''} required /><span><strong>${escape(text)}</strong></span></label>`).join('')}</fieldset>`;
const row = (...cells) => `<div class="field-row">${cells.map(c => `<div>${c}</div>`).join('')}</div>`;
const program = () => ttPrograms.find(p => p.id === a().program);
const orNone = (v, f = (x) => x) => v === '' || v == null ? 'Not provided' : f(v);
const details = (rows) => `<dl class="detail-list">${rows.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;

function costHint() {
  const p = program();
  return p?.href ? `Use the cost on the <a href="${p.href}" target="_blank" rel="noopener">${escape(p.name)} page</a> for the year you are applying for.` : 'Use the cost CfA gave you for the year you are applying for.';
}

const FIELDS = [
  () => input('name', 'Your name', 'text', 'required maxlength="120" autocomplete="off"') + row(input('email', 'Email', 'email', 'required maxlength="200" autocomplete="off"'), input('phone', 'Phone (optional)', 'tel', 'maxlength="40" autocomplete="off"'))
    + radios('program', 'Which program?', ttPrograms.map(p => [p.id, p.name]))
    + select('stage', 'Are you starting or continuing?', STAGES)
    + radios('diversity', 'Do you wish to apply for a Diversity Scholarship?', YES_NO.map(v => [v, v]))
    + row(input('employer', 'Current employer (optional)', 'text', 'maxlength="200"'), input('position', 'Position (optional)', 'text', 'maxlength="200"'))
    + input('yearsThere', 'How many years there? (optional)', 'number', 'min="0" max="60" step="1"'),
  () => input('tuition', 'Program cost you are applying for help with (USD)', 'number', 'min="1" max="100000" step="0.01" required') + `<p class="muted">${costHint()}</p>`
    + row(input('monthly', 'What could you contribute each month?', 'number', 'min="0" max="100000" step="0.01" required'), input('months', 'Over how many months?', 'number', 'min="1" max="24" step="1" required'))
    + input('support', 'Confirmed support from your school or elsewhere (total)', 'number', 'min="0" max="1000000" step="0.01" required') + '<p class="muted">Enter 0 if none. A proposed payment schedule is subject to CfA’s review.</p>',
  () => row(input('dependents', 'Number of dependents (optional)', 'number', 'min="0" max="20" step="1"'), select('housing', 'Housing (optional)', HOUSING).replace(' required', ''))
    + select('income', 'Annual household income', INCOME_RANGES)
    + row(money$('expenses', 'Estimated annual living expenses'), money$('schoolTuition', 'Children’s school tuition per year (optional)', 'min="0" max="10000000" step="1"'))
    + row(money$('assets', 'Total assets (savings, investments, property, vehicles)'), money$('liabilities', 'Total debts (mortgage, loans, credit cards)'))
    + '<p class="muted">Rough current values are fine. Enter 0 if none.</p>'
    + row(radios('defaulted', 'Have you ever defaulted on a student loan?', YES_NO.map(v => [v, v])), radios('bankruptcy', 'Have you ever declared bankruptcy?', YES_NO.map(v => [v, v])))
    + textarea('explain', 'If you answered yes to either, please explain'),
  () => select('taxFiled', 'When did you last file a tax return?', TAX_FILED)
    + '<div class="review-notice"><strong>Tax return upload</strong><p>The live form will ask for your latest IRS Form 1040 (Canadian applicants: the Canadian equivalent), up to three files. Uploads are not enabled in this preview.</p></div>'
    + '<h3 style="margin-top:20px">One personal reference (not a relative)</h3>'
    + row(input('referenceName', 'Name (optional)', 'text', 'maxlength="120"'), input('referenceRelation', 'How do they know you? (optional)', 'text', 'maxlength="120"'))
    + input('referenceContact', 'Email or phone (optional)', 'text', 'maxlength="200"')
    + textarea('notes', 'Any other relevant notes or comments? (optional)'),
  () => summary() + '<div class="review-notice"><p>By submitting, I affirm that the information in this application is true, complete and correct, and I acknowledge that the Center for Anthroposophy is relying on it if it grants aid. CfA does not discriminate on the basis of race, color, age, gender, ancestry, religion, national origin, sexual orientation, family status or disability in awarding financial aid.</p></div>'
    + `<label><input name="affirmed" type="checkbox" ${a().affirmed ? 'checked' : ''} required />I affirm the statement above (fictional example).</label>`,
];
const TITLES = ['First, you and your program.', 'What would feel manageable?', 'Your household and finances.', 'Documents and a reference.', 'Does this look right?'];
const GUIDES = [() => 'Use a fictional name as you explore. Antioch, WHiSTEP and TSHE share this application.', () => ttGuidance(a()), () => 'These follow the Waldorf Fellowship form, shortened. Estimates are fine. No account numbers.', () => 'A reference is optional in this draft. CfA will tell you if anything else is needed.', () => 'You can go back and correct anything before submitting.'];

function summary() {
  const x = a(); const calc = assessment(x, x.tuition);
  return details([
    ['Name', x.name], ['Email', x.email], ['Program', program()?.name || 'Not selected'], ['Starting or continuing', orNone(x.stage)], ['Diversity Scholarship', orNone(x.diversity)],
    ['Employer / position', [x.employer, x.position].filter(Boolean).join(', ') || 'Not provided'],
    ['Program cost', orNone(x.tuition, money)], ['Monthly contribution', orNone(x.monthly, money)], ['Number of months', x.months], ['Confirmed outside support', orNone(x.support, money)],
    ['Dependents', orNone(x.dependents)], ['Housing', orNone(x.housing)], ['Annual household income', orNone(x.income)], ['Annual living expenses', orNone(x.expenses, money)], ['Children’s school tuition', orNone(x.schoolTuition, money)],
    ['Total assets', orNone(x.assets, money)], ['Total debts', orNone(x.liabilities, money)], ['Student loan default', orNone(x.defaulted)], ['Bankruptcy', orNone(x.bankruptcy)],
    ['Last tax return filed', orNone(x.taxFiled)], ['Reference', [x.referenceName, x.referenceRelation, x.referenceContact].filter(Boolean).join(' · ') || 'Not provided'],
    ['Remaining funding gap', calc ? money(calc.gap) : 'More information needed'],
  ]) + (x.explain ? `<h3 style="margin-top:24px">Explanation</h3><p class="long-answer">${escape(x.explain)}</p>` : '') + `<h3 style="margin-top:24px">Notes</h3><p class="long-answer">${escape(x.notes || 'Not provided')}</p>`;
}

function render(focus = false) {
  $('step-count').textContent = `Step ${state.step + 1} of ${STEPS.length}`;
  $('step-title').textContent = TITLES[state.step]; $('guide-text').textContent = GUIDES[state.step]();
  document.querySelectorAll('#steps li').forEach((el, i) => { el.classList.toggle('current', i === state.step); if (i === state.step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
  $('back').hidden = state.step === 0; $('next').textContent = state.step === LAST ? 'Submit example →' : 'Continue →'; $('form-error').textContent = '';
  $('fields').innerHTML = FIELDS[state.step]();
  if (focus) $('step-title').focus();
}

$('application-form').addEventListener('input', (event) => { const t = event.target; if (!t.name || !(t.name in state.application)) return; state.application[t.name] = t.type === 'checkbox' ? t.checked : t.value; if (t.name !== 'affirmed') state.application.affirmed = false; save(); if (state.step === 1) $('guide-text').textContent = ttGuidance(a()); });
$('application-form').addEventListener('submit', (event) => { event.preventDefault(); const error = validateTT(a(), state.step); if (error) { $('form-error').textContent = error; return; } if (state.step < LAST) { state.step++; save(); render(true); } else { state.submitted = true; state.history.push({ at: new Date().toISOString(), text: 'Applicant submitted this fictional example.' }); save(); show('submitted'); } });
$('back').onclick = () => { state.step--; save(); render(true); };
$('demo-login').onsubmit = (event) => { event.preventDefault(); $('demo-login').hidden = true; $('demo-verify').hidden = false; $('demo-code').focus(); };
$('demo-verify').onsubmit = (event) => { event.preventDefault(); if ($('demo-code').value !== '123456') { $('login-status').textContent = 'For this simulation, use 123456.'; return; } $('login-status').textContent = ''; show(state.submitted ? 'submitted' : 'application'); render(true); };
$('resume').onclick = () => { show(state.submitted ? 'submitted' : 'application'); render(true); };
$('save-exit').onclick = () => { save(); show('welcome'); };
$('applicant-tab').onclick = () => show('welcome');
$('reviewer-tab').onclick = () => { show('review'); renderReview(); };
$('see-review').onclick = () => { show('review'); renderReview(); };
$('edit-example').onclick = () => { state.submitted = false; delete state.decision; state.application.affirmed = false; state.step = 0; save(); show('application'); render(true); };
$('load-sample').onclick = () => { state = { application: sampleTT(), step: LAST, submitted: true, history: [{ at: new Date().toISOString(), text: 'Fictional example loaded for staff review.' }] }; save(); renderReview(); };
$('reset').onclick = () => { state = { application: emptyTT(), step: 0, submitted: false, history: [] }; save(); $('demo-login').hidden = false; $('demo-verify').hidden = true; $('demo-code').value = ''; $('login-status').textContent = ''; show('welcome'); };

function renderReview() {
  const x = a(); const calc = assessment(x, x.tuition); const p = program();
  if (!state.submitted) { $('review-content').innerHTML = '<div class="card"><h2>No submitted example yet.</h2><p>Complete the applicant walkthrough, or choose “Load fictional example” above to explore a completed application.</p></div>'; return; }
  const flags = [x.defaulted === 'Yes' && 'Reports a student loan default', x.bankruptcy === 'Yes' && 'Reports a bankruptcy', x.diversity === 'Yes' && 'Applying for the Diversity Scholarship', x.taxFiled === 'Did not file' && 'Did not file a recent tax return'].filter(Boolean);
  $('review-content').innerHTML = `<span class="badge">${escape(state.decision || 'Awaiting human review')} · simulation</span><h2>${escape(x.name)}</h2><p class="muted">${escape(p?.name || '')} · ${escape(x.stage)}${p?.href ? ` · <a href="${p.href}" target="_blank" rel="noopener">program page</a>` : ''}</p>`
    + (calc ? `<div class="stats"><div class="stat"><span>Program cost</span><strong>${money(calc.tuition)}</strong></div><div class="stat"><span>Contribution + support</span><strong>${money(calc.contribution + calc.support)}</strong></div><div class="stat gap"><span>Remaining funding gap</span><strong>${money(calc.gap)}</strong></div></div>` : '')
    + `<div class="review-grid"><div class="card"><h3>Applicant’s answers</h3>${summary()}</div><div><div class="card"><p class="eyebrow">For the reviewer</p><h3>A clear starting point.</h3><p>${calc ? `The applicant proposes ${money(calc.contribution)} in personal payments plus ${money(calc.support)} in confirmed outside support. That leaves ${money(calc.gap)} to discuss.` : 'More information is needed to calculate the gap.'}</p>${flags.length ? `<ul>${flags.map(f => `<li>${escape(f)}</li>`).join('')}</ul>` : '<p class="muted">No yes answers on the loan, bankruptcy or diversity questions.</p>'}<p class="muted">This is arithmetic, not an award or an eligibility finding. Funds, rules, admission and the payment term need human review.</p>`
    + `<form id="decision-form"><label for="decision">Example review action</label><select id="decision" required><option>Request more information</option><option>Recommend an award</option><option>Refer for exception review</option><option>Decline with explanation</option></select><label for="award">Proposed award (USD; required for an award recommendation)</label><input id="award" type="number" min="0" max="${calc?.tuition || 0}" step="0.01" /><label for="reason">Reason / next step</label><textarea id="reason" required maxlength="2000" placeholder="Explain the decision and any questions to resolve."></textarea><button class="primary" type="submit">Record example review</button><p id="decision-error" class="error" role="alert"></p></form></div>`
    + `<div class="card" style="margin-top:20px"><h3>Review history</h3><ol class="audit">${state.history.map(h => `<li><strong>${escape(new Date(h.at).toLocaleString())}</strong><br />${escape(h.text)}</li>`).join('')}</ol><p class="small">Demo history stays in this tab. No award, email, enrollment, or accounting entry is created.</p></div></div></div>`;
  $('decision').onchange = () => { $('award').required = $('decision').value === 'Recommend an award'; };
  $('decision-form').onsubmit = (event) => { event.preventDefault(); const decision = $('decision').value; const reason = $('reason').value.trim(); const award = $('award').value; if (!reason || (decision === 'Recommend an award' && (award === '' || Number(award) <= 0))) { $('decision-error').textContent = 'Please provide a reason and, for an award recommendation, a positive amount.'; return; } state.decision = decision; state.history.push({ at: new Date().toISOString(), text: `${decision}${decision === 'Recommend an award' ? ` of ${money(award)}` : ''}. ${reason}` }); save(); renderReview(); };
}
show('welcome');
