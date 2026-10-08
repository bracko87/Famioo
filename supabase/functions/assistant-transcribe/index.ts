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

function publishableKey(){
  const current=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if(current){
    try{
      const parsed=JSON.parse(current) as Record<string,string>
      if(parsed.default) return parsed.default
    }catch{
      // Legacy key fallback remains below.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY")??""
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json({error:"Method not allowed."},405)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401)

  const supabaseUrl=Deno.env.get("SUPABASE_URL")??""
  const clientKey=publishableKey()
  if(!supabaseUrl||!clientKey) return json({error:"Server configuration is incomplete."},500)

  const userClient=createClient(supabaseUrl,clientKey,{
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false,autoRefreshToken:false},
  })

  const token=authorization.slice("Bearer ".length).trim()
  const userResult=await userClient.auth.getUser(token)
  if(userResult.error||!userResult.data.user){
    return json({error:"Authentication required."},401)
  }

  let form:FormData
  try{
    form=await req.formData()
  }catch{
    return json({error:"Invalid audio upload."},400)
  }

  const householdId=String(form.get("household_id")??"").trim()
  const file=form.get("file")

  if(!householdId) return json({error:"Household is required."},400)
  if(!(file instanceof File)) return json({error:"Audio recording is required."},400)
  if(file.size===0) return json({error:"The audio recording is empty."},400)
  if(file.size>20*1024*1024) return json({error:"The audio recording is too large."},413)

  const householdResult=await userClient
    .from("households")
    .select("id,name")
    .eq("id",householdId)
    .single()

  if(householdResult.error||!householdResult.data){
    return json({error:"This household is not accessible."},403)
  }

  const assistantAccess=await userClient.rpc("household_module_enabled_v1",{
    p_household_id:householdId,
    p_module_code:"assistant",
  })
  if(assistantAccess.error){
    console.error("Assistant entitlement check failed",assistantAccess.error)
    return json({error:"Famioo could not verify AI Assistant access."},503)
  }
  if(assistantAccess.data!==true){
    return json({
      error:"AI Assistant is not enabled for this household.",
      code:"AI_ASSISTANT_REQUIRED",
    },403)
  }

  const profilesResult=await userClient
    .from("family_profiles")
    .select("display_name")
    .eq("household_id",householdId)
    .eq("active",true)
    .order("display_name")

  const names=(profilesResult.data??[])
    .map((row:any)=>String(row.display_name||"").trim())
    .filter(Boolean)
    .slice(0,20)

  const apiKey=Deno.env.get("OPENAI_API_KEY")
  if(!apiKey) return json({error:"Voice transcription is not configured on the server."},503)

  const openAiForm=new FormData()
  const extension=file.type.includes("mp4")||file.type.includes("m4a")
    ?"m4a"
    :file.type.includes("ogg")
      ?"ogg"
      :file.type.includes("wav")
        ?"wav"
        :"webm"

  openAiForm.append("file",file,"famioo-voice."+extension)
  openAiForm.append("model","gpt-transcribe")
  openAiForm.append("response_format","json")
  openAiForm.append(
    "prompt",
    [
      "This is a voice command for the Famioo family organization app.",
      "The speaker may use English, German, Serbian, or switch between them.",
      "Preserve the spoken language instead of translating it.",
      "Common app words include Famioo, Calendar, Task, Checklist, Shopping, notification, reminder and appointment.",
      names.length?"Household member names: "+names.join(", ")+".":"",
      "Transcribe dates, times, names and numbers carefully.",
    ].filter(Boolean).join(" "),
  )

  let response:Response
  try{
    response=await fetch("https://api.openai.com/v1/audio/transcriptions",{
      method:"POST",
      headers:{Authorization:"Bearer "+apiKey},
      body:openAiForm,
    })
  }catch{
    return json({error:"Voice transcription could not be reached."},502)
  }

  const payload=await response.json().catch(()=>({}))
  if(!response.ok){
    const reason=typeof payload?.error?.message==="string"
      ?payload.error.message
      :"Voice transcription failed."
    return json({error:reason.slice(0,500)},502)
  }

  const text=String(payload?.text??"").trim()
  if(!text) return json({error:"No speech was detected in the recording."},422)

  return json({
    text,
    model:"gpt-transcribe",
    language:payload?.language??null,
    languages:payload?.languages??null,
  })
})
