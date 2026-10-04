-- Famioo migration 010
-- Grant the browser client only the table privileges it needs.
-- RLS remains the authorization boundary for every household-owned row.

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;

revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke all on all tables in schema public from anon;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

alter default privileges in schema public
  revoke all on tables from anon;
