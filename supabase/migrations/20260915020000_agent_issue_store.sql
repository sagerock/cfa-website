-- Shared coordination state for agents working the same client issues.
--
-- Email remains the human interface; this store gives inbox responders, desk
-- sessions, and routines one atomic lease and one append-only history. It sits
-- beside customer data without changing contacts, registrations, or programs.
-- All access is through service-role-only security-definer RPCs.

create table public.agent_issues (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  key text not null,
  title text not null,
  summary text not null,
  status text not null default 'open'
    constraint agent_issues_status_check
    check (status in ('open', 'waiting', 'decided', 'done', 'dropped')),
  priority text not null default 'soon'
    constraint agent_issues_priority_check
    check (priority in ('now', 'soon', 'later')),
  owner text,
  waiting_on text,
  next_action text,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  closed_at timestamptz,
  possible_duplicate_of uuid,
  constraint agent_issues_client_id_key_key unique (client_id, key)
);

create index agent_issues_client_status_idx
  on public.agent_issues(client_id, status);
create index agent_issues_claimed_by_idx
  on public.agent_issues(claimed_by);

create table public.agent_issue_links (
  issue_id uuid not null references public.agent_issues(id) on delete cascade,
  kind text not null
    constraint agent_issue_links_kind_check
    check (kind in (
      'gmail_thread',
      'gmail_message',
      'contact',
      'registration',
      'coupon',
      'program',
      'url',
      'file',
      'trello',
      'sheet'
    )),
  ref text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint agent_issue_links_issue_id_kind_ref_key
    unique (issue_id, kind, ref)
);

create unique index agent_issue_links_gmail_thread_ref_idx
  on public.agent_issue_links(kind, ref)
  where kind = 'gmail_thread';

