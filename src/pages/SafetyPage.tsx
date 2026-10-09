import {
  BellRing,
  CheckCircle2,
  Clock3,
  MapPin,
  Navigation,
  Phone,
  ShieldAlert,
  UserCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type SafetyAlert={
  id:string
  household_id:string
  triggered_by_user_id:string
  triggered_by_profile_id:string|null
  status:'active'|'resolved'|'cancelled'
  triggered_at:string
  latitude:number|null
  longitude:number|null
  accuracy_m:number|null
  location_captured_at:string|null
  resolved_by_user_id:string|null
  resolved_at:string|null
  resolution_note:string|null
}

type SafetyResponse={
  alert_id:string
  responder_user_id:string
  responded_at:string
}

type HouseholdUser={
  user_id:string
  email:string|null
  phone:string|null
  display_name:string
  role:'owner'|'admin'|'user'
  status:string
}

function mapUrl(latitude:number,longitude:number){
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
}

function formatTime(value:string){
  return new Intl.DateTimeFormat(undefined,{
    dateStyle:'medium',
    timeStyle:'short',
  }).format(new Date(value))
}

export function SafetyPage(){
  const { household,profiles,user }=useHousehold()
  const currentProfile=profiles.find((profile)=>profile.linked_user_id===user.id)??null

  const [alerts,setAlerts]=useState<SafetyAlert[]>([])
  const [responses,setResponses]=useState<SafetyResponse[]>([])
  const [householdUsers,setHouseholdUsers]=useState<HouseholdUser[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [includeLocation,setIncludeLocation]=useState(true)
  const [locationStatus,setLocationStatus]=useState('')
  const [sending,setSending]=useState(false)
  const [actingAlertId,setActingAlertId]=useState('')
  const [holdProgress,setHoldProgress]=useState(0)

  const holdStartedAtRef=useRef(0)
  const holdFrameRef=useRef(0)
  const holdTriggeredRef=useRef(false)

  const profileById=useMemo(
    ()=>new Map(profiles.map((profile)=>[profile.id,profile])),
    [profiles],
  )
  const userById=useMemo(
    ()=>new Map(householdUsers.map((member)=>[member.user_id,member])),
    [householdUsers],
  )

  const activeAlerts=alerts.filter((alert)=>alert.status==='active')
  const historyAlerts=alerts.filter((alert)=>alert.status!=='active').slice(0,8)
  const myActiveAlert=activeAlerts.find((alert)=>alert.triggered_by_user_id===user.id)??null

  const load=useCallback(async (foreground=false)=>{
    if(foreground) setLoading(true)

    const [alertsResult,responsesResult,usersResult]=await Promise.all([
      supabase
        .from('safety_alerts')
        .select('id,household_id,triggered_by_user_id,triggered_by_profile_id,status,triggered_at,latitude,longitude,accuracy_m,location_captured_at,resolved_by_user_id,resolved_at,resolution_note')
        .eq('household_id',household.id)
        .order('triggered_at',{ascending:false})
        .limit(30),
      supabase
        .from('safety_alert_responses')
        .select('alert_id,responder_user_id,responded_at')
        .eq('household_id',household.id)
        .order('responded_at',{ascending:true}),
      supabase.rpc('household_users_v1',{p_household_id:household.id}),
    ])

    if(alertsResult.error){
      setError(alertsResult.error.message)
    }else{
      setAlerts((alertsResult.data??[]) as SafetyAlert[])
    }

    if(!responsesResult.error){
      setResponses((responsesResult.data??[]) as SafetyResponse[])
    }

    if(!usersResult.error){
      setHouseholdUsers((usersResult.data??[]) as HouseholdUser[])
    }

    if(foreground) setLoading(false)
  },[household.id])

  useEffect(()=>{
    void load(true)

    const timer=window.setInterval(()=>{ void load(false) },8000)
    const onFocus=()=>{ void load(false) }
    window.addEventListener('focus',onFocus)

    return ()=>{
      window.clearInterval(timer)
      window.removeEventListener('focus',onFocus)
      if(holdFrameRef.current) cancelAnimationFrame(holdFrameRef.current)
    }
  },[load])

  function alertName(alert:SafetyAlert){
    if(alert.triggered_by_profile_id){
      const profile=profileById.get(alert.triggered_by_profile_id)
      if(profile) return profile.display_name
    }
    return userById.get(alert.triggered_by_user_id)?.display_name??'Family member'
  }

  function alertProfile(alert:SafetyAlert){
    return alert.triggered_by_profile_id
      ? profileById.get(alert.triggered_by_profile_id)??null
      : profiles.find((profile)=>profile.linked_user_id===alert.triggered_by_user_id)??null
  }

  function responderNames(alertId:string){
    return responses
      .filter((response)=>response.alert_id===alertId)
      .map((response)=>userById.get(response.responder_user_id)?.display_name??'Family member')
  }

  async function triggerAlert(latitude?:number,longitude?:number,accuracy?:number){
    return supabase.rpc('trigger_safety_alert_v1',{
      p_household_id:household.id,
      p_profile_id:currentProfile?.id??null,
      p_latitude:latitude??null,
      p_longitude:longitude??null,
      p_accuracy_m:accuracy??null,
    })
  }

  function requestLocation(alertId:string){
    if(!includeLocation||!navigator.geolocation){
      setLocationStatus(includeLocation?'Location is not supported on this device.':'')
      return
    }

    setLocationStatus('Trying to add your current location…')

    navigator.geolocation.getCurrentPosition(
      (position)=>{
        void triggerAlert(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        ).then(({error:locationError})=>{
          if(locationError){
            setLocationStatus('SOS is active. Location could not be added.')
            return
          }
          setLocationStatus('Current location added to the SOS alert.')
          void load(false)
        })
      },
      ()=>{
        setLocationStatus('SOS is active without location. Location permission was not available.')
      },
      {
        enableHighAccuracy:true,
        timeout:3500,
        maximumAge:15000,
      },
    )
  }

  async function sendSos(){
    if(sending||myActiveAlert) return

    setSending(true)
    setError('')
    setMessage('')
    setLocationStatus('')

    const result=await triggerAlert()

    setSending(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    const alertId=String(result.data??'')
    setMessage('SOS sent. Your household adults have been alerted.')
    try{
      navigator.vibrate?.([120,80,120])
    }catch{
      // Vibration is optional.
    }

    await load(false)
    if(alertId) requestLocation(alertId)
  }

  function cancelHold(){
    if(holdFrameRef.current){
      cancelAnimationFrame(holdFrameRef.current)
      holdFrameRef.current=0
    }
    holdStartedAtRef.current=0
    holdTriggeredRef.current=false
    setHoldProgress(0)
  }

  function holdFrame(now:number){
    if(!holdStartedAtRef.current) return

    const elapsed=now-holdStartedAtRef.current
    const progress=Math.min(100,(elapsed/2000)*100)
    setHoldProgress(progress)

    if(progress>=100){
      holdTriggeredRef.current=true
      holdFrameRef.current=0
      void sendSos()
      return
    }

    holdFrameRef.current=requestAnimationFrame(holdFrame)
  }

  function startHold(){
    if(sending||myActiveAlert) return
    cancelHold()
    holdStartedAtRef.current=performance.now()
    holdFrameRef.current=requestAnimationFrame(holdFrame)
  }

  function releaseHold(){
    if(!holdTriggeredRef.current) cancelHold()
  }

  async function respond(alertId:string){
    setActingAlertId(alertId)
    setError('')

    const result=await supabase.rpc('respond_to_safety_alert_v1',{
      p_alert_id:alertId,
    })

    setActingAlertId('')

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage('Marked as responding.')
    await load(false)
  }

  async function resolve(alert:SafetyAlert){
    setActingAlertId(alert.id)
    setError('')

    const result=await supabase.rpc('resolve_safety_alert_v1',{
      p_alert_id:alert.id,
      p_resolution_note:null,
    })

    setActingAlertId('')

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage(alert.triggered_by_user_id===user.id
      ? 'Your SOS alert is resolved.'
      : 'Safety alert marked as resolved.')
    setLocationStatus('')
    await load(false)
  }

  function canResolve(alert:SafetyAlert){
    if(alert.triggered_by_user_id===user.id) return true
    if(household.role==='owner'||household.role==='admin') return true
    return currentProfile?.profile_type==='adult'
  }

  return (
    <div className="page safety-page">
      <div className="page-heading-row safety-page-heading">
        <div>
          <span className="eyebrow">FAMILY SAFETY</span>
          <h1>Safety / SOS</h1>
          <p>Alert your household quickly if you feel unsafe or need immediate family help.</p>
        </div>
        <span className={activeAlerts.length?'safety-status-chip active':'safety-status-chip'}>
          <ShieldAlert size={15}/>
          {activeAlerts.length ? `${activeAlerts.length} active` : 'All clear'}
        </span>
      </div>

      <div className="safety-emergency-note">
        <BellRing size={16}/>
        <span>
          <strong>Family alert only</strong>
          <small>Famioo notifies your household. It does not contact police, ambulance or other emergency services.</small>
        </span>
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice">{message}</div>}

      <section className={myActiveAlert?'safety-sos-card active':'safety-sos-card'}>
        <div className="safety-sos-copy">
          <span className="safety-sos-mark"><ShieldAlert size={28}/></span>
          <div>
            <span className="eyebrow">{myActiveAlert?'YOUR SOS IS ACTIVE':'NEED HELP?'}</span>
            <h2>{myActiveAlert?'Your family has been alerted':'Hold to send SOS'}</h2>
            <p>
              {myActiveAlert
                ?'Keep this alert active until you or an adult family member confirms that the situation is safe.'
                :'Press and hold the SOS button for 2 seconds. The alert is sent immediately; location is added afterwards if available.'}
            </p>
          </div>
        </div>

        {myActiveAlert ? (
          <button
            type="button"
            className="safety-safe-button"
            disabled={actingAlertId===myActiveAlert.id}
            onClick={()=>void resolve(myActiveAlert)}
          >
            <CheckCircle2 size={18}/>
            {actingAlertId===myActiveAlert.id?'Resolving…':"I'm safe — resolve SOS"}
          </button>
        ) : (
          <button
            type="button"
            className="safety-hold-button"
            disabled={sending}
            onPointerDown={startHold}
            onPointerUp={releaseHold}
            onPointerCancel={releaseHold}
            onPointerLeave={releaseHold}
            onKeyDown={(event)=>{
              if((event.key==='Enter'||event.key===' ')&&!holdStartedAtRef.current){
                event.preventDefault()
                startHold()
              }
            }}
            onKeyUp={(event)=>{
              if(event.key==='Enter'||event.key===' '){
                event.preventDefault()
                releaseHold()
              }
            }}
          >
            <span className="safety-hold-fill" style={{width:`${holdProgress}%`}}/>
            <ShieldAlert size={24}/>
            <span>
              <strong>{sending?'Sending SOS…':'HOLD FOR SOS'}</strong>
              <small>{sending?'Alerting your household':'Hold for 2 seconds'}</small>
            </span>
          </button>
        )}

        {!myActiveAlert&&(
          <label className="safety-location-toggle">
            <input
              type="checkbox"
              checked={includeLocation}
              onChange={(event)=>setIncludeLocation(event.target.checked)}
            />
            <span>
              <strong><Navigation size={14}/>Add my current location when possible</strong>
              <small>The SOS is sent first, so location permission never delays the family alert.</small>
            </span>
          </label>
        )}

        {locationStatus&&<div className="safety-location-status"><MapPin size={14}/>{locationStatus}</div>}
      </section>

      <section className="safety-alerts-section">
        <div className="safety-section-head">
          <div>
            <span className="eyebrow">HOUSEHOLD</span>
            <h2>Active safety alerts</h2>
          </div>
          <small>{activeAlerts.length ? 'Updated automatically' : 'No active alerts'}</small>
        </div>

        {loading ? (
          <div className="list-card empty-state">Loading Family Safety…</div>
        ) : activeAlerts.length===0 ? (
          <div className="safety-all-clear">
            <CheckCircle2 size={26}/>
            <strong>Everyone is currently marked safe.</strong>
            <span>Active SOS alerts from household members will appear here.</span>
          </div>
        ) : (
          <div className="safety-alert-list">
            {activeAlerts.map((alert)=>{
              const profile=alertProfile(alert)
              const contact=userById.get(alert.triggered_by_user_id)
              const responders=responderNames(alert.id)
              const alreadyResponding=responses.some(
                (response)=>response.alert_id===alert.id&&response.responder_user_id===user.id,
              )
              const own=alert.triggered_by_user_id===user.id

              return (
                <article className={own?'safety-alert-card mine':'safety-alert-card'} key={alert.id}>
                  <header>
                    <ProfileAvatar
                      avatarPath={profile?.avatar_path??null}
                      name={alertName(alert)}
                      size="md"
                    />
                    <div>
                      <span className="safety-alert-live">SOS ACTIVE</span>
                      <h3>{alertName(alert)} needs help</h3>
                      <small><Clock3 size={12}/>{formatTime(alert.triggered_at)}</small>
                    </div>
                  </header>

                  {alert.latitude!=null&&alert.longitude!=null ? (
                    <a
                      className="safety-location-card"
                      href={mapUrl(alert.latitude,alert.longitude)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin size={18}/>
                      <span>
                        <strong>Current SOS location</strong>
                        <small>
                          {alert.latitude.toFixed(5)}, {alert.longitude.toFixed(5)}
                          {alert.accuracy_m!=null ? ` · ±${Math.round(alert.accuracy_m)} m` : ''}
                        </small>
                      </span>
                      <b>Open map →</b>
                    </a>
                  ) : (
                    <div className="safety-location-card unavailable">
                      <MapPin size={18}/>
                      <span>
                        <strong>No location shared</strong>
                        <small>The family alert is still active.</small>
                      </span>
                    </div>
                  )}

                  {responders.length>0&&(
                    <div className="safety-responders">
                      <UserCheck size={15}/>
                      <span><strong>Responding:</strong> {responders.join(', ')}</span>
                    </div>
                  )}

                  <div className="safety-alert-actions">
                    {!own&&(
                      <button
                        type="button"
                        className={alreadyResponding?'secondary-button responding':'primary-button'}
                        disabled={actingAlertId===alert.id||alreadyResponding}
                        onClick={()=>void respond(alert.id)}
                      >
                        <UserCheck size={15}/>
                        {alreadyResponding?'I am responding':'I’m responding'}
                      </button>
                    )}

                    {!own&&contact?.phone&&(
                      <a className="secondary-button" href={`tel:${contact.phone}`}>
                        <Phone size={15}/>Call {alertName(alert).split(' ')[0]}
                      </a>
                    )}

                    {canResolve(alert)&&(
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={actingAlertId===alert.id}
                        onClick={()=>void resolve(alert)}
                      >
                        <CheckCircle2 size={15}/>
                        {own?'I’m safe':'Resolve'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {historyAlerts.length>0&&(
        <details className="safety-history">
          <summary>Recent resolved alerts <span>{historyAlerts.length}</span></summary>
          <div>
            {historyAlerts.map((alert)=>(
              <div className="safety-history-row" key={alert.id}>
                <CheckCircle2 size={15}/>
                <span>
                  <strong>{alertName(alert)}</strong>
                  <small>{formatTime(alert.triggered_at)}{alert.resolved_at ? ` · resolved ${formatTime(alert.resolved_at)}` : ''}</small>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
