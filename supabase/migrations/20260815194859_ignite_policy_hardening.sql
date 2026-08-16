create schema if not exists cfa_private;

revoke all on schema cfa_private from public, anon, authenticated;
grant usage on schema cfa_private to authenticated;

alter function public.cfa_learn_has_access(uuid) set schema cfa_private;
alter function cfa_private.cfa_learn_has_access(uuid) set search_path = '';

revoke all on function cfa_private.cfa_learn_has_access(uuid) from public, anon;
grant execute on function cfa_private.cfa_learn_has_access(uuid) to authenticated;

create index cfa_learn_enrollments_course_idx
  on public.cfa_learn_enrollments(course_id);

create index cfa_learn_resources_session_course_idx
  on public.cfa_learn_resources(session_id, course_id);

drop policy "Learners read their profile" on public.cfa_learn_profiles;
create policy "Learners read their profile"
on public.cfa_learn_profiles for select
to authenticated
using (user_id = (select auth.uid()));

drop policy "Learners read their enrollments" on public.cfa_learn_enrollments;
create policy "Learners read their enrollments"
on public.cfa_learn_enrollments for select
to authenticated
using (user_id = (select auth.uid()));

drop policy "Learners read their email history" on public.cfa_learn_email_events;
create policy "Learners read their email history"
on public.cfa_learn_email_events for select
to authenticated
using (
  exists (
    select 1
    from public.cfa_learn_enrollments enrollment
    where enrollment.id = enrollment_id
      and enrollment.user_id = (select auth.uid())
  )
);
