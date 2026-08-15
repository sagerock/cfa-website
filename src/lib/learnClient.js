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

export async function getCoursePayload(slug = 'ignite') {
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
