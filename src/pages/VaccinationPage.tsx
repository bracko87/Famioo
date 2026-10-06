import { CalendarDays, Check, LockKeyhole, MapPin, Pencil, ShieldCheck, Syringe, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { TimePicker } from '../components/ui/TimePicker'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarRow } from '../lib/types'

type HealthStatus='recommended'|'scheduled'|'completed'|'not_applicable'
type PlanTab='vaccinations'|'checkups'

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

type CheckupTemplate={
  code:string
  schedule_version:string
  checkup_name:string
  age_label:string
  timing_note:string|null
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
  status:HealthStatus
  completed_date:string|null
  calendar_id:string|null
  linked_event_id:string|null
}

type CheckupEntry={
  id:string
  child_profile_id:string
  template_code:string|null
  schedule_version:string
  checkup_name:string
  recommended_start_date:string|null
  recommended_end_date:string|null
  scheduled_date:string|null
  scheduled_time:string|null
  location_text:string|null
  provider_text:string|null
  notes:string|null
  status:HealthStatus
  completed_date:string|null
  calendar_id:string|null
  linked_event_id:string|null
}

type EditingHealthEntry=
  | {kind:'vaccination';entry:VaccinationEntry}
  | {kind:'checkup';entry:CheckupEntry}

function firstName(name:string){
  return name.trim().split(/\s+/)[0]||name
}

function formatDate(value:string|null){
  if(!value) return 'Date set with paediatrician'
  return new Date(value+'T12:00:00').toLocaleDateString()
}

function statusLabel(status:HealthStatus){
  if(status==='scheduled') return 'Scheduled'
  if(status==='completed') return 'Completed'
  if(status==='not_applicable') return 'Not applicable'
  return 'Recommended'
}

function dateSort(value:string|null){
  if(!value) return Number.MAX_SAFE_INTEGER
  return new Date(value+'T12:00:00').getTime()
}

