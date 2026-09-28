// Builds the signed Mux Player iframe URL for a private recording. The metadata tags
// (2026-09-28) tie each Mux Data view to an enrollment and a session, so recording watch
// time can count toward certificate attendance. viewer_id is an opaque enrollment id: no
// name or email ever goes to Mux.
export function muxPlayerUrl({ playbackId, tokens, viewerId, sessionId, title }) {
  const params = new URLSearchParams({
    'playback-token': tokens.video,
    'thumbnail-token': tokens.thumbnail,
    'storyboard-token': tokens.storyboard,
  });
  if (viewerId) params.set('metadata-viewer-user-id', viewerId);
  if (sessionId) params.set('metadata-video-id', sessionId);
  if (title) params.set('metadata-video-title', title);
  return `https://player.mux.com/${encodeURIComponent(playbackId)}?${params}`;
}
