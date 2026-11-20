-- Click counter for tracked go-links (Sage 2026-11-17): how many Explorations students still
-- join class from Thinkific's class page. learn.*/go/<link> records one row, then redirects.
-- No personal data: link, source, time and a coarse device kind only.
create table if not exists public.cfa_link_clicks (
  id bigserial primary key,
  link text not null,
  source text not null default 'unknown',
  device text,
  clicked_at timestamptz not null default now()
);
create index if not exists cfa_link_clicks_link_time on public.cfa_link_clicks (link, clicked_at);
alter table public.cfa_link_clicks enable row level security;
-- The Pages Function inserts with the public (anon) key: insert only, known links only, no reads.
drop policy if exists cfa_link_clicks_insert on public.cfa_link_clicks;
create policy cfa_link_clicks_insert on public.cfa_link_clicks for insert to anon
  with check (link in ('explorations-class') and length(source) <= 40 and (device is null or length(device) <= 20));
grant insert on public.cfa_link_clicks to anon;
grant usage, select on sequence public.cfa_link_clicks_id_seq to anon;
