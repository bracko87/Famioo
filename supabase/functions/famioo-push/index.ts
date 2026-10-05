import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.105.0'
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const dbUrl = Deno.env.get('SUPABASE_DB_URL')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const sql = postgres(dbUrl, { prepare:false, max:1 })

function json(data: unknown, status=200) {
  return new Response(JSON.stringify(data), { status, headers:corsHeaders })
}

function decodeBase64Url(value: string) {
  const base64=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')
  const binary=atob(base64)
  return Uint8Array.from(binary,(char)=>char.charCodeAt(0))
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary=''
  for (const byte of bytes) binary+=String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')
}

async function generateVapidKeys() {
  const pair=await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' },true,['sign','verify'])
  const publicJwk=await crypto.subtle.exportKey('jwk',pair.publicKey)
  const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey)
  if (!publicJwk.x || !publicJwk.y || !privateJwk.d) throw new Error('Unable to create notification keys')
  const x=decodeBase64Url(publicJwk.x)
  const y=decodeBase64Url(publicJwk.y)
  const publicBytes=new Uint8Array(65)
  publicBytes[0]=4
  publicBytes.set(x,1)
  publicBytes.set(y,33)
  return { publicKey:encodeBase64Url(publicBytes), privateKey:privateJwk.d }
}

async function readConfig() {
  const rows=await sql<Array<{ public_key:string; private_key:string }>>`
    select c.public_key,s.decrypted_secret as private_key
    from private.notification_push_config c
    join vault.decrypted_secrets s on s.name=c.vault_secret_name
    where c.singleton=true
    limit 1
  `
  return rows[0] ?? null
}

async function getOrCreateConfig() {
  const existing=await readConfig()
  if (existing) return existing

  return await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('famioo_web_push_vapid'))`
    const afterLock=await tx<Array<{ public_key:string; private_key:string }>>`
      select c.public_key,s.decrypted_secret as private_key
      from private.notification_push_config c
      join vault.decrypted_secrets s on s.name=c.vault_secret_name
      where c.singleton=true
      limit 1
    `
    if (afterLock[0]) return afterLock[0]

    const generated=await generateVapidKeys()
    const secretName='famioo_vapid_private_key'
    const secret=await tx<Array<{ id:string }>>`
      select id::text from vault.secrets where name=${secretName} limit 1
    `

    if (secret[0]) {
      await tx`select vault.update_secret(${secret[0].id}::uuid,${generated.privateKey},${secretName},'Private VAPID key for Famioo Web Push')`
    } else {
      await tx`select vault.create_secret(${generated.privateKey},${secretName},'Private VAPID key for Famioo Web Push')`
    }

    await tx`
      insert into private.notification_push_config(singleton,public_key,vault_secret_name)
      values(true,${generated.publicKey},${secretName})
      on conflict(singleton) do update
      set public_key=excluded.public_key,
          vault_secret_name=excluded.vault_secret_name,
          updated_at=now()
    `
    return { public_key:generated.publicKey, private_key:generated.privateKey }
  })
}

async function authenticate(req: Request) {
  const authorization=req.headers.get('Authorization') ?? ''
  const token=authorization.replace(/^Bearer\s+/i,'')
  if (!token) return null
  const client=createClient(supabaseUrl,anonKey,{ auth:{ persistSession:false,autoRefreshToken:false } })
  const { data,error }=await client.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

Deno.serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{ headers:corsHeaders })
  if (req.method!=='POST') return json({ error:'Method not allowed' },405)

  try {
    const user=await authenticate(req)
    if (!user) return json({ error:'Authentication required' },401)

    const body=await req.json().catch(()=>({}))
    const householdId=typeof body?.household_id==='string' ? body.household_id : ''
    if (!householdId) return json({ error:'Household is required' },400)

    const membership=await sql<Array<{ ok:boolean }>>`
      select exists(
        select 1 from public.household_members
        where household_id=${householdId}::uuid
          and user_id=${user.id}::uuid
          and status='active'
      ) as ok
    `
    if (!membership[0]?.ok) return json({ error:'Household access required' },403)

    const action=typeof body?.action==='string' ? body.action : 'public-key'
    const config=await getOrCreateConfig()

    if (action==='public-key') return json({ publicKey:config.public_key })

    if (action==='test') {
      webpush.setVapidDetails('mailto:famioo@propelotonmanager.com',config.public_key,config.private_key)
      const subscriptions=await sql<Array<{ id:string; endpoint:string; p256dh:string; auth_key:string }>>`
        select id::text,endpoint,p256dh,auth_key
        from public.push_subscriptions
        where household_id=${householdId}::uuid
          and user_id=${user.id}::uuid
          and active=true
        order by updated_at desc
      `

      let sent=0
      let failed=0
      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification(
            { endpoint:subscription.endpoint,keys:{ p256dh:subscription.p256dh,auth:subscription.auth_key } },
            JSON.stringify({
              title:'Famioo',
              body:'Push notifications are connected on this device.',
              icon:'/famioo-icon-192.png',
              badge:'/famioo-icon-192.png',
              tag:'famioo-push-test',
              url:'/app/settings?tab=notifications-security',
            }),
            { TTL:60,urgency:'normal' },
          )
          sent+=1
          await sql`update public.push_subscriptions set last_seen_at=now(),updated_at=now() where id=${subscription.id}::uuid`
        } catch (error) {
          failed+=1
          const statusCode=typeof error==='object' && error && 'statusCode' in error
            ? Number((error as { statusCode?:number }).statusCode)
            : null
          if (statusCode===404 || statusCode===410) {
            await sql`update public.push_subscriptions set active=false,updated_at=now() where id=${subscription.id}::uuid`
          }
        }
      }

      return json({
        attempted:subscriptions.length,
        sent,
        failed,
        message:subscriptions.length===0
          ? 'No active push subscription is registered on this device.'
          : sent>0 ? 'Test notification sent.' : 'The push provider did not accept the notification.',
      })
    }

    return json({ error:'Unknown action' },400)
  } catch (error) {
    console.error('famioo-push error',error)
    return json({ error:error instanceof Error ? error.message : 'Unexpected push error' },500)
  }
})
