-- Staged only. Apply to the dedicated CfA learning environment after review.

create table public.cfa_learn_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  contact_id uuid,
  display_name text,
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.cfa_learn_courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  former_name text,
  subtitle text,
  cohort text,
  facilitator text,
  image_url text,
  source_system text,
  source_course_id text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.cfa_learn_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.cfa_learn_courses(id) on delete cascade,
  source text not null check (source in ('payment', 'institution', 'scholarship', 'manual', 'migration')),
  source_reference text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create table public.cfa_learn_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.cfa_learn_courses(id) on delete cascade,
  slug text not null,
  position integer not null check (position > 0),
  presenter text,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  zoom_url text,
  mux_playback_id text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, course_id),
  unique (course_id, slug),
  unique (course_id, position)
);

create table public.cfa_learn_resources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.cfa_learn_courses(id) on delete cascade,
  session_id uuid,
  title text not null,
  kind text not null check (kind in ('page', 'file', 'external_link')),
  body text,
  storage_path text,
  external_url text,
  position integer not null default 1 check (position > 0),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (session_id, course_id)
    references public.cfa_learn_sessions(id, course_id)
    on delete cascade
);

create table public.cfa_learn_email_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.cfa_learn_enrollments(id) on delete cascade,
  message_type text not null check (message_type in ('welcome', 'session_reminder', 'course_update')),
  provider_message_id text,
  status text not null check (status in ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index cfa_learn_enrollments_user_idx on public.cfa_learn_enrollments(user_id);
create index cfa_learn_sessions_course_idx on public.cfa_learn_sessions(course_id, position);
create index cfa_learn_resources_course_idx on public.cfa_learn_resources(course_id, position);
create index cfa_learn_email_events_enrollment_idx on public.cfa_learn_email_events(enrollment_id, created_at desc);

alter table public.cfa_learn_profiles enable row level security;
alter table public.cfa_learn_courses enable row level security;
alter table public.cfa_learn_enrollments enable row level security;
alter table public.cfa_learn_sessions enable row level security;
alter table public.cfa_learn_resources enable row level security;
alter table public.cfa_learn_email_events enable row level security;

-- Learners use a verified Edge Function that returns a projected course payload.
-- RLS remains as defense in depth if direct table grants are introduced later.
revoke all on table public.cfa_learn_profiles from anon, authenticated;
revoke all on table public.cfa_learn_courses from anon, authenticated;
revoke all on table public.cfa_learn_enrollments from anon, authenticated;
revoke all on table public.cfa_learn_sessions from anon, authenticated;
revoke all on table public.cfa_learn_resources from anon, authenticated;
revoke all on table public.cfa_learn_email_events from anon, authenticated;

create or replace function public.cfa_learn_has_access(requested_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cfa_learn_enrollments enrollment
    join public.cfa_learn_courses course on course.id = enrollment.course_id
    where enrollment.course_id = requested_course_id
      and course.published
      and enrollment.user_id = auth.uid()
      and enrollment.starts_at <= now()
      and (enrollment.expires_at is null or enrollment.expires_at > now())
      and enrollment.revoked_at is null
  );
$$;

revoke all on function public.cfa_learn_has_access(uuid) from public;
grant execute on function public.cfa_learn_has_access(uuid) to authenticated;

create policy "Learners read their profile"
on public.cfa_learn_profiles for select
to authenticated
using (user_id = auth.uid());

create policy "Learners read their enrollments"
on public.cfa_learn_enrollments for select
to authenticated
using (user_id = auth.uid());

create policy "Enrolled learners read courses"
on public.cfa_learn_courses for select
to authenticated
using (published and public.cfa_learn_has_access(id));

create policy "Enrolled learners read sessions"
on public.cfa_learn_sessions for select
to authenticated
using (published and public.cfa_learn_has_access(course_id));

create policy "Enrolled learners read resources"
on public.cfa_learn_resources for select
to authenticated
using (published and public.cfa_learn_has_access(course_id));

create policy "Learners read their email history"
on public.cfa_learn_email_events for select
to authenticated
using (
  exists (
    select 1
    from public.cfa_learn_enrollments enrollment
    where enrollment.id = enrollment_id
      and enrollment.user_id = auth.uid()
  )
);

insert into public.cfa_learn_courses (
  slug,
  title,
  former_name,
  subtitle,
  cohort,
  facilitator,
  image_url,
  source_system,
  source_course_id,
  published
) values (
  'ignite',
  'Ignite',
  'Starlight Rays in Darkened Times',
  'Contemporary questions in Waldorf education',
  '2026-2027 Seminar Series',
  'David Barham, M.Ed.',
  '/images/posts/e54997f7cf-thechallengeofinnerbalancehorizontal1.jpg',
  'thinkific',
  '3357450',
  false
);

insert into public.cfa_learn_sessions (
  course_id,
  slug,
  position,
  presenter,
  title,
  starts_at,
  ends_at,
  published
)
select
  course.id,
  session.slug,
  session.position,
  session.presenter,
  session.title,
  session.starts_at,
  session.ends_at,
  false
from public.cfa_learn_courses course
cross join (
  values
    (
      'methods',
      1,
      'Dr. Martyn Rawson',
      'Steiner Frequently Called the Waldorf School a Method School. Oh Really? Which Methods Are Those?',
      '2026-09-05 15:00:00-04'::timestamptz,
      '2026-09-05 16:30:00-04'::timestamptz
    ),
    (
      'student-leadership',
      2,
      'Vicki Larson and Heather Scott',
      'Stepping Into Life: Cultivating Student Leadership',
      '2026-09-26 15:00:00-04'::timestamptz,
      '2026-09-26 16:30:00-04'::timestamptz
    ),
    (
      'lower-school',
      3,
      'Carol Bärtges',
      'What Have They Been Doing in the Lower School?',
      '2026-10-10 15:00:00-04'::timestamptz,
      '2026-10-10 16:30:00-04'::timestamptz
    ),
    (
      'sensory-diet',
      4,
      'Dr. Adam Blanning',
      'What Does a Healthy Sensory Diet Look Like for the Modern Adolescent?',
      '2026-10-31 15:00:00-04'::timestamptz,
      '2026-10-31 16:30:00-04'::timestamptz
    ),
    (
      'burnout',
      5,
      'Alison Davis',
      'Let''s Get Real About Burnout',
      '2026-11-07 15:00:00-05'::timestamptz,
      '2026-11-07 16:30:00-05'::timestamptz
    ),
    (
      'spirit',
      6,
      'Sven Saar',
      'Does Spirit Matter?',
      '2026-11-21 15:00:00-05'::timestamptz,
      '2026-11-21 16:30:00-05'::timestamptz
    ),
    (
      'true-equality',
      7,
      'Cedar Oliver',
      '“True Equality”: How and Why We Sort Our Students',
      '2026-12-12 15:00:00-05'::timestamptz,
      '2026-12-12 16:30:00-05'::timestamptz
    ),
    (
      'citizenship',
      8,
      'Dr. Constanza Kaliks',
      'Citizenship and the Search for Knowledge on the Human Being as Fundamentals for the Teachers'' Work',
      '2026-12-19 15:00:00-05'::timestamptz,
      '2026-12-19 16:30:00-05'::timestamptz
    ),
    (
      'generations',
      9,
      'Liz Beaven',
      'Talkin’ ’bout My Generation',
      '2027-01-09 15:00:00-05'::timestamptz,
      '2027-01-09 16:30:00-05'::timestamptz
    ),
    (
      'ninth-grade',
      10,
      'Nathan Wilcox',
      'Solid Foundations: The Three Critical Skills Every Ninth Grader Needs, and How to Teach Them',
      '2027-01-23 15:00:00-05'::timestamptz,
      '2027-01-23 16:30:00-05'::timestamptz
    ),
    (
      'systemic-change',
      11,
      'Beverly Amico',
      'Education in a Time of Systemic Change: Trends, Challenges, and Possibilities for Waldorf Schools',
      '2027-02-13 15:00:00-05'::timestamptz,
      '2027-02-13 16:30:00-05'::timestamptz
    ),
    (
      'social-impulses',
      12,
      'David Barham',
      'Instilling Social Impulses in an Antisocial Age',
      '2027-02-27 15:00:00-05'::timestamptz,
      '2027-02-27 16:30:00-05'::timestamptz
    )
) as session(slug, position, presenter, title, starts_at, ends_at)
where course.slug = 'ignite';
