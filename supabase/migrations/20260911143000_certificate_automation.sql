-- In-house certificate generation. Certificate PDFs and their design assets stay
-- private; the public website repository contains the renderer, not CfA's signed
-- background artwork or issued learner documents.

alter table public.enrollments
  add constraint enrollments_id_client_program_key unique (id, client_id, program_id);

create table public.cfa_certificate_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid references public.programs(id) on delete cascade,
  name text not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  background_bucket text not null default 'cfa-certificate-assets',
  background_path text,
  certificate_title text not null default 'Certificate of Completion',
  completion_text text not null default 'has successfully completed',
  program_title text,
  detail_text text,
  layout jsonb not null default '{}'::jsonb,
  eligibility_ratio numeric(5,4) not null default 0.8000
    check (eligibility_ratio >= 0 and eligibility_ratio <= 1),
  auto_issue boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, name, version),
  foreign key (program_id, client_id)
    references public.programs(id, client_id)
);

create unique index cfa_certificate_templates_one_active_program_idx
  on public.cfa_certificate_templates (client_id, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

create table public.cfa_certificate_eligibility (
  enrollment_id uuid primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  eligible boolean not null default false,
  basis text not null default 'manual_review'
    check (basis in ('attendance', 'course_completion', 'manual_review', 'migration')),
  attended_sessions integer check (attended_sessions is null or attended_sessions >= 0),
  countable_sessions integer check (countable_sessions is null or countable_sessions >= 0),
  attendance_ratio numeric(5,4)
    check (attendance_ratio is null or (attendance_ratio >= 0 and attendance_ratio <= 1)),
  evidence jsonb not null default '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_id, client_id)
    references public.programs(id, client_id),
  foreign key (enrollment_id, client_id, program_id)
    references public.enrollments(id, client_id, program_id)
    on delete cascade,
  check (
    attended_sessions is null
    or countable_sessions is null
    or attended_sessions <= countable_sessions
  ),
  check (not eligible or (reviewed_at is not null and reviewed_by is not null))
);

create index cfa_certificate_eligibility_queue_idx
  on public.cfa_certificate_eligibility (client_id, program_id, eligible, updated_at desc);

create table public.cfa_certificates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  enrollment_id uuid not null,
  template_id uuid not null references public.cfa_certificate_templates(id) on delete restrict,
  certificate_number text not null unique,
  verification_code uuid not null default gen_random_uuid() unique,
  recipient_name text not null,
  program_title text not null,
  detail_text text,
  award_date date not null,
  template_version integer not null check (template_version > 0),
  eligibility_snapshot jsonb not null,
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'revoked', 'failed')),
  pdf_bucket text not null default 'cfa-certificates',
  pdf_path text,
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  issued_by text,
  issued_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_id, client_id)
    references public.programs(id, client_id),
  foreign key (enrollment_id, client_id, program_id)
    references public.enrollments(id, client_id, program_id)
    on delete restrict,
  check ((status <> 'issued') or (pdf_path is not null and pdf_sha256 is not null and issued_at is not null and issued_by is not null)),
  check ((status <> 'revoked') or (revoked_at is not null and revocation_reason is not null))
);

create unique index cfa_certificates_one_current_issue_idx
  on public.cfa_certificates (enrollment_id, template_id)
  where status = 'issued';
create index cfa_certificates_program_status_idx
  on public.cfa_certificates (client_id, program_id, status, award_date desc);
create index cfa_certificates_verification_idx
  on public.cfa_certificates (verification_code)
  where status = 'issued';

create trigger cfa_certificate_templates_updated_at
before update on public.cfa_certificate_templates
for each row execute function public.update_updated_at_column();

create trigger cfa_certificate_eligibility_updated_at
before update on public.cfa_certificate_eligibility
for each row execute function public.update_updated_at_column();

create trigger cfa_certificates_updated_at
before update on public.cfa_certificates
for each row execute function public.update_updated_at_column();

alter table public.cfa_certificate_templates enable row level security;
alter table public.cfa_certificate_eligibility enable row level security;
alter table public.cfa_certificates enable row level security;

revoke all on table public.cfa_certificate_templates from public, anon, authenticated;
revoke all on table public.cfa_certificate_eligibility from public, anon, authenticated;
revoke all on table public.cfa_certificates from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('cfa-certificate-assets', 'cfa-certificate-assets', false, 10485760, array['image/jpeg', 'image/png']),
  ('cfa-certificates', 'cfa-certificates', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

insert into public.cfa_certificate_templates (
  client_id,
  name,
  version,
  status,
  background_path,
  layout,
  eligibility_ratio,
  auto_issue
) values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'CfA Classic',
  1,
  'active',
  'templates/cfa-classic-v1.jpg',
  '{
    "page_width": 792,
    "page_height": 612,
    "name_y": 431,
    "name_size": 38,
    "program_y": 345,
    "program_size": 33,
    "detail_y": 307,
    "detail_size": 23,
    "date_y": 257,
    "date_size": 20,
    "verification_y": 19,
    "verification_size": 7
  }'::jsonb,
  0.8000,
  false
);

comment on table public.cfa_certificate_templates is
  'Versioned private certificate designs. auto_issue remains off until CfA explicitly approves issuance policy.';
comment on table public.cfa_certificate_eligibility is
  'Auditable bridge between attendance/completion evidence and certificate issuance; manual review is supported before attendance automation ships.';
comment on table public.cfa_certificates is
  'Immutable issuance snapshots and private PDF locations. Revocation preserves rather than deletes the record.';