export function VaccinationPage(){
  const { household,modules,profiles,refresh }=useHousehold()
  const access=modules.find((module)=>module.code==='vaccinations')
  const canWrite=Boolean(access?.enabled&&access.can_write)
  const children=useMemo(()=>profiles.filter((profile)=>profile.profile_type==='child'),[profiles])
  const [selectedChild,setSelectedChild]=useState('')
  const [planTab,setPlanTab]=useState<PlanTab>('vaccinations')
  const [vaccinationTemplates,setVaccinationTemplates]=useState<VaccinationTemplate[]>([])
  const [checkupTemplates,setCheckupTemplates]=useState<CheckupTemplate[]>([])
  const [vaccinationEntries,setVaccinationEntries]=useState<VaccinationEntry[]>([])
  const [checkupEntries,setCheckupEntries]=useState<CheckupEntry[]>([])
  const [calendars,setCalendars]=useState<CalendarRow[]>([])
  const [birthDate,setBirthDate]=useState('')
  const [editing,setEditing]=useState<EditingHealthEntry|null>(null)
  const [scheduledDate,setScheduledDate]=useState('')
  const [scheduledTime,setScheduledTime]=useState('')
  const [hasTime,setHasTime]=useState(false)
  const [locationText,setLocationText]=useState('')
  const [providerText,setProviderText]=useState('')
  const [notes,setNotes]=useState('')
  const [status,setStatus]=useState<HealthStatus>('recommended')
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

  const vaccinationTemplateByCode=useMemo(
    ()=>new Map(vaccinationTemplates.map((item)=>[item.code,item])),
    [vaccinationTemplates],
  )

  const checkupTemplateByCode=useMemo(
    ()=>new Map(checkupTemplates.map((item)=>[item.code,item])),
    [checkupTemplates],
  )

  useEffect(()=>{
    if(!selectedChild&&children.length) setSelectedChild(children[0].id)
    if(selectedChild&&!children.some((child)=>child.id===selectedChild)) setSelectedChild(children[0]?.id??'')
  },[children,selectedChild])

  async function loadBase(){
    if(!access?.enabled) return
    const [vaccinationTemplateResult,checkupTemplateResult,calendarResult]=await Promise.all([
      supabase
        .from('vaccination_schedule_templates')
        .select('code,schedule_version,vaccine_name,dose_label,age_label,timing_note,is_optional,sort_order')
        .eq('country_code','DE')
        .eq('schedule_version','STIKO 2026')
        .eq('active',true)
        .order('sort_order'),
      supabase
        .from('child_checkup_schedule_templates')
        .select('code,schedule_version,checkup_name,age_label,timing_note,sort_order')
        .eq('country_code','DE')
        .eq('schedule_version','G-BA 2026')
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

    if(vaccinationTemplateResult.error) setError(vaccinationTemplateResult.error.message)
    else setVaccinationTemplates((vaccinationTemplateResult.data??[]) as VaccinationTemplate[])

    if(checkupTemplateResult.error) setError((current)=>current||checkupTemplateResult.error.message)
    else setCheckupTemplates((checkupTemplateResult.data??[]) as CheckupTemplate[])

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
    const [vaccinationResult,checkupResult]=await Promise.all([
      supabase
        .from('child_vaccination_entries')
        .select('id,child_profile_id,template_code,schedule_version,vaccine_name,dose_label,recommended_start_date,recommended_end_date,scheduled_date,scheduled_time,location_text,provider_text,notes,status,completed_date,calendar_id,linked_event_id')
        .eq('household_id',household.id)
        .eq('child_profile_id',childId),
      supabase
        .from('child_checkup_entries')
        .select('id,child_profile_id,template_code,schedule_version,checkup_name,recommended_start_date,recommended_end_date,scheduled_date,scheduled_time,location_text,provider_text,notes,status,completed_date,calendar_id,linked_event_id')
        .eq('household_id',household.id)
        .eq('child_profile_id',childId),
    ])

    if(vaccinationResult.error) setError(vaccinationResult.error.message)
    else setVaccinationEntries((vaccinationResult.data??[]) as VaccinationEntry[])

    if(checkupResult.error) setError((current)=>current||checkupResult.error.message)
    else setCheckupEntries((checkupResult.data??[]) as CheckupEntry[])
  }

  async function initializePlans(childId:string){
    if(!canWrite) return

    const [vaccinationResult,checkupResult]=await Promise.all([
      supabase.rpc('initialize_child_vaccination_plan_v1',{
        p_household_id:household.id,
        p_child_profile_id:childId,
      }),
      supabase.rpc('initialize_child_checkup_plan_v1',{
        p_household_id:household.id,
        p_child_profile_id:childId,
      }),
    ])

    const errors=[vaccinationResult.error,checkupResult.error].filter(Boolean)
    const unexpected=errors.find((item)=>!/date of birth/i.test(item?.message??''))
    if(unexpected){
      setError(unexpected.message)
      return
    }

    if(errors.length===0) await loadEntries(childId)
  }

  useEffect(()=>{ void loadBase() },[household.id,access?.enabled])

  useEffect(()=>{
    if(!selectedProfile||!access?.enabled) return
    setBirthDate(selectedProfile.birth_date??'')
    void (async()=>{
      await loadEntries(selectedProfile.id)
      if(selectedProfile.birth_date&&canWrite) await initializePlans(selectedProfile.id)
    })()
  },[selectedProfile?.id,selectedProfile?.birth_date,access?.enabled,canWrite,household.id])

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

    setMessage('Date of birth saved. Vaccination and U/J check-up timelines were created.')
    await refresh()
    await loadEntries(selectedProfile.id)
  }

  function openEntry(item:EditingHealthEntry){
    const entry=item.entry
    setEditing(item)
    setScheduledDate(entry.scheduled_date??entry.recommended_start_date??'')
    setScheduledTime(entry.scheduled_time?.slice(0,5)??'09:00')
    setHasTime(Boolean(entry.scheduled_time))
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

    const rpc=editing.kind==='vaccination'
      ?'save_child_vaccination_entry_v1'
      :'save_child_checkup_entry_v1'

    const result=await supabase.rpc(rpc,{
      p_entry_id:editing.entry.id,
      p_household_id:household.id,
      p_scheduled_date:scheduledDate||null,
      p_scheduled_time:hasTime?(scheduledTime||null):null,
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

    const savedKind=editing.kind
    setEditing(null)
    setMessage(savedKind==='vaccination'?'Vaccination entry updated.':'Check-up entry updated.')
    if(selectedProfile) await loadEntries(selectedProfile.id)
  }

  const sortedVaccinations=useMemo(()=>[...vaccinationEntries].sort((a,b)=>{
    const ta=a.template_code?vaccinationTemplateByCode.get(a.template_code):undefined
    const tb=b.template_code?vaccinationTemplateByCode.get(b.template_code):undefined
    return (ta?.sort_order??999)-(tb?.sort_order??999)
  }),[vaccinationEntries,vaccinationTemplateByCode])

  const sortedCheckups=useMemo(()=>[...checkupEntries].sort((a,b)=>{
    const ta=a.template_code?checkupTemplateByCode.get(a.template_code):undefined
    const tb=b.template_code?checkupTemplateByCode.get(b.template_code):undefined
    return (ta?.sort_order??999)-(tb?.sort_order??999)
  }),[checkupEntries,checkupTemplateByCode])

  const activeEntries=planTab==='vaccinations'?vaccinationEntries:checkupEntries
  const completedCount=activeEntries.filter((entry)=>entry.status==='completed').length
  const scheduledCount=activeEntries.filter((entry)=>entry.status==='scheduled').length

  const nextVaccination=useMemo(()=>{
    const scheduled=[...vaccinationEntries]
      .filter((entry)=>entry.status==='scheduled'&&entry.scheduled_date)
      .sort((a,b)=>dateSort(a.scheduled_date)-dateSort(b.scheduled_date))[0]
    if(scheduled) return scheduled
    return [...vaccinationEntries]
      .filter((entry)=>entry.status==='recommended'&&entry.recommended_start_date)
      .sort((a,b)=>dateSort(a.recommended_start_date)-dateSort(b.recommended_start_date))[0]??null
  },[vaccinationEntries])

  const nextCheckup=useMemo(()=>{
    const scheduled=[...checkupEntries]
      .filter((entry)=>entry.status==='scheduled'&&entry.scheduled_date)
      .sort((a,b)=>dateSort(a.scheduled_date)-dateSort(b.scheduled_date))[0]
    if(scheduled) return scheduled
    return [...checkupEntries]
      .filter((entry)=>entry.status==='recommended'&&entry.recommended_start_date)
      .sort((a,b)=>dateSort(a.recommended_start_date)-dateSort(b.recommended_start_date))[0]??null
  },[checkupEntries])

  const nextEntry=planTab==='vaccinations'?nextVaccination:nextCheckup
  const nextTitle=nextEntry
    ? planTab==='vaccinations'
      ? (nextEntry as VaccinationEntry).vaccine_name+' · '+(nextEntry as VaccinationEntry).dose_label
      : (nextEntry as CheckupEntry).checkup_name
    : 'No upcoming item'

  if(!access?.enabled){
    return (
      <div className="page vaccination-page">
        <div className="page-label">PREVENTION</div>
        <section className="list-card module-placeholder-card">
          <Syringe size={24}/>
          <strong>Prevention is not enabled for this household.</strong>
          <span>This optional Famioo module combines the German child vaccination schedule with U/J preventive check-ups and Calendar synchronization.</span>
        </section>
      </div>
    )
  }

  return (
    <div className="page vaccination-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">PREVENTION</div>
          <h1>Prevention</h1>
          <p className="page-subtitle">Keep each child’s German vaccination plan and U/J preventive examinations together, then place booked appointments directly into the Family Calendar.</p>
        </div>
        <span className="vaccination-source-badge"><ShieldCheck size={14}/>Germany · STIKO + G-BA</span>
      </div>

      <section className="list-card vaccination-medical-note">
        <ShieldCheck size={18}/>
        <div>
          <strong>Planning aid, not a replacement for medical advice</strong>
          <p>Famioo uses the current standard German schedules as templates. The paediatrician, vaccination record and Yellow Book remain authoritative, especially for premature babies, catch-up vaccinations, risk groups, vaccine-product intervals and insurer-specific extra examinations.</p>
        </div>
      </section>

      <section className="list-card prevention-data-protection">
        <LockKeyhole size={18}/>
        <div>
          <strong>Protected health data</strong>
          <p>Your child-health information is encrypted in transit and protected at rest in the Famioo database. Access is restricted by household permissions to authorized household members.</p>
        </div>
      </section>

      {error&&!editing&&<div className="notice error">{error}</div>}
      {message&&<div className="notice success">{message}</div>}

      {children.length===0 ? (
        <section className="list-card empty-state vaccination-empty">
          <Syringe size={26}/>
          <span className="empty-state-title">Create a child profile first.</span>
          <span>The health timelines belong to the child’s existing Famioo profile.</span>
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
                <p>Famioo uses the birth date to calculate vaccination windows and U/J check-up periods.</p>
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
                {saving?'Creating plans…':'Create child health plans'}
              </button>
            </form>
          ) : selectedProfile ? (
            <>
              <nav className="vaccination-plan-tabs" aria-label="Child health plan">
                <button type="button" className={planTab==='vaccinations'?'active':''} onClick={()=>setPlanTab('vaccinations')}>
                  <Syringe size={15}/>Vaccinations
                </button>
                <button type="button" className={planTab==='checkups'?'active':''} onClick={()=>setPlanTab('checkups')}>
                  <ShieldCheck size={15}/>U / J Check-ups
                </button>
              </nav>

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
                  <span>{planTab==='vaccinations'?<Syringe size={18}/>:<ShieldCheck size={18}/>}</span>
                  <div>
                    <small>Next</small>
                    <strong>{nextTitle}</strong>
                    <small>{nextEntry?.scheduled_date
                      ?formatDate(nextEntry.scheduled_date)
                      :nextEntry?.recommended_start_date
                        ?'Recommended from '+formatDate(nextEntry.recommended_start_date)
                        :'Set timing with the paediatrician'}</small>
                  </div>
                </article>
              </section>

              <section className="vaccination-timeline-section">
                <header className="vaccination-section-head">
                  <div>
                    <span className="eyebrow">{planTab==='vaccinations'?'STIKO 2026':'GERMAN PREVENTIVE EXAMINATIONS'}</span>
                    <h2>{firstName(selectedProfile.display_name)} · {planTab==='vaccinations'?'vaccination timeline':'U/J timeline'}</h2>
                  </div>
                  <button type="button" className="secondary-button compact" disabled={!canWrite} onClick={()=>void initializePlans(selectedProfile.id)}>
                    Refresh German templates
                  </button>
                </header>

                {planTab==='checkups'&&(
                  <div className="vaccination-checkup-note">
                    Standard template: U1–U9 and J1. Optional insurer benefits such as additional U/J examinations are not automatically treated as mandatory appointments.
                  </div>
                )}

                <div className="vaccination-timeline">
                  {planTab==='vaccinations' ? sortedVaccinations.map((entry)=>{
                    const template=entry.template_code?vaccinationTemplateByCode.get(entry.template_code):undefined
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
                          <button type="button" className="icon-button compact-icon" aria-label={'Edit '+entry.vaccine_name} onClick={()=>openEntry({kind:'vaccination',entry})}>
                            <Pencil size={14}/>
                          </button>
                        )}
                      </article>
                    )
                  }) : sortedCheckups.map((entry)=>{
                    const template=entry.template_code?checkupTemplateByCode.get(entry.template_code):undefined
                    return (
                      <article className={'list-card vaccination-entry '+entry.status} key={entry.id}>
                        <div className="vaccination-age">
                          <span>{template?.age_label??'Custom'}</span>
                        </div>
                        <span className="vaccination-dot checkup"><ShieldCheck size={15}/></span>
                        <div className="vaccination-entry-main">
                          <div className="vaccination-entry-title">
                            <div>
                              <strong>{entry.checkup_name}</strong>
                              <span>Preventive child health examination</span>
                            </div>
                            <em className={'vaccination-status '+entry.status}>{statusLabel(entry.status)}</em>
                          </div>
                          <div className="vaccination-entry-meta">
                            {entry.scheduled_date ? (
                              <span><CalendarDays size={12}/>{formatDate(entry.scheduled_date)}{entry.scheduled_time?' · '+entry.scheduled_time.slice(0,5):''}</span>
                            ) : (
                              <span><CalendarDays size={12}/>Recommended {formatDate(entry.recommended_start_date)}{entry.recommended_end_date&&entry.recommended_end_date!==entry.recommended_start_date?' – '+formatDate(entry.recommended_end_date):''}</span>
                            )}
                            {entry.location_text&&<GoogleMapsLink location={entry.location_text}/>}
                            {entry.provider_text&&<span><MapPin size={12}/>{entry.provider_text}</span>}
                            {entry.linked_event_id&&<span><CalendarDays size={12}/>In Family Calendar</span>}
                          </div>
                          {template?.timing_note&&<p>{template.timing_note}</p>}
                          {entry.notes&&<p className="vaccination-user-note">{entry.notes}</p>}
                        </div>
                        {canWrite&&(
                          <button type="button" className="icon-button compact-icon" aria-label={'Edit '+entry.checkup_name} onClick={()=>openEntry({kind:'checkup',entry})}>
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
                <span className="eyebrow">{editing.kind==='vaccination'?'VACCINATION APPOINTMENT':'U / J CHECK-UP'}</span>
                <h2>{editing.kind==='vaccination'
                  ?editing.entry.vaccine_name+' · '+editing.entry.dose_label
                  :editing.entry.checkup_name}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close child health appointment" onClick={()=>setEditing(null)}>
                <X size={18}/>
              </button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Status
                <Select
                  value={status}
                  onChange={(value)=>setStatus(value as HealthStatus)}
                  options={[
                    {value:'recommended',label:'Recommended'},
                    {value:'scheduled',label:'Scheduled'},
                    {value:'completed',label:'Completed'},
                    {value:'not_applicable',label:'Not applicable'},
                  ]}
                  ariaLabel="Choose appointment status"
                />
              </label>

              <label>
                Appointment date
                <DatePicker
                  value={scheduledDate}
                  onChange={setScheduledDate}
                  format={household.date_format}
                  ariaLabel="Choose appointment date"
                />
                <small className="field-hint">Use the date agreed with the paediatrician.</small>
              </label>
            </div>

            <label className="vaccination-specific-time">
              <input
                type="checkbox"
                checked={hasTime}
                onChange={(event)=>setHasTime(event.target.checked)}
              />
              <span>Appointment has a specific time</span>
            </label>

            <div className={hasTime?'composer-grid-two aligned-field-row':'composer-grid-two aligned-field-row single-health-field'}>
              {hasTime&&(
                <label>
                  Time
                  <TimePicker value={scheduledTime} onChange={setScheduledTime}/>
                </label>
              )}
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
                Completed on
                <DatePicker
                  value={completedDate||scheduledDate}
                  onChange={setCompletedDate}
                  format={household.date_format}
                  ariaLabel="Choose completion date"
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
                    ariaLabel="Choose Calendar for child health appointment"
                  />
                </label>
              )}
            </section>

            {error&&<div className="notice error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={()=>setEditing(null)}>Cancel</button>
              <button className="primary-button" disabled={saving||(status==='scheduled'&&!scheduledDate)||(addToCalendar&&!scheduledDate)}>
                {saving?'Saving…':'Save appointment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
