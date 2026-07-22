// Shared logic for the Center & Periphery newsletter structure.
// An "edition" is a newsletter post that links to its member articles
// (each article belongs to exactly one edition — verified across the archive).

const EDITION_RE = /newsletter|periphery/i;

export function analyzeEditions(posts) {
  const bySlug = Object.fromEntries(posts.map((p) => [p.data.slug, p]));
  const editions = {}; // slug -> { slug, title, date, articles: [{slug,title}] }

  for (const p of posts) {
    if (!EDITION_RE.test(p.data.slug)) continue;
    const seen = new Map();
    for (const m of (p.body || '').matchAll(/\[([^\]]+)\]\(\/news\/([a-z0-9-]+)\)/g)) {
      const label = m[1].trim(), slug = m[2];
      if (slug === p.data.slug || !bySlug[slug]) continue;
      if (!seen.has(slug) || (/read more/i.test(seen.get(slug)) && !/read more/i.test(label)))
        seen.set(slug, label);
    }
    if (seen.size >= 2) {
      editions[p.data.slug] = {
        slug: p.data.slug,
        title: p.data.title,
        date: p.data.date,
        articles: [...seen].map(([slug, title]) => ({
          slug,
          title: bySlug[slug]?.data.title || title,
        })),
      };
    }
  }

  // article slug -> its edition's slug (most recent edition wins on any tie)
  const memberOf = {};
  for (const ed of Object.values(editions))
    for (const a of ed.articles)
      if (!memberOf[a.slug] || ed.date > editions[memberOf[a.slug]].date)
        memberOf[a.slug] = ed.slug;

  return { editions, memberOf };
}

/** Posts for the news index: editions + standalone posts (member articles fold
    into their edition). Returns [{ post, articleCount }] sorted newest first. */
export function indexPosts(posts) {
  const { editions, memberOf } = analyzeEditions(posts);
  return posts
    .filter((p) => !memberOf[p.data.slug])
    .sort((a, b) => b.data.date.localeCompare(a.data.date))
    .map((post) => ({
      post,
      articleCount: editions[post.data.slug]?.articles.length ?? 0,
    }));
}
