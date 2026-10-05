-- Famioo migration 025
-- Household finance settings, scheduled monthly costs and optional task costs.

create table if not exists public.household_finance_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  monthly_income numeric(12,2),
  monthly_budget numeric(12,2),
  currency text not null default 'EUR',
  updated_by_user_id uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint household_finance_settings_income_check check (monthly_income is null or monthly_income >= 0),
  constraint household_finance_settings_budget_check check (monthly_budget is null or monthly_budget >= 0)
);

alter table public.household_finance_settings enable row level security;

drop policy if exists household_finance_settings_select on public.household_finance_settings;
create policy household_finance_settings_select
on public.household_finance_settings for select to authenticated
using (private.has_module_access(household_id,'costs','read'));

drop policy if exists household_finance_settings_insert on public.household_finance_settings;
create policy household_finance_settings_insert
on public.household_finance_settings for insert to authenticated
with check (private.has_module_access(household_id,'costs','full'));

drop policy if exists household_finance_settings_update on public.household_finance_settings;
create policy household_finance_settings_update
on public.household_finance_settings for update to authenticated
using (private.has_module_access(household_id,'costs','full'))
with check (private.has_module_access(household_id,'costs','full'));

grant select,insert,update,delete on public.household_finance_settings to authenticated;

alter table public.household_costs
  add column if not exists schedule_type text not null default 'one_time',
  add column if not exists schedule_day smallint,
  add column if not exists source_task_id uuid references public.tasks(id) on delete set null;

alter table public.household_costs
  drop constraint if exists household_costs_schedule_type_check,
  drop constraint if exists household_costs_schedule_day_check,
  drop constraint if exists household_costs_source_type_check;

alter table public.household_costs
  add constraint household_costs_schedule_type_check
    check (schedule_type in ('one_time','scheduled')),
  add constraint household_costs_schedule_day_check
    check (schedule_day is null or (schedule_day between 1 and 31)),
  add constraint household_costs_source_type_check
    check (source_type in ('manual','shopping','task'));

create unique index if not exists household_costs_source_task_uidx
  on public.household_costs(source_task_id)
  where source_task_id is not null;

alter table public.tasks
  add column if not exists cost_amount numeric(12,2),
  add column if not exists cost_currency text not null default 'EUR';

alter table public.tasks
  drop constraint if exists tasks_cost_amount_check;

alter table public.tasks
  add constraint tasks_cost_amount_check
    check (cost_amount is null or cost_amount >= 0);

create or replace function private.record_task_cost_v1()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_costs_enabled boolean;
begin
  select coalesce(hm.enabled,false)
  into v_costs_enabled
  from public.household_modules hm
  where hm.household_id=new.household_id
    and hm.module_code='costs'
    and (hm.valid_until is null or hm.valid_until > now())
  limit 1;

  if not coalesce(v_costs_enabled,false) then
    return new;
  end if;

  if new.status='done'
     and new.cost_amount is not null
     and new.cost_amount > 0
     and (
       tg_op='INSERT'
       or old.status is distinct from 'done'
       or old.cost_amount is distinct from new.cost_amount
       or old.due_date is distinct from new.due_date
       or old.title is distinct from new.title
     )
  then
    insert into public.household_costs(
      household_id,title,amount,currency,cost_date,cost_kind,source_type,
      source_task_id,schedule_type,created_by_user_id
    )
    values(
      new.household_id,
      'Task · '||new.title,
      new.cost_amount,
      coalesce(nullif(new.cost_currency,''),'EUR'),
      coalesce(new.due_date,current_date),
      'additional',
      'task',
      new.id,
      'one_time',
      coalesce(auth.uid(),new.created_by_user_id)
    )
    on conflict(source_task_id) where source_task_id is not null
    do update set
      title=excluded.title,
      amount=excluded.amount,
      currency=excluded.currency,
      cost_date=excluded.cost_date,
      updated_at=now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_record_task_cost on public.tasks;
create trigger trg_record_task_cost
after insert or update of status,cost_amount,due_date,title
on public.tasks
for each row
execute function private.record_task_cost_v1();
