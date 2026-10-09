import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'
import webpush from 'npm:web-push@3.6.7'

const dbUrl=Deno.env.get('SUPABASE_DB_URL')!
const sql=postgres(dbUrl,{ prepare:false,max:1 })

function json(data:unknown,status=200) {
  return new Response(JSON.stringify(data),{ status,headers:{ 'Content-Type':'application/json' } })
}

function escapeHtml(value:string) {
  return value.replace(/[&<>"']/g,(char)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;',
  }[char] ?? char))
}

async function secret(name:string) {
  const rows=await sql<Array<{ value:string }>>`
    select decrypted_secret as value
    from vault.decrypted_secrets
    where name=${name}
    limit 1
  `
  return rows[0]?.value ?? ''
}

async function sendPushes() {
  const configRows=await sql<Array<{ public_key:string; private_key:string }>>`
    select c.public_key,s.decrypted_secret as private_key
    from private.notification_push_config c
    join vault.decrypted_secrets s on s.name=c.vault_secret_name
    where c.singleton=true
    limit 1
  `
  const config=configRows[0]

  const claimed=await sql.begin(async (tx)=> {
    const rows=await tx<Array<{
      id:string; household_id:string; recipient_user_id:string; notification_type:string; title:string; body:string;
      entity_id:string|null
    }>>`
      with candidates as (
        select id
        from public.notifications
        where status='pending'
          and coalesce(scheduled_for,now())<=now()
        order by coalesce(scheduled_for,created_at),created_at
        for update skip locked
        limit 100
      )
      update public.notifications n
      set status='sent',sent_at=now()
      from candidates c
      where n.id=c.id
      returning n.id::text,n.household_id::text,n.recipient_user_id::text,
                n.notification_type,n.title,n.body,n.entity_id::text
    `
    return rows
  })

  let pushed=0
  if (!config) return { claimed:claimed.length,pushed }

  webpush.setVapidDetails('mailto:famioo@propelotonmanager.com',config.public_key,config.private_key)

  for (const item of claimed) {
    const prefs=await sql<Array<{ push_enabled:boolean }>>`
      select push_enabled
      from public.notification_preferences
      where household_id=${item.household_id}::uuid
        and user_id=${item.recipient_user_id}::uuid
      limit 1
    `
    if (!prefs[0]?.push_enabled) continue

    const subscriptions=await sql<Array<{ id:string;endpoint:string;p256dh:string;auth_key:string }>>`
      select id::text,endpoint,p256dh,auth_key
      from public.push_subscriptions
      where household_id=${item.household_id}::uuid
        and user_id=${item.recipient_user_id}::uuid
        and active=true
    `

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint:subscription.endpoint,keys:{ p256dh:subscription.p256dh,auth:subscription.auth_key } },
          JSON.stringify({
            title:item.title,
            body:item.body,
            icon:'/famioo-icon-192.png',
            badge:'/famioo-icon-192.png',
            tag:item.notification_type.startsWith('safety_')
              ? 'famioo-safety-'+item.entity_id
              : item.notification_type.startsWith('location_')
                ? 'famioo-location-'+item.entity_id
                : item.notification_type==='messenger_message'
                  ? 'famioo-messenger-'+item.entity_id
                  : 'famioo-'+item.id,
            url:item.notification_type.startsWith('safety_')
              ? '/app/safety'
              : item.notification_type.startsWith('location_')
                ? '/app/location'
                : item.notification_type==='messenger_message'
                  ? '/app/messenger'
                  : '/app/calendar',
          }),
          {
            TTL:item.notification_type.startsWith('safety_') ? 300 : 3600,
            urgency:item.notification_type.startsWith('safety_') ? 'high' : 'normal',
          },
        )
        pushed+=1
        await sql`update public.push_subscriptions set last_seen_at=now(),updated_at=now() where id=${subscription.id}::uuid`
      } catch (error) {
        const statusCode=typeof error==='object' && error && 'statusCode' in error
          ? Number((error as { statusCode?:number }).statusCode)
          : null
        if (statusCode===404 || statusCode===410) {
          await sql`update public.push_subscriptions set active=false,updated_at=now() where id=${subscription.id}::uuid`
        }
      }
    }
  }

  return { claimed:claimed.length,pushed }
}

