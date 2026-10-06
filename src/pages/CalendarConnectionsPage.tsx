import { CalendarSync, Check, FileText, FileUp, Image as ImageIcon, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarRow } from '../lib/types'

type Connection={
  id:string
  provider:'ics'|'file'|'microsoft'|'google'
  display_name:string
  target_calendar_id:string
  import_mode:'busy'|'title'|'full'
  feed_url:string|null
  status:'pending'|'connected'|'error'|'disabled'|'setup_required'
  sync_enabled:boolean
  last_synced_at:string|null
  last_error:string|null
}

type ImportDraft={
  id:string
  selected:boolean
  title:string
  date:string
  start_time:string|null
  end_time:string|null
  all_day:boolean
  location:string|null
  description:string|null
  confidence:number
}

const importModes=[
  {
    value:'busy',
    label:'Busy only',
    description:'Recommended for work. Famioo keeps only occupied time and shows “Busy”.',
  },
  {
    value:'title',
    label:'Title + time',
    description:'Keeps the appointment title and time, without notes or location.',
  },
  {
    value:'full',
    label:'Full details',
    description:'Keeps title, time, description and location when they are available.',
  },
] as const

function dateKey(date:Date){
  const year=date.getFullYear()
  const month=String(date.getMonth()+1).padStart(2,'0')
  const day=String(date.getDate()).padStart(2,'0')
  return year+'-'+month+'-'+day
}

function zonedLocalToIso(date:string,time:string,timezone:string){
  const [year,month,day]=date.split('-').map(Number)
  const [hour,minute]=time.split(':').map(Number)
  let guess=Date.UTC(year,month-1,day,hour,minute,0)

  for(let pass=0;pass<3;pass+=1){
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:timezone,
      year:'numeric',
      month:'2-digit',
      day:'2-digit',
      hour:'2-digit',
      minute:'2-digit',
      second:'2-digit',
      hourCycle:'h23',
    }).formatToParts(new Date(guess))
    const get=(type:string)=>Number(parts.find((part)=>part.type===type)?.value??0)
    const represented=Date.UTC(
      get('year'),get('month')-1,get('day'),
      get('hour'),get('minute'),get('second'),
    )
    const desired=Date.UTC(year,month-1,day,hour,minute,0)
    guess+=desired-represented
  }

  return new Date(guess).toISOString()
}

async function imageFileToDataUrl(file:File){
  if(!file.type.startsWith('image/')) throw new Error('Choose a screenshot image.')
  if(file.size>10_000_000) throw new Error('The screenshot is too large. Use an image smaller than 10 MB.')

  const objectUrl=URL.createObjectURL(file)
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const next=new window.Image()
      next.onload=()=>resolve(next)
      next.onerror=()=>reject(new Error('Famioo could not read the screenshot.'))
      next.src=objectUrl
    })

    const maxSide=2200
    const scale=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight))
    const width=Math.max(1,Math.round(image.naturalWidth*scale))
    const height=Math.max(1,Math.round(image.naturalHeight*scale))
    const canvas=document.createElement('canvas')
    canvas.width=width
    canvas.height=height
    const context=canvas.getContext('2d')
    if(!context) throw new Error('Famioo could not prepare the screenshot.')
    context.drawImage(image,0,0,width,height)
    return canvas.toDataURL('image/jpeg',0.9)
  }finally{
    URL.revokeObjectURL(objectUrl)
  }
}

