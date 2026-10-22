-- Migration 117: Restore least-privilege backend access required by
-- manage-household-user invitation actions (sent, received, invite, revoke, resend).
--
-- The Famioo project does not give service_role blanket access to every
-- public table. The Edge Function uses the protected SUPABASE_SERVICE_ROLE_KEY
-- to look up invitations and households after authenticating the caller.
-- Migration 116 introduced new invitation actions, but its backend reads
-- returned 403 permission denied; the Edge Function surfaced 500 errors.
--
-- Keep RLS policies and frontend grants unchanged. Do not grant invitations
-- to anon or add any broad authenticated table permissions.
grant select, insert, update, delete
  on table public.household_invitations to service_role;

grant select
  on table public.households to service_role;
