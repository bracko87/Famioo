import { createClient } from "npm:@supabase/supabase-js@2"

function redirect(url:string){
  return new Response(null,{status:302,headers:{Location:url}})
}

function safeError(value:string){
  return value.replace(/[^a-zA-Z0-9 _.-]+/g," ").trim().slice(0,180)
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

function decodeBase64(value:string){
  const raw=atob(value)
  return Uint8Array.from(raw,(char)=>char.charCodeAt(0))
}

function encodeBase64(value:Uint8Array){
  let text=""
  for(const byte of value) text+=String.fromCharCode(byte)
  return btoa(text)
}

async function encryptionKey(){
  const keyB64=Deno.env.get("FAMIOO_CALENDAR_TOKEN_KEY_B64")
  if(!keyB64) throw new Error("Calendar token encryption key is missing")
  const bytes=decodeBase64(keyB64)
  if(bytes.length!==32) throw new Error("Calendar token encryption key must be 32 bytes")
  return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"])
}

async function encryptSecret(value:string,key:CryptoKey){
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const encoded=new TextEncoder().encode(value)
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoded)
  return {
    ciphertext:encodeBase64(new Uint8Array(encrypted)),
    iv:encodeBase64(iv),
  }
}

Deno.serve(async(req)=>{
  const supabaseUrl=Deno.env.get("SUPABASE_URL")
  const serviceRoleKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const appBase=(Deno.env.get("FAMIOO_APP_URL")??"").replace(/\/$/,"")
  const fail=(message:string)=>{
    const target=appBase
      ? appBase+"/app/calendar/connections?connection_error="+encodeURIComponent(safeError(message))
      : supabaseUrl+"/functions/v1/calendar-oauth-callback-error"
    return redirect(target)
  }

  if(!supabaseUrl||!serviceRoleKey||!appBase){
    return fail("Calendar OAuth server configuration is incomplete.")
  }

  const url=new URL(req.url)
  const provider=url.searchParams.get("provider")
  if(provider!=="microsoft"&&provider!=="google") return fail("Calendar provider is invalid.")

  const providerError=url.searchParams.get("error")
  if(providerError){
    return fail(url.searchParams.get("error_description")||providerError)
  }

  const code=url.searchParams.get("code")
  const state=url.searchParams.get("state")
  if(!code||!state) return fail("Calendar authorization did not return the expected code.")

  const admin=createClient(supabaseUrl,serviceRoleKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  })

  const stateResult=await admin
    .from("calendar_oauth_states")
    .select("state,provider,household_id,user_id,target_calendar_id,import_mode,display_name,expires_at,used_at")
    .eq("state",state)
    .maybeSingle()

  const oauthState=stateResult.data
  if(stateResult.error||!oauthState) return fail("Calendar connection session was not found.")
  if(oauthState.provider!==provider) return fail("Calendar provider did not match the connection session.")
  if(oauthState.used_at) return fail("This calendar connection link was already used.")
  if(new Date(oauthState.expires_at).getTime()<Date.now()) return fail("This calendar connection link expired. Start again.")

  await admin.from("calendar_oauth_states").update({used_at:new Date().toISOString()}).eq("state",state)

  const config=providerConfig(provider)
  if(!config.clientId||!config.clientSecret) return fail("Calendar OAuth credentials are not configured.")

  const redirectUri=supabaseUrl+"/functions/v1/calendar-oauth-callback?provider="+encodeURIComponent(provider)

  let tokenResponse:Response
  if(provider==="microsoft"){
    const form=new URLSearchParams({
      client_id:config.clientId,
      client_secret:config.clientSecret,
      code,
      redirect_uri:redirectUri,
      grant_type:"authorization_code",
    })
    tokenResponse=await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:form,
    })
  }else{
    const form=new URLSearchParams({
      client_id:config.clientId,
      client_secret:config.clientSecret,
      code,
      redirect_uri:redirectUri,
      grant_type:"authorization_code",
    })
    tokenResponse=await fetch("https://oauth2.googleapis.com/token",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:form,
    })
  }

  const tokenPayload=await tokenResponse.json().catch(()=>({}))
  if(!tokenResponse.ok||!tokenPayload.access_token){
    return fail("The calendar provider did not accept the authorization code.")
  }

  const accessToken=String(tokenPayload.access_token)
  const refreshToken=tokenPayload.refresh_token?String(tokenPayload.refresh_token):null
  const expiresIn=Number(tokenPayload.expires_in??3600)
  const expiresAt=new Date(Date.now()+Math.max(60,expiresIn)*1000).toISOString()
  const scopeText=String(tokenPayload.scope??"")

  let accountLabel=""
  let externalCalendarId=""

  if(provider==="microsoft"){
    const [profileResponse,calendarResponse]=await Promise.all([
      fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",{
        headers:{Authorization:"Bearer "+accessToken},
      }),
      fetch("https://graph.microsoft.com/v1.0/me/calendar?$select=id,name",{
        headers:{Authorization:"Bearer "+accessToken},
      }),
    ])

    const profile=await profileResponse.json().catch(()=>({}))
    const calendar=await calendarResponse.json().catch(()=>({}))
    accountLabel=String(profile.mail||profile.userPrincipalName||profile.displayName||"Microsoft 365")
    externalCalendarId=String(calendar.id||"primary")
  }else{
    const [profileResponse,calendarResponse]=await Promise.all([
      fetch("https://openidconnect.googleapis.com/v1/userinfo",{
        headers:{Authorization:"Bearer "+accessToken},
      }),
      fetch("https://www.googleapis.com/calendar/v3/calendars/primary",{
        headers:{Authorization:"Bearer "+accessToken},
      }),
    ])

    const profile=await profileResponse.json().catch(()=>({}))
    const calendar=await calendarResponse.json().catch(()=>({}))
    accountLabel=String(profile.email||profile.name||"Google Calendar")
    externalCalendarId=String(calendar.id||"primary")
  }

  const connectionResult=await admin
    .from("calendar_connections")
    .insert({
      household_id:oauthState.household_id,
      provider,
      display_name:oauthState.display_name,
      target_calendar_id:oauthState.target_calendar_id,
      import_mode:oauthState.import_mode,
      feed_url:null,
      external_account_label:accountLabel,
      external_calendar_id:externalCalendarId,
      status:"connected",
      sync_enabled:true,
      created_by_user_id:oauthState.user_id,
    })
    .select("id")
    .single()

  if(connectionResult.error||!connectionResult.data){
    return fail("Famioo could not save the calendar connection.")
  }

  try{
    const key=await encryptionKey()
    const accessEncrypted=await encryptSecret(accessToken,key)
    const refreshEncrypted=refreshToken ? await encryptSecret(refreshToken,key) : null

    const tokenInsert=await admin.from("calendar_connection_tokens").insert({
      connection_id:connectionResult.data.id,
      provider,
      access_token_ciphertext:accessEncrypted.ciphertext,
      access_token_iv:accessEncrypted.iv,
      refresh_token_ciphertext:refreshEncrypted?.ciphertext??null,
      refresh_token_iv:refreshEncrypted?.iv??null,
      token_expires_at:expiresAt,
      scope_text:scopeText,
    })

    if(tokenInsert.error) throw tokenInsert.error
  }catch(error){
    await admin.from("calendar_connections").delete().eq("id",connectionResult.data.id)
    return fail(error instanceof Error?error.message:"Could not protect the calendar token.")
  }

  return redirect(
    appBase+"/app/calendar/connections?connected="+encodeURIComponent(provider)
  )
})
