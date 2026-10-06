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

type IcsProperty={ value:string; params:Record<string,string> }
type ParsedEvent={
  uid:string
  summary:string
  description:string
  location:string
  dtstart:IcsProperty|null
  dtend:IcsProperty|null
  rrule:string|null
  recurrenceId:IcsProperty|null
  exdates:IcsProperty[]
  lastModified:string|null
  status:string
}

function unescapeIcs(value:string){
  return value
    .replace(/\\n/gi,"\n")
    .replace(/\\,/g,",")
    .replace(/\\;/g,";")
    .replace(/\\\\/g,"\\")
    .trim()
}

function propertyFromLine(line:string):{ name:string; property:IcsProperty }|null{
  const colon=line.indexOf(":")
  if(colon<1) return null
  const left=line.slice(0,colon)
  const value=line.slice(colon+1)
  const pieces=left.split(";")
  const name=pieces[0].toUpperCase()
  const params:Record<string,string>={}
  for(const part of pieces.slice(1)){
    const eq=part.indexOf("=")
    if(eq>0) params[part.slice(0,eq).toUpperCase()]=part.slice(eq+1).replace(/^"|"$/g,"")
  }
  return { name,property:{ value,params } }
}

function parseIcs(text:string):ParsedEvent[]{
  const raw=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n")
  const lines:string[]=[]
  for(const line of raw){
    if((line.startsWith(" ")||line.startsWith("\t"))&&lines.length){
      lines[lines.length-1]+=line.slice(1)
    }else{
      lines.push(line)
    }
  }

  const events:ParsedEvent[]=[]
  let block:string[]|null=null

  for(const line of lines){
    if(line.toUpperCase()==="BEGIN:VEVENT"){
      block=[]
      continue
    }
    if(line.toUpperCase()==="END:VEVENT"&&block){
      const props=new Map<string,IcsProperty[]>()
      for(const item of block){
        const parsed=propertyFromLine(item)
        if(!parsed) continue
        props.set(parsed.name,[...(props.get(parsed.name)??[]),parsed.property])
      }
      const first=(name:string)=>props.get(name)?.[0]??null
      const uid=unescapeIcs(first("UID")?.value??"")
      if(uid){
        events.push({
          uid,
          summary:unescapeIcs(first("SUMMARY")?.value??"Busy")||"Busy",
          description:unescapeIcs(first("DESCRIPTION")?.value??""),
          location:unescapeIcs(first("LOCATION")?.value??""),
          dtstart:first("DTSTART"),
          dtend:first("DTEND"),
          rrule:first("RRULE")?.value??null,
          recurrenceId:first("RECURRENCE-ID"),
          exdates:props.get("EXDATE")??[],
          lastModified:first("LAST-MODIFIED")?.value??first("DTSTAMP")?.value??null,
          status:(first("STATUS")?.value??"CONFIRMED").toUpperCase(),
        })
      }
      block=null
      continue
    }
    if(block) block.push(line)
  }

  return events
}

function dateOnly(value:string){
  if(!/^\d{8}$/.test(value)) return null
  return value.slice(0,4)+"-"+value.slice(4,6)+"-"+value.slice(6,8)
}

function partsFromCompact(value:string){
  const match=value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z?$/)
  if(!match) return null
  return {
    year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),
    hour:Number(match[4]),minute:Number(match[5]),second:Number(match[6]??"0"),
  }
}

function zonedLocalToUtc(value:string,timeZone:string){
  const p=partsFromCompact(value)
  if(!p) return null
  if(value.endsWith("Z")){
    return new Date(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second))
  }

  let guess=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)
  for(let pass=0;pass<2;pass++){
    const parts=new Intl.DateTimeFormat("en-CA",{
      timeZone,
      year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit",
      hourCycle:"h23",
    }).formatToParts(new Date(guess))
    const get=(type:string)=>Number(parts.find((x)=>x.type===type)?.value??0)
    const represented=Date.UTC(
      get("year"),get("month")-1,get("day"),
      get("hour"),get("minute"),get("second"),
    )
    const desired=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)
    guess+=desired-represented
  }
  return new Date(guess)
}

function parseDateTime(prop:IcsProperty|null,fallbackTimezone:string){
  if(!prop) return null
  const allDay=prop.params.VALUE?.toUpperCase()==="DATE"||/^\d{8}$/.test(prop.value)
  if(allDay){
    const date=dateOnly(prop.value.slice(0,8))
    return date ? { allDay:true as const,date,instant:null,timezone:fallbackTimezone } : null
  }
  const timezone=prop.params.TZID||fallbackTimezone
  const instant=zonedLocalToUtc(prop.value,timezone)
  return instant
    ? { allDay:false as const,date:null,instant:instant.toISOString(),timezone }
    : null
}

function minusOneDay(value:string){
  const d=new Date(value+"T12:00:00Z")
  d.setUTCDate(d.getUTCDate()-1)
  return d.toISOString().slice(0,10)
}