async function sendSummaryEmails() {
  const resendKey=await secret('famioo_resend_api_key')
  if (!resendKey) {
    return { claimed:0,sent:0,failed:0,configured:false }
  }

  const deliveries=await sql.begin(async (tx)=> {
    const rows=await tx<Array<{
      id:string; household_id:string; user_id:string; summary_kind:'daily'|'weekly';
      recipient_email:string; period_start:string; period_end:string; attempts:number
    }>>`
      with candidates as (
        select id
        from public.summary_email_deliveries
        where status in ('pending','failed')
          and scheduled_for<=now()
          and scheduled_for>=now()-interval '24 hours'
          and attempts<5
        order by scheduled_for,created_at
        for update skip locked
        limit 25
      )
      update public.summary_email_deliveries d
      set status='sending',attempts=d.attempts+1,last_attempt_at=now(),updated_at=now()
      from candidates c
      where d.id=c.id
      returning d.id::text,d.household_id::text,d.user_id::text,d.summary_kind,
                d.recipient_email,d.period_start::text,d.period_end::text,d.attempts
    `
    return rows
  })

  let sent=0
  let failed=0

  for (const delivery of deliveries) {
    try {
      if (!resendKey) throw new Error('Summary email provider is not configured')

      const householdRows=await sql<Array<{ name:string;timezone:string }>>`
        select name,timezone from public.households where id=${delivery.household_id}::uuid limit 1
      `
      const household=householdRows[0]
      if (!household) throw new Error('Household not found')

      const events=await sql<Array<{
        event_id:string; occurrence_key:string; title:string; all_day:boolean;
        occurrence_start_at:string|null; occurrence_start_date:string|null;
        event_timezone:string; location_text:string|null; people:string[]
      }>>`
        select
          o.event_id::text,
          o.occurrence_key,
          o.title,
          o.all_day,
          o.occurrence_start_at::text,
          o.occurrence_start_date::text,
          o.event_timezone,
          o.location_text,
          coalesce(
            array_agg(distinct fp.display_name order by fp.display_name)
              filter (where fp.id is not null),
            array[]::text[]
          ) as people
        from private.worker_calendar_occurrences(
          ${delivery.household_id}::uuid,
          ${delivery.period_start}::date,
          ${delivery.period_end}::date
        ) o
        join public.calendar_events ce
          on ce.id=o.event_id and ce.household_id=o.household_id
        left join public.event_participants ep
          on ep.event_id=o.event_id and ep.household_id=o.household_id
        left join public.family_profiles fp
          on fp.id=ep.profile_id and fp.household_id=ep.household_id and fp.active
        where (
          ce.visibility='household'
          or ce.created_by_user_id=${delivery.user_id}::uuid
          or exists(
            select 1
            from public.event_participants own_ep
            join public.family_profiles own_fp
              on own_fp.id=own_ep.profile_id
             and own_fp.household_id=own_ep.household_id
             and own_fp.active
            where own_ep.event_id=ce.id
              and own_fp.linked_user_id=${delivery.user_id}::uuid
          )
          or exists(
            select 1
            from public.household_members hm
            left join public.module_role_permissions mrp
              on mrp.household_id=hm.household_id
             and mrp.module_code='calendar'
             and mrp.role=hm.role
            where hm.household_id=${delivery.household_id}::uuid
              and hm.user_id=${delivery.user_id}::uuid
              and hm.status='active'
              and (
                hm.role='owner'
                or coalesce(
                  mrp.access_level,
                  case when hm.role='admin' then 'full' else 'read' end
                )='full'
              )
          )
        )
        group by
          o.event_id,o.occurrence_key,o.title,o.all_day,o.occurrence_start_at,
          o.occurrence_start_date,o.event_timezone,o.location_text
        order by coalesce(
          o.occurrence_start_at,
          o.occurrence_start_date::timestamp at time zone o.event_timezone
        ),o.title
      `

      const grouped=new Map<string,typeof events>()
      for (const event of events) {
        const key=event.all_day
          ? event.occurrence_start_date!
          : new Intl.DateTimeFormat('en-CA',{ timeZone:event.event_timezone,year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(event.occurrence_start_at!))
        grouped.set(key,[...(grouped.get(key) ?? []),event])
      }

      const sections=[...grouped.entries()].map(([day,items])=>{
        const dayLabel=new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{ weekday:'long',day:'numeric',month:'long' })
        const rows=items.map((event)=>{
          const time=event.all_day ? 'All day' : new Date(event.occurrence_start_at!).toLocaleTimeString('en-GB',{ timeZone:event.event_timezone,hour:'2-digit',minute:'2-digit' })
          const people=event.people.length ? ' · '+event.people.join(', ') : ''
          const location=event.location_text ? ' · '+escapeHtml(event.location_text) : ''
          return '<li style="margin:8px 0"><strong>'+escapeHtml(time+' · '+event.title)+'</strong>'+escapeHtml(people)+location+'</li>'
        }).join('')
        return '<section style="margin:22px 0"><h3 style="margin:0 0 8px;color:#6d347e">'+escapeHtml(dayLabel)+'</h3><ul style="padding-left:18px;margin:0">'+rows+'</ul></section>'
      }).join('')

      const empty='<p style="color:#766d7b">There are no calendar events in this summary period.</p>'
      const kindLabel=delivery.summary_kind==='daily' ? 'Daily family summary' : 'Weekly family summary'
      const subject=delivery.summary_kind==='daily'
        ? 'Famioo · Today in '+household.name
        : 'Famioo · Your week in '+household.name
      const html='<!doctype html><html><body style="font-family:Arial,sans-serif;color:#443a47;line-height:1.5">'
        +'<div style="max-width:620px;margin:auto;padding:24px">'
        +'<div style="font-size:12px;letter-spacing:.12em;color:#a24e95">FAMIOO</div>'
        +'<h1 style="margin:6px 0 4px;color:#5f316f">'+escapeHtml(kindLabel)+'</h1>'
        +'<p style="margin-top:0;color:#8a7d8e">'+escapeHtml(delivery.period_start)
        +(delivery.period_end!==delivery.period_start ? ' – '+escapeHtml(delivery.period_end) : '')+'</p>'
        +(sections || empty)
        +'<p style="margin-top:28px;font-size:12px;color:#9b8fa0">You receive this because the summary is enabled in Famioo Settings.</p>'
        +'</div></body></html>'

      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',
        headers:{
          'Authorization':'Bearer '+resendKey,
          'Content-Type':'application/json',
        },
        body:JSON.stringify({
          from:'Famioo <famioo@propelotonmanager.com>',
          to:[delivery.recipient_email],
          subject,
          html,
        }),
      })

      const responseText=await response.text()
      if (!response.ok) throw new Error('Email provider '+response.status+': '+responseText.slice(0,500))

      await sql`
        update public.summary_email_deliveries
        set status='sent',provider_status=${response.status},
            provider_response=${responseText || '{}'}::jsonb,
            sent_at=now(),error_text=null,updated_at=now()
        where id=${delivery.id}::uuid
      `
      sent+=1
    } catch (error) {
      const message=error instanceof Error ? error.message : String(error)
      await sql`
        update public.summary_email_deliveries
        set status=case when attempts>=5 then 'expired' else 'failed' end,
            error_text=left(${message},1000),updated_at=now()
        where id=${delivery.id}::uuid
      `
      failed+=1
    }
  }

  return { claimed:deliveries.length,sent,failed,configured:true }
}


