-- WHiSTEP Open House (Dec 12, 2026): keep sign-ups open after the event so
-- people can register for the recording. Social post 62 (Dec 16) sends them to
-- /whistep/open-house/ for it (Caitlin, 2026-11-12). The free offer was set to
-- close at 4:35 PM ET Dec 12; it now closes at the end of Dec 31.
-- cfa-register sends late registrants the recording wording, not the Zoom link
-- (afterEvent in the program definition).
-- Rollback: set ends_at back to '2026-12-12 16:35:00-05'.

update public.program_offers offer
set ends_at = timestamptz '2026-12-31 23:59:59-05'
from public.programs program
where offer.program_id = program.id
  and program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'whistep-open-house-2026-12-12'
  and offer.code = 'open-house';
