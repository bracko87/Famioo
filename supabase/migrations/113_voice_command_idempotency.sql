-- Famioo migration 113: atomic Alexa/Voice write idempotency
-- Apply after 099 and 112 in the Famioo Supabase project.
-- Each real spoken command must have a stable request_id across network retries.
-- Different spoken commands must receive distinct request IDs.
-- Private service_role-only storage; no user rows or existing tasks are changed.

create table if not exists public.voice_command_receipts (
  household_id uuid not null references public.households(id) on delete cascade,
  request_id text not null check (length(request_id) between 16 and 160),
  intent text not null check (intent in ('task_add', 'shopping_add')),
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (household_id, request_id)
);
create index if not exists voice_command_receipts_created_idx
  on public.voice_command_receipts(created_at);

alter table public.voice_command_receipts enable row level security;
revoke all on table public.voice_command_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.voice_command_receipts to service_role;

create or replace function public.voice_create_once_v1(
  p_household_id uuid,
  p_request_id text,
  p_intent text,
  p_payload jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_prior public.voice_command_receipts%rowtype;
  v_result jsonb;
  v_task_id uuid;
  v_list_id uuid;
  v_item_id uuid;
  v_list_name text;
  v_title text;
  v_quantity text;
  v_requested_list text;
  v_due_date date;
begin
  if p_household_id is null
     or p_actor_user_id is null
     or p_request_id is null
     or length(p_request_id) not between 16 and 160
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]+$'
     or p_intent not in ('task_add','shopping_add')
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
  then
    raise exception 'Invalid voice write request' using errcode='22023';
  end if;

  -- The Edge Function calls this with a service_role key. Recheck permissions
  -- INSIDE the transaction so disabling or revoking Alexa blocks new writes.
  if not exists (
    select 1
    from public.voice_integration_settings s
    join public.household_members hm
      on hm.household_id=s.household_id
     and hm.user_id=s.linked_by_user_id
    where s.household_id=p_household_id
      and s.linked_by_user_id=p_actor_user_id
      and s.enabled=true
      and p_intent=any(s.allowed_actions)
      and hm.status='active'
      and hm.role in ('owner','admin')
  ) then
    raise exception 'Voice integration permission denied' using errcode='42501';
  end if;

  -- A transaction-scoped PostgreSQL lock serializes even simultaneous retries.
  -- Hash collisions only cause additional waiting, never false duplicates.
  perform pg_advisory_xact_lock(
    hashtextextended(p_household_id::text || ':' || p_request_id,0)
  );

  select *
  into v_prior
  from public.voice_command_receipts
  where household_id=p_household_id and request_id=p_request_id;

  if found then
    if v_prior.intent <> p_intent or v_prior.payload <> p_payload then
      raise exception 'Voice request ID conflicts with a different command'
        using errcode='23505';
    end if;
    return v_prior.response || '{"replayed":true}'::jsonb;
  end if;

  if p_intent='task_add' then
    v_title=trim(coalesce(p_payload->>'title',''));
    if length(v_title) not between 1 and 160 then
      raise exception 'Invalid voice task title' using errcode='22023';
    end if;
    if nullif(p_payload->>'due_date','') is not null then
      v_due_date=(p_payload->>'due_date')::date;
    end if;

    insert into public.tasks(
      household_id,title,status,priority,due_date,created_by_user_id
    )
    values(p_household_id,v_title,'open','normal',v_due_date,p_actor_user_id)
    returning id into v_task_id;

    v_result=jsonb_build_object(
      'ok',true,'intent',p_intent,'task_id',v_task_id,
      'speech','Created task: '||v_title||
        case when v_due_date is null then '' else ' for '||v_due_date::text end
    );
  elsif p_intent='shopping_add' then
    v_title=trim(coalesce(p_payload->>'item_text',''));
    v_quantity=nullif(trim(coalesce(p_payload->>'quantity','')),'');
    v_requested_list=nullif(trim(coalesce(p_payload->>'list_title','')),'');
    if length(v_title) not between 1 and 160
       or length(coalesce(v_quantity,''))>80
       or length(coalesce(v_requested_list,''))>120 then
      raise exception 'Invalid shopping voice request' using errcode='22023';
    end if;

    -- Two DIFFERENT requests arriving at once should not accidentally make
    -- two new lists with the same name.
    perform pg_advisory_xact_lock(hashtextextended(
      'voice-list:'||p_household_id::text||':'||coalesce(v_requested_list,'Shopping'),0
    ));

    select l.id,l.title into v_list_id,v_list_name
    from public.shopping_lists l
    where l.household_id=p_household_id
      and l.status='active'
      and l.archived_at is null
      and (v_requested_list is null or l.title=v_requested_list)
    order by l.created_at desc
    limit 1;

    if v_list_id is null then
      v_list_name=coalesce(v_requested_list,'Shopping');
      insert into public.shopping_lists(
        household_id,title,created_by_user_id
      )
      values(p_household_id,v_list_name,p_actor_user_id)
      returning id into v_list_id;
    end if;

    insert into public.shopping_items(
      household_id,shopping_list_id,item_text,quantity,created_by_user_id
    )
    values(p_household_id,v_list_id,v_title,v_quantity,p_actor_user_id)
    returning id into v_item_id;

    v_result=jsonb_build_object(
      'ok',true,'intent',p_intent,'item_id',v_item_id,'list_id',v_list_id,
      'speech','Added '||v_title||
        case when v_quantity is null then '' else ' ('||v_quantity||')' end||
        ' to '||v_list_name||'.'
    );
  end if;

  -- Receipt and created row commit (or roll back) together. Failed writes
  -- store no receipt, so a legitimate retry can be attempted again.
  insert into public.voice_command_receipts(
    household_id,request_id,intent,payload,response
  )
  values(p_household_id,p_request_id,p_intent,p_payload,v_result);

  return v_result;
end;
$$;

revoke all on function public.voice_create_once_v1(uuid,text,text,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.voice_create_once_v1(uuid,text,text,jsonb,uuid)
  to service_role;

-- Retain receipts for at least 30 days so common delayed retries remain
-- idempotent. A separate reviewed housekeeping job can later prune older rows.
