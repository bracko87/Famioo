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
      id:string; household_id:string; recipient_user_id:string; title:string; body:string;
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
                n.title,n.body,n.entity_id::text
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
            tag:'famioo-'+item.id,
            url:'/app/calendar',
          }),
          { TTL:3600,urgency:'normal' },
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
        left join public.event_participants ep
          on ep.event_id=o.event_id and ep.household_id=o.household_id
        left join public.family_profiles fp
          on fp.id=ep.profile_id and fp.household_id=ep.household_id and fp.active
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

  return { claimed:deliveries.length,sent,failed }
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

    return json({
      ok:true,
      queuedReminders:Number(queuedReminders[0]?.count ?? 0),
      queuedSummaries:Number(queuedSummaries[0]?.count ?? 0),
      pushes,
      emails,
      checkedAt:new Date().toISOString(),
    })
  } catch (error) {
    console.error('famioo-notification-worker error',error)
    return json({ ok:false,error:error instanceof Error ? error.message : 'Unexpected worker error' },500)
  }
})
