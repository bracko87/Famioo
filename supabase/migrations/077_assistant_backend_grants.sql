-- Minimum backend reads required by the Assistant usage recorder.
-- The secret/service role remains server-only and bypasses RLS, but explicit
-- table privileges are still required in this project's tightened grant model.

grant select on table public.household_members to service_role;
grant select on table public.modules to service_role;
grant select on table public.household_modules to service_role;
