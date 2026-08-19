-- The contacts insert trigger generate_unsubscribe_token() called
-- gen_random_bytes() unqualified, which fails inside any SECURITY DEFINER
-- function that empties search_path — cfa_complete_registration among them.
-- Every brand-new-contact registration died there. Pin the trigger's own
-- search path so pgcrypto resolves regardless of the caller's.

alter function public.generate_unsubscribe_token() set search_path = extensions, public;
