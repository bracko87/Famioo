-- Household-level AI Assistant allowance and usage ledger.
-- Included monthly actions do not roll over. Purchased top-up actions are kept separately.

create table if not exists public.assistant_allowances (
  household_id uuid primary key references public.households(id) on delete cascade,
  monthly_action_limit integer not null default 150 check (monthly_action_limit >= 0),
  billing_anchor_at timestamptz not null default now(),
  topup_actions integer not null default 0 check (topup_actions >= 0),
  topup_expires_at timestamptz,
  source text not null default 'subscription',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_usage_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action_type text not null check (length(action_type) between 1 and 80),
  model text not null default 'gpt-6-luna',
  balance_source text not null check (balance_source in ('included','topup')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_usage_events_household_created_idx
  on public.assistant_usage_events (household_id, created_at desc);

create index if not exists assistant_usage_events_household_source_created_idx
  on public.assistant_usage_events (household_id, balance_source, created_at desc);

alter table public.assistant_allowances enable row level security;
alter table public.assistant_usage_events enable row level security;

revoke all on table public.assistant_allowances from anon;
revoke all on table public.assistant_usage_events from anon;
revoke insert, update, delete on table public.assistant_allowances from authenticated;
revoke insert, update, delete on table public.assistant_usage_events from authenticated;
grant select on table public.assistant_allowances to authenticated;
grant select on table public.assistant_usage_events to authenticated;
grant select, insert, update, delete on table public.assistant_allowances to service_role;
grant select, insert, update, delete on table public.assistant_usage_events to service_role;

drop policy if exists "Assistant allowances visible to household members"
  on public.assistant_allowances;
create policy "Assistant allowances visible to household members"
  on public.assistant_allowances
  for select
  to authenticated
  using (private.is_household_member(household_id));

drop policy if exists "Assistant usage visible to household members"
  on public.assistant_usage_events;
create policy "Assistant usage visible to household members"
  on public.assistant_usage_events
  for select
  to authenticated
  using (private.is_household_member(household_id));

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

create or replace function public.consume_assistant_action_v1(
  p_household_id uuid,
  p_action_type text,
  p_model text default 'gpt-6-luna',
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_total_tokens integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_allowance public.assistant_allowances%rowtype;
  v_months integer;
  v_cycle_start timestamptz;
  v_cycle_end timestamptz;
  v_used bigint;
  v_source text;
  v_remaining bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not private.is_household_member(p_household_id) then
    raise exception 'Household access required.' using errcode = '42501';
  end if;

  if not public.household_module_enabled_v1(p_household_id, 'assistant') then
    return jsonb_build_object('ok', false, 'code', 'AI_ASSISTANT_REQUIRED');
  end if;

  if p_action_type is null or length(trim(p_action_type)) = 0 or length(p_action_type) > 80 then
    raise exception 'Invalid Assistant action type.' using errcode = '22023';
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
    v_user_id,
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

revoke all on function public.assistant_usage_summary_v1(uuid) from public, anon;
grant execute on function public.assistant_usage_summary_v1(uuid) to authenticated;

revoke all on function public.consume_assistant_action_v1(uuid,text,text,integer,integer,integer,jsonb) from public, anon;
grant execute on function public.consume_assistant_action_v1(uuid,text,text,integer,integer,integer,jsonb) to authenticated;
