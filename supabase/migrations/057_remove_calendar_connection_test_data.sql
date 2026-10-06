-- Famioo migration 057
-- Remove the temporary ICS connection and imported events used to verify
-- the retired Calendar Connections prototype.

delete from public.calendar_events
where external_connection_id in (
  select id
  from public.calendar_connections
  where provider='ics'
    and display_name='Famioo ICS Test'
    and feed_url like '%/functions/v1/famioo-test-calendar%'
);

delete from public.calendar_connections
where provider='ics'
  and display_name='Famioo ICS Test'
  and feed_url like '%/functions/v1/famioo-test-calendar%';
