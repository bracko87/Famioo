-- Famioo migration 102
-- Family Messenger quick-access notification wording.

create or replace function private.format_messenger_notification_v1()
returns trigger
language plpgsql
set search_path=public,private,pg_temp
as $$
declare
  v_sender text;
  v_preview text;
begin
  if new.notification_type='messenger_message' then
    v_sender:=coalesce(nullif(trim(new.title),''),'Family member');
    v_preview:=nullif(trim(coalesce(new.body,'')),'');
    new.title:='New message in Family Messenger';
    new.body:=v_sender||case when v_preview is not null then ': '||v_preview else '' end;
  end if;
  return new;
end;
$$;

revoke all on function private.format_messenger_notification_v1() from public,anon,authenticated;

drop trigger if exists format_messenger_notification on public.notifications;
create trigger format_messenger_notification
before insert on public.notifications
for each row
when (new.notification_type='messenger_message')
execute function private.format_messenger_notification_v1();

update public.notifications
set body=coalesce(nullif(trim(title),''),'Family member')
         ||case when nullif(trim(coalesce(body,'')),'') is not null then ': '||trim(body) else '' end,
    title='New message in Family Messenger'
where notification_type='messenger_message'
  and title<>'New message in Family Messenger'
  and status in ('pending','sent');
