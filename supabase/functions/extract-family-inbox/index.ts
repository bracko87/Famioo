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
function outputText(payload:any){
  if(typeof payload?.output_text==="string")return payload.output_text
  for(const item of payload?.output??[])for(const part of item?.content??[]){
    if(part?.type==="output_text"&&typeof part.text==="string")return part.text
  }
  return ""
}
async function recordAssistantAction(supabaseUrl:string,adminKey:string,body:Record<string,unknown>){
  const response=await fetch(supabaseUrl+"/rest/v1/rpc/record_assistant_action_v1",{
    method:"POST",headers:{apikey:adminKey,"Content-Type":"application/json"},body:JSON.stringify(body),
  })
  const payload=await response.json().catch(()=>null)
  return {response,payload}
}

const schema={
  type:"object",
  additionalProperties:false,
  required:["document_type","title","summary","sender","event_date","deadline_date","location","confidence","suggestions"],
  properties:{
    document_type:{type:"string",enum:["letter","flyer","invitation","school_notice","appointment","bill","other"]},
    title:{type:"string",maxLength:200},
    summary:{type:"string",maxLength:1800},
    sender:{type:["string","null"],maxLength:200},
    event_date:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
    deadline_date:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
    location:{type:["string","null"],maxLength:300},
    confidence:{type:"number",minimum:0,maximum:1},
    suggestions:{
      type:"array",maxItems:8,
      items:{
        type:"object",additionalProperties:false,
        required:["action_type","title","date","start_time","end_time","location","notes","file_category"],
        properties:{
          action_type:{type:"string",enum:["calendar","task","file","school"]},
          title:{type:"string",maxLength:200},
          date:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
          start_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
          end_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
          location:{type:["string","null"],maxLength:300},
          notes:{type:["string","null"],maxLength:1200},
          file_category:{type:["string","null"],enum:["document","photo","receipt","school","home","other",null]},
        },
      },
    },
  },
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors})
  if(req.method!=="POST")return json({error:"Method not allowed."},405)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer "))return json({error:"Authentication required."},401)

  let body:{household_id?:string;inbox_item_id?:string;image_data_url?:string;reference_date?:string}
  try{body=await req.json()}catch{return json({error:"Invalid request."},400)}

  if(!body.household_id||!body.inbox_item_id)return json({error:"Household and inbox item are required."},400)
  if(!body.image_data_url||!/^data:image\/(?:png|jpeg|webp);base64,/i.test(body.image_data_url)){
    return json({error:"Choose a JPG, PNG or WebP document image."},400)
  }
  if(body.image_data_url.length>12_000_000)return json({error:"The document image is too large for extraction."},413)

  const supabaseUrl=Deno.env.get("SUPABASE_URL")??""
  const clientKey=publishableKey()
  const adminKey=secretKey()
  if(!supabaseUrl||!clientKey||!adminKey)return json({error:"Server configuration is incomplete."},500)

  const userClient=createClient(supabaseUrl,clientKey,{
    global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false},
  })
  const token=authorization.slice("Bearer ".length).trim()
  const userResult=await userClient.auth.getUser(token)
  if(userResult.error||!userResult.data.user)return json({error:"Authentication required."},401)

  const inboxAccess=await userClient.rpc("household_module_enabled_v1",{p_household_id:body.household_id,p_module_code:"inbox_scan"})
  if(inboxAccess.error||inboxAccess.data!==true)return json({error:"Family Inbox access is required."},403)

  const assistantAccess=await userClient.rpc("household_module_enabled_v1",{p_household_id:body.household_id,p_module_code:"assistant"})
  if(assistantAccess.error)return json({error:"Famioo could not verify AI Assistant access."},503)
  if(assistantAccess.data!==true)return json({error:"AI Assistant is required for document extraction.",code:"AI_ASSISTANT_REQUIRED"},403)

  const allowanceResult=await userClient.rpc("assistant_usage_summary_v1",{p_household_id:body.household_id})
  if(allowanceResult.error)return json({error:"Famioo could not verify the Assistant allowance."},503)
  const allowance=Array.isArray(allowanceResult.data)?allowanceResult.data[0]:allowanceResult.data
  if(Number(allowance?.total_remaining??0)<=0){
    return json({error:"Your household has used all Assistant actions for this period.",code:"ASSISTANT_LIMIT_REACHED",cycle_end:allowance?.cycle_end??null},429)
  }

  const itemResult=await userClient.from("family_inbox_items")
    .select("id,household_id,file_id")
    .eq("id",body.inbox_item_id).eq("household_id",body.household_id).single()
  if(itemResult.error||!itemResult.data)return json({error:"Inbox item is not accessible."},403)

  const apiKey=Deno.env.get("OPENAI_API_KEY")
  if(!apiKey)return json({error:"Family Inbox extraction is not configured on the server."},503)

  const referenceDate=/^\d{4}-\d{2}-\d{2}$/.test(body.reference_date??"")
    ?String(body.reference_date):new Date().toISOString().slice(0,10)

  const prompt=[
    "Read this household document image and extract only information clearly supported by the image.",
    "The image may be a letter, flyer, invitation, school/Kita notice, appointment notice, bill or another family document.",
    "Never invent names, dates, times, deadlines, locations, senders, amounts or obligations.",
    "title: concise human title suitable for a family inbox.",
    "summary: short practical summary of what the family needs to know.",
    "event_date: actual event/appointment date only when clear. deadline_date: response/payment/action deadline only when clear.",
    "Suggest useful follow-up actions only when justified by the document:",
    "- calendar for an event/appointment with a clear date;",
    "- task for a deadline or action the family must complete;",
    "- school for school/Kita/child activity notices with a clear date;",
    "- file once, to classify/name the retained document.",
    "Do not suggest duplicate actions for the same purpose. A school notice can have a school action and a task if there is a separate deadline.",
    "For file suggestions use category school for school/Kita notices, document for letters/invitations/appointments/bills unless another allowed category is clearly better.",
    "If a time is absent, return null rather than guessing. If an end time is absent, return null.",
    "Reference date: "+referenceDate+".",
  ].join("\n")

  const model=Deno.env.get("OPENAI_INBOX_MODEL")
    ||Deno.env.get("OPENAI_RECEIPT_MODEL")
    ||Deno.env.get("OPENAI_CALENDAR_MODEL")
    ||"gpt-6-luna"

  let response:Response
  try{
    response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        model,store:false,
        input:[{role:"user",content:[
          {type:"input_text",text:prompt},
          {type:"input_image",image_url:body.image_data_url,detail:"high"},
        ]}],
        text:{format:{type:"json_schema",name:"family_inbox_scan",strict:true,schema}},
        max_output_tokens:5000,
      }),
    })
  }catch{return json({error:"Document extraction service could not be reached."},502)}

  const payload=await response.json().catch(()=>({}))
  if(!response.ok){
    const message=typeof payload?.error?.message==="string"?payload.error.message:"Document extraction failed."
    return json({error:message.slice(0,500)},502)
  }
  const raw=outputText(payload)
  if(!raw)return json({error:"Assistant returned no document data."},502)

  let parsed:any
  try{parsed=JSON.parse(raw)}catch{return json({error:"Assistant returned unreadable document data."},502)}

  const suggestions=(Array.isArray(parsed.suggestions)?parsed.suggestions:[]).slice(0,8)
    .filter((x:any)=>x&&["calendar","task","file","school"].includes(String(x.action_type))&&String(x.title??"").trim())
    .map((x:any)=>({
      action_type:String(x.action_type),
      title:String(x.title).trim().slice(0,200),
      date:x.date?String(x.date):null,
      start_time:x.start_time?String(x.start_time):null,
      end_time:x.end_time?String(x.end_time):null,
      location:x.location?String(x.location).trim().slice(0,300):null,
      notes:x.notes?String(x.notes).trim().slice(0,1200):null,
      file_category:x.file_category?String(x.file_category):null,
    }))

  const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const itemUpdate=await admin.from("family_inbox_items").update({
    document_type:String(parsed.document_type||"other"),
    title:String(parsed.title||"Scanned document").trim().slice(0,200),
    summary:String(parsed.summary||"").trim().slice(0,1800),
    sender:parsed.sender?String(parsed.sender).trim().slice(0,200):null,
    event_date:parsed.event_date||null,
    deadline_date:parsed.deadline_date||null,
    location_text:parsed.location?String(parsed.location).trim().slice(0,300):null,
    confidence:Math.max(0,Math.min(1,Number(parsed.confidence??0))),
    extraction_json:parsed,
    extracted_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
  }).eq("id",body.inbox_item_id).eq("household_id",body.household_id)
  if(itemUpdate.error)return json({error:"The document was read, but Famioo could not save the extraction."},503)

  await admin.from("family_inbox_actions").delete()
    .eq("inbox_item_id",body.inbox_item_id).eq("status","suggested")

  if(suggestions.length){
    const actionInsert=await admin.from("family_inbox_actions").insert(suggestions.map((s:any)=>({
      household_id:body.household_id,
      inbox_item_id:body.inbox_item_id,
      action_type:s.action_type,
      title:s.title,
      action_date:s.date,
      start_time:s.start_time,
      end_time:s.end_time,
      location_text:s.location,
      notes:s.notes,
      file_category:s.file_category,
    })))
    if(actionInsert.error)return json({error:"Extraction was saved, but suggested actions could not be saved."},503)
  }

  const usage=payload?.usage??{}
  const accounting=await recordAssistantAction(supabaseUrl,adminKey,{
    p_household_id:body.household_id,
    p_user_id:userResult.data.user.id,
    p_action_type:"inbox_scan",
    p_model:model,
    p_input_tokens:Number.isFinite(Number(usage.input_tokens))?Math.max(0,Math.round(Number(usage.input_tokens))):null,
    p_output_tokens:Number.isFinite(Number(usage.output_tokens))?Math.max(0,Math.round(Number(usage.output_tokens))):null,
    p_total_tokens:Number.isFinite(Number(usage.total_tokens))?Math.max(0,Math.round(Number(usage.total_tokens))):null,
    p_metadata:{inbox_item_id:body.inbox_item_id,document_type:parsed.document_type??"other"},
  })
  if(!accounting.response.ok||accounting.payload?.ok!==true){
    return json({error:"The document was read, but Famioo could not record the Assistant action. Please try again."},503)
  }

  return json({
    extraction:{
      document_type:parsed.document_type??"other",
      title:parsed.title??"Scanned document",
      summary:parsed.summary??"",
      sender:parsed.sender??null,
      event_date:parsed.event_date??null,
      deadline_date:parsed.deadline_date??null,
      location:parsed.location??null,
      confidence:Number(parsed.confidence??0),
      suggestions,
    },
    model,
  })
})
