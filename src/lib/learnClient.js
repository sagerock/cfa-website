import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ckloewflialohuvixmvd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_59zXVlf7rTMrP3vC3aghPA_4rzgbjGU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export async function getCoursePayload(slug = 'starlight-rays-2026-2027') {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return { status: 'signed_out' };

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/cfa-learn-course?slug=${encodeURIComponent(slug)}`,
    {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      cache: 'no-store',
    },
  );

  const body = await response.json().catch(() => ({}));
  if (response.status === 401) return { status: 'signed_out' };
  if (response.status === 403) return { status: 'forbidden' };
  if (!response.ok) return { status: 'error', error: body.error || 'course_request_failed' };
  return { status: 'ok', data: body };
}

export async function getPlaybackTokens(slug, sessionId) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return { status: 'signed_out' };

  const params = new URLSearchParams({ slug, session: sessionId });
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/cfa-learn-playback?${params}`,
    {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      cache: 'no-store',
    },
  );

  const body = await response.json().catch(() => ({}));
  if (response.status === 401) return { status: 'signed_out' };
  if (response.status === 403) return { status: 'forbidden' };
  if (!response.ok) return { status: 'error', error: body.error || 'playback_request_failed' };
  return { status: 'ok', data: body };
}

export async function getMyCourses() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return { status: 'signed_out' };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/cfa-learn-courses`, {
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    cache: 'no-store',
  });

  const body = await response.json().catch(() => ({}));
  if (response.status === 401) return { status: 'signed_out' };
  if (!response.ok) return { status: 'error', error: body.error || 'courses_request_failed' };
  return { status: 'ok', data: body };
}

// Builds text with clickable web addresses and email addresses, without
// innerHTML: course copy comes from the database and is treated as plain text.
export function appendLinkedText(parent, text) {
  const pattern = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"’”]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const link = document.createElement('a');
    const value = match[0];
    if (value.includes('@') && !value.startsWith('http')) {
      link.href = `mailto:${value}`;
    } else {
      link.href = value;
      link.target = '_blank';
      link.rel = 'noopener';
    }
    link.textContent = value;
    parent.append(link);
    last = match.index + value.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}
