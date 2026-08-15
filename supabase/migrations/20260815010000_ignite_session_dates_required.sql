alter table public.cfa_learn_sessions
  alter column starts_at set not null,
  alter column ends_at set not null;
