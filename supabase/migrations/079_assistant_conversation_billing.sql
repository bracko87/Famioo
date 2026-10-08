-- Group up to three quick-Assistant turns into one customer-visible action.
-- Every OpenAI call is still retained in usage history for cost analysis.

alter table public.assistant_usage_events
  add column if not exists billable boolean not null default true,
  add column if not exists conversation_id uuid,
  add column if not exists conversation_turn integer;

create index if not exists assistant_usage_events_household_conversation_idx
  on public.assistant_usage_events (household_id, conversation_id, created_at)
  where conversation_id is not null;

create or replace function public.assistant_usage_summary_v1(p_household_id uuid)
returns table (
  monthly_limit integer,
  monthly_used bigint,
  monthly_remaining bigint,
  topup_remaining integer,
  total_remaining bigint,
  cycle_start timestamptz,
  cycle_end timestamptz,
  included_rollover integer
)
language plpgsql
stable
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_allowance public.assistant_allowances%rowtype;
  v_months integer;
  v_cycle_start timestamptz;
  v_cycle_end timestamptz;
  v_used bigint;
  v_topup integer;
begin
  if auth.uid() is null or not private.is_household_member(p_household_id) then
    raise exception 'Assistant allowance is not accessible for this household.'
      using errcode = '42501';
  end if;

  select *
  into v_allowance
  from public.assistant_allowances
  where household_id = p_household_id;

  if not found then
    return query
    select 0::integer, 0::bigint, 0::bigint, 0::integer, 0::bigint,
           now(), now(), 0::integer;
    return;
  end if;

  v_months :=
    (extract(year from now())::integer - extract(year from v_allowance.billing_anchor_at)::integer) * 12
    + (extract(month from now())::integer - extract(month from v_allowance.billing_anchor_at)::integer);

  v_cycle_start := v_allowance.billing_anchor_at + make_interval(months => v_months);
  if v_cycle_start > now() then
    v_months := v_months - 1;
    v_cycle_start := v_allowance.billing_anchor_at + make_interval(months => v_months);
  end if;
  v_cycle_end := v_allowance.billing_anchor_at + make_interval(months => v_months + 1);

  select count(*)
  into v_used
  from public.assistant_usage_events
  where household_id = p_household_id
    and balance_source = 'included'
    and billable = true
    and created_at >= v_cycle_start
    and created_at < v_cycle_end;

  v_topup := case
    when v_allowance.topup_expires_at is not null and v_allowance.topup_expires_at <= now() then 0
    else v_allowance.topup_actions
  end;

  return query
  select
    v_allowance.monthly_action_limit,
    v_used,
    greatest(v_allowance.monthly_action_limit::bigint - v_used, 0::bigint),
    v_topup,
    greatest(v_allowance.monthly_action_limit::bigint - v_used, 0::bigint) + v_topup::bigint,
    v_cycle_start,
    v_cycle_end,
    0::integer;
end;
$$;

