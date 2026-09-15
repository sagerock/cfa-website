-- Add explicit human ownership and Gmail draft tracking to the shared agent issue store.
--
-- Drafts are links on their issue so reconcilers can find and delete stale drafts
-- when another actor resolves or supersedes the issue.

alter table public.agent_issue_links
  drop constraint agent_issue_links_kind_check;

alter table public.agent_issue_links
  add constraint agent_issue_links_kind_check
  check (kind in (
    'gmail_thread',
    'gmail_message',
    'gmail_draft',
    'contact',
    'registration',
    'coupon',
    'program',
    'url',
    'file',
    'trello',
    'sheet'
  ));

create or replace function public.agent_escalate(
  p_issue uuid,
  p_actor text,
  p_why text,
  p_owner text default 'human:sage',
  p_draft text default null
)
returns public.agent_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  escalated_issue public.agent_issues%rowtype;
  event_refs jsonb;
begin
  update public.agent_issues
     set owner = p_owner,
         status = 'waiting',
         next_action = p_why
   where id = p_issue
  returning * into escalated_issue;

  if p_draft is not null then
    insert into public.agent_issue_links (issue_id, kind, ref, note)
    values (p_issue, 'gmail_draft', p_draft, p_why)
    on conflict do nothing;
  end if;

  event_refs := jsonb_build_object('owner', p_owner);

  if p_draft is not null then
    event_refs := event_refs || jsonb_build_object('gmail_draft', p_draft);
  end if;

  insert into public.agent_issue_events (issue_id, actor, kind, body, refs)
  values (
    p_issue,
    p_actor,
    'escalated',
    p_why,
    event_refs
  );

  return escalated_issue;
end;
$$;

create or replace function public.agent_set_owner(
  p_issue uuid,
  p_actor text,
  p_owner text
)
returns public.agent_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_issue public.agent_issues%rowtype;
begin
  update public.agent_issues
     set owner = p_owner
   where id = p_issue
  returning * into owned_issue;

  insert into public.agent_issue_events (issue_id, actor, kind, body, refs)
  values (
    p_issue,
    p_actor,
    'status',
    'owner -> ' || coalesce(p_owner, 'null'),
    jsonb_build_object('owner', p_owner)
  );

  return owned_issue;
end;
$$;

create or replace function public.agent_needs_human(
  p_client uuid,
  p_owner text default 'human:sage'
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
    and issue.owner = p_owner
    and issue.status in ('open', 'waiting')
  order by
    case issue.priority
      when 'now' then 1
      when 'soon' then 2
      when 'later' then 3
    end,
    issue.updated_at,
    issue.id;
$$;

create or replace function public.agent_issue_links_of(
  p_issue uuid
)
returns setof public.agent_issue_links
language sql
stable
security definer
set search_path = ''
as $$
  select link
  from public.agent_issue_links link
  where link.issue_id = p_issue
  order by link.created_at, link.kind, link.ref;
$$;

revoke all on function public.agent_escalate(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.agent_set_owner(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.agent_needs_human(uuid, text)
  from public, anon, authenticated;
revoke all on function public.agent_issue_links_of(uuid)
  from public, anon, authenticated;

grant execute on function public.agent_escalate(uuid, text, text, text, text) to service_role;
grant execute on function public.agent_set_owner(uuid, text, text) to service_role;
grant execute on function public.agent_needs_human(uuid, text) to service_role;
grant execute on function public.agent_issue_links_of(uuid) to service_role;
