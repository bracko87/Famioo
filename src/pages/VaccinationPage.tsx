import { CalendarDays, Check, MapPin, Pencil, Plus, ShieldCheck, Syringe, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { TimePicker } from '../components/ui/TimePicker'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarRow } from '../lib/types'

type VaccinationTemplate={
  code:string
  schedule_version:string
  vaccine_name:string
  dose_label:string
  age_label:string
  timing_note:string|null
  is_optional:boolean
  sort_order:number
}

type VaccinationEntry={
  id:string
  child_profile_id:string
  template_code:string|null
  schedule_version:string
  vaccine_name:string
  dose_label:string
  recommended_start_date:string|null
  recommended_end_date:string|null
  scheduled_date:string|null
  scheduled_time:string|null
  location_text:string|null
  provider_text:string|null
  notes:string|null
  status:'recommended'|'scheduled'|'completed'|'not_applicable'
  completed_date:string|null
  calendar_id:string|null
  linked_event_id:string|null
}

function firstName(name:string){
  return name.trim().split(/\s+/)[0]||name
}

function formatDate(value:string|null){
  if(!value) return 'Date set by paediatrician'
  return new Date(value+'T12:00:00').toLocaleDateString()
}

function statusLabel(status:VaccinationEntry['status']){
  if(status==='scheduled') return 'Scheduled'
  if(status==='completed') return 'Completed'
  if(status==='not_applicable') return 'Not applicable'
  return 'Recommended'
}

