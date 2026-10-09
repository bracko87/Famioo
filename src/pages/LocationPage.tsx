import {
  BellRing,
  CheckCircle2,
  Eye,
  EyeOff,
  LocateFixed,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FamilyLocationMap } from '../components/FamilyLocationMap'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type VisibilityScope='household'|'adults'|'private'

type LocationRow={
  profile_id:string
  linked_user_id:string|null
  display_name:string
  profile_type:'adult'|'child'|'profile_only'
  color_key:string
  avatar_path:string|null
  is_self:boolean
  sharing_enabled:boolean
  visibility_scope:VisibilityScope
  arrival_departure_enabled:boolean
  latitude:number|null
  longitude:number|null
  accuracy_m:number|null
  captured_at:string|null
}

type SafePlace={
  id:string
  name:string
  place_type:'home'|'school'|'kita'|'work'|'grandparents'|'custom'
  latitude:number
  longitude:number
  radius_m:number
  arrival_alerts:boolean
  departure_alerts:boolean
  created_at:string
}

const placeLabels:Record<SafePlace['place_type'],string>={
  home:'Home',
  school:'School',
  kita:'Kita',
  work:'Work',
  grandparents:'Grandparents',
  custom:'Custom',
}

function relativeTime(value:string|null){
  if(!value) return 'No location yet'
  const diff=Math.max(0,Date.now()-new Date(value).getTime())
  if(diff<60000) return 'Updated just now'
  const minutes=Math.floor(diff/60000)
  if(minutes<60) return `Updated ${minutes} min ago`
  const hours=Math.floor(minutes/60)
  if(hours<24) return `Updated ${hours} h ago`
  const days=Math.floor(hours/24)
  return `Updated ${days} d ago`
}

function mapsUrl(latitude:number,longitude:number){
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
}

