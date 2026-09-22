-- STAGED ONLY: deploy to a test database and verify RLS before enabling intake.
-- No programs or reviewers are seeded. No financial/enrollment records are changed.
create table public.cfa_scholarship_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tuition_cents bigint not null check (tuition_cents >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  intake_open boolean not null default false,
  policy_version text not null,
  created_at timestamptz not null default now()
);
create table public.cfa_scholarship_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.cfa_scholarship_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.cfa_scholarship_programs(id),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 20000),
  status text not null default 'draft' check (status in ('draft','submitted')),
  revision integer not null default 1,
  policy_version text,
  tuition_cents bigint,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, program_id)
);
create table public.cfa_scholarship_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.cfa_scholarship_applications(id),
  reviewer_id uuid not null references auth.users(id),
  action text not null check (action in ('request_information','recommend_award','refer_exception','decline')),
  proposed_cents bigint check (proposed_cents > 0),
  reason text not null check (length(trim(reason)) between 1 and 3000),
  created_at timestamptz not null default now(),
  check ((action = 'recommend_award') = (proposed_cents is not null))
);
create table public.cfa_scholarship_signin_limits (
  email_hash text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);

alter table public.cfa_scholarship_programs enable row level security;
alter table public.cfa_scholarship_reviewers enable row level security;
alter table public.cfa_scholarship_applications enable row level security;
alter table public.cfa_scholarship_reviews enable row level security;
alter table public.cfa_scholarship_signin_limits enable row level security;
revoke all on public.cfa_scholarship_programs, public.cfa_scholarship_reviewers, public.cfa_scholarship_applications, public.cfa_scholarship_reviews, public.cfa_scholarship_signin_limits from anon, authenticated;
grant select on public.cfa_scholarship_programs, public.cfa_scholarship_reviewers, public.cfa_scholarship_applications, public.cfa_scholarship_reviews to authenticated;
grant all on public.cfa_scholarship_programs, public.cfa_scholarship_reviewers, public.cfa_scholarship_applications, public.cfa_scholarship_reviews, public.cfa_scholarship_signin_limits to service_role;
create policy scholarship_program_read on public.cfa_scholarship_programs for select to authenticated using (intake_open or exists(select 1 from public.cfa_scholarship_reviewers where user_id = auth.uid()));
create policy scholarship_reviewer_self on public.cfa_scholarship_reviewers for select to authenticated using (user_id = auth.uid());
create policy scholarship_application_read on public.cfa_scholarship_applications for select to authenticated using (user_id = auth.uid() or (status = 'submitted' and exists(select 1 from public.cfa_scholarship_reviewers where user_id = auth.uid())));
-- Reviewer notes remain internal. Applicant-facing messages need a separate release step.
create policy scholarship_review_read on public.cfa_scholarship_reviews for select to authenticated using (exists(select 1 from public.cfa_scholarship_reviewers where user_id = auth.uid()));