export function VaccinationPage(){
  const { household,modules,profiles,refresh }=useHousehold()
  const access=modules.find((module)=>module.code==='vaccinations')
  const canWrite=Boolean(access?.enabled&&access.can_write)
  const children=useMemo(()=>profiles.filter((profile)=>profile.profile_type==='child'),[profiles])
  const [selectedChild,setSelectedChild]=useState('')
  const [templates,setTemplates]=useState<VaccinationTemplate[]>([])
  const [entries,setEntries]=useState<VaccinationEntry[]>([])
  const [calendars,setCalendars]=useState<CalendarRow[]>([])
  const [birthDate,setBirthDate]=useState('')
  const [editing,setEditing]=useState<VaccinationEntry|null>(null)
  const [scheduledDate,setScheduledDate]=useState('')
  const [scheduledTime,setScheduledTime]=useState('')
  const [locationText,setLocationText]=useState('')
  const [providerText,setProviderText]=useState('')
  const [notes,setNotes]=useState('')
  const [status,setStatus]=useState<VaccinationEntry['status']>('recommended')
  const [completedDate,setCompletedDate]=useState('')
  const [calendarId,setCalendarId]=useState('')
  const [addToCalendar,setAddToCalendar]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const selectedProfile=useMemo(
    ()=>children.find((child)=>child.id===selectedChild)??children[0]??null,
    [children,selectedChild],
  )

  const templateByCode=useMemo(
    ()=>new Map(templates.map((item)=>[item.code,item])),
    [templates],
  )

  useEffect(()=>{
    if(!selectedChild&&children.length) setSelectedChild(children[0].id)
    if(selectedChild&&!children.some((child)=>child.id===selectedChild)) setSelectedChild(children[0]?.id??'')
  },[children,selectedChild])

  async function loadBase(){
    if(!access?.enabled) return
    const [templateResult,calendarResult]=await Promise.all([
      supabase
        .from('vaccination_schedule_templates')
        .select('code,schedule_version,vaccine_name,dose_label,age_label,timing_note,is_optional,sort_order')
        .eq('country_code','DE')
        .eq('schedule_version','STIKO 2026')
        .eq('active',true)
        .order('sort_order'),
      supabase
        .from('calendars')
        .select('id,name,color_key,is_default')
        .eq('household_id',household.id)
        .eq('active',true)
        .order('is_default',{ascending:false})
        .order('name'),
    ])

    if(templateResult.error) setError(templateResult.error.message)
    else setTemplates((templateResult.data??[]) as VaccinationTemplate[])

    if(calendarResult.error) setError((current)=>current||calendarResult.error.message)
    else{
      const rows=(calendarResult.data??[]) as CalendarRow[]
      setCalendars(rows)
      setCalendarId((current)=>rows.some((row)=>row.id===current)
        ?current
        :rows.find((row)=>row.is_default)?.id??rows[0]?.id??'')
    }
  }

  async function loadEntries(childId:string){
    setError('')
    const result=await supabase
      .from('child_vaccination_entries')
      .select('id,child_profile_id,template_code,schedule_version,vaccine_name,dose_label,recommended_start_date,recommended_end_date,scheduled_date,scheduled_time,location_text,provider_text,notes,status,completed_date,calendar_id,linked_event_id')
      .eq('household_id',household.id)
      .eq('child_profile_id',childId)

    if(result.error){
      setError(result.error.message)
      return
    }

    setEntries((result.data??[]) as VaccinationEntry[])
  }

  async function initializePlan(childId:string){
    if(!canWrite) return
    const result=await supabase.rpc('initialize_child_vaccination_plan_v1',{
      p_household_id:household.id,
      p_child_profile_id:childId,
    })
    if(result.error){
      if(!/date of birth/i.test(result.error.message)) setError(result.error.message)
      return
    }
    await loadEntries(childId)
  }

  useEffect(()=>{ void loadBase() },[household.id,access?.enabled])

  useEffect(()=>{
    if(!selectedProfile||!access?.enabled) return
    setBirthDate(selectedProfile.birth_date??'')
    void (async()=>{
      await loadEntries(selectedProfile.id)
      if(selectedProfile.birth_date&&canWrite) await initializePlan(selectedProfile.id)
    })()
  },[selectedProfile?.id,selectedProfile?.birth_date,access?.enabled])

  async function saveBirthDate(event:FormEvent){
    event.preventDefault()
    if(!selectedProfile||!birthDate||!canWrite||saving) return
    setSaving(true)
    setError('')
    setMessage('')

    const result=await supabase.rpc('set_child_birth_date_v1',{
      p_household_id:household.id,
      p_child_profile_id:selectedProfile.id,
      p_birth_date:birthDate,
    })

    setSaving(false)
    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage('Date of birth saved and the STIKO 2026 vaccination plan was created.')
    await refresh()
    await loadEntries(selectedProfile.id)
  }

  function openEntry(entry:VaccinationEntry){
    setEditing(entry)
    setScheduledDate(entry.scheduled_date??entry.recommended_start_date??'')
    setScheduledTime(entry.scheduled_time?.slice(0,5)??'')
    setLocationText(entry.location_text??'')
    setProviderText(entry.provider_text??'')
    setNotes(entry.notes??'')
    setStatus(entry.status)
    setCompletedDate(entry.completed_date??'')
    setCalendarId(entry.calendar_id??calendars.find((calendar)=>calendar.is_default)?.id??calendars[0]?.id??'')
    setAddToCalendar(Boolean(entry.linked_event_id)||entry.status==='scheduled')
    setError('')
  }

  async function saveEntry(event:FormEvent){
    event.preventDefault()
    if(!editing||!canWrite||saving) return

    setSaving(true)
    setError('')
    setMessage('')

    const result=await supabase.rpc('save_child_vaccination_entry_v1',{
      p_entry_id:editing.id,
      p_household_id:household.id,
      p_scheduled_date:scheduledDate||null,
      p_scheduled_time:scheduledTime||null,
      p_location_text:locationText.trim()||null,
      p_provider_text:providerText.trim()||null,
      p_notes:notes.trim()||null,
      p_status:status,
      p_completed_date:completedDate||null,
      p_calendar_id:calendarId||null,
      p_add_to_calendar:addToCalendar,
    })

    setSaving(false)
    if(result.error){
      setError(result.error.message)
      return
    }

    setEditing(null)
    setMessage('Vaccination entry updated.')
    if(selectedProfile) await loadEntries(selectedProfile.id)
  }

  const sortedEntries=useMemo(()=>[...entries].sort((a,b)=>{
    const ta=a.template_code?templateByCode.get(a.template_code):undefined
    const tb=b.template_code?templateByCode.get(b.template_code):undefined
    return (ta?.sort_order??999)-(tb?.sort_order??999)
  }),[entries,templateByCode])

  const completedCount=entries.filter((entry)=>entry.status==='completed').length
  const scheduledCount=entries.filter((entry)=>entry.status==='scheduled').length
  const nextEntry=sortedEntries.find((entry)=>entry.status==='scheduled')
    ??sortedEntries.find((entry)=>entry.status==='recommended'&&entry.recommended_start_date)

  if(!access?.enabled){
    return (
      <div className="page vaccination-page">
        <div className="page-label">VACCINATION CALENDAR</div>
        <section className="list-card module-placeholder-card">
          <Syringe size={24}/>
          <strong>Vaccination Calendar is not enabled for this household.</strong>
          <span>This is an optional Famioo module for child vaccination planning and Calendar synchronization.</span>
        </section>
      </div>
    )
  }

  return (
    <div className="page vaccination-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">VACCINATION CALENDAR</div>
          <h1>Vaccination Calendar</h1>
          <p className="page-subtitle">Plan and track each child’s vaccination appointments using the German STIKO 2026 standard schedule, then place booked appointments directly into the family Calendar.</p>
        </div>
        <span className="vaccination-source-badge"><ShieldCheck size={14}/>Germany · STIKO 2026</span>
      </div>

      <section className="list-card vaccination-medical-note">
        <ShieldCheck size={18}/>
        <div>
          <strong>Planning aid, not a replacement for medical advice</strong>
          <p>Famioo uses the standard STIKO schedule as a template. The child’s paediatrician and vaccination record remain authoritative, especially for premature babies, catch-up vaccinations, medical risk groups and product-specific intervals.</p>
        </div>
      </section>

      {error&&!editing&&<div className="notice error">{error}</div>}
      {message&&<div className="notice success">{message}</div>}

      {children.length===0 ? (
        <section className="list-card empty-state vaccination-empty">
          <Syringe size={26}/>
          <span className="empty-state-title">Create a child profile first.</span>
          <span>The vaccination plan belongs to the child’s existing Famioo profile.</span>
          <Link className="primary-button compact" to="/app/settings?tab=users">Open household people</Link>
        </section>
      ) : (
        <>
          <section className="vaccination-child-strip">
            {children.map((child)=>(
              <button
                type="button"
                className={selectedProfile?.id===child.id?'list-card vaccination-child-card active':'list-card vaccination-child-card'}
                key={child.id}
                onClick={()=>setSelectedChild(child.id)}
              >
                <ProfileAvatar avatarPath={child.avatar_path} name={child.display_name} size="sm"/>
                <span>
                  <strong>{firstName(child.display_name)}</strong>
                  <small>{child.birth_date?new Date(child.birth_date+'T12:00:00').toLocaleDateString():'Birth date needed'}</small>
                </span>
              </button>
            ))}
          </section>

          {selectedProfile&&!selectedProfile.birth_date ? (
            <form className="list-card vaccination-birth-card" onSubmit={saveBirthDate}>
              <div>
                <span className="eyebrow">SET UP CHILD</span>
                <h2>Add {firstName(selectedProfile.display_name)}’s date of birth</h2>
                <p>Famioo needs the birth date to calculate the recommended vaccination windows.</p>
              </div>
              <label>
                Date of birth
                <DatePicker
                  value={birthDate}
                  onChange={setBirthDate}
                  max={new Date().toISOString().slice(0,10)}
                  format={household.date_format}
                  ariaLabel="Choose child date of birth"
                />
              </label>
              <button className="primary-button compact" disabled={!birthDate||saving}>
                {saving?'Creating plan…':'Create vaccination plan'}
              </button>
            </form>
          ) : selectedProfile ? (
            <>
              <section className="vaccination-summary-grid">
                <article className="list-card vaccination-summary-card">
                  <span><Check size={18}/></span>
                  <div><strong>{completedCount}</strong><small>completed</small></div>
                </article>
                <article className="list-card vaccination-summary-card">
                  <span><CalendarDays size={18}/></span>
                  <div><strong>{scheduledCount}</strong><small>scheduled</small></div>
                </article>
                <article className="list-card vaccination-summary-card wide">
                  <span><Syringe size={18}/></span>
                  <div>
                    <small>Next</small>
                    <strong>{nextEntry?nextEntry.vaccine_name+' · '+nextEntry.dose_label:'No upcoming item'}</strong>
                    <small>{nextEntry?.scheduled_date?formatDate(nextEntry.scheduled_date):nextEntry?.recommended_start_date?'Recommended from '+formatDate(nextEntry.recommended_start_date):'Ask the paediatrician for timing'}</small>
                  </div>
                </article>
              </section>

              <section className="vaccination-timeline-section">
                <header className="vaccination-section-head">
                  <div>
                    <span className="eyebrow">CHILD PLAN</span>
                    <h2>{firstName(selectedProfile.display_name)} · vaccination timeline</h2>
                  </div>
                  <button type="button" className="secondary-button compact" disabled={!canWrite} onClick={()=>void initializePlan(selectedProfile.id)}>
                    Refresh STIKO template
                  </button>
                </header>

                <div className="vaccination-timeline">
                  {sortedEntries.map((entry)=>{
                    const template=entry.template_code?templateByCode.get(entry.template_code):undefined
                    return (
                      <article className={'list-card vaccination-entry '+entry.status} key={entry.id}>
                        <div className="vaccination-age">
                          <span>{template?.age_label??'Custom'}</span>
                          {template?.is_optional&&<small>Optional / product dependent</small>}
                        </div>
                        <span className="vaccination-dot"><Syringe size={15}/></span>
                        <div className="vaccination-entry-main">
                          <div className="vaccination-entry-title">
                            <div>
                              <strong>{entry.vaccine_name}</strong>
                              <span>{entry.dose_label}</span>
                            </div>
                            <em className={'vaccination-status '+entry.status}>{statusLabel(entry.status)}</em>
                          </div>

                          <div className="vaccination-entry-meta">
                            {entry.scheduled_date ? (
                              <span><CalendarDays size={12}/>{formatDate(entry.scheduled_date)}{entry.scheduled_time?' · '+entry.scheduled_time.slice(0,5):''}</span>
                            ) : entry.recommended_start_date ? (
                              <span><CalendarDays size={12}/>Recommended {formatDate(entry.recommended_start_date)}{entry.recommended_end_date&&entry.recommended_end_date!==entry.recommended_start_date?' – '+formatDate(entry.recommended_end_date):''}</span>
                            ) : (
                              <span><CalendarDays size={12}/>Timing set with paediatrician</span>
                            )}
                            {entry.location_text&&<GoogleMapsLink location={entry.location_text}/>}
                            {entry.provider_text&&<span><MapPin size={12}/>{entry.provider_text}</span>}
                            {entry.linked_event_id&&<span><CalendarDays size={12}/>In Family Calendar</span>}
                          </div>

                          {template?.timing_note&&<p>{template.timing_note}</p>}
                          {entry.notes&&<p className="vaccination-user-note">{entry.notes}</p>}
                        </div>

                        {canWrite&&(
                          <button type="button" className="icon-button compact-icon" aria-label={'Edit '+entry.vaccine_name} onClick={()=>openEntry(entry)}>
                            <Pencil size={14}/>
                          </button>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            </>
          ) : null}
        </>
      )}

      {editing&&canWrite&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{ if(event.currentTarget===event.target) setEditing(null) }}>
          <form className="modal-card vaccination-composer" onSubmit={saveEntry}>
            <header>
              <div>
                <span className="eyebrow">VACCINATION APPOINTMENT</span>
                <h2>{editing.vaccine_name} · {editing.dose_label}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close vaccination appointment" onClick={()=>setEditing(null)}>
                <X size={18}/>
              </button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Status
                <Select
                  value={status}
                  onChange={(value)=>setStatus(value as VaccinationEntry['status'])}
                  options={[
                    {value:'recommended',label:'Recommended'},
                    {value:'scheduled',label:'Scheduled'},
                    {value:'completed',label:'Completed'},
                    {value:'not_applicable',label:'Not applicable'},
                  ]}
                  ariaLabel="Choose vaccination status"
                />
              </label>

              <label>
                Appointment date
                <DatePicker
                  value={scheduledDate}
                  onChange={setScheduledDate}
                  format={household.date_format}
                  ariaLabel="Choose vaccination appointment date"
                />
                <small className="field-hint">Use the date agreed with the paediatrician.</small>
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Time
                <TimePicker value={scheduledTime} onChange={setScheduledTime}/>
                <small className="field-hint">Optional. Leave empty for an all-day Calendar entry.</small>
              </label>
              <label>
                Practice / doctor
                <input value={providerText} onChange={(event)=>setProviderText(event.target.value)} placeholder="e.g. Kinderarzt Dr. Müller"/>
              </label>
            </div>

            <label>
              Location
              <input value={locationText} onChange={(event)=>setLocationText(event.target.value)} placeholder="Practice or address"/>
              {locationText.trim()&&<GoogleMapsLink location={locationText} label="Open in Google Maps" className="field-map-link"/>}
            </label>

            {status==='completed'&&(
              <label>
                Vaccination completed on
                <DatePicker
                  value={completedDate||scheduledDate}
                  onChange={setCompletedDate}
                  format={household.date_format}
                  ariaLabel="Choose vaccination completion date"
                />
              </label>
            )}

            <label>
              Notes
              <textarea value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Optional note from the appointment"/>
            </label>

            <section className="vaccination-calendar-sync">
              <label className="school-all-day-control">
                <input type="checkbox" checked={addToCalendar} onChange={(event)=>setAddToCalendar(event.target.checked)}/>
                <span>Add this appointment to Family Calendar</span>
              </label>

              {addToCalendar&&(
                <label>
                  Calendar
                  <Select
                    value={calendarId}
                    onChange={setCalendarId}
                    options={calendars.map((calendar)=>({
                      value:calendar.id,
                      label:calendar.name+(calendar.is_default?' · Default':''),
                      dotColor:categoryColor(calendar.color_key),
                    }))}
                    ariaLabel="Choose Calendar for vaccination appointment"
                  />
                </label>
              )}
            </section>

            {error&&<div className="notice error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={()=>setEditing(null)}>Cancel</button>
              <button className="primary-button" disabled={saving||(status==='scheduled'&&!scheduledDate)||(addToCalendar&&!scheduledDate)}>
                {saving?'Saving…':'Save vaccination'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
