import {
  Archive,
  BedDouble,
  CalendarDays,
  Check,
  FileText,
  ImagePlus,
  MapPin,
  Route,
  PackageCheck,
  Pencil,
  Plane,
  Plus,
  Ticket,
  TrainFront,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import { getTravelTraffic, type TrafficResult } from '../lib/travelTraffic'
import { DatePicker } from '../components/ui/DatePicker'
import { Select } from '../components/ui/Select'
import { TimePicker } from '../components/ui/TimePicker'

type Trip={
  id:string
  title:string
  destination:string
  start_date:string
  end_date:string
  notes:string|null
  status:'planned'|'active'|'completed'|'archived'
  calendar_event_id:string|null
  photo_path:string|null
  created_at:string
}

type ItineraryItem={
  id:string
  trip_id:string
  item_type:'transport'|'accommodation'|'activity'|'note'
  title:string
  start_at:string|null
  end_at:string|null
  location_text:string|null
  booking_reference:string|null
  notes:string|null
  sort_order:number
  created_at:string
}

type ChecklistItem={
  id:string
  trip_id:string
  title:string
  checked:boolean
  sort_order:number
  created_at:string
}

type HouseholdFile={
  id:string
  title:string
  file_name:string
  storage_path:string
  category:string
  mime_type:string|null
}

type TripDocument={
  id:string
  trip_id:string
  file_id:string
  document_type:'document'|'ticket'
  label:string|null
  created_at:string
}

type TripDraft={
  id:string
  title:string
  destination:string
  start_date:string
  end_date:string
  notes:string
  sync_calendar:boolean
  calendar_event_id:string
}

type ItemDraft={
  id:string
  item_type:'transport'|'accommodation'|'activity'|'note'
  title:string
  start_at:string
  end_at:string
  location_text:string
  booking_reference:string
  notes:string
}

const emptyTrip:TripDraft={
  id:'',
  title:'',
  destination:'',
  start_date:'',
  end_date:'',
  notes:'',
  sync_calendar:true,
  calendar_event_id:'',
}

const emptyItem:ItemDraft={
  id:'',
  item_type:'transport',
  title:'',
  start_at:'',
  end_at:'',
  location_text:'',
  booking_reference:'',
  notes:'',
}

function prettyDate(value:string){
  return new Date(value+'T12:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})
}

function prettyDateTime(value:string|null){
  if(!value)return 'No time set'
  return new Date(value).toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
}

function statusFor(trip:Trip){
  if(trip.status==='archived')return 'Archived'
  const today=new Date().toISOString().slice(0,10)
  if(today<trip.start_date)return 'Upcoming'
  if(today>trip.end_date)return 'Completed'
  return 'In progress'
}

function itemIcon(type:ItineraryItem['item_type']){
  if(type==='transport')return <TrainFront size={16}/>
  if(type==='accommodation')return <BedDouble size={16}/>
  if(type==='activity')return <MapPin size={16}/>
  return <FileText size={16}/>
}

export function TravelPage(){
  const {household,modules,user}=useHousehold()
  const canWrite=Boolean(modules.find(module=>module.code==='travel')?.can_write)
  const [trips,setTrips]=useState<Trip[]>([])
  const [selectedTripId,setSelectedTripId]=useState('')
  const [itinerary,setItinerary]=useState<ItineraryItem[]>([])
  const [checklist,setChecklist]=useState<ChecklistItem[]>([])
  const [files,setFiles]=useState<HouseholdFile[]>([])
  const [documents,setDocuments]=useState<TripDocument[]>([])
  const [fileUrls,setFileUrls]=useState<Record<string,string>>({})
  const [tripPhotoUrls,setTripPhotoUrls]=useState<Record<string,string>>({})
  const [eventPhotoFileIds,setEventPhotoFileIds]=useState<Record<string,string>>({})
  const [calendarEvents,setCalendarEvents]=useState<Array<{id:string;title:string;start_date:string|null;start_at:string|null}>>([])
  const [tripPhotoFile,setTripPhotoFile]=useState<File|null>(null)
  const [tripPhotoPreview,setTripPhotoPreview]=useState('')
  const [removeTripPhoto,setRemoveTripPhoto]=useState(false)
  const [tab,setTab]=useState<'overview'|'itinerary'|'documents'|'checklist'>('overview')
  const [tripEditorOpen,setTripEditorOpen]=useState(false)
  const [tripDraft,setTripDraft]=useState<TripDraft>(emptyTrip)
  const [itemEditorOpen,setItemEditorOpen]=useState(false)
  const [itemDraft,setItemDraft]=useState<ItemDraft>(emptyItem)
  const [checklistTitle,setChecklistTitle]=useState('')
  const [documentFileId,setDocumentFileId]=useState('')
  const [documentType,setDocumentType]=useState<'document'|'ticket'>('document')
  const [documentLabel,setDocumentLabel]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [trafficBusy,setTrafficBusy]=useState(false)
  const [trafficError,setTrafficError]=useState('')
  const [trafficResult,setTrafficResult]=useState<TrafficResult|null>(null)
  const [trafficOrigin,setTrafficOrigin]=useState('')
  const [message,setMessage]=useState('')

  const selectedTrip=trips.find(trip=>trip.id===selectedTripId)??trips[0]??null
  useEffect(()=>{setTrafficResult(null);setTrafficError('');setTrafficOrigin('')},[selectedTripId])

  async function checkTripTraffic(){
    if(!selectedTrip)return
    setTrafficBusy(true);setTrafficError('');setTrafficResult(null)
    try{setTrafficResult(await getTravelTraffic(household.id,{trip_id:selectedTrip.id,...(trafficOrigin.trim()?{origin:trafficOrigin.trim()}:{})}))}
    catch(error){setTrafficError(error instanceof Error?error.message:'Unable to check traffic')}
    finally{setTrafficBusy(false)}
  }

  const selectedTripCover=selectedTrip?(tripPhotoUrls[selectedTrip.id] || (selectedTrip.calendar_event_id?fileUrls[eventPhotoFileIds[selectedTrip.calendar_event_id]]:'') || ''):''
  const selectedItinerary=useMemo(
    ()=>itinerary.filter(item=>item.trip_id===selectedTrip?.id).sort((a,b)=>(a.start_at??'').localeCompare(b.start_at??'')||a.sort_order-b.sort_order),
    [itinerary,selectedTrip?.id],
  )
  const selectedChecklist=useMemo(
    ()=>checklist.filter(item=>item.trip_id===selectedTrip?.id).sort((a,b)=>Number(a.checked)-Number(b.checked)||a.sort_order-b.sort_order),
    [checklist,selectedTrip?.id],
  )
  const selectedDocuments=documents.filter(item=>item.trip_id===selectedTrip?.id)
  const fileById=useMemo(()=>new Map(files.map(file=>[file.id,file])),[files])

  async function load(foreground=false){
    if(foreground)setLoading(true)
    setError('')
    const [tripResult,itemResult,checkResult,fileResult,docResult,eventResult,eventPhotoResult]=await Promise.all([
      supabase.from('family_trips').select('id,title,destination,start_date,end_date,notes,status,calendar_event_id,photo_path,created_at').eq('household_id',household.id).neq('status','archived').order('start_date',{ascending:true}),
      supabase.from('family_trip_itinerary').select('id,trip_id,item_type,title,start_at,end_at,location_text,booking_reference,notes,sort_order,created_at').eq('household_id',household.id).order('sort_order'),
      supabase.from('family_trip_checklist_items').select('id,trip_id,title,checked,sort_order,created_at').eq('household_id',household.id).order('sort_order'),
      supabase.from('household_files').select('id,title,file_name,storage_path,category,mime_type').eq('household_id',household.id).eq('status','active').is('archived_at',null).order('created_at',{ascending:false}),
      supabase.from('family_trip_documents').select('id,trip_id,file_id,document_type,label,created_at').eq('household_id',household.id).order('created_at',{ascending:false}),
      supabase.from('calendar_events').select('id,title,start_date,start_at').eq('household_id',household.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(250),
      supabase.from('calendar_event_attachments').select('event_id,file_id').eq('household_id',household.id).limit(300),
    ])
    const failure=tripResult.error||itemResult.error||checkResult.error||fileResult.error||docResult.error
    if(failure)setError(failure.message)

    const tripRows=(tripResult.data??[]) as Trip[]
    const fileRows=(fileResult.data??[]) as HouseholdFile[]
    setTrips(tripRows)
    setItinerary((itemResult.data??[]) as ItineraryItem[])
    setChecklist((checkResult.data??[]) as ChecklistItem[])
    setFiles(fileRows)
    setDocuments((docResult.data??[]) as TripDocument[])
    setCalendarEvents((eventResult.data??[]) as Array<{id:string;title:string;start_date:string|null;start_at:string|null}>)
    const imageFileIds=new Set(fileRows.filter(file=>file.mime_type?.startsWith('image/')).map(file=>file.id))
    setEventPhotoFileIds(Object.fromEntries(((eventPhotoResult.data??[]) as Array<{event_id:string;file_id:string}>).filter(row=>imageFileIds.has(row.file_id)).map(row=>[row.event_id,row.file_id])))
    setSelectedTripId(current=>tripRows.some(row=>row.id===current)?current:(tripRows[0]?.id??''))

    const signed=await Promise.all(fileRows.map(async file=>{
      const result=await supabase.storage.from('famioo-files').createSignedUrl(file.storage_path,3600)
      return [file.id,result.data?.signedUrl??''] as const
    }))
    setFileUrls(Object.fromEntries(signed))
    const photos=await Promise.all(tripRows.filter(trip=>trip.photo_path).map(async trip=>{
      const result=await supabase.storage.from('trip-media').createSignedUrl(String(trip.photo_path),3600)
      return [trip.id,result.data?.signedUrl??''] as const
    }))
    setTripPhotoUrls(Object.fromEntries(photos))
    if(foreground)setLoading(false)
  }

  useEffect(()=>{void load(true)},[household.id])

  function clearTripPhotoPreview(){
    if(tripPhotoPreview.startsWith('blob:'))URL.revokeObjectURL(tripPhotoPreview)
    setTripPhotoPreview('');setTripPhotoFile(null);setRemoveTripPhoto(false)
  }
  function chooseTripPhoto(file:File|null){
    if(!file)return
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Trip image must be JPG, PNG or WebP.');return}
    if(file.size>5*1024*1024){setError('Trip image can be up to 5 MB.');return}
    if(tripPhotoPreview.startsWith('blob:'))URL.revokeObjectURL(tripPhotoPreview)
    setTripPhotoFile(file);setTripPhotoPreview(URL.createObjectURL(file));setRemoveTripPhoto(false);setError('')
  }
  function openNewTrip(){
    clearTripPhotoPreview()
    setTripDraft({...emptyTrip})
    setTripEditorOpen(true)
    setError('');setMessage('')
  }

  function openEditTrip(trip:Trip){
    clearTripPhotoPreview()
    setTripPhotoPreview(tripPhotoUrls[trip.id] || (trip.calendar_event_id?fileUrls[eventPhotoFileIds[trip.calendar_event_id]]:'') || '')
    setTripDraft({
      id:trip.id,title:trip.title,destination:trip.destination,start_date:trip.start_date,end_date:trip.end_date,
      notes:trip.notes??'',sync_calendar:false,calendar_event_id:trip.calendar_event_id??'',
    })
    setTripEditorOpen(true)
    setError('');setMessage('')
  }

  async function saveTrip(event:FormEvent){
    event.preventDefault()
    if(!tripDraft.title.trim()||!tripDraft.destination.trim()||!tripDraft.start_date||!tripDraft.end_date){setError('Trip name, destination and dates are required.');return}
    if(tripDraft.end_date<tripDraft.start_date){setError('The end date cannot be before the start date.');return}
    setSaving(true);setError('');setMessage('')
    const result=await supabase.rpc('save_family_trip_v1',{
      p_id:tripDraft.id||null,
      p_household_id:household.id,
      p_title:tripDraft.title.trim(),
      p_destination:tripDraft.destination.trim(),
      p_start_date:tripDraft.start_date,
      p_end_date:tripDraft.end_date,
      p_notes:tripDraft.notes.trim()||null,
      p_sync_calendar:tripDraft.sync_calendar && !tripDraft.calendar_event_id,
    })
    if(result.error){setSaving(false);setError(result.error.message);return}
    const id=String(result.data)
    if(tripDraft.calendar_event_id || (!tripDraft.sync_calendar && tripDraft.id)){
      // A manually linked event is never rewritten by the trip's automatic Calendar sync.
      const linked=await supabase.from('family_trips').update({calendar_event_id:tripDraft.calendar_event_id||null}).eq('household_id',household.id).eq('id',id)
      if(linked.error){setSaving(false);setError('Trip saved, but event linking failed: '+linked.error.message);return}
    }
    if(tripPhotoFile){
      const oldPath=trips.find(trip=>trip.id===id)?.photo_path
      const extension=tripPhotoFile.type==='image/png'?'png':tripPhotoFile.type==='image/webp'?'webp':'jpg'
      const storagePath=`${household.id}/${id}/${crypto.randomUUID()}.${extension}`
      const uploaded=await supabase.storage.from('trip-media').upload(storagePath,tripPhotoFile,{contentType:tripPhotoFile.type})
      if(uploaded.error){setSaving(false);setError('Trip saved, but image upload failed: '+uploaded.error.message);return}
      const linked=await supabase.from('family_trips').update({photo_path:storagePath}).eq('household_id',household.id).eq('id',id)
      if(linked.error){await supabase.storage.from('trip-media').remove([storagePath]);setSaving(false);setError('Trip saved, but image linking failed: '+linked.error.message);return}
      if(oldPath)await supabase.storage.from('trip-media').remove([oldPath])
    }else if(removeTripPhoto){
      const oldPath=trips.find(trip=>trip.id===id)?.photo_path
      const cleared=await supabase.from('family_trips').update({photo_path:null}).eq('household_id',household.id).eq('id',id)
      if(cleared.error){setSaving(false);setError('Could not remove trip cover: '+cleared.error.message);return}
      if(oldPath)await supabase.storage.from('trip-media').remove([oldPath])
    }
    setSaving(false)
    clearTripPhotoPreview()
    setTripEditorOpen(false)
    setSelectedTripId(id)
    setMessage(tripDraft.id?'Trip updated.':'Trip created.')
    await load(false)
  }

  async function archiveTrip(trip:Trip){
    if(!window.confirm('Archive '+trip.title+'?'))return
    const result=await supabase.from('family_trips').update({status:'archived',updated_at:new Date().toISOString()}).eq('id',trip.id).eq('household_id',household.id)
    if(result.error){setError(result.error.message);return}
    setMessage('Trip archived.')
    await load(false)
  }

  function openNewItem(type:ItemDraft['item_type']='transport'){
    setItemDraft({...emptyItem,item_type:type})
    setItemEditorOpen(true)
    setError('');setMessage('')
  }

  function openEditItem(item:ItineraryItem){
    setItemDraft({
      id:item.id,item_type:item.item_type,title:item.title,
      start_at:item.start_at?item.start_at.slice(0,16):'',
      end_at:item.end_at?item.end_at.slice(0,16):'',
      location_text:item.location_text??'',booking_reference:item.booking_reference??'',notes:item.notes??'',
    })
    setItemEditorOpen(true)
  }

  async function saveItem(event:FormEvent){
    event.preventDefault()
    if(!selectedTrip||!itemDraft.title.trim())return
    setSaving(true);setError('');setMessage('')
    const payload={
      household_id:household.id,
      trip_id:selectedTrip.id,
      item_type:itemDraft.item_type,
      title:itemDraft.title.trim(),
      start_at:itemDraft.start_at?new Date(itemDraft.start_at).toISOString():null,
      end_at:itemDraft.end_at?new Date(itemDraft.end_at).toISOString():null,
      location_text:itemDraft.location_text.trim()||null,
      booking_reference:itemDraft.booking_reference.trim()||null,
      notes:itemDraft.notes.trim()||null,
      updated_at:new Date().toISOString(),
    }
    const result=itemDraft.id
      ?await supabase.from('family_trip_itinerary').update(payload).eq('id',itemDraft.id).eq('household_id',household.id)
      :await supabase.from('family_trip_itinerary').insert({...payload,created_by_user_id:user.id,sort_order:selectedItinerary.length})
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setItemEditorOpen(false)
    setMessage(itemDraft.id?'Itinerary item updated.':'Itinerary item added.')
    await load(false)
  }

  async function deleteItem(item:ItineraryItem){
    if(!window.confirm('Remove '+item.title+' from the itinerary?'))return
    const result=await supabase.from('family_trip_itinerary').delete().eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  async function addChecklistItem(event:FormEvent){
    event.preventDefault()
    if(!selectedTrip||!checklistTitle.trim())return
    const result=await supabase.from('family_trip_checklist_items').insert({
      household_id:household.id,trip_id:selectedTrip.id,title:checklistTitle.trim(),checked:false,
      sort_order:selectedChecklist.length,created_by_user_id:user.id,
    })
    if(result.error){setError(result.error.message);return}
    setChecklistTitle('')
    await load(false)
  }

  async function toggleChecklist(item:ChecklistItem){
    const result=await supabase.from('family_trip_checklist_items').update({checked:!item.checked,updated_at:new Date().toISOString()}).eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  async function deleteChecklist(item:ChecklistItem){
    const result=await supabase.from('family_trip_checklist_items').delete().eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  async function linkDocument(event:FormEvent){
    event.preventDefault()
    if(!selectedTrip||!documentFileId)return
    const result=await supabase.from('family_trip_documents').insert({
      household_id:household.id,trip_id:selectedTrip.id,file_id:documentFileId,document_type:documentType,
      label:documentLabel.trim()||null,created_by_user_id:user.id,
    })
    if(result.error){setError(result.error.message);return}
    setDocumentFileId('');setDocumentLabel('');setDocumentType('document')
    setMessage('File linked to this trip.')
    await load(false)
  }

  async function unlinkDocument(doc:TripDocument){
    const result=await supabase.from('family_trip_documents').delete().eq('id',doc.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  if(loading)return <div className="page travel-page"><div className="travel-empty">Loading trips…</div></div>

  return (
    <div className="page travel-page">
      <div className="page-heading-row travel-heading">
        <div>
          <span className="eyebrow">TRAVEL & TRIPS</span>
          <h1>Plan the whole family trip</h1>
          <p>Keep dates, transport, accommodation, plans, tickets, documents and packing items together.</p>
        </div>
        {canWrite&&<button type="button" className="primary-button compact" onClick={openNewTrip}><Plus size={15}/>New trip</button>}
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice">{message}</div>}

      {trips.length===0?(
        <div className="travel-empty"><Plane size={34}/><strong>No trips planned yet.</strong><span>Create the first trip and Famioo can keep the itinerary, documents and checklist in one place.</span>{canWrite&&<button type="button" className="primary-button compact" onClick={openNewTrip}><Plus size={14}/>Create first trip</button>}</div>
      ):(
        <>
          <section className="travel-trip-strip">
            {trips.map(trip=>(
              <button type="button" className={selectedTrip?.id===trip.id?'travel-trip-chip active':'travel-trip-chip'} onClick={()=>setSelectedTripId(trip.id)} key={trip.id}>
                <Plane size={16}/><span><strong>{trip.title}</strong><small>{trip.destination} · {prettyDate(trip.start_date)}</small></span>
              </button>
            ))}
          </section>

          {selectedTrip&&<>
            <section className="travel-hero">
              <div className="travel-hero-art" aria-hidden="true">{selectedTripCover?<img src={selectedTripCover} alt=""/>:<div className="travel-destination-art"><Plane size={55}/><span>{selectedTrip.destination.split(',').slice(-1)[0]?.trim()}</span></div>}</div>
              <div className="travel-hero-copy">
                <span className="eyebrow">{statusFor(selectedTrip).toUpperCase()}</span>
                <h2>{selectedTrip.title}</h2>
                <p><MapPin size={13}/>{selectedTrip.destination}</p>
                <small><CalendarDays size={13}/>{prettyDate(selectedTrip.start_date)} – {prettyDate(selectedTrip.end_date)}</small>
              </div>
              <div className="travel-hero-actions">
                {selectedTrip.calendar_event_id&&<span className="travel-calendar-badge"><CalendarDays size={13}/>Calendar synced</span>}
                <button type="button" className="secondary-button compact" onClick={()=>void checkTripTraffic()} disabled={trafficBusy}><Route size={14}/>{trafficBusy?'Checking…':'Check traffic'}</button>
                {canWrite&&<button type="button" className="secondary-button compact" onClick={()=>openEditTrip(selectedTrip)}><Pencil size={13}/>Edit</button>}
                {canWrite&&<button type="button" className="icon-button" onClick={()=>void archiveTrip(selectedTrip)} title="Archive trip"><Archive size={15}/></button>}
              </div>
            </section>

            {(trafficResult||trafficError)&&<section className="travel-traffic-result" aria-live="polite">
              <header><strong>Google Maps driving estimate</strong><button type="button" onClick={()=>{setTrafficResult(null);setTrafficError('')}} aria-label="Dismiss traffic result"><X size={14}/></button></header>
              {trafficResult?<>
                <p>{trafficResult.traffic_type} to {trafficResult.destination}</p>
                {trafficResult.routes.map((route,index)=><div className="travel-traffic-row" key={index}><b>Route {index+1}</b><span>{route.distance_km} km · {route.duration_minutes!=null?Math.floor(route.duration_minutes/60)+'h '+(route.duration_minutes%60)+'m':'Time unavailable'}</span></div>)}
                <small>{trafficResult.warning}</small>
                <a className="secondary-button compact" href={trafficResult.navigation_url} target="_blank" rel="noopener noreferrer">Open route in Google Maps</a>
              </>:<>
                <p>{trafficError}</p>
                <label>Start address (optional alternative to GPS)<input value={trafficOrigin} onChange={event=>setTrafficOrigin(event.target.value)} placeholder="Street, town, country"/></label>
                <button type="button" className="secondary-button compact" disabled={trafficBusy} onClick={()=>void checkTripTraffic()}>Try route again</button>
              </>}
            </section>}
            <nav className="projects-tabs travel-tabs" aria-label="Trip sections">
              <button type="button" className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Overview</button>
              <button type="button" className={tab==='itinerary'?'active':''} onClick={()=>setTab('itinerary')}>Itinerary <span>{selectedItinerary.length}</span></button>
              <button type="button" className={tab==='documents'?'active':''} onClick={()=>setTab('documents')}>Documents <span>{selectedDocuments.length}</span></button>
              <button type="button" className={tab==='checklist'?'active':''} onClick={()=>setTab('checklist')}>Checklist <span>{selectedChecklist.filter(item=>!item.checked).length}</span></button>
            </nav>

            {tab==='overview'&&<section className="travel-overview-grid">
              <article className="travel-summary-card"><TrainFront size={19}/><span><small>TRANSPORT</small><strong>{selectedItinerary.filter(i=>i.item_type==='transport').length} item(s)</strong></span><button onClick={()=>{setTab('itinerary');openNewItem('transport')}}>Add</button></article>
              <article className="travel-summary-card"><BedDouble size={19}/><span><small>ACCOMMODATION</small><strong>{selectedItinerary.filter(i=>i.item_type==='accommodation').length} stay(s)</strong></span><button onClick={()=>{setTab('itinerary');openNewItem('accommodation')}}>Add</button></article>
              <article className="travel-summary-card"><Ticket size={19}/><span><small>TICKETS & DOCS</small><strong>{selectedDocuments.length} linked</strong></span><button onClick={()=>setTab('documents')}>Open</button></article>
              <article className="travel-summary-card"><PackageCheck size={19}/><span><small>CHECKLIST</small><strong>{selectedChecklist.filter(i=>!i.checked).length} remaining</strong></span><button onClick={()=>setTab('checklist')}>Open</button></article>
              <article className="travel-notes-card">
                <span className="eyebrow">TRIP NOTES</span>
                <p>{selectedTrip.notes||'No notes yet. Add booking tips, meeting points, important addresses or anything the family should remember.'}</p>
              </article>
            </section>}

            {tab==='itinerary'&&<section className="travel-section">
              <div className="travel-section-head"><div><span className="eyebrow">ITINERARY</span><h2>Transport, stays & plans</h2></div>{canWrite&&<button className="primary-button compact" onClick={()=>openNewItem('activity')}><Plus size={14}/>Add item</button>}</div>
              {selectedItinerary.length===0?<div className="travel-empty compact"><strong>No itinerary items yet.</strong><span>Add travel, accommodation or activities.</span></div>:<div className="travel-itinerary-list">{selectedItinerary.map(item=><article className="travel-itinerary-row" key={item.id}>
                <span className={'travel-item-icon '+item.item_type}>{itemIcon(item.item_type)}</span>
                <div><small>{item.item_type.toUpperCase()}</small><strong>{item.title}</strong><span>{prettyDateTime(item.start_at)}{item.location_text?' · '+item.location_text:''}</span>{item.booking_reference&&<em>Booking: {item.booking_reference}</em>}{item.notes&&<p>{item.notes}</p>}</div>
                {canWrite&&<div className="travel-row-actions"><button onClick={()=>openEditItem(item)}><Pencil size={13}/></button><button onClick={()=>void deleteItem(item)}><Trash2 size={13}/></button></div>}
              </article>)}</div>}
            </section>}

            {tab==='documents'&&<section className="travel-section">
              <div className="travel-section-head"><div><span className="eyebrow">DOCUMENTS & TICKETS</span><h2>Files for this trip</h2><p>Upload files in Famioo Files, then link them here to the trip.</p></div></div>
              {canWrite&&<form className="travel-document-linker" onSubmit={linkDocument}>
                <Select value={documentType} options={[{value:'document',label:'Document'},{value:'ticket',label:'Ticket'}]} onChange={value=>setDocumentType(value as 'document'|'ticket')} ariaLabel="Document type"/>
                <Select value={documentFileId} options={files.map(file=>({value:file.id,label:file.title}))} onChange={setDocumentFileId} placeholder="Choose file…" ariaLabel="Trip document"/>
                <input value={documentLabel} onChange={e=>setDocumentLabel(e.target.value)} placeholder="Optional label"/>
                <button className="primary-button compact"><Plus size={13}/>Link</button>
              </form>}
              {selectedDocuments.length===0?<div className="travel-empty compact"><FileText size={24}/><strong>No trip documents linked.</strong><span>Passports copies, booking confirmations, tickets and insurance documents can all live here.</span></div>:<div className="travel-document-list">{selectedDocuments.map(doc=>{const file=fileById.get(doc.file_id);if(!file)return null;return <article className="travel-document-row" key={doc.id}>
                <span>{doc.document_type==='ticket'?<Ticket size={17}/>:<FileText size={17}/>}</span>
                <div><small>{doc.document_type.toUpperCase()}</small><strong>{doc.label||file.title}</strong><em>{file.file_name}</em></div>
                <div>{fileUrls[file.id]&&<a className="secondary-button compact" href={fileUrls[file.id]} target="_blank" rel="noreferrer">Open</a>}{canWrite&&<button className="icon-button" onClick={()=>void unlinkDocument(doc)}><X size={14}/></button>}</div>
              </article>})}</div>}
            </section>}

            {tab==='checklist'&&<section className="travel-section">
              <div className="travel-section-head"><div><span className="eyebrow">TRIP CHECKLIST</span><h2>Pack & prepare</h2></div></div>
              {canWrite&&<form className="travel-checklist-add" onSubmit={addChecklistItem}><input value={checklistTitle} onChange={e=>setChecklistTitle(e.target.value)} placeholder="Add packing or preparation item…" required/><button className="primary-button compact"><Plus size={14}/>Add</button></form>}
              {selectedChecklist.length===0?<div className="travel-empty compact"><PackageCheck size={24}/><strong>Checklist is empty.</strong><span>Add luggage, documents, medicine, chargers or pre-trip tasks.</span></div>:<div className="travel-checklist-list">{selectedChecklist.map(item=><div className={item.checked?'travel-check-row checked':'travel-check-row'} key={item.id}>
                <button type="button" className="travel-check-toggle" onClick={()=>void toggleChecklist(item)} disabled={!canWrite}>{item.checked?<Check size={15}/>:null}</button>
                <span>{item.title}</span>
                {canWrite&&<button type="button" className="icon-button" onClick={()=>void deleteChecklist(item)}><Trash2 size={13}/></button>}
              </div>)}</div>}
            </section>}
          </>}
        </>
      )}

      {tripEditorOpen&&<div className="modal-backdrop travel-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card travel-editor">
        <header><div><span className="eyebrow">{tripDraft.id?'EDIT TRIP':'NEW TRIP'}</span><h2>{tripDraft.id?'Update trip':'Plan a family trip'}</h2></div><button className="icon-button" onClick={()=>{clearTripPhotoPreview();setTripEditorOpen(false)}}><X size={18}/></button></header>
        <form onSubmit={saveTrip}>
          <label><span>Trip name *</span><input value={tripDraft.title} onChange={e=>setTripDraft(current=>({...current,title:e.target.value}))} maxLength={160} required placeholder="e.g. Summer holiday"/></label>
          <label><span>Destination *</span><input value={tripDraft.destination} onChange={e=>setTripDraft(current=>({...current,destination:e.target.value}))} maxLength={180} required placeholder="e.g. Salzburg, Austria"/></label>
          <div className="travel-editor-row"><label><span>Start *</span><DatePicker value={tripDraft.start_date} onChange={value=>setTripDraft(current=>({...current,start_date:value,end_date:current.end_date&&current.end_date<value?value:current.end_date}))} ariaLabel="Trip start date"/></label><label><span>End *</span><DatePicker value={tripDraft.end_date} min={tripDraft.start_date||undefined} onChange={value=>setTripDraft(current=>({...current,end_date:value}))} ariaLabel="Trip end date"/></label></div>
          <div className="trip-photo-field">
             <div className="trip-photo-preview">{tripPhotoPreview?<img src={tripPhotoPreview} alt="Trip cover preview"/>:<Plane size={26}/>}</div>
             <div><strong>Trip cover image</strong><small>Optional · JPG, PNG or WebP · up to 5 MB</small><label className="secondary-button compact trip-photo-upload"><ImagePlus size={14}/>{tripPhotoPreview?'Change image':'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{chooseTripPhoto(event.target.files?.[0]??null);event.target.value=''}}/></label>{tripPhotoPreview&&<button type="button" className="trip-photo-remove" onClick={()=>{if(tripPhotoPreview.startsWith('blob:'))URL.revokeObjectURL(tripPhotoPreview);setTripPhotoFile(null);setTripPhotoPreview('');setRemoveTripPhoto(true)}}>Remove image</button>}</div>
           </div>
           <label><span>Notes</span><textarea rows={4} value={tripDraft.notes} onChange={e=>setTripDraft(current=>({...current,notes:e.target.value}))} placeholder="Accommodation notes, contacts, reminders…"/></label>
           <label><span>Calendar connection</span><Select value={tripDraft.calendar_event_id?'event:'+tripDraft.calendar_event_id:tripDraft.sync_calendar?'sync':'none'} options={[{value:'sync',label:'Create / update trip in Calendar'},{value:'none',label:'No Calendar connection'},...calendarEvents.map(event=>({value:'event:'+event.id,label:'Link existing: '+event.title}))]} onChange={value=>setTripDraft(current=>({...current,sync_calendar:value==='sync',calendar_event_id:value.startsWith('event:')?value.slice(6):''}))} ariaLabel="Connect Calendar event"/></label>
           <small className="trip-photo-helper">If the linked Calendar event has an attached image, it is used when no trip cover has been uploaded.</small>
          
          <footer><button type="button" className="secondary-button" onClick={()=>{clearTripPhotoPreview();setTripEditorOpen(false)}}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save trip'}</button></footer>
        </form>
      </section></div>}

      {itemEditorOpen&&selectedTrip&&<div className="modal-backdrop travel-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card travel-editor">
        <header><div><span className="eyebrow">{itemDraft.id?'EDIT ITINERARY':'ADD TO ITINERARY'}</span><h2>{itemDraft.id?'Update plan':'New trip item'}</h2></div><button className="icon-button" onClick={()=>setItemEditorOpen(false)}><X size={18}/></button></header>
        <form onSubmit={saveItem}>
          <label><span>Type</span><Select value={itemDraft.item_type} options={[{value:'transport',label:'Transport'},{value:'accommodation',label:'Accommodation'},{value:'activity',label:'Activity'},{value:'note',label:'Note'}]} onChange={value=>setItemDraft(current=>({...current,item_type:value as ItemDraft['item_type']}))} ariaLabel="Trip item type"/></label>
          <label><span>Title *</span><input value={itemDraft.title} onChange={e=>setItemDraft(current=>({...current,title:e.target.value}))} required maxLength={180} placeholder="Flight, hotel, museum…"/></label>
          <div className="travel-editor-row"><label><span>Starts</span><DatePicker value={itemDraft.start_at.slice(0,10)} onChange={date=>setItemDraft(current=>({...current,start_at:date?date+'T'+(current.start_at.slice(11,16)||'09:00'):''}))} ariaLabel="Itinerary start date"/><TimePicker value={itemDraft.start_at.slice(11,16)||'09:00'} onChange={time=>setItemDraft(current=>({...current,start_at:current.start_at?current.start_at.slice(0,10)+'T'+time:''}))}/></label><label><span>Ends</span><DatePicker value={itemDraft.end_at.slice(0,10)} onChange={date=>setItemDraft(current=>({...current,end_at:date?date+'T'+(current.end_at.slice(11,16)||'10:00'):''}))} ariaLabel="Itinerary end date"/><TimePicker value={itemDraft.end_at.slice(11,16)||'10:00'} onChange={time=>setItemDraft(current=>({...current,end_at:current.end_at?current.end_at.slice(0,10)+'T'+time:''}))}/></label></div>
          <label><span>Location</span><input value={itemDraft.location_text} onChange={e=>setItemDraft(current=>({...current,location_text:e.target.value}))} placeholder="Airport, hotel, address…"/></label>
          <label><span>Booking / reference</span><input value={itemDraft.booking_reference} onChange={e=>setItemDraft(current=>({...current,booking_reference:e.target.value}))} placeholder="Confirmation or booking code"/></label>
          <label><span>Notes</span><textarea rows={3} value={itemDraft.notes} onChange={e=>setItemDraft(current=>({...current,notes:e.target.value}))}/></label>
          <footer><button type="button" className="secondary-button" onClick={()=>setItemEditorOpen(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save item'}</button></footer>
        </form>
      </section></div>}
    </div>
  )
}
