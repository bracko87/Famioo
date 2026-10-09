import { useCallback, useEffect, useRef, useState } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type MySetting={
  profile_id:string
  sharing_enabled:boolean
  visibility_scope:'household'|'adults'|'private'
  arrival_departure_enabled:boolean
}

function distanceMeters(
  a:{latitude:number;longitude:number},
  b:{latitude:number;longitude:number},
){
  const radius=6371000
  const dLat=(b.latitude-a.latitude)*Math.PI/180
  const dLon=(b.longitude-a.longitude)*Math.PI/180
  const lat1=a.latitude*Math.PI/180
  const lat2=b.latitude*Math.PI/180
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2
  return radius*2*Math.asin(Math.min(1,Math.sqrt(h)))
}

export function LocationSharingAgent(){
  const {household,modules,user}=useHousehold()
  const locationModule=modules.find((module)=>module.code==='location')
  const [setting,setSetting]=useState<MySetting|null>(null)

  const watchIdRef=useRef<number|null>(null)
  const lastSentAtRef=useRef(0)
  const lastSentPositionRef=useRef<{latitude:number;longitude:number}|null>(null)
  const sendingRef=useRef(false)

  const stopWatch=useCallback(()=>{
    if(watchIdRef.current!=null&&navigator.geolocation){
      navigator.geolocation.clearWatch(watchIdRef.current)
    }
    watchIdRef.current=null
  },[])

  const loadSetting=useCallback(async ()=>{
    if(!locationModule?.enabled){
      setSetting(null)
      return
    }

    const result=await supabase.rpc('my_location_setting_v1',{
      p_household_id:household.id,
    })

    if(result.error){
      setSetting(null)
      return
    }

    const row=Array.isArray(result.data)?result.data[0]:null
    setSetting(row??null)
  },[household.id,locationModule?.enabled,user.id])

  useEffect(()=>{
    void loadSetting()
    const timer=window.setInterval(()=>{ void loadSetting() },60000)
    const onVisibility=()=>{
      if(document.visibilityState==='visible') void loadSetting()
    }
    document.addEventListener('visibilitychange',onVisibility)

    return ()=>{
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange',onVisibility)
    }
  },[loadSetting])

  useEffect(()=>{
    stopWatch()

    if(
      !setting?.sharing_enabled
      || !locationModule?.enabled
      || !navigator.geolocation
    ) return

    watchIdRef.current=navigator.geolocation.watchPosition(
      (position)=>{
        const now=Date.now()
        const next={
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
        }
        const previous=lastSentPositionRef.current
        const moved=previous?distanceMeters(previous,next):Infinity
        const elapsed=now-lastSentAtRef.current

        if(sendingRef.current) return
        if(elapsed<15000&&moved<25) return

        sendingRef.current=true
        void supabase.rpc('update_family_location_v1',{
          p_household_id:household.id,
          p_profile_id:setting.profile_id,
          p_latitude:next.latitude,
          p_longitude:next.longitude,
          p_accuracy_m:position.coords.accuracy,
          p_captured_at:new Date(position.timestamp||now).toISOString(),
        }).then(({error})=>{
          if(!error){
            lastSentAtRef.current=Date.now()
            lastSentPositionRef.current=next
          }
          sendingRef.current=false
        })
      },
      ()=>{
        // The Location page presents permission errors to the user.
      },
      {
        enableHighAccuracy:true,
        maximumAge:15000,
        timeout:20000,
      },
    )

    return stopWatch
  },[
    household.id,
    locationModule?.enabled,
    setting?.profile_id,
    setting?.sharing_enabled,
    stopWatch,
  ])

  return null
}
