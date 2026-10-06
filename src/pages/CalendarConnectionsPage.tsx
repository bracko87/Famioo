import { CalendarSync, Check, Cloud, Link2, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarRow } from '../lib/types'

type Connection={
  id:string
  provider:'ics'|'microsoft'|'google'
  display_name:string
  target_calendar_id:string
  import_mode:'busy'|'title'|'full'
  feed_url:string|null
  external_account_label:string|null
  status:'pending'|'connected'|'error'|'disabled'|'setup_required'
  sync_enabled:boolean
  last_synced_at:string|null
  last_error:string|null
}

const importModes=[
  {
    value:'busy',
    label:'Busy only',
    description:'Safest. Famioo imports only the occupied time and displays “Busy”.',
  },
  {
    value:'title',
    label:'Title + time',
    description:'Imports the event title and time, but not notes or location.',
  },
  {
    value:'full',
    label:'Full details',
    description:'Imports title, time, description and location when the source provides them.',
  },
] as const

export function CalendarConnectionsPage(){
  const { household,modules }=useHousehold()
  const access=modules.find((module)=>module.code==='calendar_connections')
  const canWrite=Boolean(access?.enabled&&access?.can_write)
  const [calendars,setCalendars]=useState<CalendarRow[]>([])
  const [connections,setConnections]=useState<Connection[]>([])
  const [name,setName]=useState('')
  const [feedUrl,setFeedUrl]=useState('')
  const [targetCalendarId,setTargetCalendarId]=useState('')
  const [importMode,setImportMode]=useState<'busy'|'title'|'full'>('busy')
  const [saving,setSaving]=useState(false)
  const [syncingId,setSyncingId]=useState<string|null>(null)
  const [deleteConnection,setDeleteConnection]=useState<Connection|null>(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const icsFormRef=useRef<HTMLDivElement|null>(null)

  const calendarById=useMemo(
    ()=>new Map(calendars.map((calendar)=>[calendar.id,calendar])),
    [calendars],
  )

  async function load(){
    setError('')
    const [calendarResult,connectionResult]=await Promise.all([
      supabase
        .from('calendars')
        .select('id,name,color_key,is_default')
        .eq('household_id',household.id)
        .eq('active',true)
        .order('is_default',{ascending:false})
        .order('name'),
      supabase
        .from('calendar_connections')
        .select('id,provider,display_name,target_calendar_id,import_mode,feed_url,external_account_label,status,sync_enabled,last_synced_at,last_error')
        .eq('household_id',household.id)
        .order('created_at'),
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
  }

  useEffect(()=>{ void load() },[household.id])

  async function syncConnection(connectionId:string,showSuccess=true){
    if(syncingId) return
    setSyncingId(connectionId)
    setError('')
    setMessage('')

    const result=await supabase.functions.invoke('sync-calendar-connection',{
      body:{ connection_id:connectionId },
    })

    setSyncingId(null)

    if(result.error||result.data?.error){
      let detail=result.data?.error||result.error?.message||'Calendar sync failed.'
      const context=(result.error as {context?:Response}|null)?.context
      if(context){
        try{
          const payload=await context.clone().json() as {error?:string}
          if(payload.error) detail=payload.error
        }catch{
          // Keep the normal function error.
        }
      }
      setError(detail)
      await load()
      return false
    }

    if(showSuccess){
      setMessage(
        'Calendar synced · '
        +Number(result.data?.imported??0)+' new · '
        +Number(result.data?.updated??0)+' updated.',
      )
    }
    await load()
    return true
  }

  async function addIcsConnection(event:FormEvent){
    event.preventDefault()
    if(!canWrite||saving) return

    setSaving(true)
    setError('')
    setMessage('')

    const result=await supabase.rpc('save_ics_calendar_connection_v1',{
      p_connection_id:null,
      p_household_id:household.id,
      p_display_name:name.trim(),
      p_feed_url:feedUrl.trim(),
      p_target_calendar_id:targetCalendarId,
      p_import_mode:importMode,
    })

    setSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    const connectionId=String(result.data)
    setName('')
    setFeedUrl('')
    setImportMode('busy')
    await load()
    await syncConnection(connectionId,true)
  }

  async function toggleConnection(connection:Connection){
    if(!canWrite) return
    setError('')
    const result=await supabase.rpc('set_calendar_connection_enabled_v1',{
      p_household_id:household.id,
      p_connection_id:connection.id,
      p_enabled:!connection.sync_enabled,
    })

    if(result.error){
      setError(result.error.message)
      return
    }
    await load()
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

    setMessage(current.display_name+' disconnected and its imported events were removed.')
    await load()
  }

  function openIcsForm(){
    icsFormRef.current?.scrollIntoView({behavior:'smooth',block:'center'})
    window.setTimeout(()=>{
      const input=icsFormRef.current?.querySelector<HTMLInputElement>('input[name="ics-name"]')
      input?.focus()
    },250)
  }

  if(!access?.enabled){
    return (
      <div className="page calendar-connections-page">
        <div className="page-label">CALENDAR CONNECTIONS</div>
        <section className="list-card module-placeholder-card">
          <strong>Calendar Connections is not enabled for this household.</strong>
          <span>This optional module connects external calendars to Famioo.</span>
        </section>
      </div>
    )
  }

  return (
    <div className="page calendar-connections-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">CALENDAR CONNECTIONS</div>
          <h1>Bring work and external calendars into Famioo</h1>
          <p>Keep Famioo as the family view while controlling exactly how much information an external calendar may reveal.</p>
        </div>
        <Link className="secondary-button compact" to="/app/calendar">Back to Calendar</Link>
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice success">{message}</div>}

      <section className="calendar-provider-grid">
        <article className="calendar-provider-card">
          <span className="calendar-provider-icon microsoft"><Cloud size={20}/></span>
          <div>
            <span className="eyebrow">MICROSOFT</span>
            <h2>Outlook / Microsoft 365</h2>
            <p>Automatic work-calendar sync. Famioo will default to Busy-only mode so meeting subjects stay private.</p>
          </div>
          <span className="calendar-provider-status setup">OAuth setup required</span>
          <button type="button" className="secondary-button compact" disabled>Connect Microsoft 365</button>
        </article>

        <article className="calendar-provider-card">
          <span className="calendar-provider-icon google"><CalendarSync size={20}/></span>
          <div>
            <span className="eyebrow">GOOGLE</span>
            <h2>Google Calendar</h2>
            <p>Automatic calendar sync with the same Busy-only, Title + time and Full details privacy modes.</p>
          </div>
          <span className="calendar-provider-status setup">OAuth setup required</span>
          <button type="button" className="secondary-button compact" disabled>Connect Google Calendar</button>
        </article>

        <article className="calendar-provider-card ready">
          <span className="calendar-provider-icon ics"><Link2 size={20}/></span>
          <div>
            <span className="eyebrow">AVAILABLE NOW</span>
            <h2>ICS calendar feed</h2>
            <p>Connect a private HTTPS ICS subscription URL from Outlook, Google or another calendar provider.</p>
          </div>
          <span className="calendar-provider-status connected"><Check size={12}/>Ready</span>
          <button type="button" className="primary-button compact" onClick={openIcsForm}>Add ICS feed</button>
        </article>
      </section>

      <section className="calendar-privacy-modes list-card">
        <header>
          <div>
            <span className="eyebrow">PRIVACY MODE</span>
            <h2>Choose what Famioo imports</h2>
          </div>
        </header>
        <div className="calendar-import-mode-grid">
          {importModes.map((mode)=>(
            <article className={importMode===mode.value?'selected':''} key={mode.value}>
              <strong>{mode.label}</strong>
              <p>{mode.description}</p>
              {mode.value==='busy'&&<small>Recommended for business calendars</small>}
            </article>
          ))}
        </div>
      </section>

      <section className="calendar-connections-list list-card">
        <header>
          <div>
            <span className="eyebrow">CONNECTED CALENDARS</span>
            <h2>{connections.length ? connections.length+' connection'+(connections.length===1?'':'s') : 'No connections yet'}</h2>
          </div>
        </header>

        {connections.length===0 ? (
          <div className="empty-state compact-empty">
            <CalendarSync size={22}/>
            <strong>No external calendar is connected.</strong>
            <span>Add an ICS feed below. Microsoft and Google automatic OAuth connections are prepared as the next step.</span>
          </div>
        ) : (
          <div className="calendar-connection-rows">
            {connections.map((connection)=>{
              const target=calendarById.get(connection.target_calendar_id)
              return (
                <article className="calendar-connection-row" key={connection.id}>
                  <span className="calendar-connection-provider">
                    {connection.provider==='ics'?<Link2 size={16}/>:<Cloud size={16}/>}
                  </span>
                  <div className="calendar-connection-main">
                    <strong>{connection.display_name}</strong>
                    <small>
                      {connection.provider.toUpperCase()}
                      {' · '}
                      {connection.import_mode==='busy'?'Busy only':connection.import_mode==='title'?'Title + time':'Full details'}
                      {target?' · '+target.name:''}
                    </small>
                    {connection.last_synced_at&&(
                      <small>Last synced {new Date(connection.last_synced_at).toLocaleString()}</small>
                    )}
                    {connection.last_error&&<small className="connection-error">{connection.last_error}</small>}
                  </div>
                  <span className={'calendar-provider-status '+(
                    connection.status==='connected'&&connection.sync_enabled?'connected':
                    connection.status==='error'?'error':'paused'
                  )}>
                    {connection.status==='connected'&&connection.sync_enabled?'Connected':
                     connection.status==='error'?'Needs attention':'Paused'}
                  </span>
                  <div className="calendar-connection-actions">
                    <button
                      type="button"
                      className="icon-button compact-icon"
                      title="Sync now"
                      aria-label={'Sync '+connection.display_name}
                      disabled={syncingId===connection.id||!connection.sync_enabled}
                      onClick={()=>void syncConnection(connection.id)}
                    >
                      <RefreshCw size={14} className={syncingId===connection.id?'spin':''}/>
                    </button>
                    <button
                      type="button"
                      className="icon-button compact-icon"
                      title={connection.sync_enabled?'Pause sync':'Resume sync'}
                      aria-label={(connection.sync_enabled?'Pause ':'Resume ')+connection.display_name}
                      onClick={()=>void toggleConnection(connection)}
                    >
                      {connection.sync_enabled?<Pause size={14}/>:<Play size={14}/>}
                    </button>
                    <button
                      type="button"
                      className="icon-button compact-icon danger-icon-button"
                      title="Disconnect"
                      aria-label={'Disconnect '+connection.display_name}
                      onClick={()=>setDeleteConnection(connection)}
                    >
                      <Trash2 size={14}/>
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="calendar-ics-form list-card" ref={icsFormRef}>
        <header>
          <div>
            <span className="eyebrow">ICS FEED</span>
            <h2>Add an external calendar URL</h2>
            <p>The feed is imported read-only into Famioo. Editing the original meeting remains with the external calendar provider.</p>
          </div>
        </header>

        <form onSubmit={addIcsConnection}>
          <div className="composer-grid-two">
            <label>
              Connection name
              <input name="ics-name" value={name} onChange={(event)=>setName(event.target.value)} placeholder="e.g. Aleks Work Calendar" required/>
            </label>
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
              />
            </label>
          </div>

          <label>
            Private ICS URL
            <input
              value={feedUrl}
              onChange={(event)=>setFeedUrl(event.target.value)}
              placeholder="https://…/calendar.ics"
              inputMode="url"
              autoComplete="off"
              required
            />
            <small className="field-hint">Use the private subscription URL provided by the external calendar. Do not share this URL publicly.</small>
          </label>

          <fieldset className="calendar-connection-mode-fieldset">
            <legend>Privacy mode</legend>
            <div className="calendar-mode-buttons">
              {importModes.map((mode)=>(
                <button
                  type="button"
                  className={importMode===mode.value?'active':''}
                  key={mode.value}
                  onClick={()=>setImportMode(mode.value)}
                >
                  <strong>{mode.label}</strong>
                  <small>{mode.description}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="composer-footer-right">
            <button className="primary-button compact" disabled={saving||!targetCalendarId||!name.trim()||!feedUrl.trim()}>
              {saving?'Connecting…':'Connect & sync'}
            </button>
          </div>
        </form>
      </section>

      <ConfirmDialog
        open={Boolean(deleteConnection)}
        title="Disconnect external calendar?"
        message="The connection and all calendar events imported from it will be removed from Famioo. The original external calendar is not changed."
        confirmLabel="Disconnect"
        danger
        onCancel={()=>setDeleteConnection(null)}
        onConfirm={()=>void removeConnection()}
      />
    </div>
  )
}
