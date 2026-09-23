// Subscribe feed for the program calendar. All-day events, one per session, so
// no time-zone conversion can shift a date; the class time is in the description.
// Current-students-only runs are left out: subscribers want what they can join.
import { CALENDAR, STATUS_LABEL } from '../data/calendar.js';

const SITE = 'https://learn.centerforanthroposophy.org';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const ymd = (iso) => iso.replace(/-/g, '');
const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
// RFC 5545 lines are limited to 75 octets; continuation lines start with a space.
const fold = (line) => {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = ' ' + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
};
const url = (u) => (u.startsWith('http') ? u : SITE + u);

export function GET() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Center for Anthroposophy//Program Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Center for Anthroposophy Programs',
    'X-WR-CALDESC:Upcoming programs at the Center for Anthroposophy',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
  ];
  for (const e of CALENDAR) {
    if (e.status === 'cohort') continue;
    e.sessions.forEach((s, i) => {
      const desc = [
        s.note,
        e.time,
        e.format,
        STATUS_LABEL[e.status],
        s.tentative ? 'Dates tentative' : null,
        e.summary,
        e.register ? `Register: ${url(e.register)}` : null,
        `Details: ${url(e.href)}`,
      ].filter(Boolean).join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.id}-${i + 1}@centerforanthroposophy.org`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(s.date)}`,
        `DTEND;VALUE=DATE:${ymd(nextDay(s.end ?? s.date))}`,
        `SUMMARY:${esc(s.tentative ? `${e.title} (tentative)` : e.title)}`,
        `DESCRIPTION:${esc(desc)}`,
        `LOCATION:${esc(e.format)}`,
        `URL:${url(e.href)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    });
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
}
