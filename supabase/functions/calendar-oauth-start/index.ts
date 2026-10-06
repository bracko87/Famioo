import { createClient } from "npm:@supabase/supabase-js@2"

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
}

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors,"Content-Type":"application/json"},
  })
}

function providerConfig(provider:"microsoft"|"google"){
  if(provider==="microsoft"){
    return {
      clientId:Deno.env.get("FAMIOO_MICROSOFT_CALENDAR_CLIENT_ID")??"",
      clientSecret:Deno.env.get("FAMIOO_MICROSOFT_CALENDAR_CLIENT_SECRET")??"",
    }
  }
  return {
    clientId:Deno.env.get("FAMIOO_GOOGLE_CALENDAR_CLIENT_ID")??"",
    clientSecret:Deno.env.get("FAMIOO_GOOGLE_CALENDAR_CLIENT_SECRET")??"",
  }
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json({error:"Method not allowed"},405)

  const supabaseUrl=Deno.env.get("SUPABASE_URL")
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")
  const serviceRoleKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if(!supabaseUrl||!anonKey||!serviceRoleKey) return json({error:"Server configuration is incomplete."},500)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401)

  const userClient=createClient(supabaseUrl,anonKey,{
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false,autoRefreshToken:false},
  })
  const admin=createClient(supabaseUrl,serviceRoleKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  })

  const userResult=await userClient.auth.getUser()
  const user=userResult.data.user
  if(!user) return json({error:"Authentication required."},401)

  let body:{
    action?:string
    provider?:"microsoft"|"google"
    household_id?:string
    target_calendar_id?:string
    import_mode?:"busy"|"title"|"full"
    display_name?:string
  }
  try{ body=await req.json() }catch{ body={} }

  if(body.action==="status"){
    const microsoft=providerConfig("microsoft")
    const google=providerConfig("google")
    const tokenKey=Boolean(Deno.env.get("FAMIOO_CALENDAR_TOKEN_KEY_B64"))
    const appUrl=Boolean(Deno.env.get("FAMIOO_APP_URL"))

    return json({
      microsoft:Boolean(microsoft.clientId&&microsoft.clientSecret&&tokenKey&&appUrl),
      google:Boolean(google.clientId&&google.clientSecret&&tokenKey&&appUrl),
    })
  }

  const provider=body.provider
  if(provider!=="microsoft"&&provider!=="google"){
    return json({error:"Choose Microsoft or Google."},400)
  }

  if(!body.household_id||!body.target_calendar_id){
    return json({error:"Household and target calendar are required."},400)
  }

  const importMode=body.import_mode??"busy"
  if(!["busy","title","full"].includes(importMode)){
    return json({error:"Invalid import mode."},400)
  }

  const accessResult=await userClient.rpc("household_module_enabled_v1",{
    p_household_id:body.household_id,
    p_module_code:"calendar_connections",
  })
  if(accessResult.error||accessResult.data!==true){
    return json({error:"Calendar Connections is not enabled for this household."},403)
  }

  const calendarResult=await userClient
    .from("calendars")
    .select("id,name")
    .eq("household_id",body.household_id)
    .eq("id",body.target_calendar_id)
    .eq("active",true)
    .maybeSingle()

  if(calendarResult.error||!calendarResult.data){
    return json({error:"Target calendar was not found."},404)
  }

  const config=providerConfig(provider)
  const tokenKey=Deno.env.get("FAMIOO_CALENDAR_TOKEN_KEY_B64")
  const appUrl=Deno.env.get("FAMIOO_APP_URL")
  if(!config.clientId||!config.clientSecret||!tokenKey||!appUrl){
    return json({
      error:(provider==="microsoft"?"Microsoft 365":"Google Calendar")
        +" OAuth is not configured for this Famioo environment yet.",
      configured:false,
    },503)
  }

  const state=crypto.randomUUID()+crypto.randomUUID().replaceAll("-","")
  const displayName=(body.display_name??(
    provider==="microsoft"?"Microsoft 365":"Google Calendar"
  )).trim().slice(0,120)

  const stateResult=await admin.from("calendar_oauth_states").insert({
    state,
    provider,
    household_id:body.household_id,
    user_id:user.id,
    target_calendar_id:body.target_calendar_id,
    import_mode:importMode,
    display_name:displayName||provider,
  })

  if(stateResult.error){
    return json({error:"Could not prepare the calendar connection."},500)
  }

  const redirectUri=supabaseUrl+"/functions/v1/calendar-oauth-callback?provider="+encodeURIComponent(provider)
  let authorizationUrl:string

  if(provider==="microsoft"){
    const scope=importMode==="full"
      ? "openid profile email offline_access https://graph.microsoft.com/Calendars.Read"
      : "openid profile email offline_access https://graph.microsoft.com/Calendars.ReadBasic"

    const url=new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    url.searchParams.set("client_id",config.clientId)
    url.searchParams.set("response_type","code")
    url.searchParams.set("redirect_uri",redirectUri)
    url.searchParams.set("response_mode","query")
    url.searchParams.set("scope",scope)
    url.searchParams.set("state",state)
    url.searchParams.set("prompt","select_account")
    authorizationUrl=url.toString()
  }else{
    const url=new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id",config.clientId)
    url.searchParams.set("redirect_uri",redirectUri)
    url.searchParams.set("response_type","code")
    url.searchParams.set("scope","openid email profile https://www.googleapis.com/auth/calendar.readonly")
    url.searchParams.set("access_type","offline")
    url.searchParams.set("include_granted_scopes","true")
    url.searchParams.set("prompt","consent")
    url.searchParams.set("state",state)
    authorizationUrl=url.toString()
  }

  return json({ok:true,authorization_url:authorizationUrl,configured:true})
})