async function sendSystemEmails() {
  const resendKey=await secret('famioo_resend_api_key')
  if (!resendKey) {
    return { claimed:0,sent:0,failed:0,configured:false }
  }

  const deliveries=await sql.begin(async (tx)=> {
    const rows=await tx<Array<{
      id:string; household_id:string; user_id:string; kind:'storage_downgrade';
      recipient_email:string; payload_json:Record<string,unknown>; attempts:number
    }>>`
      with candidates as (
        select id
        from public.system_email_deliveries
        where status in ('pending','failed')
          and scheduled_for<=now()
          and scheduled_for>=now()-interval '7 days'
          and attempts<5
        order by scheduled_for,created_at
        for update skip locked
        limit 25
      )
      update public.system_email_deliveries d
      set status='sending',attempts=d.attempts+1,last_attempt_at=now(),updated_at=now()
      from candidates c
      where d.id=c.id
      returning d.id::text,d.household_id::text,d.user_id::text,d.kind,
                d.recipient_email,d.payload_json,d.attempts
    `
    return rows
  })

  let sent=0
  let failed=0

  for (const delivery of deliveries) {
    try {
      const householdRows=await sql<Array<{ name:string }>>`
        select name from public.households where id=${delivery.household_id}::uuid limit 1
      `
      const household=householdRows[0]
      if (!household) throw new Error('Household not found')

      let subject='Famioo account update'
      let html=''

      if (delivery.kind==='storage_downgrade') {
        const paid=Number(delivery.payload_json?.paid_monthly_eur ?? 0)
        const addon=Number(delivery.payload_json?.storage_addon_price_eur ?? 0.49)
        const grace=String(delivery.payload_json?.grace_until ?? '')
        const graceLabel=grace
          ? new Date(grace).toLocaleDateString('en-GB',{ day:'numeric',month:'long',year:'numeric' })
          : ''

        subject='Famioo · Your Files storage changed to 1 GB'
        html='<!doctype html><html><body style="font-family:Arial,sans-serif;color:#443a47;line-height:1.55">'
          +'<div style="max-width:620px;margin:auto;padding:24px">'
          +'<div style="font-size:12px;letter-spacing:.12em;color:#a24e95">FAMIOO</div>'
          +'<h1 style="margin:6px 0 10px;color:#5f316f">Your Files storage benefit changed</h1>'
          +'<p>Your qualifying paid Famioo modules for <strong>'+escapeHtml(household.name)+'</strong> are now '
          +'<strong>€'+paid.toFixed(2)+'/month</strong>, which is below the €3.00 threshold for the included 10 GB Files tier.</p>'
          +'<p>Your free Files allowance is now <strong>1 GB</strong>. Existing files are not automatically deleted.</p>'
          +'<div style="margin:18px 0;padding:14px 16px;border-radius:12px;background:#f7f0f9">'
          +'<strong>Keep 10 GB for €'+addon.toFixed(2)+'/month</strong>'
          +'<p style="margin:6px 0 0">You can keep the larger Files allowance as a storage add-on. '
          +'If your existing usage is above 1 GB and you do not keep 10 GB, new uploads are paused until usage is reduced below the free allowance.</p>'
          +(graceLabel ? '<p style="margin:6px 0 0;color:#7d7082">Current downgrade window: until '+escapeHtml(graceLabel)+'.</p>' : '')
          +'</div>'
          +'<p style="font-size:12px;color:#9b8fa0">This is a transactional storage/account notice from Famioo.</p>'
          +'</div></body></html>'
      }

      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',
        headers:{
          'Authorization':'Bearer '+resendKey,
          'Content-Type':'application/json',
        },
        body:JSON.stringify({
          from:'Famioo <famioo@propelotonmanager.com>',
          to:[delivery.recipient_email],
          subject,
          html,
        }),
      })

      const responseText=await response.text()
      if (!response.ok) throw new Error('Email provider '+response.status+': '+responseText.slice(0,500))

      await sql`
        update public.system_email_deliveries
        set status='sent',provider_status=${response.status},
            provider_response=${responseText || '{}'}::jsonb,
            sent_at=now(),error_text=null,updated_at=now()
        where id=${delivery.id}::uuid
      `
      sent+=1
    } catch (error) {
      const message=error instanceof Error ? error.message : String(error)
      await sql`
        update public.system_email_deliveries
        set status=case when attempts>=5 then 'expired' else 'failed' end,
            error_text=left(${message},1000),updated_at=now()
        where id=${delivery.id}::uuid
      `
      failed+=1
    }
  }

  return { claimed:deliveries.length,sent,failed,configured:true }
}

Deno.serve(async (req) => {
  if (req.method!=='POST') return json({ error:'Method not allowed' },405)

  try {
    const expected=await secret('famioo_notification_worker_token')
    const supplied=req.headers.get('x-famioo-worker') ?? ''
    if (!expected || supplied!==expected) return json({ error:'Unauthorized worker' },401)

    const queuedReminders=await sql`select private.queue_due_calendar_notifications(now()) as count`
    const queuedSummaries=await sql`select private.queue_due_summary_emails(now()) as count`
    const pushes=await sendPushes()
    const emails=await sendSummaryEmails()
    const systemEmails=await sendSystemEmails()

    return json({
      ok:true,
      queuedReminders:Number(queuedReminders[0]?.count ?? 0),
      queuedSummaries:Number(queuedSummaries[0]?.count ?? 0),
      pushes,
      emails,
      systemEmails,
      checkedAt:new Date().toISOString(),
    })
  } catch (error) {
    console.error('famioo-notification-worker error',error)
    return json({ ok:false,error:error instanceof Error ? error.message : 'Unexpected worker error' },500)
  }
})
