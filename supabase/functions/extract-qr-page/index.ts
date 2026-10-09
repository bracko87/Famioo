import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { load as loadHtml } from "npm:cheerio@1.1.2"

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

type RequestBody={
  household_id?:string
  url?:string
  timezone?:string
  metadata_only?:boolean
}

function publishableKey(){
  const current=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if(current){
    try{
      const parsed=JSON.parse(current) as Record<string,string>
      if(parsed.default) return parsed.default
    }catch{
      // Fall back while legacy anon key remains configured.
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

function isPrivateIpv4(ip:string){
  const parts=ip.split(".").map(Number)
  if(parts.length!==4||parts.some((part)=>!Number.isInteger(part)||part<0||part>255)) return false
  const [a,b]=parts
  return a===10
    ||a===127
    ||(a===169&&b===254)
    ||(a===172&&b>=16&&b<=31)
    ||(a===192&&b===168)
    ||a===0
}

function isPrivateIpv6(ip:string){
  const value=ip.toLowerCase()
  return value==="::1"
    ||value==="::"
    ||value.startsWith("fe80:")
    ||value.startsWith("fc")
    ||value.startsWith("fd")
}

async function ensurePublicUrl(raw:string){
  let url:URL
  try{ url=new URL(raw) }catch{ throw new Error("The QR code does not contain a valid web address.") }
  if(url.protocol!=="https:"&&url.protocol!=="http:"){
    throw new Error("Only normal web links can be read by Assistant.")
  }

  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"")
  if(
    host==="localhost"
    ||host.endsWith(".localhost")
    ||host.endsWith(".local")
    ||host.endsWith(".internal")
    ||isPrivateIpv4(host)
    ||isPrivateIpv6(host)
  ){
    throw new Error("Private or local network links cannot be opened by Assistant.")
  }

  // Resolve public hostnames before fetching to reduce SSRF risk.
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)&&!host.includes(":")){
    try{
      const addresses=await Deno.resolveDns(host,"A")
      if(addresses.some(isPrivateIpv4)){
        throw new Error("Private or local network links cannot be opened by Assistant.")
      }
    }catch(error){
      if(error instanceof Error&&error.message.includes("Private or local")) throw error
      // Some valid hosts do not expose A records directly (IPv6/CDN edge cases).
    }

    try{
      const addresses=await Deno.resolveDns(host,"AAAA")
      if(addresses.some(isPrivateIpv6)){
        throw new Error("Private or local network links cannot be opened by Assistant.")
      }
    }catch(error){
      if(error instanceof Error&&error.message.includes("Private or local")) throw error
    }
  }

  return url
}

function pageText(html:string){
  const $=loadHtml(html)
  $("script,style,noscript,svg,iframe,template").remove()

  const title=(
    $('meta[property="og:title"]').attr("content")
    ||$("title").first().text()
    ||$("h1").first().text()
    ||""
  ).trim()

  const description=(
    $('meta[property="og:description"]').attr("content")
    ||$('meta[name="description"]').attr("content")
    ||""
  ).trim()

  const rawImage=(
    $('meta[property="og:image"]').attr("content")
    ||$('meta[name="twitter:image"]').attr("content")
    ||$('meta[property="twitter:image"]').attr("content")
    ||$('link[rel="image_src"]').attr("href")
    ||""
  ).trim()

  const body=$("body").text()
    .replace(/\s+/g," ")
    .trim()
    .slice(0,45_000)

  return {title,description,body,rawImage}
}