create or replace function public.record_assistant_conversation_turn_v1(
  p_household_id uuid,
  p_user_id uuid,
  p_conversation_id uuid,
  p_action_type text,
  p_model text default 'gpt-6-luna',
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_total_tokens integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_allowance public.assistant_allowances%rowtype;
  v_months integer;
  v_cycle_start timestamptz;
  v_cycle_end timestamptz;
  v_used bigint;
  v_turn_count integer;
  v_turn integer;
  v_billable boolean;
  v_source text;
  v_remaining bigint;
begin
  if p_user_id is null or p_conversation_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CONVERSATION');
  end if;

  if not exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = p_user_id
      and hm.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'HOUSEHOLD_ACCESS_REQUIRED');
  end if;

  if not exists (
    select 1
    from public.modules m
    left join public.household_modules hm
      on hm.household_id = p_household_id
     and hm.module_code = m.code
    where m.code = 'assistant'
      and m.is_active
      and (
        m.is_core
        or (
          coalesce(hm.enabled, false)
          and (hm.valid_until is null or hm.valid_until > now())
        )
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'AI_ASSISTANT_REQUIRED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':' || p_conversation_id::text, 0));

  select *
  into v_allowance
  from public.assistant_allowances
  where household_id = p_household_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'ASSISTANT_LIMIT_REACHED', 'remaining', 0);
  end if;

  v_months :=
    (extract(year from now())::integer - extract(year from v_allowance.billing_anchor_at)::integer) * 12
    + (extract(month from now())::integer - extract(month from v_allowance.billing_anchor_at)::integer);

  v_cycle_start := v_allowance.billing_anchor_at + make_interval(months => v_months);
  if v_cycle_start > now() then
    v_months := v_months - 1;
    v_cycle_start := v_allowance.billing_anchor_at + make_interval(months => v_months);
  end if;
  v_cycle_end := v_allowance.billing_anchor_at + make_interval(months => v_months + 1);

  select count(*)
  into v_turn_count
  from public.assistant_usage_events
  where household_id = p_household_id
    and conversation_id = p_conversation_id;

  v_turn := v_turn_count + 1;
  v_billable := mod(v_turn_count, 3) = 0;

  select count(*)
  into v_used
  from public.assistant_usage_events
  where household_id = p_household_id
    and balance_source = 'included'
    and billable = true
    and created_at >= v_cycle_start
    and created_at < v_cycle_end;

  if v_billable then
    if v_used < v_allowance.monthly_action_limit then
      v_source := 'included';
    elsif v_allowance.topup_actions > 0
          and (v_allowance.topup_expires_at is null or v_allowance.topup_expires_at > now()) then
      v_source := 'topup';
      update public.assistant_allowances
      set topup_actions = topup_actions - 1,
          updated_at = now()
      where household_id = p_household_id;
    else
      return jsonb_build_object(
        'ok', false,
        'code', 'ASSISTANT_LIMIT_REACHED',
        'remaining', 0,
        'cycle_end', v_cycle_end
      );
    end if;
  else
    select balance_source
    into v_source
    from public.assistant_usage_events
    where household_id = p_household_id
      and conversation_id = p_conversation_id
      and billable = true
    order by created_at desc
    limit 1;

    v_source := coalesce(v_source, 'included');
  end if;

  insert into public.assistant_usage_events (
    household_id, user_id, action_type, model, balance_source,
    input_tokens, output_tokens, total_tokens, metadata_json,
    billable, conversation_id, conversation_turn
  ) values (
    p_household_id,
    p_user_id,
    trim(p_action_type),
    coalesce(nullif(trim(p_model), ''), 'gpt-6-luna'),
    v_source,
    case when p_input_tokens is null then null else greatest(p_input_tokens, 0) end,
    case when p_output_tokens is null then null else greatest(p_output_tokens, 0) end,
    case when p_total_tokens is null then null else greatest(p_total_tokens, 0) end,
    coalesce(p_metadata, '{}'::jsonb),
    v_billable,
    p_conversation_id,
    v_turn
  );

  if v_source = 'included' then
    v_remaining := greatest(
      v_allowance.monthly_action_limit::bigint - (v_used + case when v_billable then 1 else 0 end),
      0::bigint
    ) + v_allowance.topup_actions::bigint;
  else
    v_remaining := greatest(v_allowance.topup_actions - case when v_billable then 1 else 0 end, 0)::bigint;
  end if;

  return jsonb_build_object(
    'ok', true,
    'source', v_source,
    'billable', v_billable,
    'conversation_turn', v_turn,
    'remaining', v_remaining,
    'cycle_end', v_cycle_end
  );
end;
$$;

revoke all on function public.record_assistant_conversation_turn_v1(
  uuid,uuid,uuid,text,text,integer,integer,integer,jsonb
) from public, anon, authenticated;
grant execute on function public.record_assistant_conversation_turn_v1(
  uuid,uuid,uuid,text,text,integer,integer,integer,jsonb
) to service_role;

-- Treat the three most recent clarification turns from the same failed dentist task as one action.
with recent as (
  select id,
         row_number() over (order by created_at) as rn
  from public.assistant_usage_events
  where household_id='7dc78248-8600-4d66-b42d-0179c6cc7028'::uuid
    and created_at >= '2026-10-08 11:36:00+00'::timestamptz
    and created_at <= '2026-10-08 11:40:00+00'::timestamptz
)
update public.assistant_usage_events u
set conversation_id = 'b61f2ceb-fd2f-4b06-a1d7-95e24336a711'::uuid,
    conversation_turn = recent.rn,
    billable = (recent.rn = 1)
from recent
where u.id = recent.id;