export function LocationPage(){
  const {household,user,profiles}=useHousehold()
  const currentProfile=profiles.find((profile)=>profile.linked_user_id===user.id)??null

  const [locations,setLocations]=useState<LocationRow[]>([])
  const [safePlaces,setSafePlaces]=useState<SafePlace[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [savingSettings,setSavingSettings]=useState(false)
  const [updatingNow,setUpdatingNow]=useState(false)
  const [sharingEnabled,setSharingEnabled]=useState(false)
  const [visibility,setVisibility]=useState<VisibilityScope>('adults')
  const [arrivalDeparture,setArrivalDeparture]=useState(true)

  const [placeOpen,setPlaceOpen]=useState(false)
  const [placeName,setPlaceName]=useState('')
  const [placeType,setPlaceType]=useState<SafePlace['place_type']>('home')
  const [placeLatitude,setPlaceLatitude]=useState('')
  const [placeLongitude,setPlaceLongitude]=useState('')
  const [placeRadius,setPlaceRadius]=useState('200')
  const [placeArrival,setPlaceArrival]=useState(true)
  const [placeDeparture,setPlaceDeparture]=useState(true)
  const [savingPlace,setSavingPlace]=useState(false)
  const [locatingPlace,setLocatingPlace]=useState(false)

  const myLocation=locations.find((item)=>item.is_self)??null
  const canManagePlaces=household.role==='owner'||household.role==='admin'||currentProfile?.profile_type==='adult'

  const load=useCallback(async (foreground=false)=>{
    if(foreground) setLoading(true)

    const [locationsResult,placesResult]=await Promise.all([
      supabase.rpc('family_locations_v1',{p_household_id:household.id}),
      supabase.rpc('safe_places_v1',{p_household_id:household.id}),
    ])

    if(locationsResult.error){
      setError(locationsResult.error.message)
    }else{
      const rows=(locationsResult.data??[]) as LocationRow[]
      setLocations(rows)
      const mine=rows.find((item)=>item.is_self)
      if(mine){
        setSharingEnabled(mine.sharing_enabled)
        setVisibility(mine.visibility_scope)
        setArrivalDeparture(mine.arrival_departure_enabled)
      }
    }

    if(placesResult.error){
      setError(placesResult.error.message)
    }else{
      setSafePlaces((placesResult.data??[]) as SafePlace[])
    }

    if(foreground) setLoading(false)
  },[household.id])

  useEffect(()=>{
    void load(true)
    const timer=window.setInterval(()=>{ void load(false) },10000)
    const onFocus=()=>{ void load(false) }
    window.addEventListener('focus',onFocus)

    return ()=>{
      window.clearInterval(timer)
      window.removeEventListener('focus',onFocus)
    }
  },[load])

  const mapMembers=useMemo(
    ()=>locations
      .filter((item):item is LocationRow&{latitude:number;longitude:number}=>
        item.latitude!=null&&item.longitude!=null,
      )
      .map((item)=>({
        profile_id:item.profile_id,
        display_name:item.display_name,
        latitude:item.latitude,
        longitude:item.longitude,
        accuracy_m:item.accuracy_m,
        color_key:item.color_key,
      })),
    [locations],
  )

  const mapPlaces=useMemo(
    ()=>safePlaces.map((place)=>({
      id:place.id,
      name:place.name,
      latitude:place.latitude,
      longitude:place.longitude,
      radius_m:place.radius_m,
      place_type:place.place_type,
    })),
    [safePlaces],
  )

  async function saveSharing(nextEnabled=sharingEnabled){
    if(!currentProfile){
      setError('This account is not linked to a family profile, so location sharing cannot be enabled yet.')
      return
    }

    setSavingSettings(true)
    setError('')
    setMessage('')

    const result=await supabase.rpc('set_location_sharing_v1',{
      p_household_id:household.id,
      p_profile_id:currentProfile.id,
      p_enabled:nextEnabled,
      p_visibility_scope:visibility,
      p_arrival_departure_enabled:arrivalDeparture,
    })

    setSavingSettings(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    setSharingEnabled(nextEnabled)
    setMessage(nextEnabled
      ?'Location sharing is on while Famioo is active on this device.'
      :'Location sharing is off. Your last location is no longer visible to other members.')

    window.dispatchEvent(new CustomEvent('famioo-location-setting-changed'))
    await load(false)

    if(nextEnabled) updateMyLocationNow(true)
  }

  function updateMyLocationNow(force=false){
    if(!sharingEnabled&&!force&&!savingSettings){
      setError('Turn on location sharing first.')
      return
    }
    if(!currentProfile){
      setError('This account is not linked to a family profile.')
      return
    }
    if(!navigator.geolocation){
      setError('Location is not available in this browser.')
      return
    }

    setUpdatingNow(true)
    setError('')
    setMessage('')

    navigator.geolocation.getCurrentPosition(
      (position)=>{
        void supabase.rpc('update_family_location_v1',{
          p_household_id:household.id,
          p_profile_id:currentProfile.id,
          p_latitude:position.coords.latitude,
          p_longitude:position.coords.longitude,
          p_accuracy_m:position.coords.accuracy,
          p_captured_at:new Date(position.timestamp||Date.now()).toISOString(),
        }).then(({error:locationError})=>{
          setUpdatingNow(false)
          if(locationError){
            setError(locationError.message)
            return
          }
          setMessage('Your location was updated.')
          void load(false)
        })
      },
      (reason)=>{
        setUpdatingNow(false)
        setError(reason.message||'Location permission was not available.')
      },
      {
        enableHighAccuracy:true,
        timeout:10000,
        maximumAge:5000,
      },
    )
  }

  function useCurrentLocationForPlace(){
    if(!navigator.geolocation){
      setError('Location is not available in this browser.')
      return
    }

    setLocatingPlace(true)
    setError('')

    navigator.geolocation.getCurrentPosition(
      (position)=>{
        setLocatingPlace(false)
        setPlaceLatitude(position.coords.latitude.toFixed(7))
        setPlaceLongitude(position.coords.longitude.toFixed(7))
      },
      (reason)=>{
        setLocatingPlace(false)
        setError(reason.message||'Location permission was not available.')
      },
      {
        enableHighAccuracy:true,
        timeout:10000,
        maximumAge:5000,
      },
    )
  }

  async function savePlace(){
    const latitude=Number(placeLatitude)
    const longitude=Number(placeLongitude)
    const radius=Number(placeRadius)

    if(!placeName.trim()){
      setError('Enter a name for the Safe Place.')
      return
    }
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)){
      setError('Enter valid coordinates or use your current location.')
      return
    }

    setSavingPlace(true)
    setError('')
    setMessage('')

    const result=await supabase.rpc('save_safe_place_v1',{
      p_household_id:household.id,
      p_id:null,
      p_name:placeName.trim(),
      p_place_type:placeType,
      p_latitude:latitude,
      p_longitude:longitude,
      p_radius_m:radius,
      p_arrival_alerts:placeArrival,
      p_departure_alerts:placeDeparture,
    })

    setSavingPlace(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage(placeName.trim()+' added as a Safe Place.')
    setPlaceName('')
    setPlaceLatitude('')
    setPlaceLongitude('')
    setPlaceRadius('200')
    setPlaceType('home')
    setPlaceArrival(true)
    setPlaceDeparture(true)
    setPlaceOpen(false)
    await load(false)
  }

  async function archivePlace(place:SafePlace){
    if(!window.confirm('Remove '+place.name+' from Safe Places?')) return

    const result=await supabase.rpc('archive_safe_place_v1',{
      p_household_id:household.id,
      p_id:place.id,
    })

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage(place.name+' removed from Safe Places.')
    await load(false)
  }

  return (
    <div className="page location-page">
      <div className="page-heading-row location-heading">
        <div>
          <span className="eyebrow">FAMILY LOCATION</span>
          <h1>Family Location & Safe Places</h1>
          <p>See voluntarily shared family locations and receive arrival/departure alerts for important places.</p>
        </div>
        <button type="button" className="secondary-button compact" onClick={()=>void load(true)}>
          <RefreshCw size={14}/>Refresh
        </button>
      </div>

      <div className="location-pwa-note">
        <Navigation size={17}/>
        <span>
          <strong>PWA location sharing</strong>
          <small>Famioo can keep updating location while the installed app/browser remains active. Reliable locked-screen/background tracking will be added to the future native Android and iOS apps.</small>
        </span>
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice">{message}</div>}

      <section className="location-map-card">
        <div className="location-section-head">
          <div>
            <span className="eyebrow">FAMILY MAP</span>
            <h2>{mapMembers.length} shared {mapMembers.length===1?'location':'locations'}</h2>
          </div>
          <span><MapPin size={14}/>{safePlaces.length} safe {safePlaces.length===1?'place':'places'}</span>
        </div>

        <FamilyLocationMap members={mapMembers} safePlaces={mapPlaces}/>

        <div className="location-member-strip">
          {locations.map((item)=>(
            <div className={item.latitude!=null?'location-member-chip online':'location-member-chip'} key={item.profile_id}>
              <ProfileAvatar avatarPath={item.avatar_path} name={item.display_name} size="sm"/>
              <span>
                <strong>{item.display_name}{item.is_self?' · You':''}</strong>
                <small>
                  {item.latitude!=null
                    ?relativeTime(item.captured_at)
                    :item.linked_user_id
                      ?item.sharing_enabled?'Location unavailable':'Not sharing'
                      :'No login device'}
                </small>
              </span>
              {item.latitude!=null&&item.longitude!=null&&(
                <a href={mapsUrl(item.latitude,item.longitude)} target="_blank" rel="noreferrer" aria-label={'Open '+item.display_name+' in maps'}>
                  <Navigation size={14}/>
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="location-settings-card">
        <div className="location-section-head">
          <div>
            <span className="eyebrow">MY LOCATION</span>
            <h2>Location sharing & privacy</h2>
          </div>
          <span className={sharingEnabled?'location-sharing-state active':'location-sharing-state'}>
            {sharingEnabled?<Eye size={14}/>:<EyeOff size={14}/>}
            {sharingEnabled?'Sharing':'Off'}
          </span>
        </div>

        {!currentProfile ? (
          <div className="location-unavailable-note">Your login needs to be linked to a family profile before you can share a location.</div>
        ) : (
          <div className="location-settings-grid">
            <label className="location-setting-toggle">
              <input
                type="checkbox"
                checked={sharingEnabled}
                onChange={(event)=>{
                  const next=event.target.checked
                  setSharingEnabled(next)
                  void saveSharing(next)
                }}
                disabled={savingSettings}
              />
              <span>
                <strong>Share my location</strong>
                <small>Updates automatically while Famioo is active on this device.</small>
              </span>
            </label>

            <label className="location-field">
              <span>Who can see my location?</span>
              <select
                value={visibility}
                onChange={(event)=>setVisibility(event.target.value as VisibilityScope)}
                disabled={!sharingEnabled}
              >
                <option value="household">Everyone in household</option>
                <option value="adults">Adults only</option>
                <option value="private">Only me</option>
              </select>
            </label>

            <label className="location-setting-toggle">
              <input
                type="checkbox"
                checked={arrivalDeparture}
                onChange={(event)=>setArrivalDeparture(event.target.checked)}
                disabled={!sharingEnabled}
              />
              <span>
                <strong>Safe Place arrival/departure alerts</strong>
                <small>Notify adult household members when your location crosses an enabled Safe Place boundary.</small>
              </span>
            </label>

            <div className="location-settings-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={!sharingEnabled||savingSettings}
                onClick={()=>void saveSharing()}
              >
                <ShieldCheck size={15}/>{savingSettings?'Saving…':'Save privacy settings'}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!sharingEnabled||updatingNow}
                onClick={()=>updateMyLocationNow(false)}
              >
                <LocateFixed size={15}/>{updatingNow?'Locating…':'Update my location now'}
              </button>
            </div>

            {myLocation?.captured_at&&(
              <div className="location-last-update">
                <CheckCircle2 size={14}/>
                <span>
                  <strong>{relativeTime(myLocation.captured_at)}</strong>
                  <small>
                    {myLocation.accuracy_m!=null?`Accuracy ±${Math.round(myLocation.accuracy_m)} m`:'Accuracy unavailable'}
                  </small>
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="safe-places-section">
        <div className="location-section-head">
          <div>
            <span className="eyebrow">SAFE PLACES</span>
            <h2>Home, School, Kita, Work & more</h2>
          </div>
          {canManagePlaces&&(
            <button type="button" className="primary-button compact" onClick={()=>setPlaceOpen((current)=>!current)}>
              <Plus size={14}/>{placeOpen?'Close':'Add place'}
            </button>
          )}
        </div>

        {placeOpen&&canManagePlaces&&(
          <div className="safe-place-form">
            <label>
              <span>Name</span>
              <input value={placeName} onChange={(event)=>setPlaceName(event.target.value)} placeholder="e.g. Home"/>
            </label>

            <label>
              <span>Type</span>
              <select value={placeType} onChange={(event)=>setPlaceType(event.target.value as SafePlace['place_type'])}>
                {Object.entries(placeLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
              </select>
            </label>

            <label>
              <span>Radius</span>
              <select value={placeRadius} onChange={(event)=>setPlaceRadius(event.target.value)}>
                <option value="100">100 m</option>
                <option value="150">150 m</option>
                <option value="200">200 m</option>
                <option value="300">300 m</option>
                <option value="500">500 m</option>
                <option value="1000">1 km</option>
              </select>
            </label>

            <div className="safe-place-coordinate-row">
              <label>
                <span>Latitude</span>
                <input inputMode="decimal" value={placeLatitude} onChange={(event)=>setPlaceLatitude(event.target.value)} placeholder="53.55"/>
              </label>
              <label>
                <span>Longitude</span>
                <input inputMode="decimal" value={placeLongitude} onChange={(event)=>setPlaceLongitude(event.target.value)} placeholder="10.00"/>
              </label>
            </div>

            <button type="button" className="secondary-button safe-place-current-button" onClick={useCurrentLocationForPlace} disabled={locatingPlace}>
              <LocateFixed size={15}/>{locatingPlace?'Locating…':'Use my current location'}
            </button>

            <div className="safe-place-alert-options">
              <label>
                <input type="checkbox" checked={placeArrival} onChange={(event)=>setPlaceArrival(event.target.checked)}/>
                <span><BellRing size={14}/>Arrival alerts</span>
              </label>
              <label>
                <input type="checkbox" checked={placeDeparture} onChange={(event)=>setPlaceDeparture(event.target.checked)}/>
                <span><BellRing size={14}/>Departure alerts</span>
              </label>
            </div>

            <button type="button" className="primary-button safe-place-save" onClick={()=>void savePlace()} disabled={savingPlace}>
              <MapPin size={15}/>{savingPlace?'Saving…':'Save Safe Place'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="location-empty">Loading Safe Places…</div>
        ) : safePlaces.length===0 ? (
          <div className="location-empty">
            <MapPin size={24}/>
            <strong>No Safe Places yet</strong>
            <span>Add Home, School, Kita or another important place.</span>
          </div>
        ) : (
          <div className="safe-place-list">
            {safePlaces.map((place)=>(
              <article className="safe-place-card" key={place.id}>
                <span className={'safe-place-icon '+place.place_type}><MapPin size={18}/></span>
                <span className="safe-place-copy">
                  <small>{placeLabels[place.place_type].toUpperCase()}</small>
                  <strong>{place.name}</strong>
                  <em>{place.radius_m} m radius · {place.arrival_alerts?'arrival on':'arrival off'} · {place.departure_alerts?'departure on':'departure off'}</em>
                </span>
                <a href={mapsUrl(place.latitude,place.longitude)} target="_blank" rel="noreferrer" className="safe-place-map-link">
                  <Navigation size={14}/>Map
                </a>
                {canManagePlaces&&(
                  <button type="button" className="safe-place-delete" onClick={()=>void archivePlace(place)} aria-label={'Remove '+place.name}>
                    <Trash2 size={14}/>
                  </button>
                )}
              </article>
            ))}
          </div>
        )}

        <div className="location-privacy-note">
          <Users size={15}/>
          <span>
            <strong>Privacy first</strong>
            <small>Every logged-in family member controls their own sharing. “Adults only” is the default. Turning sharing off immediately hides the stored last location from other members.</small>
          </span>
        </div>
      </section>
    </div>
  )
}