const schema={
  type:"object",
  additionalProperties:false,
  required:["summary","found_event","suggest_ticket","title","date","end_date","start_time","end_time","all_day","location","description","confidence"],
  properties:{
    summary:{type:"string",maxLength:900},
    found_event:{type:"boolean"},
    suggest_ticket:{type:"boolean"},
    title:{type:["string","null"],maxLength:200},
    date:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
    end_date:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
    start_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
    end_time:{type:["string","null"],pattern:"^(?:[01]\\d|2[0-3]):[0-5]\\d$"},
    all_day:{type:"boolean"},
    location:{type:["string","null"],maxLength:300},
    description:{type:["string","null"],maxLength:1400},
    confidence:{type:"number",minimum:0,maximum:1},
  },
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json({error:"Method not allowed."},405)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401)

  let body:RequestBody
  try{ body=await req.json() }catch{ return json({error:"Invalid request."},400) }

  const householdId=body.household_id?.trim()
  const rawUrl=body.url?.trim()
  if(!householdId||!rawUrl) return json({error:"Household and QR page URL are required."},400)

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
    .eq("id",householdId)
    .single()

  if(householdResult.error||!householdResult.data){
    return json({error:"This household is not accessible."},403)
  }

  let url:URL
  try{
    url=await ensurePublicUrl(rawUrl)
  }catch(error){
    return json({error:error instanceof Error?error.message:"This QR destination cannot be opened safely."},400)
  }

  let response:Response
  try{
    response=await fetch(url.toString(),{
      redirect:"manual",
      headers:{
        "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1 Famioo/1.0",
        "Accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    })
  }catch{
    return json({error:"Famioo could not reach the QR destination page."},502)
  }

  // Follow a small number of redirects and validate every destination.
  for(let redirects=0;response.status>=300&&response.status<400&&redirects<4;redirects+=1){
    const location=response.headers.get("location")
    if(!location) break

    try{
      url=await ensurePublicUrl(new URL(location,url).toString())
    }catch(error){
      return json({error:error instanceof Error?error.message:"Unsafe redirect blocked."},400)
    }

    try{
      response=await fetch(url.toString(),{
        redirect:"manual",
        headers:{
          "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1 Famioo/1.0",
          "Accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language":"de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      })
    }catch{
      return json({error:"Famioo could not follow the QR page redirect."},502)
    }
  }

  if(!response.ok){
    return json({error:"The QR destination page returned HTTP "+response.status+"."},422)
  }

  const contentType=response.headers.get("content-type")??""
  if(!contentType.includes("text/html")&&!contentType.includes("application/xhtml+xml")){
    return json({error:"The QR destination is not a normal web page that Assistant can read."},422)
  }

  const html=await response.text()
  if(html.length>5_000_000) return json({error:"The QR destination page is too large to analyze safely."},413)

  const page=pageText(html)
  let pageImageUrl=""
  if(page.rawImage){
    try{ pageImageUrl=new URL(page.rawImage,response.url||url.toString()).toString() }catch{ pageImageUrl="" }
  }
  if(!page.body&&!page.title){
    return json({error:"Famioo opened the page, but there was no readable information."},422)
  }

  if(body.metadata_only===true){
    return json({
      ok:true,
      metadata:{
        title:page.title.slice(0,200)||new URL(response.url||url.toString()).hostname.replace(/^www\./,""),
        description:page.description.slice(0,700)||null,
        source_url:response.url||url.toString(),
        image_url:pageImageUrl||null,
      },
    })
  }

  const assistantAccess=await userClient.rpc("household_module_enabled_v1",{
    p_household_id:householdId,
    p_module_code:"assistant",
  })

  if(assistantAccess.error){
    console.error("AI Assistant entitlement check failed",assistantAccess.error)
    return json({error:"Famioo could not verify AI Assistant access. Please try again."},503)
  }
  if(assistantAccess.data!==true){
    return json({
      error:"AI Assistant is required to read the QR destination page and create an event draft.",
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
    },429)
  }

  const apiKey=Deno.env.get("OPENAI_API_KEY")
  if(!apiKey) return json({error:"AI Assistant extraction is not configured on the server."},503)

  const timezone=String(householdResult.data.timezone||body.timezone||"Europe/Berlin")
  const today=new Intl.DateTimeFormat("en-CA",{
    timeZone:timezone,
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
  }).format(new Date())

  const instruction=[
    "You summarize a webpage opened from a QR code and decide which Famioo actions are useful.",
    "The page may be a concert, invitation, fair, exhibition, appointment, registration page, commercial flyer landing page, travel/ticket page, booking page, sports event, ordinary website, or a page with no event at all.",
    "Return a short plain-language summary of what the page is about.",
    "Set suggest_ticket=true only when keeping this page as an active pass/ticket/booking/reference in Ticket Wallet would genuinely be useful.",
    "Never invent missing information. If this page does not clearly describe a schedulable event, set found_event=false and return null event fields.",
    "Use only the supplied webpage text. Ignore navigation, ads, cookie notices, recommendations, unrelated future events and footer content.",
    "For a clear event, return its concise name, date, optional end date, start/end times, location and a short useful description.",
    "If the event is all day, set all_day=true and both times to null.",
    "If a start time is present but no end time is given, keep end_time=null rather than guessing.",
    "Resolve relative dates only when unambiguous using today's date.",
    "Timezone: "+timezone+". Today: "+today+". Source URL: "+response.url,
  ].join("\n")

  const pagePayload=[
    page.title?"PAGE TITLE: "+page.title:"",
    page.description?"META DESCRIPTION: "+page.description:"",
    "PAGE TEXT:",
    page.body,
  ].filter(Boolean).join("\n\n")

  const model=Deno.env.get("OPENAI_QR_MODEL")
    ||Deno.env.get("OPENAI_CALENDAR_MODEL")
    ||"gpt-6-luna"

  let aiResponse:Response
  try{
    aiResponse=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+apiKey,
        "Content-Type":"application/json",
      },
      body:JSON.stringify({
        model,
        store:false,
        input:[{
          role:"user",
          content:[
            {type:"input_text",text:instruction},
            {type:"input_text",text:pagePayload},
          ],
        }],
        text:{
          format:{
            type:"json_schema",
            name:"qr_page_event",
            strict:true,
            schema,
          },
        },
        max_output_tokens:1800,
      }),
    })
  }catch{
    return json({error:"AI Assistant could not be reached."},502)
  }

  const payload=await aiResponse.json().catch(()=>({}))
  if(!aiResponse.ok){
    const message=typeof payload?.error?.message==="string"
      ?payload.error.message
      :"AI Assistant could not read this page."
    return json({error:message.slice(0,500)},502)
  }

  const raw=outputText(payload)
  if(!raw) return json({error:"AI Assistant returned no event draft."},502)

  let parsed:any
  try{ parsed=JSON.parse(raw) }catch{ return json({error:"AI Assistant returned an unreadable event draft."},502) }


  const assistantUsage=payload?.usage??{}
  const accounting=await recordAssistantAction(supabaseUrl,adminKey,{
    p_household_id:householdId,
    p_user_id:userResult.data.user.id,
    p_action_type:"qr_page_event",
    p_model:model,
    p_input_tokens:Number.isFinite(Number(assistantUsage.input_tokens))?Math.max(0,Math.round(Number(assistantUsage.input_tokens))):null,
    p_output_tokens:Number.isFinite(Number(assistantUsage.output_tokens))?Math.max(0,Math.round(Number(assistantUsage.output_tokens))):null,
    p_total_tokens:Number.isFinite(Number(assistantUsage.total_tokens))?Math.max(0,Math.round(Number(assistantUsage.total_tokens))):null,
    p_metadata:{},
  })
  if(!accounting.response.ok){
    console.error("Assistant action accounting failed",accounting.payload)
    return json({error:"The page was read, but Famioo could not record the Assistant action. Please try again."},503)
  }
  if(accounting.payload?.ok!==true){
    return json({
      error:"Your household has used all Assistant actions for this period.",
      code:String(accounting.payload?.code||"ASSISTANT_LIMIT_REACHED"),
      cycle_end:accounting.payload?.cycle_end??null,
    },429)
  }

  return json({
    ok:true,
    source_url:response.url||url.toString(),
    page_title:page.title.slice(0,200)||new URL(response.url||url.toString()).hostname.replace(/^www\./,""),
    page_description:page.description.slice(0,700)||null,
    model,
    summary:String(parsed.summary||"").slice(0,900),
    suggest_ticket:Boolean(parsed.suggest_ticket),
    image_url:pageImageUrl||null,
    event:{
      found_event:Boolean(parsed.found_event),
      title:parsed.title?String(parsed.title).slice(0,200):null,
      date:parsed.date?String(parsed.date):null,
      end_date:parsed.end_date?String(parsed.end_date):null,
      start_time:parsed.start_time?String(parsed.start_time).slice(0,5):null,
      end_time:parsed.end_time?String(parsed.end_time).slice(0,5):null,
      all_day:Boolean(parsed.all_day),
      location:parsed.location?String(parsed.location).slice(0,300):null,
      description:parsed.description?String(parsed.description).slice(0,1400):null,
      confidence:Math.max(0,Math.min(1,Number(parsed.confidence??0))),
    },
  })
})
