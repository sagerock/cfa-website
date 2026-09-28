import assert from 'node:assert/strict';
import test from 'node:test';
import { muxPlayerUrl } from '../src/lib/muxPlayerUrl.js';

const tokens = { video: 'v.tok', thumbnail: 't.tok', storyboard: 's.tok' };

test('carries the three signed tokens and the viewer/session tags', () => {
  const url = new URL(muxPlayerUrl({
    playbackId: 'abc123',
    tokens,
    viewerId: 'enr-1',
    sessionId: 'ses-9',
    title: 'Stepping Into Life: Cultivating Student Leadership',
  }));
  assert.equal(url.origin + url.pathname, 'https://player.mux.com/abc123');
  assert.equal(url.searchParams.get('playback-token'), 'v.tok');
  assert.equal(url.searchParams.get('thumbnail-token'), 't.tok');
  assert.equal(url.searchParams.get('storyboard-token'), 's.tok');
  assert.equal(url.searchParams.get('metadata-viewer-user-id'), 'enr-1');
  assert.equal(url.searchParams.get('metadata-video-id'), 'ses-9');
  assert.equal(url.searchParams.get('metadata-video-title'), 'Stepping Into Life: Cultivating Student Leadership');
});

test('still plays when the function is older and returns no viewer id', () => {
  const url = new URL(muxPlayerUrl({ playbackId: 'abc123', tokens, sessionId: 'ses-9' }));
  assert.equal(url.searchParams.get('playback-token'), 'v.tok');
  assert.equal(url.searchParams.has('metadata-viewer-user-id'), false);
});

test('encodes token characters safely', () => {
  const url = new URL(muxPlayerUrl({ playbackId: 'a/b', tokens: { ...tokens, video: 'x+y=z&q' } }));
  assert.equal(url.pathname, '/a%2Fb');
  assert.equal(url.searchParams.get('playback-token'), 'x+y=z&q');
});
