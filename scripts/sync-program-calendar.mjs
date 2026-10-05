#!/usr/bin/env node
// Refresh src/data/program-calendar.json from Caitlin's "CfA Programs and Events"
// Google Calendar. Only public run dates are written (isPublic in
// src/lib/program-calendar.js), minus anything her notes say to confirm (isHeld);
// internal entries and event descriptions never reach this repository.
//
//   node scripts/sync-program-calendar.mjs                 # live: Google Calendar API
//   node scripts/sync-program-calendar.mjs --from raw.json # offline: a saved event list
//
// Live mode needs a Google service account allowed to read the calendar:
//   GOOGLE_SA_JSON   path to the service-account key file (never committed)
//   GOOGLE_SA_SUBJECT  Workspace user to impersonate (domain-wide delegation with the
//                      calendar.readonly scope), or unset if the calendar is shared
//                      with the service account directly.
import { readFileSync, writeFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { publicEvents } from '../src/lib/program-calendar.js';

export const CALENDAR_ID = 'c_ce3389186d8654df7bf71697589899840e805bfa218fb5b3d824424574193b05@group.calendar.google.com';
const OUT = new URL('../src/data/program-calendar.json', import.meta.url);

async function token() {
  const key = JSON.parse(readFileSync(process.env.GOOGLE_SA_JSON, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = { iss: key.client_email, scope: 'https://www.googleapis.com/auth/calendar.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  if (process.env.GOOGLE_SA_SUBJECT) claims.sub = process.env.GOOGLE_SA_SUBJECT;
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).access_token;
}

async function live() {
  const auth = await token();
  const events = [];
  let page = '';
  const since = new Date(Date.now() - 86400000).toISOString();
  do {
    const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: since, maxResults: '250', ...(page && { pageToken: page }) });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${q}`, { headers: { authorization: `Bearer ${auth}` } });
    if (!res.ok) throw new Error(`events ${res.status}`);
    const body = await res.json();
    for (const e of body.items ?? []) {
      if (e.status === 'cancelled' || e.visibility === 'private') continue;
      events.push({ title: e.summary ?? '', start: e.start.dateTime ?? e.start.date, end: e.end.dateTime ?? e.end.date, description: e.description ?? '' });
    }
    page = body.nextPageToken ?? '';
  } while (page);
  return events;
}

const from = process.argv.indexOf('--from');
const raw = from > -1 ? JSON.parse(readFileSync(process.argv[from + 1], 'utf8')) : await live();
const events = publicEvents(raw)
  .map(({ title, start, end }) => ({ title, start, end }))
  .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
writeFileSync(OUT, JSON.stringify({ source: 'CfA Programs and Events (Google Calendar)', synced: new Date().toISOString(), events }, null, 1) + '\n');
console.log(`kept ${events.length} of ${raw.length} events`);
