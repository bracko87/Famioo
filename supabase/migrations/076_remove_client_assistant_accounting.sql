-- Remove the client-callable Assistant accounting RPC.
-- Usage is now recorded only by backend Edge Functions via record_assistant_action_v1.

revoke all on function public.consume_assistant_action_v1(
  uuid,text,text,integer,integer,integer,jsonb
) from public, anon, authenticated, service_role;

drop function if exists public.consume_assistant_action_v1(
  uuid,text,text,integer,integer,integer,jsonb
);
