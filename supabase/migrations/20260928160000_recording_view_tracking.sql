-- Recording view tracking (Sage, 2026-09-28). Certificates count at least 80% of sessions,
-- and many participants watch the recording instead of joining live. Until now a recording
-- view could not be tied to a person: the playback function checked the enrollment but kept
-- no record, and the Mux player sent anonymous views to Mux Data.
--
-- Two sources from here on:
--   1. this table: one row every time an enrolled person is issued a recording's playback
--      token (they opened the recording), written by cfa-learn-playback;
--   2. Mux Data: the player now tags each view with viewer_user_id = enrollment id and
--      video_id = session id, so watch time per person comes from the Mux Data API.
-- Views before this migration stay anonymous.

create table public.cfa_learn_playback_events (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  session_id uuid not null references public.cfa_learn_sessions(id) on delete cascade,
  contact_id uuid,
  requested_at timestamptz not null default now()
);

create index cfa_learn_playback_events_enrollment_session_idx
  on public.cfa_learn_playback_events (enrollment_id, session_id);
create index cfa_learn_playback_events_session_idx
  on public.cfa_learn_playback_events (session_id, requested_at);

alter table public.cfa_learn_playback_events enable row level security;
revoke all on table public.cfa_learn_playback_events from public, anon, authenticated;

comment on table public.cfa_learn_playback_events is
  'One row per recording playback token issued to an enrolled person. Service-role only. Watch time lives in Mux Data (viewer_user_id = enrollment id).';
