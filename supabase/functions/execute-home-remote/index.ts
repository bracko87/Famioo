import { createClient } from "npm:@supabase/supabase-js@2"

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
}
function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}})
}
function publishableKey(){
  const current=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if(current){try{const parsed=JSON.parse(current) as Record<string,string>;if(parsed.default)return parsed.default}catch{}}
  return Deno.env.get("SUPABASE_ANON_KEY")??""
}
function secretKey(){
  const current=Deno.env.get("SUPABASE_SECRET_KEYS")
  if(current){try{const parsed=JSON.parse(current) as Record<string,string>;if(parsed.default)return parsed.default}catch{}}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??""
}

const allowedCommands=new Set([
  "power","volume_up","volume_down","mute","home","play_pause",
  "up","down","left","right","select","back",
])

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors})
  if(req.method!=="POST")return json({error:"Method not allowed."},405)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer "))return json({error:"Authentication required."},401)

  let body:{household_id?:string;device_id?:string;command?:string}
  try{body=await req.json()}catch{return json({error:"Invalid request."},400)}

  const householdId=String(body.household_id??"")
  const deviceId=String(body.device_id??"")
  const command=String(body.command??"")
  if(!householdId||!deviceId||!allowedCommands.has(command))return json({error:"Invalid remote command."},400)

  const supabaseUrl=Deno.env.get("SUPABASE_URL")??""
  const clientKey=publishableKey()
  const adminKey=secretKey()
  if(!supabaseUrl||!clientKey||!adminKey)return json({error:"Server configuration is incomplete."},500)

  const userClient=createClient(supabaseUrl,clientKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const token=authorization.slice(7).trim()
  const userResult=await userClient.auth.getUser(token)
  if(userResult.error||!userResult.data.user)return json({error:"Authentication required."},401)
  const userId=userResult.data.user.id

  const deviceResult=await userClient.from("home_remote_devices")
    .select("id,household_id,name,capabilities,active")
    .eq("id",deviceId).eq("household_id",householdId).single()
  if(deviceResult.error||!deviceResult.data||deviceResult.data.active!==true)return json({error:"Remote device not available."},404)

  const capabilities=Array.isArray(deviceResult.data.capabilities)?deviceResult.data.capabilities.map(String):[]
  if(!capabilities.includes(command))return json({error:"This device does not support that command."},400)

  const memberResult=await userClient.from("household_members")
    .select("role,status").eq("household_id",householdId).eq("user_id",userId).maybeSingle()
  const isAdmin=Boolean(memberResult.data?.status==="active"&&["owner","admin"].includes(String(memberResult.data.role)))

  if(!isAdmin){
    const profileResult=await userClient.from("family_profiles")
      .select("id").eq("household_id",householdId).eq("linked_user_id",userId).eq("active",true).maybeSingle()
    if(!profileResult.data?.id)return json({error:"Remote permission is required."},403)

    const permissionResult=await userClient.from("home_remote_device_permissions")
      .select("can_control").eq("device_id",deviceId).eq("profile_id",profileResult.data.id).maybeSingle()
    if(permissionResult.data?.can_control!==true)return json({error:"You are not allowed to control this device."},403)
  }

  const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const bridgeResult=await admin.from("home_remote_device_bridges")
    .select("webhook_url,bearer_token").eq("device_id",deviceId).eq("household_id",householdId).single()
  if(bridgeResult.error||!bridgeResult.data)return json({error:"This device bridge is not configured."},503)

  let target:URL
  try{
    target=new URL(String(bridgeResult.data.webhook_url))
    if(target.protocol!=="https:")throw new Error("https required")
  }catch{return json({error:"Device bridge URL is invalid."},503)}

  let response:Response
  try{
    response=await fetch(target.toString(),{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        ...(bridgeResult.data.bearer_token?{"Authorization":"Bearer "+bridgeResult.data.bearer_token}:{}),
      },
      body:JSON.stringify({
        source:"famioo",
        household_id:householdId,
        device_id:deviceId,
        device_name:deviceResult.data.name,
        command,
        requested_at:new Date().toISOString(),
      }),
      signal:AbortSignal.timeout(7000),
    })
  }catch{
    await admin.from("home_remote_command_log").insert({
      household_id:householdId,device_id:deviceId,command,requested_by_user_id:userId,success:false,
    })
    return json({error:"The device bridge could not be reached."},502)
  }

  await admin.from("home_remote_command_log").insert({
    household_id:householdId,
    device_id:deviceId,
    command,
    requested_by_user_id:userId,
    success:response.ok,
    response_status:response.status,
  })

  if(!response.ok)return json({error:"The device bridge rejected the command.",status:response.status},502)
  return json({ok:true,device_id:deviceId,command})
})
