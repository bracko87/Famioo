-- Record Assistant usage only from trusted backend clients.
-- The PWA can read allowance/history but cannot consume actions directly.

create or replace function public.record_assistant_action_v1(
  p_household_id uuid,
  p_user_id uuid,
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
  v_source text;
  v_remaining bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
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

  if p_action_type is null or length(trim(p_action_type)) = 0 or length(p_action_type) > 80 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ACTION_TYPE');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text, 0));

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
  into v_used
  from public.assistant_usage_events
  where household_id = p_household_id
    and balance_source = 'included'
    and created_at >= v_cycle_start
    and created_at < v_cycle_end;

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

  insert into public.assistant_usage_events (
    household_id, user_id, action_type, model, balance_source,
    input_tokens, output_tokens, total_tokens, metadata_json
  ) values (
    p_household_id,
    p_user_id,
    trim(p_action_type),
    coalesce(nullif(trim(p_model), ''), 'gpt-6-luna'),
    v_source,
    case when p_input_tokens is null then null else greatest(p_input_tokens, 0) end,
    case when p_output_tokens is null then null else greatest(p_output_tokens, 0) end,
    case when p_total_tokens is null then null else greatest(p_total_tokens, 0) end,
    coalesce(p_metadata, '{}'::jsonb)
  );

  if v_source = 'included' then
    v_remaining := greatest(v_allowance.monthly_action_limit::bigint - (v_used + 1), 0::bigint)
      + v_allowance.topup_actions::bigint;
  else
    v_remaining := greatest(v_allowance.topup_actions - 1, 0)::bigint;
  end if;

  return jsonb_build_object(
    'ok', true,
    'source', v_source,
    'remaining', v_remaining,
    'cycle_end', v_cycle_end
  );
end;
$$;

revoke all on function public.record_assistant_action_v1(uuid,uuid,text,text,integer,integer,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_assistant_action_v1(uuid,uuid,text,text,integer,integer,integer,jsonb)
  to service_role;
