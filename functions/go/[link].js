// Tracked go-links (Sage 2026-11-17). learn.*/go/<link>?from=<source> logs one anonymous click
// in cfa_link_clicks (link, source, device kind, time; no names, no IP) and redirects.
// First use: Thinkific's Explorations class page, to see how many students still join from there.
// The key below is the public anon key (same as src/lib/learnClient.js); RLS allows insert only.
const SUPABASE_URL = 'https://ckloewflialohuvixmvd.supabase.co';
const ANON_KEY = 'sb_publishable_59zXVlf7rTMrP3vC3aghPA_4rzgbjGU';

const LINKS = {
  // Same target the class page used before; centerforanthroposophy.org/zoomroom2 stays the source of truth.
  'explorations-class': 'https://centerforanthroposophy.org/zoomroom2',
};

function deviceKind(ua) {
  if (!ua) return 'unknown';
  if (/bot|crawl|spider|preview|slurp|facebookexternalhit/i.test(ua)) return 'bot';
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function onRequest(context) {
  const link = String(context.params.link || '');
  const target = LINKS[link];
  if (!target) return new Response('Not found', { status: 404 });
  const url = new URL(context.request.url);
  const source = (url.searchParams.get('from') || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const device = deviceKind(context.request.headers.get('user-agent') || '');
  if (context.request.method === 'GET' && device !== 'bot') {
    context.waitUntil(fetch(`${SUPABASE_URL}/rest/v1/cfa_link_clicks`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ link, source, device }),
    }).catch(() => {}));
  }
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}
