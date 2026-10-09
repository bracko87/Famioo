import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Home,
  MapPin,
  Navigation,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence } from '../lib/types'

type CheckinType='home'|'safe'|'pickup'|'late'

type CheckinRow={
  id:string
  profile_id:string|null
  checkin_type:CheckinType
  note:string|null
  eta_minutes:number|null
  event_id:string|null
  latitude:number|null
  longitude:number|null
  accuracy_m:number|null
  created_by_user_id:string
  created_at:string
}

type HouseholdUser={
  profile_id:string
  user_id:string|null
  display_name:string
  role:'owner'|'admin'|'user'|'profile'
  status:string
}

const typeMeta:Record<CheckinType,{label:string;description:string;icon:typeof Home}> = {
  home:{label:"I'm home",description:'Let the family know you arrived home.',icon:Home},
  safe:{label:"I'm safe",description:'Quick reassurance that everything is okay.',icon:ShieldCheck},
  pickup:{label:'Pick me up',description:'Ask the family for a pickup.',icon:Navigation},
  late:{label:'Running late',description:'Share a delay and optional ETA.',icon:Clock3},
}

function dateKey(date:Date){
  const year=date.getFullYear()
  const month=String(date.getMonth()+1).padStart(2,'0')
  const day=String(date.getDate()).padStart(2,'0')
  return year+'-'+month+'-'+day
}

function shiftDate(date:Date,days:number){
  const next=new Date(date)
  next.setDate(next.getDate()+days)
  return dateKey(next)
}

function formatWhen(value:string){
  const date=new Date(value)
  const today=new Date()
  const sameDay=date.toDateString()===today.toDateString()
  return new Intl.DateTimeFormat(undefined,sameDay
    ?{hour:'2-digit',minute:'2-digit'}
    :{dateStyle:'medium',timeStyle:'short'}
  ).format(date)
}

function mapsUrl(latitude:number,longitude:number){
  return 'https://www.google.com/maps/search/?api=1&query='+latitude+','+longitude
}

function occurrenceLabel(item:CalendarOccurrence){
  if(item.all_day){
    const date=item.occurrence_start_date
    return item.title+(date?' · '+new Date(date+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'')
  }
  const value=item.occurrence_start_at
  if(!value)return item.title
  return item.title+' · '+new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))
}

