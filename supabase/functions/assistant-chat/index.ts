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

type ChatMessage={role:"user"|"assistant";content:string}
type RequestBody={
  household_id?:string
  message?:string
  history?:ChatMessage[]
  page_path?:string
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

function outputText(payload:any){
  if(typeof payload?.output_text==="string") return payload.output_text
  for(const item of payload?.output??[]){
    for(const part of item?.content??[]){
      if(part?.type==="output_text"&&typeof part.text==="string") return part.text
    }
  }
  return ""
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

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json({error:"Method not allowed."},405)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401)

  let body:RequestBody
  try{ body=await req.json() }catch{ return json({error:"Invalid request."},400) }

  const householdId=body.household_id?.trim()
  const message=body.message?.trim()
  if(!householdId) return json({error:"Household is required."},400)
  if(!message) return json({error:"Write a question or task for Assistant."},400)
  if(message.length>4000) return json({error:"Assistant messages can be up to 4,000 characters."},413)

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

  const householdResult=await userClient
    .from("households")
    .select("id,name,timezone")
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

  const allowanceResult=await userClient.rpc("assistant_usage_summary_v1",{
    p_household_id:householdId,
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
      remaining:0,
    },429)
  }

  const apiKey=Deno.env.get("OPENAI_API_KEY")
  if(!apiKey) return json({error:"AI Assistant is not configured on the server."},503)

  const history=(Array.isArray(body.history)?body.history:[])
    .filter((item)=>item&&(item.role==="user"||item.role==="assistant")&&typeof item.content==="string")
    .slice(-8)
    .map((item)=>({
      role:item.role,
      content:item.content.trim().slice(0,3000),
    }))
    .filter((item)=>item.content)

  const timezone=String(householdResult.data.timezone||"Europe/Berlin")
  const now=new Intl.DateTimeFormat("en-CA",{
    timeZone:timezone,
    year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hour12:false,
  }).format(new Date())

  const instructions=[
    "You are Famioo Assistant, a concise household and family organization assistant inside the Famioo app.",
    "Help with planning, calculations, explanations, drafting, organizing, schedules, shopping, household tasks and similar everyday family requests.",
    "The user is authenticated in their household. Do not claim to know private household data unless it appears in the conversation.",
    "Do not claim that you created, changed, deleted or saved anything in Famioo. This quick panel is conversational only for now.",
    "If the user asks you to change Famioo data, prepare the requested content clearly and say that confirmation/execution support will be added separately.",
    "Prefer short practical answers. Ask one concise follow-up only when essential information is missing.",
    "Household timezone: "+timezone+". Current household-local date/time: "+now+".",
    body.page_path?"Current Famioo page: "+String(body.page_path).slice(0,160)+".":"",
  ].filter(Boolean).join("\n")

  const model=Deno.env.get("OPENAI_ASSISTANT_MODEL")||"gpt-6-luna"

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
        reasoning:{effort:"none"},
        instructions,
        input:[
          ...history,
          {role:"user",content:message},
        ],
        max_output_tokens:900,
      }),
    })
  }catch{
    return json({error:"AI Assistant could not be reached."},502)
  }

  const payload=await response.json().catch(()=>({}))
  if(!response.ok){
    const reason=typeof payload?.error?.message==="string"
      ?payload.error.message
      :"AI Assistant could not answer right now."
    return json({error:reason.slice(0,500)},502)
  }

  const reply=outputText(payload).trim()
  if(!reply) return json({error:"AI Assistant returned no response."},502)

  const adminKey=secretKey()
  if(!adminKey) return json({error:"Server accounting configuration is incomplete."},503)

  const usage=payload?.usage??{}
  const accounting=await recordAssistantAction(supabaseUrl,adminKey,{
    p_household_id:householdId,
    p_user_id:userResult.data.user.id,
    p_action_type:"quick_assistant",
    p_model:model,
    p_input_tokens:Number.isFinite(Number(usage.input_tokens))?Math.max(0,Math.round(Number(usage.input_tokens))):null,
    p_output_tokens:Number.isFinite(Number(usage.output_tokens))?Math.max(0,Math.round(Number(usage.output_tokens))):null,
    p_total_tokens:Number.isFinite(Number(usage.total_tokens))?Math.max(0,Math.round(Number(usage.total_tokens))):null,
    p_metadata:{page_path:String(body.page_path||"").slice(0,160)},
  })

  if(!accounting.response.ok){
    console.error("Assistant action accounting failed",accounting.payload)
    return json({error:"Assistant answered, but Famioo could not record the action. Please try again."},503)
  }
  if(accounting.payload?.ok!==true){
    return json({
      error:"Your household has used all Assistant actions for this period.",
      code:String(accounting.payload?.code||"ASSISTANT_LIMIT_REACHED"),
      cycle_end:accounting.payload?.cycle_end??null,
      remaining:Number(accounting.payload?.remaining??0),
    },429)
  }

  return json({
    reply,
    model,
    remaining:Number(accounting.payload?.remaining??0),
    cycle_end:accounting.payload?.cycle_end??allowance?.cycle_end??null,
  })
})
