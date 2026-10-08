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

type AssistantPlan={
  reply:string
  action_type:"none"|"create_calendar_event"|"create_task"|"create_checklist"|"create_shopping_list"
  title:string|null
  date:string|null
  start_time:string|null
  end_time:string|null
  all_day:boolean
  location:string|null
  description:string|null
}

const planSchema={
  type:"object",
  additionalProperties:false,
  required:[
    "reply","action_type","title","date","start_time","end_time",
    "all_day","location","description",
  ],
  properties:{
    reply:{type:"string",maxLength:1400},
    action_type:{
      type:"string",
      enum:["none","create_calendar_event","create_task","create_checklist","create_shopping_list"],
    },
    title:{type:["string","null"],maxLength:200},
    date:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
    start_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
    end_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
    all_day:{type:"boolean"},
    location:{type:["string","null"],maxLength:300},
    description:{type:["string","null"],maxLength:1200},
  },
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

function localDateTimeToIso(date:string,time:string,timeZone:string){
  const [year,month,day]=date.split("-").map(Number)
  const [hour,minute]=time.split(":").map(Number)
  const wanted=Date.UTC(year,month-1,day,hour,minute,0)
  let guess=wanted

  const formatter=new Intl.DateTimeFormat("en-CA",{
    timeZone,
    year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",
    hourCycle:"h23",
  })

  for(let i=0;i<3;i+=1){
    const parts=Object.fromEntries(
      formatter.formatToParts(new Date(guess))
        .filter((part)=>part.type!=="literal")
        .map((part)=>[part.type,part.value]),
    ) as Record<string,string>

    const rendered=Date.UTC(
      Number(parts.year),Number(parts.month)-1,Number(parts.day),
      Number(parts.hour),Number(parts.minute),Number(parts.second||0),
    )
    const delta=wanted-rendered
    if(delta===0) break
    guess+=delta
  }

  return new Date(guess).toISOString()
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

async function executePlan(
  userClient:any,
  householdId:string,
  timezone:string,
  plan:AssistantPlan,
){
  const title=plan.title?.trim()
  if(plan.action_type==="none") return {executed:false,reply:plan.reply}
  if(!title) return {executed:false,reply:"I need a title before I can create that."}

  if(plan.action_type==="create_calendar_event"){
    if(!plan.date){
      return {executed:false,reply:"I need the event date before I can add it to the calendar."}
    }

    const calendars=await userClient
      .from("calendars")
      .select("id,is_default")
      .eq("household_id",householdId)
      .eq("active",true)

    if(calendars.error||!calendars.data?.length){
      return {executed:false,error:calendars.error?.message||"No active household calendar is available."}
    }

    const calendar=calendars.data.find((item:any)=>item.is_default)??calendars.data[0]
    const allDay=Boolean(plan.all_day||!plan.start_time)
    const startAt=!allDay&&plan.start_time
      ?localDateTimeToIso(plan.date,plan.start_time,timezone)
      :null
    const endAt=!allDay&&plan.end_time
      ?localDateTimeToIso(plan.date,plan.end_time,timezone)
      :null

    const result=await userClient.rpc("save_event_v1",{
      p_event_id:null,
      p_household_id:householdId,
      p_calendar_id:calendar.id,
      p_title:title,
      p_description:plan.description?.trim()||null,
      p_all_day:allDay,
      p_start_at:startAt,
      p_end_at:endAt,
      p_start_date:allDay?plan.date:null,
      p_end_date:allDay?plan.date:null,
      p_timezone:timezone,
      p_location_text:plan.location?.trim()||null,
      p_category_id:null,
      p_visibility:"household",
      p_participants:[],
      p_rrule:null,
      p_reminders:[],
    })

    if(result.error) return {executed:false,error:result.error.message}

    const when=allDay
      ?plan.date
      :plan.date+" at "+plan.start_time+(plan.end_time?"–"+plan.end_time:"")
    return {
      executed:true,
      action_type:plan.action_type,
      record_id:result.data,
      reply:"Added “"+title+"” to the family calendar for "+when+".",
    }
  }

  if(plan.action_type==="create_task"){
    const result=await userClient.rpc("create_task_v1",{
      p_household_id:householdId,
      p_title:title,
      p_category_id:null,
      p_due_date:plan.date,
      p_location_text:plan.location?.trim()||null,
      p_participants:[],
      p_add_to_calendar:false,
      p_create_template:false,
    })
    if(result.error) return {executed:false,error:result.error.message}
    return {
      executed:true,
      action_type:plan.action_type,
      record_id:result.data,
      reply:"Task created: “"+title+"”"+(plan.date?" for "+plan.date:"")+".",
    }
  }

  if(plan.action_type==="create_checklist"){
    const result=await userClient.rpc("create_checklist_v1",{
      p_household_id:householdId,
      p_title:title,
      p_category_id:null,
      p_due_date:plan.date,
      p_location_text:plan.location?.trim()||null,
      p_participants:[],
      p_linked_event_id:null,
      p_linked_task_id:null,
      p_add_to_calendar:false,
      p_add_to_task:false,
      p_create_template:false,
    })
    if(result.error) return {executed:false,error:result.error.message}
    return {
      executed:true,
      action_type:plan.action_type,
      record_id:result.data,
      reply:"Checklist created: “"+title+"”.",
    }
  }

  if(plan.action_type==="create_shopping_list"){
    const result=await userClient.rpc("create_shopping_list_v2",{
      p_household_id:householdId,
      p_title:title,
      p_linked_event_id:null,
      p_scheduled_date:plan.date,
      p_sync_task:false,
    })
    if(result.error) return {executed:false,error:result.error.message}
    return {
      executed:true,
      action_type:plan.action_type,
      record_id:result.data,
      reply:"Shopping list created: “"+title+"”"+(plan.date?" for "+plan.date:"")+".",
    }
  }

  return {executed:false,reply:plan.reply}
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
    "You are Famioo Assistant inside a household organization app.",
    "You can answer questions and can directly create safe household records when the user clearly asks you to do so.",
    "Supported direct actions: create a Calendar event, Task, Checklist, or Shopping list.",
    "For these four creation actions, execute when the request is clear. Do not say that you cannot do it.",
    "Never choose edit/delete/archive actions. Destructive or ambiguous changes require confirmation and are not part of this action schema yet.",
    "For create_calendar_event: extract title, date, optional start/end time, all-day, location and description. If a date/time request is clear, use it.",
    "For create_task/create_checklist/create_shopping_list: title is required; date is an optional due/scheduled date.",
    "If the user only asks a question or calculation, action_type must be none.",
    "Use plain text only in reply. Do not use Markdown markers such as **, #, backticks or bullet syntax.",
    "If essential information for a requested creation is missing, action_type must be none and reply with one concise follow-up question.",
    "Do not invent private household data or participant names.",
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
        text:{
          format:{
            type:"json_schema",
            name:"famioo_assistant_plan",
            strict:true,
            schema:planSchema,
          },
        },
        max_output_tokens:1200,
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

  const raw=outputText(payload).trim()
  if(!raw) return json({error:"AI Assistant returned no response."},502)

  let plan:AssistantPlan
  try{
    plan=JSON.parse(raw) as AssistantPlan
  }catch{
    return json({error:"AI Assistant returned an unreadable action plan."},502)
  }

  const executed=await executePlan(userClient,householdId,timezone,plan)
  if(executed.error){
    return json({
      error:"Assistant understood the request, but Famioo could not complete it: "+String(executed.error).slice(0,350),
    },422)
  }

  const adminKey=secretKey()
  if(!adminKey) return json({error:"Server accounting configuration is incomplete."},503)

  const usage=payload?.usage??{}
  const accounting=await recordAssistantAction(supabaseUrl,adminKey,{
    p_household_id:householdId,
    p_user_id:userResult.data.user.id,
    p_action_type:executed.executed?String(executed.action_type||"quick_assistant"):"quick_assistant",
    p_model:model,
    p_input_tokens:Number.isFinite(Number(usage.input_tokens))?Math.max(0,Math.round(Number(usage.input_tokens))):null,
    p_output_tokens:Number.isFinite(Number(usage.output_tokens))?Math.max(0,Math.round(Number(usage.output_tokens))):null,
    p_total_tokens:Number.isFinite(Number(usage.total_tokens))?Math.max(0,Math.round(Number(usage.total_tokens))):null,
    p_metadata:{
      page_path:String(body.page_path||"").slice(0,160),
      executed:Boolean(executed.executed),
      action_type:executed.action_type??plan.action_type,
    },
  })

  if(!accounting.response.ok){
    console.error("Assistant action accounting failed",accounting.payload)
    return json({error:"Assistant completed the request, but Famioo could not record the action usage."},503)
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
    reply:String(executed.reply||plan.reply).trim(),
    model,
    executed:Boolean(executed.executed),
    action_type:executed.action_type??plan.action_type,
    record_id:executed.record_id??null,
    remaining:Number(accounting.payload?.remaining??0),
    cycle_end:accounting.payload?.cycle_end??allowance?.cycle_end??null,
  })
})
