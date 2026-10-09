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
async function sha256(value:string){
  const data=new TextEncoder().encode(value)
  const digest=await crypto.subtle.digest("SHA-256",data)
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("")
}
function todayInZone(timeZone:string){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date()).filter(p=>p.type!=="literal").map(p=>[p.type,p.value])) as Record<string,string>
  return parts.year+"-"+parts.month+"-"+parts.day
}
function shiftDate(date:string,days:number){
  const [y,m,d]=date.split("-").map(Number)
  const next=new Date(Date.UTC(y,m-1,d+days))
  return next.toISOString().slice(0,10)
}
function timeLabel(value:string|null,date:string|null,timeZone:string){
  if(date)return "all day"
  if(!value)return ""
  return new Intl.DateTimeFormat("en",{timeZone,hour:"numeric",minute:"2-digit"}).format(new Date(value))
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors})
  if(req.method!=="POST")return json({error:"Method not allowed."},405)

  let body:{
    household_id?:string
    intent?:string
    slots?:Record<string,unknown>
  }
  try{body=await req.json()}catch{return json({error:"Invalid request."},400)}

  const intent=String(body.intent??"")
  const supported=new Set(["calendar_query","shopping_add","task_add","reminders_query"])
  if(!supported.has(intent))return json({error:"Unsupported voice intent."},400)

  const supabaseUrl=Deno.env.get("SUPABASE_URL")??""
  const clientKey=publishableKey()
  const adminKey=secretKey()
  if(!supabaseUrl||!clientKey||!adminKey)return json({error:"Server configuration is incomplete."},500)
  const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}})

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer "))return json({error:"Voice integration authorization required."},401)
  const bearer=authorization.slice(7).trim()

  let householdId=""
  let settings:any=null

  if(bearer.startsWith("fami_voice_")){
    const hash=await sha256(bearer)
    const settingsResult=await admin.from("voice_integration_settings")
      .select("household_id,enabled,allowed_actions,linked_by_user_id")
      .eq("token_hash",hash).maybeSingle()
    if(settingsResult.error||!settingsResult.data)return json({error:"Voice integration token is invalid."},401)
    settings=settingsResult.data
    householdId=String(settings.household_id)
  }else{
    const userClient=createClient(supabaseUrl,clientKey,{
      global:{headers:{Authorization:authorization}},
      auth:{persistSession:false,autoRefreshToken:false},
    })
    const userResult=await userClient.auth.getUser(bearer)
    if(userResult.error||!userResult.data.user)return json({error:"Authentication required."},401)
    householdId=String(body.household_id??"")
    if(!householdId)return json({error:"Household is required."},400)
    const member=await userClient.from("household_members").select("role,status")
      .eq("household_id",householdId).eq("user_id",userResult.data.user.id).maybeSingle()
    if(!member.data||member.data.status!=="active"||!["owner","admin"].includes(String(member.data.role))){
      return json({error:"Only household owners/admins can test voice integration."},403)
    }
    const settingsResult=await admin.from("voice_integration_settings")
      .select("household_id,enabled,allowed_actions,linked_by_user_id")
      .eq("household_id",householdId).maybeSingle()
    settings=settingsResult.data
  }

  if(!settings||settings.enabled!==true)return json({error:"Alexa / Voice Integration is not enabled."},403)
  const allowed=Array.isArray(settings.allowed_actions)?settings.allowed_actions.map(String):[]
  if(!allowed.includes(intent))return json({error:"This voice action is disabled in Famioo settings."},403)

  const householdResult=await admin.from("households").select("id,name,timezone").eq("id",householdId).single()
  if(householdResult.error||!householdResult.data)return json({error:"Household not found."},404)
  const timezone=String(householdResult.data.timezone||"Europe/Berlin")

  async function moduleEnabled(code:string){
    const base=await admin.from("modules").select("is_core,is_active").eq("code",code).maybeSingle()
    if(!base.data?.is_active)return false
    const override=await admin.from("household_modules").select("enabled,valid_until")
      .eq("household_id",householdId).eq("module_code",code).maybeSingle()
    if(override.data){
      if(override.data.valid_until&&new Date(override.data.valid_until)<new Date())return false
      return override.data.enabled===true
    }
    return base.data.is_core===true
  }

  async function log(success:boolean,summary:string){
    await admin.from("voice_integration_action_log").insert({
      household_id:householdId,provider:"alexa",intent,success,summary:summary.slice(0,500),
    })
  }

  const slots=body.slots??{}
  const today=todayInZone(timezone)
  try{
    if(intent==="calendar_query"){
      if(!(await moduleEnabled("calendar"))){await log(false,"Calendar disabled");return json({error:"Calendar is not enabled."},403)}
      const dateRaw=String(slots.date??today)
      const date=/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)?dateRaw:today
      const result=await admin.rpc("voice_calendar_household_events_v1",{p_household_id:householdId,p_range_start:date,p_range_end:date})
      if(result.error)throw result.error
      const events=(result.data??[]).slice(0,12)
      const speech=events.length
        ?events.map((event:any)=>event.title+(event.occurrence_start_at?" at "+timeLabel(event.occurrence_start_at,null,event.event_timezone||timezone):"")).join(", ")
        :"There are no household calendar events for that day."
      await log(true,"Calendar query: "+events.length+" event(s)")
      return json({ok:true,intent,date,events,speech})
    }

    if(intent==="shopping_add"){
      if(!(await moduleEnabled("shopping"))){await log(false,"Shopping disabled");return json({error:"Shopping is not enabled."},403)}
      const itemText=String(slots.item_text??"").trim()
      const quantity=String(slots.quantity??"").trim()
      if(!itemText)return json({error:"Shopping item is required."},400)

      let listQuery=admin.from("shopping_lists").select("id,title").eq("household_id",householdId).eq("status","active").is("archived_at",null)
      const requestedList=String(slots.list_title??"").trim()
      if(requestedList)listQuery=listQuery.ilike("title",requestedList)
      const existing=await listQuery.order("created_at",{ascending:false}).limit(1).maybeSingle()
      let list=existing.data
      if(!list){
        const created=await admin.from("shopping_lists").insert({
          household_id:householdId,title:requestedList||"Shopping",created_by_user_id:settings.linked_by_user_id,
        }).select("id,title").single()
        if(created.error)throw created.error
        list=created.data
      }
      const inserted=await admin.from("shopping_items").insert({
        household_id:householdId,shopping_list_id:list.id,item_text:itemText,quantity:quantity||null,
        created_by_user_id:settings.linked_by_user_id,
      }).select("id").single()
      if(inserted.error)throw inserted.error
      const speech="Added "+itemText+(quantity?" ("+quantity+")":"")+" to "+list.title+"."
      await log(true,speech)
      return json({ok:true,intent,item_id:inserted.data.id,list_id:list.id,speech})
    }

    if(intent==="task_add"){
      if(!(await moduleEnabled("tasks"))){await log(false,"Tasks disabled");return json({error:"Tasks is not enabled."},403)}
      const title=String(slots.title??"").trim()
      const dueRaw=String(slots.due_date??"").trim()
      const dueDate=/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)?dueRaw:null
      if(!title)return json({error:"Task title is required."},400)
      const inserted=await admin.from("tasks").insert({
        household_id:householdId,title,status:"open",priority:"normal",due_date:dueDate,
        created_by_user_id:settings.linked_by_user_id,
      }).select("id").single()
      if(inserted.error)throw inserted.error
      const speech="Created task: "+title+(dueDate?" for "+dueDate:"")+"."
      await log(true,speech)
      return json({ok:true,intent,task_id:inserted.data.id,speech})
    }

    if(intent==="reminders_query"){
      if(!(await moduleEnabled("tasks"))){await log(false,"Tasks disabled");return json({error:"Tasks is not enabled."},403)}
      const dateRaw=String(slots.date??today)
      const date=/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)?dateRaw:today
      const tasksResult=await admin.from("tasks").select("id,title,due_date")
        .eq("household_id",householdId).eq("status","open").is("archived_at",null).eq("due_date",date).limit(20)
      if(tasksResult.error)throw tasksResult.error
      const tasks=tasksResult.data??[]
      const speech=tasks.length?tasks.map((task:any)=>task.title).join(", "):"There are no open Famioo tasks due that day."
      await log(true,"Reminder query: "+tasks.length+" task(s)")
      return json({ok:true,intent,date,tasks,speech})
    }

    return json({error:"Unsupported voice intent."},400)
  }catch(error){
    const message=error instanceof Error?error.message:"Voice action failed."
    await log(false,message)
    return json({error:message},500)
  }
})
