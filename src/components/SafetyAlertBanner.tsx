import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert, ArrowRight } from 'lucide-react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type ActiveHouseholdSos={
  id:string
  triggered_by_user_id:string
  triggered_by_profile_id:string|null
}

/** Prominent in-app alert for other household members who are currently online.
 * Background/locked-screen notification delivery remains the push worker's job. */
export function SafetyAlertBanner(){
  const {household,user,modules,profiles}=useHousehold()
  const enabled=modules.some(module=>module.code==='safety'&&module.enabled)
  const [activeAlert,setActiveAlert]=useState<ActiveHouseholdSos|null>(null)

  useEffect(()=>{
    if(!enabled){
      setActiveAlert(null)
      return
    }

    let alive=true
    let fetching=false
    async function refresh(){
      if(fetching)return
      fetching=true
      try{
        const result=await supabase.from('safety_alerts')
          .select('id,triggered_by_user_id,triggered_by_profile_id')
          .eq('household_id',household.id)
          .eq('status','active')
          .neq('triggered_by_user_id',user.id)
          .order('triggered_at',{ascending:false})
          .limit(1)
        if(alive&&!result.error){
          const next=(result.data?.[0]??null) as ActiveHouseholdSos|null
          setActiveAlert(previous=>previous?.id===next?.id?previous:next)
        }
      }catch{
        // Temporary network failure must not falsely clear an active SOS.
      }finally{fetching=false}
    }
    void refresh()
    const timer=window.setInterval(()=>{void refresh()},5000)
    const onFocus=()=>{void refresh()}
    const onVisible=()=>{if(!document.hidden)void refresh()}
    window.addEventListener('focus',onFocus)
    document.addEventListener('visibilitychange',onVisible)
    return ()=>{
      alive=false
      window.clearInterval(timer)
      window.removeEventListener('focus',onFocus)
      document.removeEventListener('visibilitychange',onVisible)
    }
  },[enabled,household.id,user.id])

  if(!enabled||!activeAlert)return null
  const name=profiles.find(p=>p.id===activeAlert.triggered_by_profile_id)?.display_name??'A household member'
  return (
    <aside className="family-sos-live-banner" role="alert" aria-live="assertive">
      <ShieldAlert size={22} aria-hidden="true"/>
      <div>
        <strong>Family SOS active — {name} needs help</strong>
        <span>Open the alert to respond or call. Famioo does not contact emergency services automatically.</span>
      </div>
      <Link to="/app/safety">Open SOS <ArrowRight size={16}/></Link>
    </aside>
  )
}
