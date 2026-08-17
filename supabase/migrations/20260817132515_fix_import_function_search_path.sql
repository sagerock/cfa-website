-- The contacts unsubscribe-token trigger uses pgcrypto's gen_random_bytes.
alter function public.cfa_import_thinkific_enrollment_batch(text, uuid, uuid, jsonb)
  set search_path = pg_catalog, extensions;
