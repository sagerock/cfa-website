const NEWS_HOST = 'news.centerforanthroposophy.org';
const LIVE_SITE = 'https://centerforanthroposophy.org';

const NEWS_PATHS = [
  '/center-periphery',
  '/news',
  '/_astro/',
  '/images/',
  '/files/',
  '/tags.js',
];

function isNewsPath(pathname) {
  return NEWS_PATHS.some((path) =>
    path.endsWith('/') ? pathname.startsWith(path) : pathname === path || pathname.startsWith(`${path}/`)
  );
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === NEWS_HOST) {
    if (url.pathname === '/') {
      return Response.redirect(`${url.origin}/center-periphery/`, 302);
    }

    if (url.pathname === '/robots.txt') {
      return new Response(
        'User-agent: *\nAllow: /center-periphery/\nAllow: /news/\nDisallow: /\n',
        { headers: { 'content-type': 'text/plain; charset=UTF-8' } },
      );
    }

    if (!isNewsPath(url.pathname)) {
      return Response.redirect(`${LIVE_SITE}${url.pathname}${url.search}`, 302);
    }

    return context.next();
  }

  const response = await context.next();
  const guarded = new Response(response.body, response);
  guarded.headers.set('X-Robots-Tag', 'noindex');
  return guarded;
}