create table public.agent_issue_events (
  id bigserial primary key,
  issue_id uuid not null references public.agent_issues(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,
  kind text not null
    constraint agent_issue_events_kind_check
    check (kind in (
      'created',
      'linked',
      'claimed',
      'released',
      'note',
      'decision',
      'action',
      'reply_sent',
      'escalated',
      'status'
    )),
  body text not null,
  refs jsonb not null default '{}'::jsonb
);

create trigger agent_issues_updated_at
before update on public.agent_issues
for each row execute function public.update_updated_at_column();

alter table public.agent_issues enable row level security;
alter table public.agent_issue_links enable row level security;
alter table public.agent_issue_events enable row level security;

revoke all on table public.agent_issues from public, anon, authenticated;
revoke all on table public.agent_issue_links from public, anon, authenticated;
revoke all on table public.agent_issue_events from public, anon, authenticated;

create or replace function public.agent_find_issue(
  p_client uuid,
  p_kind text,
  p_ref text
)
returns public.agent_issues
language sql
stable
security definer
set search_path = ''
as $$
  select issue
  from public.agent_issues issue
  join public.agent_issue_links link on link.issue_id = issue.id
  where issue.client_id = p_client
    and link.kind = p_kind
    and link.ref = p_ref
  order by issue.updated_at desc, issue.id
  limit 1;
$$;

create or replace function public.agent_claim_issue(
  p_issue uuid,
  p_actor text,
  p_ttl interval default '45 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_issue public.agent_issues%rowtype;
  current_issue public.agent_issues%rowtype;
  issue_history jsonb;
begin
  update public.agent_issues
     set claimed_by = p_actor,
         claimed_at = now(),
         claim_expires_at = now() + p_ttl
   where id = p_issue
     and (claimed_by is null or claimed_by = p_actor or claim_expires_at < now())
  returning * into claimed_issue;

  if claimed_issue.id is null then
    select *
      into current_issue
      from public.agent_issues
     where id = p_issue;

    return jsonb_build_object(
      'ok', false,
      'claimed_by', current_issue.claimed_by,
      'claim_expires_at', current_issue.claim_expires_at
    );
  end if;

  insert into public.agent_issue_events (issue_id, actor, kind, body, refs)
  values (
    p_issue,
    p_actor,
    'claimed',
    'Claimed issue',
    jsonb_build_object('ttl', p_ttl::text)
  );

  select coalesce(
    jsonb_agg(to_jsonb(recent_event) order by recent_event.at, recent_event.id),
    '[]'::jsonb
  )
    into issue_history
    from (
      select event.*
      from public.agent_issue_events event
      where event.issue_id = p_issue
      order by event.at desc, event.id desc
      limit 20
    ) recent_event;

  return jsonb_build_object(
    'ok', true,
    'issue', to_jsonb(claimed_issue),
    'history', issue_history
  );
end;
$$;

create or replace function public.agent_release_issue(
  p_issue uuid,
  p_actor text,
  p_status text default null,
  p_summary text default null,
  p_next_action text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_issue public.agent_issues%rowtype;
begin
  update public.agent_issues
     set claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         status = coalesce(p_status, status),
         summary = coalesce(p_summary, summary),
         next_action = coalesce(p_next_action, next_action)
   where id = p_issue
     and claimed_by = p_actor
  returning * into released_issue;

  if released_issue.id is null then
    return false;
  end if;

  insert into public.agent_issue_events (issue_id, actor, kind, body, refs)
  values (
    p_issue,
    p_actor,
    'released',
    'Released issue',
    jsonb_strip_nulls(jsonb_build_object(
      'status', p_status,
      'summary', p_summary,
      'next_action', p_next_action
    ))
  );

  return true;
end;
$$;

create or replace function public.agent_create_issue(
  p_client uuid,
  p_key text,
  p_title text,
  p_summary text,
  p_actor text,
  p_links jsonb
)
returns public.agent_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_issue public.agent_issues%rowtype;
  link_record record;
  existing_link_issue uuid;
begin
  insert into public.agent_issues (
    client_id,
    key,
    title,
    summary,
    created_by
  ) values (
    p_client,
    p_key,
    p_title,
    p_summary,
    p_actor
  )
  on conflict (client_id, key) do nothing
  returning * into created_issue;

  if created_issue.id is null then
    select *
      into created_issue
      from public.agent_issues
     where client_id = p_client
       and key = p_key;

    return created_issue;
  end if;

  for link_record in
    select
      value ->> 'kind' as kind,
      value ->> 'ref' as ref,
      value ->> 'note' as note
    from jsonb_array_elements(coalesce(p_links, '[]'::jsonb))
  loop
    if link_record.kind = 'gmail_thread' then
      select link.issue_id
        into existing_link_issue
        from public.agent_issue_links link
       where link.kind = 'gmail_thread'
         and link.ref = link_record.ref;

      if existing_link_issue is not null then
        if existing_link_issue <> created_issue.id then
          raise exception 'gmail_thread % is already linked to issue %',
            link_record.ref,
            existing_link_issue;
        end if;

        continue;
      end if;
    end if;

    insert into public.agent_issue_links (issue_id, kind, ref, note)
    values (created_issue.id, link_record.kind, link_record.ref, link_record.note)
    on conflict (issue_id, kind, ref) do nothing;
  end loop;

  insert into public.agent_issue_events (issue_id, actor, kind, body, refs)
  values (
    created_issue.id,
    p_actor,
    'created',
    'Created issue',
    jsonb_build_object('links', coalesce(p_links, '[]'::jsonb))
  );

  return created_issue;
exception
  when unique_violation then
    if link_record.kind = 'gmail_thread' then
      select link.issue_id
        into existing_link_issue
        from public.agent_issue_links link
       where link.kind = 'gmail_thread'
         and link.ref = link_record.ref;

      if existing_link_issue is not null
        and existing_link_issue <> created_issue.id then
        raise exception 'gmail_thread % is already linked to issue %',
          link_record.ref,
          existing_link_issue;
      end if;
    end if;

    raise;
end;
$$;

create or replace function public.agent_link(
  p_issue uuid,
  p_kind text,
  p_ref text,
  p_actor text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_issue uuid;
  existing_issue uuid;
begin
  if p_kind = 'gmail_thread' then
    select link.issue_id
      into existing_issue
      from public.agent_issue_links link
     where link.kind = 'gmail_thread'
       and link.ref = p_ref;

    if existing_issue is not null then
      if existing_issue <> p_issue then
        raise exception 'gmail_thread % is already linked to issue %', p_ref, existing_issue;
      end if;

      return;
    end if;
  end if;

  insert into public.agent_issue_links (issue_id, kind, ref, note)
  values (p_issue, p_kind, p_ref, p_note)
  on conflict do nothing
  returning issue_id into inserted_issue;

  if inserted_issue is null then
    if p_kind = 'gmail_thread' then
      select link.issue_id
        into existing_issue
        from public.agent_issue_links link
       where link.kind = 'gmail_thread'
         and link.ref = p_ref;

      if existing_issue is not null and existing_issue <> p_issue then
        raise exception 'gmail_thread % is already linked to issue %', p_ref, existing_issue;
      end if;
    end if;

    return;
  end if;

  insert into public.agent_issue_events (issue_id, actor, kind, body, refs)
  values (
    p_issue,
    p_actor,
    'linked',
    'Linked ' || p_kind || ': ' || p_ref,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', p_kind,
      'ref', p_ref,
      'note', p_note
    ))
  );
end;
$$;

create or replace function public.agent_event(
  p_issue uuid,
  p_actor text,
  p_kind text,
  p_body text,
  p_refs jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id bigint;
begin
  insert into public.agent_issue_events (issue_id, actor, kind, body, refs)
  values (p_issue, p_actor, p_kind, p_body, coalesce(p_refs, '{}'::jsonb))
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.agent_open_issues(
  p_client uuid
)
returns setof public.agent_issues
language sql
stable
security definer
set search_path = ''
as $$
  select issue
  from public.agent_issues issue
  where issue.client_id = p_client
    and issue.status in ('open', 'waiting')
  order by issue.updated_at desc, issue.id;
$$;

create or replace function public.agent_recent_actor_activity(
  p_issue uuid,
  p_within interval
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(activity.actor order by activity.last_at desc, activity.actor),
    array[]::text[]
  )
  from (
    select event.actor, max(event.at) as last_at
    from public.agent_issue_events event
    where event.issue_id = p_issue
      and event.at >= now() - p_within
    group by event.actor
  ) activity;
$$;

revoke all on function public.agent_find_issue(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.agent_claim_issue(uuid, text, interval)
  from public, anon, authenticated;
revoke all on function public.agent_release_issue(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.agent_create_issue(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.agent_link(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.agent_event(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.agent_open_issues(uuid)
  from public, anon, authenticated;
revoke all on function public.agent_recent_actor_activity(uuid, interval)
  from public, anon, authenticated;

grant execute on function public.agent_find_issue(uuid, text, text) to service_role;
grant execute on function public.agent_claim_issue(uuid, text, interval) to service_role;
grant execute on function public.agent_release_issue(uuid, text, text, text, text) to service_role;
grant execute on function public.agent_create_issue(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.agent_link(uuid, text, text, text, text) to service_role;
grant execute on function public.agent_event(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.agent_open_issues(uuid) to service_role;
grant execute on function public.agent_recent_actor_activity(uuid, interval) to service_role;
