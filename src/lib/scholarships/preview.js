import { programs, runsFor, TEACHER_TRAINING_URL, TEACHER_TRAINING_PLANS, COUNTRIES, EMPLOYMENT, STEPS, TUITION_CHECKED, isInternational, tuitionFor, costOf, request, emptyApplication, sampleApplication, sampleInternational, money, amount, validateStep, guidance, MONEY_FIELDS, cleanAmount } from './model.js';
const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = 'cfa-scholarship-preview-v4';
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
let state = { application: emptyApplication(), step: 0, submitted: false, history: [] };
try { const saved = JSON.parse(sessionStorage.getItem(key)); if (saved?.application && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < 4 && Array.isArray(saved.history)) state = saved; } catch { /* Storage is optional for the demo. */ }
let storageWorks = true;
function save() { try { sessionStorage.setItem(key, JSON.stringify(state)); storageWorks = true; } catch { storageWorks = false; } $('save-status').textContent = storageWorks ? 'Example saved in this tab.' : 'Browser storage is unavailable. Keep this page open to retain your example.'; }
function show(view) { ['welcome','application','submitted','review'].forEach(id => $(id).hidden = id !== view); const reviewing = view === 'review'; $('reviewer-tab').classList.toggle('active', reviewing); $('applicant-tab').classList.toggle('active', !reviewing); $('reviewer-tab').setAttribute('aria-pressed', String(reviewing)); $('applicant-tab').setAttribute('aria-pressed', String(!reviewing)); if(view === 'welcome') $('resume').hidden = !state.application.name; }
const input = (name, label, type = 'text', attrs = '') => `<label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escape(state.application[name])}" ${attrs}/>`;
const textarea = (name, label) => `<label for="field-${name}">${label}</label><textarea id="field-${name}" name="${name}" maxlength="3000">${escape(state.application[name])}</textarea>`;
const select = (name, label, choices) => `<label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" required><option value="" ${state.application[name] ? '' : 'selected'} disabled>Choose one…</option>${choices.map(c => `<option ${state.application[name] === c ? 'selected' : ''}>${escape(c)}</option>`).join('')}</select>`;
// Money boxes are text so "10,000" can be typed (David, 2026-10-06); cleanAmount stores 10000.
const CASH = 'required inputmode="decimal" autocomplete="off"';
const orNone = (v, f = (x) => x) => v === '' || v == null ? 'Not provided' : f(v);
const details = (rows) => `<dl class="detail-list">${rows.map(([label,value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
const chosen = (a) => { const program = programs.find(p => p.id === a.program); return { program, run: program ? runsFor(a.program, today).find(r => r.id === a.run) : null }; };
function summary() {
  const a = state.application; const { program, run } = chosen(a); const r = request(a); const intl = isInternational(a); const cur = intl ? a.currency : '';
  const local = (v) => orNone(v, x => intl ? amount(x, cur) : money(x));
  const option = tuitionFor(a.program).find(o => o.id === a.option) ?? (tuitionFor(a.program).length === 1 ? tuitionFor(a.program)[0] : null);
  return details([
    ['Name',a.name],['School / organization',a.school || 'Not provided'],['Country',a.country === 'Another country' ? (a.otherCountry || 'Not provided') : orNone(a.country)],
    ['Program',program?.name || 'Not selected'],['Applying for',run ? (run.id === 'next' ? 'A future session or cohort' : run.dates) : 'Not selected'],
    ['Tuition',option ? `${option.label}: ${money(option.cost)}` : (program && !tuitionFor(a.program).length ? 'Not yet published' : 'Not selected')],
    ['Aid requested',a.aid === '' ? 'Not provided' : money(a.aid)],['Left for the applicant to pay',r && r.share !== null ? money(r.share) : 'To be confirmed'],
    ['Plans Waldorf teacher training',orNone(a.teacherTraining)],['Employment',orNone(a.employment)],['People in the family',orNone(a.household)],
    ...(intl ? [['Currency',orNone(a.currency)]] : []),
    ['Monthly family income',local(a.income)],['Monthly family expenses',local(a.expenses)],['Savings, investments and other assets',local(a.assets)],
    ...(intl ? [['Could pay in US dollars',orNone(a.payUsd, money)]] : []),
  ]) + (intl ? `<h3 style="margin-top:24px">How the exchange rate affects them</h3><p class="long-answer">${escape(a.exchange || 'Not provided')}</p>` : '') + `<h3 style="margin-top:24px">Anything else you shared</h3><p class="long-answer">${escape(a.circumstances || 'Not provided')}</p>`;
}
function tuitionFields(a) {
  const options = tuitionFor(a.program);
  if (!options.length) return '<div class="review-notice"><strong>Tuition not yet published.</strong><p>CfA will confirm the cost for these dates. You can still apply.</p></div>';
  if (options.length === 1) return `<p class="cost-line">Tuition: <strong>${escape(options[0].label)}, ${money(options[0].cost)}</strong></p>`;
  return `<fieldset class="runs"><legend>Which tuition applies to you?</legend>${options.map(o => `<label class="run"><input type="radio" name="option" value="${o.id}" ${a.option === o.id ? 'checked' : ''} required /><span><strong>${money(o.cost)}</strong><br /><span class="muted">${escape(o.label)}</span></span></label>`).join('')}</fieldset>`;
}
function programFields(a) {
  const { program } = chosen(a);
  const options = programs.map(p => `<option value="${p.id}" ${a.program === p.id ? 'selected' : ''}>${escape(p.name)}</option>`).join('');
  let html = `<label for="field-program">Program</label><select id="field-program" name="program" required><option value="" ${a.program ? '' : 'selected'} disabled>Choose a program…</option>${options}</select>`;
  const ttNote = `<div class="review-notice"><strong>Applying for teacher training?</strong><p>Antioch Waldorf Teacher Training and WHiSTEP are multi-year programs with their own application. <a href="${TEACHER_TRAINING_URL}">Use the Teacher Training application</a>.</p></div>`;
  if (!program) return html + '<p class="muted">Programs and dates come from CfA’s program calendar.</p>' + ttNote;
  const runs = runsFor(a.program, today);
  html += `<fieldset class="runs"><legend>Which dates are you applying for?</legend>${runs.map(r => `<label class="run"><input type="radio" name="run" value="${r.id}" ${a.run === r.id ? 'checked' : ''} required /><span><strong>${escape(r.id === 'next' ? r.label : r.dates)}</strong>${r.id === 'next' ? '' : `<br /><span class="muted">${escape(r.label.split(' · ')[0])}${r.format ? ` · ${escape(r.format)}` : ''}</span>`}<br /><span class="run-status">${escape(r.status)}</span></span></label>`).join('')}</fieldset><p class="muted">Dates from CfA’s <a href="/calendar" target="_blank" rel="noopener">program calendar</a>. <a href="${program.href}" target="_blank" rel="noopener">About ${escape(program.name)}</a>.</p>` + tuitionFields(a) + (tuitionFor(a.program).length ? `<p class="small">Tuition from the program page, checked ${TUITION_CHECKED}.</p>` : '');
  return html + ttNote;
}
function countryField(a) {
  return `<label for="field-country">Country where you live</label><select id="field-country" name="country" required><option value="" ${a.country ? '' : 'selected'} disabled>Choose one…</option>${COUNTRIES.map(c => `<option ${a.country === c ? 'selected' : ''}>${escape(c)}</option>`).join('')}</select>` + (a.country === 'Another country' ? input('otherCountry','Which country?','text','required maxlength="80" autocomplete="off"') : '');
}
function render(focus = false) {
  const a = state.application; const intl = isInternational(a);
  const titles = ['First, let’s get acquainted.','How much help are you asking for?', intl ? 'Your finances at home.' : 'Your household finances.','Does this look right?'];
  const guides = ['Use a fictional name as you explore. In the live version, your verified email will let you return to this application.',guidance(a), intl ? 'Give these in the currency you are paid in. We know a fair local income can buy very little in US dollars, so tell us what you could actually pay in dollars.' : 'A rough picture is enough for CfA to make a fair decision. Estimates are fine.','You can go back and correct anything. This preview does not score your answers.'];
  document.querySelectorAll('#steps li').forEach((el,i) => { el.textContent = i === 2 && intl ? 'Finances at home' : STEPS[i]; });
  $('step-count').textContent = `Step ${state.step + 1} of 4`;
  $('step-title').textContent = titles[state.step]; $('guide-text').textContent = guides[state.step];
  document.querySelectorAll('#steps li').forEach((el,i) => { el.classList.toggle('current',i===state.step); if(i===state.step) el.setAttribute('aria-current','step'); else el.removeAttribute('aria-current'); });
  $('back').hidden = state.step === 0; $('next').textContent = state.step === 3 ? 'Submit example →' : 'Continue →'; $('form-error').textContent = '';
  if(state.step === 0) $('fields').innerHTML = input('name','Your name','text','required maxlength="120" autocomplete="off"') + input('school','School or organization (optional)','text','maxlength="200" autocomplete="off"') + countryField(a) + programFields(a);
  if(state.step === 1) { const cost = costOf(a); $('fields').innerHTML = (cost ? `<p class="cost-line">Program cost: <strong>${money(cost)}</strong></p>` : '<p class="cost-line">Program cost: <strong>to be confirmed by CfA</strong></p>') + input('aid','How much financial aid are you asking for? (USD)','text',CASH) + select('teacherTraining','Do you intend to pursue Waldorf teacher training?',TEACHER_TRAINING_PLANS); }
  if(state.step === 2) {
    const unit = intl ? (a.currency ? ` (${escape(a.currency)})` : ' (your currency)') : ' (USD)';
    $('fields').innerHTML = select('employment','Are you currently employed?',EMPLOYMENT) + input('household','How many in the family? (optional)','number','min="1" max="50" step="1"')
      + (intl ? input('currency','Which currency are you paid in?','text','required maxlength="60" placeholder="e.g. Mexican peso (MXN)" autocomplete="off"') : '')
      + `<div class="field-row"><div>${input('income',`Monthly family income${unit}`,'text',CASH)}</div><div>${input('expenses',`Monthly family expenses${unit}`,'text',CASH)}</div></div>`
      + input('assets',`Savings, investments and other assets${unit}`,'text',CASH)
      + (intl ? input('payUsd','What could you pay toward the cost in US dollars?','text',CASH) + textarea('exchange','How does the exchange rate affect what you can pay? (optional)') : '')
      + textarea('circumstances','Anything else you wish to share in support of your request? (optional)') + '<p class="muted">Zero is an acceptable answer. No uploads, tax returns or account numbers on this form.</p>';
  }
  if(state.step === 3) $('fields').innerHTML = summary() + `<label><input name="confirmed" type="checkbox" ${a.confirmed ? 'checked' : ''} required />I have reviewed these fictional answers.</label>`;
  if(focus) $('step-title').focus();
}
$('application-form').addEventListener('input',event=>{ const target=event.target; if(!target.name || !(target.name in state.application)) return; state.application[target.name] = target.type === 'checkbox' ? target.checked : MONEY_FIELDS.includes(target.name) ? cleanAmount(target.value) : target.value; if(target.name !== 'confirmed') state.application.confirmed = false; if(target.name === 'program') { state.application.run = ''; state.application.option = ''; render(); $('field-program').focus(); } if(target.name === 'country') { render(); $('field-country').focus(); } save(); if(state.step===1) $('guide-text').textContent = guidance(state.application); });
$('application-form').addEventListener('submit',event=>{ event.preventDefault(); const error=validateStep(state.application,state.step,today); if(error) { $('form-error').textContent=error; return; } if(state.step<3) { state.step++; save(); render(true); } else { state.submitted=true; state.history.push({at:new Date().toISOString(),text:'Applicant submitted this fictional example.'}); save(); show('submitted'); } });
$('back').onclick=()=>{state.step--;save();render(true);};
$('demo-login').onsubmit=event=>{event.preventDefault();$('demo-login').hidden=true;$('demo-verify').hidden=false;$('demo-code').focus();};
$('demo-verify').onsubmit=event=>{event.preventDefault(); if($('demo-code').value!=='123456') { $('login-status').textContent='For this simulation, use 123456.'; return; } $('login-status').textContent='';show(state.submitted?'submitted':'application');render(true);};
$('resume').onclick=()=>{show(state.submitted?'submitted':'application');render(true);};
$('save-exit').onclick=()=>{save();show('welcome');};
$('applicant-tab').onclick=()=>show('welcome');
$('reviewer-tab').onclick=()=>{show('review');renderReview();};
$('see-review').onclick=()=>{show('review');renderReview();};
$('edit-example').onclick=()=>{state.submitted=false;delete state.decision;state.application.confirmed=false;state.step=0;save();show('application');render(true);};
$('load-sample').onclick=()=>{const intl=!isInternational(state.application)&&state.submitted;state={application:intl?sampleInternational():sampleApplication(),step:3,submitted:true,history:[{at:new Date().toISOString(),text:'Fictional example loaded for staff review.'}]};save();renderReview();};
$('reset').onclick=()=>{state={application:emptyApplication(),step:0,submitted:false,history:[]};save();$('demo-login').hidden=false;$('demo-verify').hidden=true;$('demo-code').value='';$('login-status').textContent='';show('welcome');};
function renderReview() {
  const a=state.application; const r=request(a); const { program, run } = chosen(a); const intl=isInternational(a);
  if(!state.submitted) { $('review-content').innerHTML='<div class="card"><h2>No submitted example yet.</h2><p>Complete the applicant walkthrough, or choose “Load fictional example” above to explore a completed application.</p></div>';return; }
  const stats = r ? `<div class="stats"><div class="stat"><span>Program cost</span><strong>${r.cost === null ? 'To confirm' : money(r.cost)}</strong></div><div class="stat gap"><span>Aid requested</span><strong>${money(r.aid)}</strong></div><div class="stat"><span>Applicant would pay</span><strong>${r.share === null ? 'To confirm' : money(r.share)}</strong></div></div>` : '';
  const said = !r ? 'More information is needed.' : r.cost === null ? `The applicant asks for ${money(r.aid)}. Tuition for these dates is not published yet.` : `The applicant asks for ${money(r.aid)} of the ${money(r.cost)} cost (${Math.round(r.percent)}%), leaving ${money(r.share)} for them to pay.`;
  const intlNote = intl ? `<p class="review-notice"><strong>Applicant outside the US (${escape(a.country === 'Another country' ? a.otherCountry : a.country)}).</strong> Income, expenses and assets are in ${escape(a.currency || 'their currency')}, not converted. They say they could pay ${a.payUsd === '' ? 'an unstated amount' : money(a.payUsd)} in US dollars.</p>` : '';
  $('review-content').innerHTML = `<span class="badge">${escape(state.decision || 'Awaiting human review')} · simulation</span><h2>${escape(a.name)}</h2><p class="muted">${escape(program?.name || '')}${run ? ` · ${escape(run.id === 'next' ? 'future session or cohort' : run.dates)} (${escape(run.status)})` : ''}${program ? ` · <a href="${program.href}" target="_blank" rel="noopener">program page</a>` : ''}</p>${stats}${intlNote}<div class="review-grid"><div class="card"><h3>Applicant’s answers</h3>${summary()}</div><div><div class="card"><p class="eyebrow">For review</p><h3>A clear starting point.</h3><p>${said}</p><p class="muted">This is the applicant’s request, not an approved award or a finding of eligibility. Available funds, eligibility rules and program admission still need human review.</p><p class="muted">No approved rubric is loaded. There is no AI-generated recommendation in this version.</p><form id="decision-form"><label for="decision">Example review action</label><select id="decision" required><option value="Request more information">Request more information</option><option value="Recommend an award">Recommend an award</option><option value="Refer for exception review">Refer for exception review</option><option value="Decline with explanation">Decline with explanation</option></select><label for="award">Proposed award (USD; required for an award recommendation)</label><input id="award" type="number" min="0" max="${r?.cost||100000}" step="0.01" /><label for="reason">Reason / next step</label><textarea id="reason" required maxlength="2000" placeholder="Explain the decision and any questions to resolve."></textarea><button class="primary" type="submit">Record example review</button><p id="decision-error" class="error" role="alert"></p></form></div><div class="card" style="margin-top:20px"><h3>Review history</h3><ol class="audit">${state.history.map(h=>`<li><strong>${escape(new Date(h.at).toLocaleString())}</strong><br />${escape(h.text)}</li>`).join('')}</ol><p class="small">Demo history stays in this tab. No award, email, enrollment, or accounting entry is created.</p></div></div></div>`;
  $('decision').onchange=()=>{$('award').required=$('decision').value==='Recommend an award';};
  $('decision-form').onsubmit=event=>{event.preventDefault();const decision=$('decision').value;const reason=$('reason').value.trim();const award=$('award').value; if(!reason || (decision==='Recommend an award' && (award===''||Number(award)<=0))) { $('decision-error').textContent='Please provide a reason and, for an award recommendation, a positive amount.';return; } state.decision=decision;state.history.push({at:new Date().toISOString(),text:`${decision}${decision==='Recommend an award'?` of ${money(award)}`:''}. ${reason}`});save();renderReview();};
}
show('welcome');