function normalizeRrule(value:string|null){
  if(!value) return null
  return value
    .split(";")
    .filter(Boolean)
    .map((part)=>part.trim().toUpperCase())
    .join(";")
}

function parseExceptionDates(props:IcsProperty[],fallbackTimezone:string){
  const dates:string[]=[]
  const instants:string[]=[]
  for(const prop of props){
    for(const raw of prop.value.split(",")){
      const parsed=parseDateTime({value:raw,params:prop.params},fallbackTimezone)
      if(!parsed) continue
      if(parsed.allDay&&parsed.date) dates.push(parsed.date)
      if(!parsed.allDay&&parsed.instant) instants.push(parsed.instant)
    }
  }
  return {dates:[...new Set(dates)],instants:[...new Set(instants)]}
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json({error:"Method not allowed"},405)

  const supabaseUrl=Deno.env.get("SUPABASE_URL")
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")
  if(!supabaseUrl||!anonKey) return json({error:"Server configuration is incomplete."},500)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401)

  let body:{connection_id?:string}
  try{ body=await req.json() }catch{ return json({error:"Invalid request."},400) }
  if(!body.connection_id) return json({error:"Connection is required."},400)

  const userClient=createClient(supabaseUrl,anonKey,{
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false,autoRefreshToken:false},
  })
  const connectionResult=await userClient
    .from("calendar_connections")
    .select("id,household_id,provider,display_name,target_calendar_id,import_mode,feed_url,status,sync_enabled,created_by_user_id")
    .eq("id",body.connection_id)
    .single()

  if(connectionResult.error||!connectionResult.data){
    return json({error:"Calendar connection was not found or is not accessible."},404)
  }

  const connection=connectionResult.data
  if(connection.provider!=="ics") return json({error:"This sync worker currently supports ICS connections."},400)
  if(!connection.sync_enabled) return json({error:"This calendar connection is paused."},400)
  if(!connection.feed_url) return json({error:"This ICS connection has no feed URL."},400)

  const householdResult=await userClient
    .from("households")
    .select("timezone")
    .eq("id",connection.household_id)
    .single()
  const householdTimezone=householdResult.data?.timezone||"Europe/Berlin"

  let response:Response
  try{
    response=await fetch(connection.feed_url,{
      redirect:"follow",
      headers:{
        "User-Agent":"Famioo Calendar Sync/1.0",
        "Accept":"text/calendar,text/plain;q=0.9,*/*;q=0.5",
      },
    })
  }catch{
    await userClient.from("calendar_connections").update({
      status:"error",last_error:"Could not reach the calendar feed.",updated_at:new Date().toISOString(),
    }).eq("id",connection.id)
    return json({error:"Could not reach the calendar feed."},400)
  }

  if(!response.ok){
    const message="Calendar feed returned HTTP "+response.status+"."
    await userClient.from("calendar_connections").update({
      status:"error",last_error:message,updated_at:new Date().toISOString(),
    }).eq("id",connection.id)
    return json({error:message},400)
  }

  const text=await response.text()
  if(text.length>6_000_000) return json({error:"Calendar feed is too large."},413)
  if(!/BEGIN:VCALENDAR/i.test(text)) return json({error:"The URL did not return an ICS calendar."},422)

  const parsed=parseIcs(text)
  if(!parsed.length) return json({error:"No calendar events were found in this feed."},422)

  const categoryResult=await userClient
    .from("event_categories")
    .select("id,name")
    .eq("household_id",connection.household_id)
    .eq("active",true)

  const workCategory=(categoryResult.data??[]).find((row)=>
    String(row.name).trim().toLowerCase()==="work"
  )?.id??null

  const masters=parsed.filter((item)=>!item.recurrenceId)
  const overrides=parsed.filter((item)=>item.recurrenceId)
  const overridesByUid=new Map<string,ParsedEvent[]>()
  for(const item of overrides){
    overridesByUid.set(item.uid,[...(overridesByUid.get(item.uid)??[]),item])
  }

  const seen:string[]=[]
  const failures:string[]=[]
  let imported=0
  let updated=0
  let skipped=0

  for(const item of masters){
    const start=parseDateTime(item.dtstart,householdTimezone)
    if(!start){
      skipped+=1
      failures.push(item.uid+": invalid DTSTART")
      continue
    }

    if(item.status==="CANCELLED"){
      const deleted=await userClient.rpc("delete_external_calendar_event_v1",{
        p_connection_id:connection.id,
        p_external_uid:item.uid,
      })
      if(deleted.error) failures.push(item.uid+": "+deleted.error.message)
      continue
    }

    const end=parseDateTime(item.dtend,householdTimezone)
    const importMode=connection.import_mode as "busy"|"title"|"full"
    const title=importMode==="busy" ? "Busy" : (item.summary||"Busy")
    const description=importMode==="full" ? item.description||null : null
    const location=importMode==="full" ? item.location||null : null
    const timezone=start.timezone||householdTimezone
    const externalUpdatedAt=item.lastModified
      ? (zonedLocalToUtc(item.lastModified,"UTC")?.toISOString()??new Date().toISOString())
      : new Date().toISOString()

    const exceptions=parseExceptionDates(item.exdates,timezone)
    for(const override of overridesByUid.get(item.uid)??[]){
      const recurrence=parseDateTime(override.recurrenceId,timezone)
      if(recurrence?.allDay&&recurrence.date) exceptions.dates.push(recurrence.date)
      if(recurrence&&!recurrence.allDay&&recurrence.instant) exceptions.instants.push(recurrence.instant)
    }

    const existing=await userClient
      .from("calendar_events")
      .select("id")
      .eq("external_connection_id",connection.id)
      .eq("external_uid",item.uid)
      .maybeSingle()

    const result=await userClient.rpc("upsert_external_calendar_event_v1",{
      p_connection_id:connection.id,
      p_external_uid:item.uid,
      p_title:title.slice(0,200),
      p_description:description,
      p_all_day:start.allDay,
      p_start_at:start.allDay?null:start.instant,
      p_end_at:start.allDay?null:(end?.instant??start.instant),
      p_start_date:start.allDay?start.date:null,
      p_end_date:start.allDay
        ? (end?.date ? minusOneDay(end.date) : start.date)
        : null,
      p_timezone:timezone,
      p_location_text:location,
      p_category_id:workCategory,
      p_external_updated_at:externalUpdatedAt,
      p_rrule:normalizeRrule(item.rrule),
      p_exception_dates:[...new Set(exceptions.dates)],
      p_exception_instants:[...new Set(exceptions.instants)],
    })

    if(result.error){
      skipped+=1
      failures.push(item.uid+": "+result.error.message)
      continue
    }

    if(existing.data?.id) updated+=1
    else imported+=1
    seen.push(item.uid)

    // Recurrence overrides are standalone read-only external events while
    // their original master occurrence is excluded above.
    for(const override of overridesByUid.get(item.uid)??[]){
      const overrideStart=parseDateTime(override.dtstart,timezone)
      const overrideUid=item.uid+"#"+override.recurrenceId!.value

      if(!overrideStart){
        skipped+=1
        failures.push(overrideUid+": invalid DTSTART")
        continue
      }

      if(override.status==="CANCELLED"){
        const deleted=await userClient.rpc("delete_external_calendar_event_v1",{
          p_connection_id:connection.id,
          p_external_uid:overrideUid,
        })
        if(deleted.error) failures.push(overrideUid+": "+deleted.error.message)
        continue
      }

      const overrideEnd=parseDateTime(override.dtend,timezone)
      const existingOverride=await userClient
        .from("calendar_events")
        .select("id")
        .eq("external_connection_id",connection.id)
        .eq("external_uid",overrideUid)
        .maybeSingle()

      const overrideResult=await userClient.rpc("upsert_external_calendar_event_v1",{
        p_connection_id:connection.id,
        p_external_uid:overrideUid,
        p_title:(importMode==="busy"?"Busy":(override.summary||item.summary||"Busy")).slice(0,200),
        p_description:importMode==="full"?(override.description||item.description||null):null,
        p_all_day:overrideStart.allDay,
        p_start_at:overrideStart.allDay?null:overrideStart.instant,
        p_end_at:overrideStart.allDay?null:(overrideEnd?.instant??overrideStart.instant),
        p_start_date:overrideStart.allDay?overrideStart.date:null,
        p_end_date:overrideStart.allDay
          ? (overrideEnd?.date?minusOneDay(overrideEnd.date):overrideStart.date)
          : null,
        p_timezone:overrideStart.timezone||timezone,
        p_location_text:importMode==="full"?(override.location||item.location||null):null,
        p_category_id:workCategory,
        p_external_updated_at:externalUpdatedAt,
        p_rrule:null,
        p_exception_dates:[],
        p_exception_instants:[],
      })

      if(overrideResult.error){
        skipped+=1
        failures.push(overrideUid+": "+overrideResult.error.message)
        continue
      }

      if(existingOverride.data?.id) updated+=1
      else imported+=1
      seen.push(overrideUid)
    }
  }

  const prune=await userClient.rpc("prune_external_calendar_events_v1",{
    p_connection_id:connection.id,
    p_seen_external_uids:seen,
  })
  if(prune.error) failures.push("cleanup: "+prune.error.message)

  if(failures.length){
    const message="Calendar sync failed for "+failures.length+" item(s): "+failures.slice(0,3).join(" | ")
    await userClient.from("calendar_connections").update({
      status:"error",
      last_error:message.slice(0,900),
      updated_at:new Date().toISOString(),
    }).eq("id",connection.id)

    return json({
      error:message,
      imported,
      updated,
      skipped,
      source_events:parsed.length,
    },422)
  }

  const now=new Date().toISOString()
  await userClient.from("calendar_connections").update({
    status:"connected",
    last_synced_at:now,
    last_error:null,
    updated_at:now,
  }).eq("id",connection.id)

  return json({
    ok:true,
    imported,
    updated,
    skipped,
    source_events:parsed.length,
    synced_at:now,
  })
})
