import { supabase } from './supabase'

export type PushStatus = {
  supported:boolean
  permission:NotificationPermission | 'unsupported'
  subscribed:boolean
}

function base64UrlToArrayBuffer(value:string):ArrayBuffer {
  const padding='='.repeat((4-(value.length%4))%4)
  const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/')
  const raw=window.atob(base64)
  const bytes=new Uint8Array(raw.length)
  for (let index=0;index<raw.length;index+=1) bytes[index]=raw.charCodeAt(index)
  return bytes.buffer
}

export function pushIsSupported() {
  return typeof window!=='undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window
}

async function serviceWorkerRegistration() {
  if (!pushIsSupported()) throw new Error('Web Push is not supported in this browser.')
  return await navigator.serviceWorker.ready
}

export async function getPushStatus():Promise<PushStatus> {
  if (!pushIsSupported()) return { supported:false,permission:'unsupported',subscribed:false }
  const registration=await serviceWorkerRegistration()
  const subscription=await registration.pushManager.getSubscription()
  return { supported:true,permission:Notification.permission,subscribed:Boolean(subscription) }
}

async function getPublicKey(householdId:string) {
  const { data,error }=await supabase.functions.invoke('famioo-push',{
    body:{ action:'public-key',household_id:householdId },
  })
  if (error) throw new Error(error.message)
  if (!data?.publicKey) throw new Error('The push notification server key is unavailable.')
  return data.publicKey as string
}

export async function enablePushNotifications(householdId:string,userId:string) {
  if (!pushIsSupported()) throw new Error('Web Push is not supported in this browser.')

  const permission=await Notification.requestPermission()
  if (permission!=='granted') {
    throw new Error(permission==='denied'
      ? 'Notifications are blocked for Famioo in your device/browser settings.'
      : 'Notification permission was not granted.')
  }

  const registration=await serviceWorkerRegistration()
  const publicKey=await getPublicKey(householdId)
  let subscription=await registration.pushManager.getSubscription()

  if (!subscription) {
    subscription=await registration.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:base64UrlToArrayBuffer(publicKey),
    })
  }

  const json=subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('The browser returned an incomplete push subscription.')
  }

  const { error }=await supabase
    .from('push_subscriptions')
    .upsert({
      household_id:householdId,
      user_id:userId,
      endpoint:json.endpoint,
      p256dh:json.keys.p256dh,
      auth_key:json.keys.auth,
      user_agent:navigator.userAgent,
      active:true,
      last_seen_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    },{ onConflict:'user_id,endpoint' })

  if (error) {
    await subscription.unsubscribe().catch(()=>false)
    throw new Error(error.message)
  }
}

export async function disablePushNotifications(householdId:string,userId:string) {
  if (!pushIsSupported()) return
  const registration=await serviceWorkerRegistration()
  const subscription=await registration.pushManager.getSubscription()
  if (!subscription) return

  const endpoint=subscription.endpoint
  const { error }=await supabase
    .from('push_subscriptions')
    .delete()
    .eq('household_id',householdId)
    .eq('user_id',userId)
    .eq('endpoint',endpoint)

  if (error) throw new Error(error.message)
  await subscription.unsubscribe()
}

export async function sendTestPush(householdId:string) {
  const { data,error }=await supabase.functions.invoke('famioo-push',{
    body:{ action:'test',household_id:householdId },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data as { attempted:number;sent:number;failed:number;message:string }
}