export function CheckInPage(){
  const {household,profiles,user,modules}=useHousehold()
  const access=modules.find(module=>module.code==='checkin')
  const canWrite=Boolean(access?.enabled&&access?.can_write)
  const currentProfile=profiles.find(profile=>profile.linked_user_id===user.id)??null

  const [checkins,setCheckins]=useState<CheckinRow[]>([])
  const [householdUsers,setHouseholdUsers]=useState<HouseholdUser[]>([])
  const [occurrences,setOccurrences]=useState<CalendarOccurrence[]>([])
  const [selectedType,setSelectedType]=useState<CheckinType>('safe')
  const [note,setNote]=useState('')
  const [etaMinutes,setEtaMinutes]=useState('')
  const [eventId,setEventId]=useState('')
  const [includeLocation,setIncludeLocation]=useState(false)
  const [sending,setSending]=useState(false)
  const [locating,setLocating]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const profileById=useMemo(()=>new Map(profiles.map(profile=>[profile.id,profile])),[profiles])
  const userNameById=useMemo(()=>new Map(
    householdUsers.filter(member=>member.user_id).map(member=>[member.user_id!,member.display_name]),
  ),[householdUsers])
  const eventTitleById=useMemo(()=>{
    const map=new Map<string,string>()
    occurrences.forEach(item=>{if(!map.has(item.event_id))map.set(item.event_id,item.title)})
    return map
  },[occurrences])

  const load=useCallback(async(foreground=false)=>{
    if(foreground)setLoading(true)
    const today=new Date()
    const [checkinResult,userResult,eventResult]=await Promise.all([
      supabase.from('family_checkins')
        .select('id,profile_id,checkin_type,note,eta_minutes,event_id,latitude,longitude,accuracy_m,created_by_user_id,created_at')
        .eq('household_id',household.id).order('created_at',{ascending:false}).limit(50),
      supabase.rpc('household_users_v1',{p_household_id:household.id}),
      supabase.rpc('calendar_occurrences_v1',{
        p_household_id:household.id,
        p_range_start:shiftDate(today,-1),
        p_range_end:shiftDate(today,7),
      }),
    ])

    if(checkinResult.error)setError(checkinResult.error.message)
    else setCheckins(((checkinResult.data??[]) as CheckinRow[]).map(row=>({
      ...row,
      eta_minutes:row.eta_minutes==null?null:Number(row.eta_minutes),
      latitude:row.latitude==null?null:Number(row.latitude),
      longitude:row.longitude==null?null:Number(row.longitude),
      accuracy_m:row.accuracy_m==null?null:Number(row.accuracy_m),
    })))

    if(!userResult.error)setHouseholdUsers((userResult.data??[]) as HouseholdUser[])
    if(!eventResult.error)setOccurrences((eventResult.data??[]) as CalendarOccurrence[])

    if(foreground)setLoading(false)
  },[household.id])

  useEffect(()=>{
    void load(true)
    const timer=window.setInterval(()=>{void load(false)},5000)
    const onFocus=()=>{void load(false)}
    window.addEventListener('focus',onFocus)
    return ()=>{
      window.clearInterval(timer)
      window.removeEventListener('focus',onFocus)
    }
  },[load])

  async function createCheckin(
    latitude?:number,
    longitude?:number,
    accuracy?:number,
  ){
    setSending(true)
    setError('')
    setMessage('')
    const result=await supabase.rpc('create_family_checkin_v1',{
      p_household_id:household.id,
      p_profile_id:currentProfile?.id??null,
      p_checkin_type:selectedType,
      p_note:note.trim()||null,
      p_eta_minutes:selectedType==='late'&&etaMinutes?Math.round(Number(etaMinutes)):null,
      p_event_id:eventId||null,
      p_latitude:latitude??null,
      p_longitude:longitude??null,
      p_accuracy_m:accuracy??null,
    })
    setSending(false)
    setLocating(false)
    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage(typeMeta[selectedType].label+' shared with the family.')
    setNote('')
    setEtaMinutes('')
    setEventId('')
    await load(false)
  }

  function sendCheckin(){
    if(!canWrite||sending||locating)return

    if(selectedType==='late'&&etaMinutes){
      const eta=Number(etaMinutes)
      if(!Number.isFinite(eta)||eta<1||eta>1440){
        setError('ETA must be between 1 and 1440 minutes.')
        return
      }
    }

    if(!includeLocation){
      void createCheckin()
      return
    }

    if(!navigator.geolocation){
      setError('Location is not available on this device. Turn off location to send the check-in without it.')
      return
    }

    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      position=>{
        void createCheckin(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        )
      },
      reason=>{
        setLocating(false)
        setError((reason.message||'Location permission was not available.')+' Turn off location to send without it.')
      },
      {enableHighAccuracy:true,timeout:8000,maximumAge:10000},
    )
  }

  async function removeCheckin(row:CheckinRow){
    if(!window.confirm('Remove this check-in from the family feed?'))return
    const result=await supabase.rpc('delete_family_checkin_v1',{
      p_household_id:household.id,p_checkin_id:row.id,
    })
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  function checkinName(row:CheckinRow){
    if(row.profile_id){
      const profile=profileById.get(row.profile_id)
      if(profile)return profile.display_name
    }
    return userNameById.get(row.created_by_user_id)??'Family member'
  }

  function canDelete(row:CheckinRow){
    return row.created_by_user_id===user.id||household.role==='owner'||household.role==='admin'
  }

  const uniqueOccurrences=useMemo(()=>{
    const seen=new Set<string>()
    return occurrences.filter(item=>{
      if(seen.has(item.event_id))return false
      seen.add(item.event_id)
      return true
    }).slice(0,40)
  },[occurrences])

  if(loading)return <div className="page checkin-page"><div className="checkin-empty">Loading family check-ins…</div></div>

  return <div className="page checkin-page">
    <div className="page-heading-row checkin-heading">
      <div>
        <span className="eyebrow">FAMILY CHECK-IN</span>
        <h1>One tap. Family knows.</h1>
        <p>Share a quick status, an optional location, and the Calendar event you are talking about.</p>
      </div>
    </div>

    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    <section className="checkin-composer">
      <div className="checkin-person">
        {currentProfile
          ?<ProfileAvatar avatarPath={currentProfile.avatar_path} name={currentProfile.display_name} size="md"/>
          :<span className="checkin-person-fallback"><UserRound size={21}/></span>}
        <span><small>CHECKING IN AS</small><strong>{currentProfile?.display_name??userNameById.get(user.id)??'Your account'}</strong>{!currentProfile&&<em>No family profile is linked to this account.</em>}</span>
      </div>

      <div className="checkin-types">
        {(Object.keys(typeMeta) as CheckinType[]).map(type=>{
          const meta=typeMeta[type]
          const Icon=meta.icon
          return <button type="button" key={type} className={selectedType===type?'active '+type:type} onClick={()=>setSelectedType(type)}>
            <span><Icon size={20}/></span>
            <strong>{meta.label}</strong>
            <small>{meta.description}</small>
          </button>
        })}
      </div>

      <div className="checkin-options">
        <label className="checkin-note"><span>Optional note</span><textarea rows={2} maxLength={500} value={note} onChange={event=>setNote(event.target.value)} placeholder={selectedType==='pickup'?'Where should they meet you?':selectedType==='late'?'What changed?':'Add a short note…'}/></label>
        {selectedType==='late'&&<label><span>ETA / delay (minutes)</span><input type="number" min="1" max="1440" value={etaMinutes} onChange={event=>setEtaMinutes(event.target.value)} placeholder="e.g. 20"/></label>}
        <label><span>Calendar context</span><select value={eventId} onChange={event=>setEventId(event.target.value)}><option value="">No linked event</option>{uniqueOccurrences.map(item=><option value={item.event_id} key={item.event_id}>{occurrenceLabel(item)}</option>)}</select></label>
        <label className="checkin-location-toggle"><input type="checkbox" checked={includeLocation} onChange={event=>setIncludeLocation(event.target.checked)}/><span><MapPin size={15}/><b>Include my current location</b><small>Famioo asks your device only when you send this check-in.</small></span></label>
      </div>

      <button type="button" className={'checkin-send '+selectedType} disabled={!canWrite||sending||locating} onClick={sendCheckin}>
        {locating?<><MapPin size={18}/>Getting location…</>:sending?<><CheckCircle2 size={18}/>Sending…</>:<><CheckCircle2 size={18}/>Send “{typeMeta[selectedType].label}”</>}
      </button>
    </section>

    <section className="checkin-feed">
      <div className="checkin-section-head"><div><span className="eyebrow">FAMILY FEED</span><h2>Recent check-ins</h2></div><small>Refreshes automatically</small></div>
      {checkins.length===0?<div className="checkin-empty compact"><CheckCircle2 size={25}/><strong>No check-ins yet.</strong></div>:<div className="checkin-feed-list">
        {checkins.map(row=>{
          const meta=typeMeta[row.checkin_type]
          const Icon=meta.icon
          const profile=row.profile_id?profileById.get(row.profile_id):null
          return <article className={'checkin-feed-row '+row.checkin_type} key={row.id}>
            <span className="checkin-feed-icon"><Icon size={18}/></span>
            <div className="checkin-feed-person">
              {profile&&<ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm"/>}
              <span><strong>{checkinName(row)}</strong><small>{formatWhen(row.created_at)}</small></span>
            </div>
            <div className="checkin-feed-message">
              <strong>{meta.label}</strong>
              {row.eta_minutes&&<em>ETA {row.eta_minutes} min</em>}
              {row.event_id&&<span><CalendarDays size={12}/>{eventTitleById.get(row.event_id)??'Calendar event'}</span>}
              {row.note&&<p>{row.note}</p>}
            </div>
            <div className="checkin-feed-actions">
              {row.latitude!=null&&row.longitude!=null&&<a href={mapsUrl(row.latitude,row.longitude)} target="_blank" rel="noreferrer" title="Open location"><MapPin size={14}/><span>Map</span></a>}
              {canDelete(row)&&<button type="button" title="Remove check-in" onClick={()=>void removeCheckin(row)}><Trash2 size={13}/></button>}
            </div>
          </article>
        })}
      </div>}
    </section>
  </div>
}
