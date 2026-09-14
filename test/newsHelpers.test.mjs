import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeEditions, indexPosts } from '../src/data/newsHelpers.js';

const post = (slug, { title = slug, date = '2026-09-14', body = '', unlisted } = {}) => ({
  body,
  data: unlisted === undefined ? { slug, title, date } : { slug, title, date, unlisted },
});

const editionBody = (...slugs) =>
  slugs.map((s) => `**[${s}](/news/${s})**\n\n[Read More »](/news/${s})`).join('\n\n');

test('an unlisted edition is absent from the listings but still readable', () => {
  const posts = [
    post('center-periphery-newsletter-fall-2026', {
      unlisted: true,
      body: editionBody('i-cant-breathe', 'from-our-friends-in-brazil'),
    }),
    post('i-cant-breathe', { unlisted: true }),
    post('from-our-friends-in-brazil', { unlisted: true }),
    post('a-standalone-announcement', { date: '2026-08-01' }),
  ];

  const listed = indexPosts(posts).map((i) => i.post.data.slug);
  assert.deepEqual(listed, ['a-standalone-announcement']);

  // the edition itself is still assembled, so each article page renders its
  // sidebar table of contents and every /news/<slug> link resolves
  const { editions, memberOf } = analyzeEditions(posts);
  assert.equal(editions['center-periphery-newsletter-fall-2026'].articles.length, 2);
  assert.equal(memberOf['i-cant-breathe'], 'center-periphery-newsletter-fall-2026');
});

test('dropping the flag is all it takes to publish the edition', () => {
  const posts = [
    post('center-periphery-newsletter-fall-2026', {
      body: editionBody('i-cant-breathe', 'from-our-friends-in-brazil'),
    }),
    post('i-cant-breathe'),
    post('from-our-friends-in-brazil'),
    post('a-standalone-announcement', { date: '2026-08-01' }),
  ];

  const listed = indexPosts(posts);
  assert.deepEqual(
    listed.map((i) => i.post.data.slug),
    ['center-periphery-newsletter-fall-2026', 'a-standalone-announcement'],
  );
  // it lists as an edition, which is what puts it on the Center & Periphery page
  assert.equal(listed[0].articleCount, 2);
  assert.equal(listed[0].firstArticle, 'i-cant-breathe');
});

test('an unlisted post that belongs to no edition is still left out', () => {
  const posts = [post('quiet-notice', { unlisted: true }), post('loud-notice')];
  assert.deepEqual(indexPosts(posts).map((i) => i.post.data.slug), ['loud-notice']);
});
