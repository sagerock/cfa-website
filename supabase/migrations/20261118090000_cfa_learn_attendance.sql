-- Student self-view attendance (Milan approved 2026-11-17, "Re: Today's class"; Jax item #4141).
-- Additive only. Written nightly by the cfaattendance export from Zoom reports matched to rosters;
-- unmatched Zoom names are never written. Read only through the cfa-learn-attendance function
-- (service role), which filters to the signed-in student's own email.
create table if not exists public.cfa_learn_attendance (
  id bigserial primary key,
  email text not null,                 -- registration email, lower-case
  cohort text not null,                -- e.g. 'explorations-fall-2026-2027'
  cohort_title text not null,
  session_date date not null,
  minutes integer not null default 0,
  status text not null check (status in ('present','partial','absent','excused')),
  updated_at timestamptz not null default now(),
  unique (email, cohort, session_date)
);
create index if not exists cfa_learn_attendance_email_idx on public.cfa_learn_attendance (lower(email));

-- One row per class actually held, so a student with no Zoom minutes still sees the date as absent.
create table if not exists public.cfa_learn_attendance_sessions (
  cohort text not null,
  session_date date not null,
  label text,
  primary key (cohort, session_date)
);

alter table public.cfa_learn_attendance enable row level security;
alter table public.cfa_learn_attendance_sessions enable row level security;
-- No policies: anon/authenticated get nothing; the edge function uses the service role.