export function CalendarConnectionsPage(){
  const { household,modules,profiles,user }=useHousehold()
  const calendarAccess=modules.find((module)=>module.code==='calendar')
  const canWrite=Boolean(calendarAccess?.enabled&&calendarAccess?.can_write)
  const [calendars,setCalendars]=useState<CalendarRow[]>([])
  const [connections,setConnections]=useState<Connection[]>([])
  const [workCategoryId,setWorkCategoryId]=useState<string|null>(null)
  const [targetCalendarId,setTargetCalendarId]=useState('')
  const [privacyMode,setPrivacyMode]=useState<'busy'|'title'|'full'>('busy')
  const [localFile,setLocalFile]=useState<File|null>(null)
  const [localImportName,setLocalImportName]=useState('')
  const [replaceFileConnectionId,setReplaceFileConnectionId]=useState<string|null>(null)
  const [screenshotFile,setScreenshotFile]=useState<File|null>(null)
  const [screenshotReferenceDate,setScreenshotReferenceDate]=useState(()=>dateKey(new Date()))
  const [pasteText,setPasteText]=useState('')
  const [drafts,setDrafts]=useState<ImportDraft[]>([])
  const [saving,setSaving]=useState(false)
  const [extracting,setExtracting]=useState<'image'|'text'|null>(null)
  const [syncingId,setSyncingId]=useState<string|null>(null)
  const [deleteConnection,setDeleteConnection]=useState<Connection|null>(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const screenshotRef=useRef<HTMLDivElement|null>(null)
  const fileRef=useRef<HTMLDivElement|null>(null)
  const pasteRef=useRef<HTMLDivElement|null>(null)
  const localFileInputRef=useRef<HTMLInputElement|null>(null)
  const replaceFileInputRef=useRef<HTMLInputElement|null>(null)

  const currentUserProfile=useMemo(
    ()=>profiles.find((profile)=>profile.linked_user_id===user.id)??null,
    [profiles,user.id],
  )

  const calendarById=useMemo(
    ()=>new Map(calendars.map((calendar)=>[calendar.id,calendar])),
    [calendars],
  )

  const visibleConnections=useMemo(
    ()=>connections.filter((connection)=>connection.provider==='file'||connection.provider==='ics'),
    [connections],
  )

  async function load(){
    setError('')
    const [calendarResult,connectionResult,categoryResult]=await Promise.all([
      supabase
        .from('calendars')
        .select('id,name,color_key,is_default')
        .eq('household_id',household.id)
        .eq('active',true)
        .order('is_default',{ascending:false})
        .order('name'),
      supabase
        .from('calendar_connections')
        .select('id,provider,display_name,target_calendar_id,import_mode,feed_url,status,sync_enabled,last_synced_at,last_error')
        .eq('household_id',household.id)
        .order('created_at'),
      supabase
        .from('event_categories')
        .select('id,name')
        .eq('household_id',household.id)
        .eq('active',true),
    ])

    if(calendarResult.error) setError(calendarResult.error.message)
    else{
      const rows=(calendarResult.data??[]) as CalendarRow[]
      setCalendars(rows)
      setTargetCalendarId((current)=>
        rows.some((item)=>item.id===current)
          ? current
          : rows.find((item)=>item.is_default)?.id??rows[0]?.id??''
      )
    }

    if(connectionResult.error) setError((current)=>current||connectionResult.error.message)
    else setConnections((connectionResult.data??[]) as Connection[])

    if(categoryResult.error) setError((current)=>current||categoryResult.error.message)
    else{
      const work=(categoryResult.data??[]).find((row)=>String(row.name).trim().toLowerCase()==='work')
      setWorkCategoryId(work?.id??null)
    }
  }

  useEffect(()=>{ void load() },[household.id])

  async function functionError(result:{error:any;data:any},fallback:string){
    let detail=result.data?.error||result.error?.message||fallback
    const context=(result.error as {context?:Response}|null)?.context
    if(context){
      try{
        const payload=await context.clone().json() as {error?:string}
        if(payload.error) detail=payload.error
      }catch{
        // Keep the normal function error.
      }
    }
    return String(detail)
  }

  async function extractDrafts(source:'image'|'text'){
    if(!canWrite||extracting) return
    setError('')
    setMessage('')

    let imageDataUrl:string|undefined
    if(source==='image'){
      if(!screenshotFile){
        setError('Choose a calendar screenshot first.')
        return
      }
      try{
        imageDataUrl=await imageFileToDataUrl(screenshotFile)
      }catch(reason){
        setError(reason instanceof Error?reason.message:'Famioo could not read the screenshot.')
        return
      }
    }else if(!pasteText.trim()){
      setError('Paste an appointment or calendar text first.')
      return
    }

    setExtracting(source)
    const result=await supabase.functions.invoke('extract-work-calendar',{
      body:{
        household_id:household.id,
        source_type:source,
        privacy_mode:privacyMode,
        reference_date:screenshotReferenceDate,
        timezone:household.timezone,
        ...(source==='image'?{image_data_url:imageDataUrl}:{raw_text:pasteText.trim()}),
      },
    })
    setExtracting(null)

    if(result.error||result.data?.error){
      setError(await functionError(result,'Could not read the calendar information.'))
      return
    }

    const rows=Array.isArray(result.data?.events)?result.data.events:[]
    const next:ImportDraft[]=rows.map((row:any,index:number)=>({
      id:String(Date.now())+'-'+index,
      selected:true,
      title:privacyMode==='busy'?'Busy':String(row.title||'Busy').slice(0,200),
      date:String(row.date||''),
      start_time:row.start_time?String(row.start_time).slice(0,5):null,
      end_time:row.end_time?String(row.end_time).slice(0,5):null,
      all_day:Boolean(row.all_day),
      location:privacyMode==='full'&&row.location?String(row.location).slice(0,300):null,
      description:privacyMode==='full'&&row.description?String(row.description).slice(0,1200):null,
      confidence:Number(row.confidence??0),
    })).filter((row:ImportDraft)=>/^\d{4}-\d{2}-\d{2}$/.test(row.date))

    if(!next.length){
      setError('No clear calendar events were detected. Try a sharper screenshot or paste the appointment text instead.')
      return
    }

    setDrafts(next)
    setMessage('Review the detected events below. Nothing has been added to Famioo yet.')
  }

  function updateDraft(id:string,patch:Partial<ImportDraft>){
    setDrafts((current)=>current.map((draft)=>draft.id===id?{...draft,...patch}:draft))
  }

  async function importSelectedDrafts(){
    if(!canWrite||saving||!targetCalendarId) return
    const selected=drafts.filter((draft)=>draft.selected)
    if(!selected.length){
      setError('Select at least one event to import.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    let imported=0
    for(const draft of selected){
      if(!draft.all_day&&(!draft.start_time||!draft.end_time)){
        setSaving(false)
        setError('Every timed event needs a start and end time.')
        return
      }

      let startAt:string|null=null
      let endAt:string|null=null
      if(!draft.all_day&&draft.start_time&&draft.end_time){
        startAt=zonedLocalToIso(draft.date,draft.start_time,household.timezone)
        endAt=zonedLocalToIso(draft.date,draft.end_time,household.timezone)
        if(new Date(endAt).getTime()<=new Date(startAt).getTime()){
          setSaving(false)
          setError('An event end time must be later than its start time.')
          return
        }
      }

      const title=privacyMode==='busy'?'Busy':(draft.title.trim()||'Busy')
      const result=await supabase.rpc('save_event_v1',{
        p_event_id:null,
        p_household_id:household.id,
        p_calendar_id:targetCalendarId,
        p_title:title.slice(0,200),
        p_description:privacyMode==='full'?(draft.description?.trim()||null):null,
        p_all_day:draft.all_day,
        p_start_at:startAt,
        p_end_at:endAt,
        p_start_date:draft.all_day?draft.date:null,
        p_end_date:draft.all_day?draft.date:null,
        p_timezone:household.timezone,
        p_location_text:privacyMode==='full'?(draft.location?.trim()||null):null,
        p_category_id:workCategoryId,
        p_visibility:'household',
        p_participants:currentUserProfile?[{
          profile_id:currentUserProfile.id,
          participant_role:'participant',
          can_edit:false,
        }]:[],
        p_rrule:null,
        p_reminders:[],
      })

      if(result.error){
        setSaving(false)
        setError('Imported '+imported+' event(s), then stopped: '+result.error.message)
        return
      }
      imported+=1
    }

    setSaving(false)
    setDrafts((current)=>current.filter((draft)=>!draft.selected))
    setMessage(imported+' work event'+(imported===1?'':'s')+' added to Famioo.')
  }

  async function syncConnection(connectionId:string,showSuccess=true,icsText?:string){
    if(syncingId) return false
    setSyncingId(connectionId)
    setError('')
    setMessage('')

    const result=await supabase.functions.invoke('sync-calendar-connection',{
      body:{ connection_id:connectionId, ...(icsText?{ics_text:icsText}:{}) },
    })
    setSyncingId(null)

    if(result.error||result.data?.error){
      setError(await functionError(result,'Calendar import failed.'))
      await load()
      return false
    }

    if(showSuccess){
      setMessage(
        'Calendar imported · '
        +Number(result.data?.imported??0)+' new · '
        +Number(result.data?.updated??0)+' updated.'
      )
    }
    await load()
    return true
  }

  async function importLocalCalendarFile(){
    if(!canWrite||saving||!localFile||!targetCalendarId) return
    setSaving(true)
    setError('')
    setMessage('')

    let textValue=''
    try{
      textValue=await localFile.text()
    }catch{
      setSaving(false)
      setError('Famioo could not read the selected calendar file.')
      return
    }

    const displayName=(localImportName.trim()||localFile.name.replace(/\.ics$/i,'').trim()||'Work calendar').slice(0,120)
    const result=await supabase.rpc('create_calendar_file_import_v1',{
      p_household_id:household.id,
      p_display_name:displayName,
      p_target_calendar_id:targetCalendarId,
      p_import_mode:privacyMode,
    })

    if(result.error){
      setSaving(false)
      setError(result.error.message)
      return
    }

    const connectionId=String(result.data)
    const synced=await syncConnection(connectionId,false,textValue)
    setSaving(false)

    if(!synced){
      await supabase.rpc('delete_calendar_connection_v1',{
        p_household_id:household.id,
        p_connection_id:connectionId,
        p_remove_imported_events:true,
      })
      await load()
      return
    }

    setLocalFile(null)
    setLocalImportName('')
    if(localFileInputRef.current) localFileInputRef.current.value=''
    setMessage('Calendar file imported. Upload a newer .ics file later whenever you want to refresh it.')
    await load()
  }

  async function replaceLocalCalendarFile(file:File,connectionId:string){
    let textValue=''
    try{
      textValue=await file.text()
    }catch{
      setError('Famioo could not read the selected calendar file.')
      return
    }
    await syncConnection(connectionId,true,textValue)
  }

  async function removeConnection(){
    if(!deleteConnection||!canWrite) return
    const current=deleteConnection
    setDeleteConnection(null)
    setError('')

    const result=await supabase.rpc('delete_calendar_connection_v1',{
      p_household_id:household.id,
      p_connection_id:current.id,
      p_remove_imported_events:true,
    })

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage(current.display_name+' and its imported events were removed from Famioo.')
    await load()
  }

  if(!calendarAccess?.enabled){
    return (
      <div className="page calendar-connections-page">
        <div className="page-label">WORK CALENDAR</div>
        <section className="list-card module-placeholder-card">
          <strong>Calendar is not enabled for this household.</strong>
          <span>Work-calendar import is part of the normal Famioo Calendar.</span>
        </section>
      </div>
    )
  }

  return (
    <div className="page calendar-connections-page work-calendar-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">WORK CALENDAR</div>
          <h1>Bring work time into Famioo</h1>
          <p>No company login is required. Import a screenshot, a local .ics file, or pasted appointment text and review it before it reaches the family calendar.</p>
        </div>
        <Link className="secondary-button compact" to="/app/calendar">Back to Calendar</Link>
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice success">{message}</div>}

      <section className="calendar-provider-grid work-calendar-methods">
        <article className="calendar-provider-card ready">
          <span className="calendar-provider-icon screenshot"><ImageIcon size={20}/></span>
          <div>
            <span className="eyebrow">EASIEST FOR COMPANY CALENDARS</span>
            <h2>Calendar screenshot</h2>
            <p>Upload a week or month screenshot. Famioo detects the occupied blocks and asks you to confirm them before import.</p>
          </div>
          <span className="calendar-provider-status connected"><Check size={12}/>Available now</span>
          <button type="button" className="primary-button compact" disabled={!canWrite} onClick={()=>screenshotRef.current?.scrollIntoView({behavior:'smooth',block:'center'})}>
            Upload screenshot
          </button>
        </article>

        <article className="calendar-provider-card ready local-file">
          <span className="calendar-provider-icon file"><FileUp size={20}/></span>
          <div>
            <span className="eyebrow">NO COMPANY CONNECTION</span>
            <h2>Local .ics file</h2>
            <p>Import a calendar file exported from Outlook or another calendar app. No public calendar link or company OAuth permission is needed.</p>
          </div>
          <span className="calendar-provider-status connected"><Check size={12}/>Available now</span>
          <button type="button" className="primary-button compact" disabled={!canWrite} onClick={()=>fileRef.current?.scrollIntoView({behavior:'smooth',block:'center'})}>
            Import .ics file
          </button>
        </article>

        <article className="calendar-provider-card ready">
          <span className="calendar-provider-icon paste"><FileText size={20}/></span>
          <div>
            <span className="eyebrow">ONE APPOINTMENT OR SMALL LIST</span>
            <h2>Paste appointment</h2>
            <p>Copy appointment text from Outlook, Teams, email or another source. Famioo turns it into editable event drafts.</p>
          </div>
          <span className="calendar-provider-status connected"><Check size={12}/>Available now</span>
          <button type="button" className="primary-button compact" disabled={!canWrite} onClick={()=>pasteRef.current?.scrollIntoView({behavior:'smooth',block:'center'})}>
            Paste appointment
          </button>
        </article>
      </section>

      <section className="work-calendar-settings list-card">
        <header>
          <div>
            <span className="eyebrow">IMPORT SETTINGS</span>
            <h2>Choose the destination and privacy level</h2>
            <p>Busy only is the default for company appointments. It removes meeting subjects, notes and locations from the Famioo event.</p>
          </div>
        </header>

        <div className="work-calendar-target-row">
          <label>
            Import into Famioo calendar
            <Select
              value={targetCalendarId}
              onChange={setTargetCalendarId}
              options={calendars.map((calendar)=>({
                value:calendar.id,
                label:calendar.name+(calendar.is_default?' · Default':''),
                dotColor:categoryColor(calendar.color_key),
              }))}
              ariaLabel="Choose Famioo target calendar"
              disabled={!canWrite}
            />
          </label>
          <div className="work-calendar-owner-note">
            <strong>Work category</strong>
            <span>{workCategoryId?'Imported work events use your Work category.':'No Work category was found; events will still import into the selected calendar.'}</span>
          </div>
        </div>

        <div className="calendar-import-mode-grid work-privacy-grid">
          {importModes.map((mode)=>(
            <button
              type="button"
              className={privacyMode===mode.value?'selected':''}
              key={mode.value}
              disabled={!canWrite}
              onClick={()=>setPrivacyMode(mode.value)}
            >
              <strong>{mode.label}</strong>
              <p>{mode.description}</p>
              {mode.value==='busy'&&<small>Recommended for business calendars</small>}
            </button>
          ))}
        </div>
      </section>

      <section className="work-import-card list-card" ref={screenshotRef}>
        <header>
          <div>
            <span className="eyebrow">SCREENSHOT IMPORT</span>
            <h2>Upload a work-calendar screenshot</h2>
            <p>A week or month view works best. Famioo analyzes the image, then shows every detected block for confirmation before creating events.</p>
          </div>
          <ImageIcon size={20}/>
        </header>

        <div className="composer-grid-two">
          <label>
            Screenshot
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!canWrite||Boolean(extracting)}
              onChange={(event)=>setScreenshotFile(event.target.files?.[0]??null)}
            />
            <small className="field-hint">Use a clear screenshot with the day/date and time grid visible.</small>
          </label>
          <label>
            Reference date
            <input
              type="date"
              value={screenshotReferenceDate}
              disabled={!canWrite||Boolean(extracting)}
              onChange={(event)=>setScreenshotReferenceDate(event.target.value)}
            />
            <small className="field-hint">Used only when the screenshot does not show a complete date.</small>
          </label>
        </div>

        <div className="calendar-file-privacy-note">
          <strong>Nothing is imported automatically</strong>
          <span>The screenshot is sent to the extraction service for this request and is not saved in Famioo file storage. You choose which detected events are added to the calendar.</span>
        </div>

        <div className="composer-footer-right">
          <button type="button" className="primary-button compact" disabled={!canWrite||!screenshotFile||Boolean(extracting)} onClick={()=>void extractDrafts('image')}>
            <Sparkles size={14}/>
            {extracting==='image'?'Reading screenshot…':'Detect calendar events'}
          </button>
        </div>
      </section>

      <section className="work-import-card list-card" ref={pasteRef}>
        <header>
          <div>
            <span className="eyebrow">PASTE APPOINTMENT</span>
            <h2>Paste one appointment or a small calendar list</h2>
            <p>Useful when Outlook lets you copy the event details even though company policy blocks external calendar access.</p>
          </div>
          <FileText size={20}/>
        </header>

        <textarea
          className="work-calendar-paste"
          value={pasteText}
          disabled={!canWrite||Boolean(extracting)}
          onChange={(event)=>setPasteText(event.target.value)}
          placeholder={"Example:\nProject meeting\nTuesday 14:00–15:30\nHamburg Office"}
        />

        <div className="composer-footer-right">
          <button type="button" className="primary-button compact" disabled={!canWrite||!pasteText.trim()||Boolean(extracting)} onClick={()=>void extractDrafts('text')}>
            <Sparkles size={14}/>
            {extracting==='text'?'Reading appointment…':'Create event draft'}
          </button>
        </div>
      </section>

      {drafts.length>0&&(
        <section className="work-calendar-review list-card">
          <header>
            <div>
              <span className="eyebrow">REVIEW BEFORE IMPORT</span>
              <h2>{drafts.length} detected event{drafts.length===1?'':'s'}</h2>
              <p>Correct dates or times if needed, deselect anything you do not want, then import the selected events.</p>
            </div>
          </header>

          <div className="work-calendar-draft-list">
            {drafts.map((draft)=>(
              <article className={draft.selected?'work-calendar-draft selected':'work-calendar-draft'} key={draft.id}>
                <label className="work-calendar-draft-check">
                  <input type="checkbox" checked={draft.selected} onChange={(event)=>updateDraft(draft.id,{selected:event.target.checked})}/>
                  <span>Import</span>
                </label>
                <label>
                  Title
                  <input value={privacyMode==='busy'?'Busy':draft.title} readOnly={privacyMode==='busy'} onChange={(event)=>updateDraft(draft.id,{title:event.target.value})}/>
                </label>
                <label>
                  Date
                  <input type="date" value={draft.date} onChange={(event)=>updateDraft(draft.id,{date:event.target.value})}/>
                </label>
                <label className="work-calendar-all-day-check">
                  <input type="checkbox" checked={draft.all_day} onChange={(event)=>updateDraft(draft.id,{all_day:event.target.checked})}/>
                  <span>All day</span>
                </label>
                {!draft.all_day&&(
                  <>
                    <label>
                      Start
                      <input type="time" value={draft.start_time??''} onChange={(event)=>updateDraft(draft.id,{start_time:event.target.value})}/>
                    </label>
                    <label>
                      End
                      <input type="time" value={draft.end_time??''} onChange={(event)=>updateDraft(draft.id,{end_time:event.target.value})}/>
                    </label>
                  </>
                )}
                <small className="work-calendar-confidence">
                  Detection confidence {Math.round(Math.max(0,Math.min(1,draft.confidence))*100)}%
                  {privacyMode==='full'&&draft.location?' · '+draft.location:''}
                </small>
              </article>
            ))}
          </div>

          <div className="work-calendar-review-actions">
            <button type="button" className="secondary-button compact" disabled={saving} onClick={()=>setDrafts([])}>Discard drafts</button>
            <button type="button" className="primary-button compact" disabled={saving||!drafts.some((draft)=>draft.selected)} onClick={()=>void importSelectedDrafts()}>
              {saving?'Importing…':'Import selected'}
            </button>
          </div>
        </section>
      )}

      <section className="calendar-file-import list-card" ref={fileRef}>
        <header>
          <div>
            <span className="eyebrow">LOCAL CALENDAR FILE</span>
            <h2>Import an .ics file without connecting the company account</h2>
            <p>The events are imported read-only. Re-upload a newer file later to refresh the same imported calendar.</p>
          </div>
          <FileUp size={20}/>
        </header>

        <div className="composer-grid-two">
          <label>
            Import name
            <input
              value={localImportName}
              disabled={!canWrite||saving}
              onChange={(event)=>setLocalImportName(event.target.value)}
              placeholder="e.g. My Work Calendar"
            />
          </label>
          <label>
            Calendar file
            <input
              ref={localFileInputRef}
              type="file"
              accept=".ics,text/calendar"
              disabled={!canWrite||saving}
              onChange={(event)=>setLocalFile(event.target.files?.[0]??null)}
            />
          </label>
        </div>

        <div className="composer-footer-right">
          <button type="button" className="primary-button compact" disabled={!canWrite||saving||!targetCalendarId||!localFile} onClick={()=>void importLocalCalendarFile()}>
            {saving?'Importing…':'Import .ics file'}
          </button>
        </div>
      </section>

      {visibleConnections.length>0&&(
        <section className="calendar-connections-list list-card">
          <header>
            <div>
              <span className="eyebrow">IMPORTED CALENDARS</span>
              <h2>{visibleConnections.length} saved import{visibleConnections.length===1?'':'s'}</h2>
            </div>
          </header>

          <div className="calendar-connection-rows">
            {visibleConnections.map((connection)=>{
              const target=calendarById.get(connection.target_calendar_id)
              return (
                <article className="calendar-connection-row" key={connection.id}>
                  <span className="calendar-connection-provider">
                    {connection.provider==='file'?<FileUp size={16}/>:<CalendarSync size={16}/>}
                  </span>
                  <div className="calendar-connection-main">
                    <strong>{connection.display_name}</strong>
                    <small>
                      {connection.provider==='file'?'LOCAL FILE':'ICS FEED'}
                      {' · '}
                      {connection.import_mode==='busy'?'Busy only':connection.import_mode==='title'?'Title + time':'Full details'}
                      {target?' · '+target.name:''}
                    </small>
                    {connection.last_synced_at&&<small>Last imported {new Date(connection.last_synced_at).toLocaleString()}</small>}
                    {connection.last_error&&<small className="connection-error">{connection.last_error}</small>}
                  </div>
                  <span className={'calendar-provider-status '+(connection.status==='error'?'error':'connected')}>
                    {connection.status==='error'?'Needs attention':'Imported'}
                  </span>
                  <div className="calendar-connection-actions">
                    <button
                      type="button"
                      className="icon-button compact-icon"
                      title={connection.provider==='file'?'Upload newer .ics file':'Refresh import'}
                      aria-label={'Refresh '+connection.display_name}
                      disabled={!canWrite||syncingId===connection.id}
                      onClick={()=>{
                        if(connection.provider==='file'){
                          setReplaceFileConnectionId(connection.id)
                          replaceFileInputRef.current?.click()
                        }else{
                          void syncConnection(connection.id)
                        }
                      }}
                    >
                      {connection.provider==='file'?<FileUp size={14}/>:<RefreshCw size={14} className={syncingId===connection.id?'spin':''}/>}
                    </button>
                    <button
                      type="button"
                      className="icon-button compact-icon danger-icon-button"
                      title="Remove import"
                      aria-label={'Remove '+connection.display_name}
                      disabled={!canWrite}
                      onClick={()=>setDeleteConnection(connection)}
                    >
                      <Trash2 size={14}/>
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <input
        ref={replaceFileInputRef}
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={(event)=>{
          const file=event.target.files?.[0]
          const connectionId=replaceFileConnectionId
          event.currentTarget.value=''
          setReplaceFileConnectionId(null)
          if(file&&connectionId) void replaceLocalCalendarFile(file,connectionId)
        }}
      />

      <section className="work-calendar-future-note list-card">
        <span className="calendar-provider-icon future"><CalendarSync size={19}/></span>
        <div>
          <span className="eyebrow">LATER: MOBILE SHARE</span>
          <h2>What “Share to Famioo” means</h2>
          <p>In a future native mobile app, Famioo can appear in the phone share menu. Then an Outlook event could be shared to Famioo as a one-off import. The current web/PWA version cannot reliably register that Outlook share action, so it is not shown as a working option yet.</p>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleteConnection)}
        title="Remove imported calendar?"
        message="The saved import and all events created from that .ics source will be removed from Famioo. The original work calendar is never changed."
        confirmLabel="Remove"
        danger
        onCancel={()=>setDeleteConnection(null)}
        onConfirm={()=>void removeConnection()}
      />
    </div>
  )
}
