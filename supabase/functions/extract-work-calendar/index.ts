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

type SourceType="image"|"text"
type PrivacyMode="busy"|"title"|"full"

type RequestBody={
  household_id?:string
  source_type?:SourceType
  privacy_mode?:PrivacyMode
  reference_date?:string
  timezone?:string
  image_data_url?:string
  raw_text?:string
}

function publishableKey(){
  const current=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if(current){
    try{
      const parsed=JSON.parse(current) as Record<string,string>
      if(parsed.default) return parsed.default
    }catch{
      // Fall back to the legacy anon key while it remains configured.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY")??""
}

function secretKey(){
  const current=Deno.env.get("SUPABASE_SECRET_KEYS")
  if(current){
    try{
      const parsed=JSON.parse(current) as Record<string,string>
      if(parsed.default) return parsed.default
    }catch{
      // Legacy service-role fallback remains below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??""
}

async function recordAssistantAction(
  supabaseUrl:string,
  adminKey:string,
  body:Record<string,unknown>,
){
  const response=await fetch(supabaseUrl+"/rest/v1/rpc/record_assistant_action_v1",{
    method:"POST",
    headers:{
      apikey:adminKey,
      "Content-Type":"application/json",
    },
    body:JSON.stringify(body),
  })
  const payload=await response.json().catch(()=>null)
  return {response,payload}
}

function outputText(payload:any){
  if(typeof payload?.output_text==="string") return payload.output_text
  for(const item of payload?.output??[]){
    for(const part of item?.content??[]){
      if(part?.type==="output_text"&&typeof part.text==="string") return part.text
    }
  }
  return ""
}

const schema={
  type:"object",
  additionalProperties:false,
  required:["events"],
  properties:{
    events:{
      type:"array",
      maxItems:100,
      items:{
        type:"object",
        additionalProperties:false,
        required:[
          "title","date","start_time","end_time","all_day",
          "location","description","confidence",
        ],
        properties:{
          title:{type:"string",maxLength:200},
          date:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
          start_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
          end_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
          all_day:{type:"boolean"},
          location:{type:["string","null"],maxLength:300},
          description:{type:["string","null"],maxLength:1200},
          confidence:{type:"number",minimum:0,maximum:1},
        },
      },
    },
  },
}

function instruction(
  sourceType:SourceType,
  privacyMode:PrivacyMode,
  referenceDate:string,
  timezone:string,
){
  const privacy=privacyMode==="busy"
    ? "PRIVACY MODE IS BUSY ONLY. Every returned title must be exactly 'Busy'. Return location=null and description=null. Extract only occupied date/time blocks."
    : privacyMode==="title"
      ? "PRIVACY MODE IS TITLE + TIME. Keep a visible appointment title when clear. Return location=null and description=null."
      : "PRIVACY MODE IS FULL DETAILS. Keep visible title, location and short description only when clearly present in the source."

  return [
    "You extract work-calendar appointments for a family calendar import.",
    sourceType==="image"
      ? "The source is a screenshot of a day, week or month calendar. Detect distinct visible event blocks and their dates/times."
      : "The source is copied appointment/calendar text. Detect distinct appointments and their dates/times.",
    "Never invent an event, title, date, location or time. If a block is too ambiguous, omit it.",
    "For timed events, return start_time and end_time as HH:MM. If an end time is not shown and cannot be reliably inferred from a clearly visible block boundary, omit that event rather than guessing.",
    "For all-day events set all_day=true and both times to null.",
    "Resolve partial weekday/date labels using the reference date only when the calendar layout makes the date relationship clear.",
    "Return dates in YYYY-MM-DD using the visible calendar date, not the upload date.",
    "Do not return headers, holidays, empty slots, working-hours shading, availability grids, or duplicated event text as events.",
    "confidence is 0 to 1 and reflects extraction certainty.",
    privacy,
    "Reference date: "+referenceDate+". Household timezone: "+timezone+".",
  ].join("\n")
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json({error:"Method not allowed."},405)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401)

  let body:RequestBody
  try{ body=await req.json() }catch{ return json({error:"Invalid request."},400) }

  if(!body.household_id) return json({error:"Household is required."},400)
  if(body.source_type!=="image"&&body.source_type!=="text") return json({error:"Choose a supported import source."},400)
  if(!["busy","title","full"].includes(String(body.privacy_mode))) return json({error:"Choose a valid privacy mode."},400)

  const referenceDate=/^\d{4}-\d{2}-\d{2}$/.test(body.reference_date??"")
    ? String(body.reference_date)
    : new Date().toISOString().slice(0,10)

  if(body.source_type==="image"){
    if(!body.image_data_url||!/^data:image\/(?:png|jpeg|webp);base64,/i.test(body.image_data_url)){
      return json({error:"Choose a PNG, JPEG or WebP calendar screenshot."},400)
    }
    if(body.image_data_url.length>12_000_000) return json({error:"The screenshot is too large."},413)
  }else{
    if(!body.raw_text?.trim()) return json({error:"Paste appointment text first."},400)
    if(body.raw_text.length>25_000) return json({error:"The pasted calendar text is too long."},413)
  }

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

  const adminKey=secretKey()
  if(!adminKey) return json({error:"Server configuration is incomplete."},500)

  const householdResult=await userClient
    .from("households")
    .select("id,timezone")
    .eq("id",body.household_id)
    .single()

  if(householdResult.error||!householdResult.data){
    return json({error:"This household is not accessible."},403)
  }

  const assistantAccess=await userClient.rpc("household_module_enabled_v1",{
    p_household_id:body.household_id,
    p_module_code:"assistant",
  })

  if(assistantAccess.error){
    console.error("AI Assistant entitlement check failed",assistantAccess.error)
    return json({error:"Famioo could not verify AI Assistant access. Please try again."},503)
  }

  if(assistantAccess.data!==true){
    return json({
      error:"AI Assistant is required for screenshot and pasted-text calendar extraction.",
      code:"AI_ASSISTANT_REQUIRED",
    },403)
  }


  const allowanceResult=await userClient.rpc("assistant_usage_summary_v1",{
    p_household_id:body.household_id,
  })
  if(allowanceResult.error){
    console.error("Assistant allowance check failed",allowanceResult.error)
    return json({error:"Famioo could not verify the Assistant allowance."},503)
  }
  const allowance=Array.isArray(allowanceResult.data)?allowanceResult.data[0]:allowanceResult.data
  if(Number(allowance?.total_remaining??0)<=0){
    return json({
      error:"Your household has used all Assistant actions for this period.",
      code:"ASSISTANT_LIMIT_REACHED",
      cycle_end:allowance?.cycle_end??null,
    },429)
  }

  const timezone=String(householdResult.data.timezone||body.timezone||"Europe/Berlin")
  const apiKey=Deno.env.get("OPENAI_API_KEY")
  if(!apiKey){
    return json({
      error:"Work-calendar screenshot and text extraction is not configured yet. Add the OPENAI_API_KEY Edge Function secret.",
    },503)
  }

  const prompt=instruction(
    body.source_type,
    body.privacy_mode as PrivacyMode,
    referenceDate,
    timezone,
  )

  const content:any[]=[{type:"input_text",text:prompt}]
  if(body.source_type==="image"){
    content.push({type:"input_image",image_url:body.image_data_url,detail:"high"})
  }else{
    content.push({
      type:"input_text",
      text:"Calendar/appointment text to extract:\n\n"+body.raw_text!.trim(),
    })
  }

  const model=Deno.env.get("OPENAI_CALENDAR_MODEL")||"gpt-6-luna"
  let response:Response
  try{
    response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+apiKey,
        "Content-Type":"application/json",
      },
      body:JSON.stringify({
        model,
        store:false,
        input:[{role:"user",content}],
        text:{
          format:{
            type:"json_schema",
            name:"work_calendar_events",
            strict:true,
            schema,
          },
        },
        max_output_tokens:6000,
      }),
    })
  }catch{
    return json({error:"Calendar extraction service could not be reached."},502)
  }

  const payload=await response.json().catch(()=>({}))
  if(!response.ok){
    const message=typeof payload?.error?.message==="string"
      ? payload.error.message
      : "Calendar extraction failed."
    return json({error:message.slice(0,500)},502)
  }

  const raw=outputText(payload)
  if(!raw) return json({error:"No structured calendar result was returned."},502)

  let parsed:{events?:any[]}
  try{
    parsed=JSON.parse(raw)
  }catch{
    return json({error:"Calendar extraction returned an unreadable result."},502)
  }

  const events=(Array.isArray(parsed.events)?parsed.events:[])
    .slice(0,100)
    .filter((event)=>event&&/^\d{4}-\d{2}-\d{2}$/.test(String(event.date??"")))
    .map((event)=>({
      title:body.privacy_mode==="busy"?"Busy":String(event.title||"Busy").slice(0,200),
      date:String(event.date),
      start_time:event.all_day?null:(event.start_time??null),
      end_time:event.all_day?null:(event.end_time??null),
      all_day:Boolean(event.all_day),
      location:body.privacy_mode==="full"&&event.location?String(event.location).slice(0,300):null,
      description:body.privacy_mode==="full"&&event.description?String(event.description).slice(0,1200):null,
      confidence:Math.max(0,Math.min(1,Number(event.confidence??0))),
    }))


  const assistantUsage=payload?.usage??{}
  const accounting=await recordAssistantAction(supabaseUrl,adminKey,{
    p_household_id:body.household_id,
    p_user_id:userResult.data.user.id,
    p_action_type:body.source_type==="image"?"work_calendar_image":"work_calendar_text",
    p_model:model,
    p_input_tokens:Number.isFinite(Number(assistantUsage.input_tokens))?Math.max(0,Math.round(Number(assistantUsage.input_tokens))):null,
    p_output_tokens:Number.isFinite(Number(assistantUsage.output_tokens))?Math.max(0,Math.round(Number(assistantUsage.output_tokens))):null,
    p_total_tokens:Number.isFinite(Number(assistantUsage.total_tokens))?Math.max(0,Math.round(Number(assistantUsage.total_tokens))):null,
    p_metadata:{privacy_mode:body.privacy_mode},
  })
  if(!accounting.response.ok){
    console.error("Assistant action accounting failed",accounting.payload)
    return json({error:"The calendar was read, but Famioo could not record the Assistant action. Please try again."},503)
  }
  if(accounting.payload?.ok!==true){
    return json({
      error:"Your household has used all Assistant actions for this period.",
      code:String(accounting.payload?.code||"ASSISTANT_LIMIT_REACHED"),
      cycle_end:accounting.payload?.cycle_end??null,
    },429)
  }

  return json({events,model})
})