create function public.cfa_scholarship_save(p_program uuid, p_answers jsonb, p_revision integer default 0, p_submit boolean default false)
returns public.cfa_scholarship_applications language plpgsql security definer set search_path = '' as $$
declare a public.cfa_scholarship_applications; p public.cfa_scholarship_programs; k text; monthly numeric; months integer; support numeric;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into p from public.cfa_scholarship_programs where id=p_program and intake_open;
  if not found then raise exception 'Intake closed'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text)>20000 then raise exception 'Invalid answers'; end if;
  for k in select jsonb_object_keys(p_answers) loop
    if k not in ('name','school','monthly','months','support','household','income','circumstances','purpose','confirmed') then raise exception 'Unexpected answer'; end if;
    if k <> 'confirmed' and jsonb_typeof(p_answers->k) <> 'string' then raise exception 'Answers must be text'; end if;
    if length(p_answers->>k)>3000 then raise exception 'Answer too long'; end if;
  end loop;
  if p_submit then
    if coalesce(length(trim(p_answers->>'name')),0)=0 or p_answers->'confirmed' is distinct from 'true'::jsonb then raise exception 'Review and confirm answers'; end if;
    if coalesce(p_answers->>'monthly','') !~ '^\d{1,6}(\.\d{1,2})?$' or coalesce(p_answers->>'support','') !~ '^\d{1,7}(\.\d{1,2})?$' or coalesce(p_answers->>'months','') !~ '^\d{1,2}$' then raise exception 'Invalid contribution'; end if;
    monthly := (p_answers->>'monthly')::numeric; months := (p_answers->>'months')::integer; support := (p_answers->>'support')::numeric;
    if months < 1 or months > 24 then raise exception 'Invalid payment term'; end if;
  end if;
  -- Serialize create/update per applicant/program; optimistic revision stops silent overwrites.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || p_program::text, 0));
  select * into a from public.cfa_scholarship_applications where user_id=auth.uid() and program_id=p_program for update;
  if found then
    if a.status <> 'draft' then raise exception 'Submitted applications are locked'; end if;
    if a.revision <> p_revision then raise exception 'Application changed; reload before saving'; end if;
    update public.cfa_scholarship_applications set answers=p_answers, status=case when p_submit then 'submitted' else 'draft' end,
      revision=revision+1, updated_at=now(), policy_version=case when p_submit then p.policy_version else null end,
      tuition_cents=case when p_submit then p.tuition_cents else null end, submitted_at=case when p_submit then now() else null end
      where id=a.id returning * into a;
  else
    if p_revision <> 0 then raise exception 'Application missing; reload'; end if;
    insert into public.cfa_scholarship_applications(user_id,program_id,answers,status,policy_version,tuition_cents,submitted_at)
      values(auth.uid(),p_program,p_answers,case when p_submit then 'submitted' else 'draft' end,
        case when p_submit then p.policy_version else null end,case when p_submit then p.tuition_cents else null end,case when p_submit then now() else null end) returning * into a;
  end if;
  return a;
end $$;

create function public.cfa_scholarship_record_review(p_application uuid, p_action text, p_reason text, p_proposed_cents bigint default null)
returns public.cfa_scholarship_reviews language plpgsql security definer set search_path = '' as $$
declare a public.cfa_scholarship_applications; r public.cfa_scholarship_reviews;
begin
  if auth.uid() is null or not exists(select 1 from public.cfa_scholarship_reviewers where user_id=auth.uid()) then raise exception 'Reviewer access required'; end if;
  select * into a from public.cfa_scholarship_applications where id=p_application and status='submitted';
  if not found then raise exception 'Submitted application required'; end if;
  if a.user_id=auth.uid() then raise exception 'A reviewer cannot review their own application'; end if;
  if p_proposed_cents > a.tuition_cents then raise exception 'Proposed award exceeds tuition'; end if;
  insert into public.cfa_scholarship_reviews(application_id,reviewer_id,action,proposed_cents,reason) values(a.id,auth.uid(),p_action,p_proposed_cents,p_reason) returning * into r;
  return r;
end $$;

create function public.cfa_scholarship_claim_signin(p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if length(p_hash) <> 64 then raise exception 'Invalid hash'; end if;
  insert into public.cfa_scholarship_signin_limits(email_hash) values(p_hash)
  on conflict(email_hash) do update set
    attempts=case when cfa_scholarship_signin_limits.window_start < now()-interval '15 minutes' then 1 else cfa_scholarship_signin_limits.attempts+1 end,
    window_start=case when cfa_scholarship_signin_limits.window_start < now()-interval '15 minutes' then now() else cfa_scholarship_signin_limits.window_start end
  returning attempts into n;
  return n<=3;
end $$;
revoke all on function public.cfa_scholarship_save(uuid,jsonb,integer,boolean), public.cfa_scholarship_record_review(uuid,text,text,bigint), public.cfa_scholarship_claim_signin(text) from public,anon,authenticated;
grant execute on function public.cfa_scholarship_save(uuid,jsonb,integer,boolean), public.cfa_scholarship_record_review(uuid,text,text,bigint) to authenticated;
grant execute on function public.cfa_scholarship_claim_signin(text) to service_role;
