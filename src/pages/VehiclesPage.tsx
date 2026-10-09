import {
  Archive,
  CalendarDays,
  CarFront,
  CircleDollarSign,
  FileText,
  Gauge,
  Plus,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type Vehicle={
  id:string
  name:string
  make:string|null
  model:string|null
  registration_plate:string|null
  vin:string|null
  model_year:number|null
  fuel_type:string|null
  odometer_km:number
  notes:string|null
  active:boolean
  created_at:string
}
type VehicleEvent={
  id:string
  vehicle_id:string
  event_type:'insurance'|'tuv'|'service'|'maintenance'|'tyre_change'|'registration'|'other'
  title:string
  due_date:string|null
  completed_date:string|null
  odometer_km:number|null
  provider:string|null
  cost_amount:number|null
  currency:string
  notes:string|null
  calendar_event_id:string|null
  created_at:string
}
type Tyre={
  id:string
  vehicle_id:string
  season:'summer'|'winter'|'all_season'
  brand:string|null
  tyre_size:string|null
  installed_date:string|null
  tread_depth_mm:number|null
  storage_location:string|null
  notes:string|null
  active:boolean
}
type HouseholdFile={id:string;title:string;file_name:string;storage_path:string}
type VehicleDocument={
  id:string
  vehicle_id:string
  file_id:string
  document_type:'registration'|'insurance'|'inspection'|'service'|'invoice'|'document'
  label:string|null
  created_at:string
}
type VehicleDraft={
  id:string
  name:string
  make:string
  model:string
  registration_plate:string
  vin:string
  model_year:string
  fuel_type:string
  odometer_km:string
  notes:string
}
type EventDraft={
  id:string
  event_type:VehicleEvent['event_type']
  title:string
  due_date:string
  completed_date:string
  odometer_km:string
  provider:string
  cost_amount:string
  notes:string
  sync_calendar:boolean
}
type TyreDraft={
  id:string
  season:Tyre['season']
  brand:string
  tyre_size:string
  installed_date:string
  tread_depth_mm:string
  storage_location:string
  notes:string
}
const emptyVehicle:VehicleDraft={id:'',name:'',make:'',model:'',registration_plate:'',vin:'',model_year:'',fuel_type:'',odometer_km:'0',notes:''}
const emptyEvent:EventDraft={id:'',event_type:'service',title:'',due_date:'',completed_date:'',odometer_km:'',provider:'',cost_amount:'',notes:'',sync_calendar:true}
const emptyTyre:TyreDraft={id:'',season:'summer',brand:'',tyre_size:'',installed_date:'',tread_depth_mm:'',storage_location:'',notes:''}

function money(value:number|null,currency='EUR'){
  if(value==null)return '—'
  return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(value)
}
function fmtDate(value:string|null){
  if(!value)return 'Not set'
  return new Date(value+'T12:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})
}
function eventLabel(type:VehicleEvent['event_type']){
  if(type==='tuv')return 'TÜV / inspection'
  if(type==='tyre_change')return 'Tyre change'
  return type.charAt(0).toUpperCase()+type.slice(1)
}
function daysUntil(value:string|null){
  if(!value)return null
  const today=new Date();today.setHours(12,0,0,0)
  const due=new Date(value+'T12:00:00')
  return Math.ceil((due.getTime()-today.getTime())/86400000)
}

export function VehiclesPage(){
  const {household,modules,user}=useHousehold()
  const canWrite=Boolean(modules.find(module=>module.code==='vehicles')?.can_write)
  const [vehicles,setVehicles]=useState<Vehicle[]>([])
  const [events,setEvents]=useState<VehicleEvent[]>([])
  const [tyres,setTyres]=useState<Tyre[]>([])
  const [files,setFiles]=useState<HouseholdFile[]>([])
  const [documents,setDocuments]=useState<VehicleDocument[]>([])
  const [fileUrls,setFileUrls]=useState<Record<string,string>>({})
  const [selectedId,setSelectedId]=useState('')
  const [tab,setTab]=useState<'overview'|'maintenance'|'tyres'|'documents'>('overview')
  const [vehicleEditor,setVehicleEditor]=useState(false)
  const [vehicleDraft,setVehicleDraft]=useState<VehicleDraft>(emptyVehicle)
  const [eventEditor,setEventEditor]=useState(false)
  const [eventDraft,setEventDraft]=useState<EventDraft>(emptyEvent)
  const [tyreEditor,setTyreEditor]=useState(false)
  const [tyreDraft,setTyreDraft]=useState<TyreDraft>(emptyTyre)
  const [documentFileId,setDocumentFileId]=useState('')
  const [documentType,setDocumentType]=useState<VehicleDocument['document_type']>('document')
  const [documentLabel,setDocumentLabel]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const selected=vehicles.find(vehicle=>vehicle.id===selectedId)??vehicles[0]??null
  const selectedEvents=events.filter(event=>event.vehicle_id===selected?.id)
  const selectedTyres=tyres.filter(tyre=>tyre.vehicle_id===selected?.id)
  const selectedDocuments=documents.filter(doc=>doc.vehicle_id===selected?.id)
  const fileById=useMemo(()=>new Map(files.map(file=>[file.id,file])),[files])
  const upcoming=useMemo(()=>selectedEvents.filter(event=>event.due_date&&!event.completed_date).sort((a,b)=>(a.due_date??'').localeCompare(b.due_date??'')),[selectedEvents])
  const totalCosts=selectedEvents.reduce((sum,event)=>sum+Number(event.cost_amount??0),0)

  async function load(foreground=false){
    if(foreground)setLoading(true)
    setError('')
    const [vehicleResult,eventResult,tyreResult,fileResult,docResult]=await Promise.all([
      supabase.from('family_vehicles').select('id,name,make,model,registration_plate,vin,model_year,fuel_type,odometer_km,notes,active,created_at').eq('household_id',household.id).eq('active',true).order('name'),
      supabase.from('vehicle_events').select('id,vehicle_id,event_type,title,due_date,completed_date,odometer_km,provider,cost_amount,currency,notes,calendar_event_id,created_at').eq('household_id',household.id).order('due_date',{ascending:true}),
      supabase.from('vehicle_tyres').select('id,vehicle_id,season,brand,tyre_size,installed_date,tread_depth_mm,storage_location,notes,active').eq('household_id',household.id).eq('active',true),
      supabase.from('household_files').select('id,title,file_name,storage_path').eq('household_id',household.id).eq('status','active').is('archived_at',null).order('created_at',{ascending:false}),
      supabase.from('vehicle_documents').select('id,vehicle_id,file_id,document_type,label,created_at').eq('household_id',household.id).order('created_at',{ascending:false}),
    ])
    const failure=vehicleResult.error||eventResult.error||tyreResult.error||fileResult.error||docResult.error
    if(failure)setError(failure.message)
    const vehicleRows=(vehicleResult.data??[]) as Vehicle[]
    const fileRows=(fileResult.data??[]) as HouseholdFile[]
    setVehicles(vehicleRows)
    setEvents(((eventResult.data??[]) as VehicleEvent[]).map(row=>({...row,cost_amount:row.cost_amount==null?null:Number(row.cost_amount),odometer_km:row.odometer_km==null?null:Number(row.odometer_km)})))
    setTyres(((tyreResult.data??[]) as Tyre[]).map(row=>({...row,tread_depth_mm:row.tread_depth_mm==null?null:Number(row.tread_depth_mm)})))
    setFiles(fileRows)
    setDocuments((docResult.data??[]) as VehicleDocument[])
    setSelectedId(current=>vehicleRows.some(row=>row.id===current)?current:(vehicleRows[0]?.id??''))
    const signed=await Promise.all(fileRows.map(async file=>{
      const result=await supabase.storage.from('famioo-files').createSignedUrl(file.storage_path,3600)
      return [file.id,result.data?.signedUrl??''] as const
    }))
    setFileUrls(Object.fromEntries(signed))
    if(foreground)setLoading(false)
  }
  useEffect(()=>{void load(true)},[household.id])

  function openVehicle(vehicle?:Vehicle){
    setVehicleDraft(vehicle?{
      id:vehicle.id,name:vehicle.name,make:vehicle.make??'',model:vehicle.model??'',
      registration_plate:vehicle.registration_plate??'',vin:vehicle.vin??'',
      model_year:vehicle.model_year?String(vehicle.model_year):'',fuel_type:vehicle.fuel_type??'',
      odometer_km:String(vehicle.odometer_km??0),notes:vehicle.notes??'',
    }:{...emptyVehicle})
    setVehicleEditor(true);setError('');setMessage('')
  }
  async function saveVehicle(event:FormEvent){
    event.preventDefault()
    const odometer=Math.max(0,Math.round(Number(vehicleDraft.odometer_km)||0))
    const year=vehicleDraft.model_year?Math.round(Number(vehicleDraft.model_year)):null
    setSaving(true);setError('')
    const result=await supabase.rpc('save_family_vehicle_v1',{
      p_id:vehicleDraft.id||null,p_household_id:household.id,p_name:vehicleDraft.name.trim(),
      p_make:vehicleDraft.make.trim()||null,p_model:vehicleDraft.model.trim()||null,
      p_registration_plate:vehicleDraft.registration_plate.trim()||null,p_vin:vehicleDraft.vin.trim()||null,
      p_model_year:year,p_fuel_type:vehicleDraft.fuel_type.trim()||null,p_odometer_km:odometer,p_notes:vehicleDraft.notes.trim()||null,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setSelectedId(String(result.data));setVehicleEditor(false);setMessage(vehicleDraft.id?'Vehicle updated.':'Vehicle added.')
    await load(false)
  }
  async function archiveVehicle(vehicle:Vehicle){
    if(!window.confirm('Archive '+vehicle.name+'?'))return
    const result=await supabase.from('family_vehicles').update({active:false,updated_at:new Date().toISOString()}).eq('id',vehicle.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  function openEvent(item?:VehicleEvent,type:VehicleEvent['event_type']='service'){
    setEventDraft(item?{
      id:item.id,event_type:item.event_type,title:item.title,due_date:item.due_date??'',completed_date:item.completed_date??'',
      odometer_km:item.odometer_km==null?'':String(item.odometer_km),provider:item.provider??'',
      cost_amount:item.cost_amount==null?'':String(item.cost_amount),notes:item.notes??'',sync_calendar:Boolean(item.calendar_event_id),
    }:{...emptyEvent,event_type:type,title:type==='tuv'?'TÜV / inspection':type==='insurance'?'Insurance renewal':type==='tyre_change'?'Tyre change':''})
    setEventEditor(true);setError('');setMessage('')
  }
  async function saveEvent(event:FormEvent){
    event.preventDefault()
    if(!selected)return
    setSaving(true);setError('')
    const result=await supabase.rpc('save_vehicle_event_v1',{
      p_id:eventDraft.id||null,p_household_id:household.id,p_vehicle_id:selected.id,p_event_type:eventDraft.event_type,
      p_title:eventDraft.title.trim(),p_due_date:eventDraft.due_date||null,p_completed_date:eventDraft.completed_date||null,
      p_odometer_km:eventDraft.odometer_km?Math.round(Number(eventDraft.odometer_km)):null,
      p_provider:eventDraft.provider.trim()||null,p_cost_amount:eventDraft.cost_amount?Number(eventDraft.cost_amount):null,
      p_currency:'EUR',p_notes:eventDraft.notes.trim()||null,p_sync_calendar:eventDraft.sync_calendar,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setEventEditor(false);setMessage(eventDraft.id?'Vehicle record updated.':'Vehicle record added.')
    await load(false)
  }
  async function deleteEvent(item:VehicleEvent){
    if(!window.confirm('Delete '+item.title+'?'))return
    const result=await supabase.from('vehicle_events').delete().eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  function openTyre(item?:Tyre){
    setTyreDraft(item?{id:item.id,season:item.season,brand:item.brand??'',tyre_size:item.tyre_size??'',installed_date:item.installed_date??'',tread_depth_mm:item.tread_depth_mm==null?'':String(item.tread_depth_mm),storage_location:item.storage_location??'',notes:item.notes??''}:{...emptyTyre})
    setTyreEditor(true)
  }
  async function saveTyre(event:FormEvent){
    event.preventDefault()
    if(!selected)return
    setSaving(true);setError('')
    const payload={
      household_id:household.id,vehicle_id:selected.id,season:tyreDraft.season,brand:tyreDraft.brand.trim()||null,
      tyre_size:tyreDraft.tyre_size.trim()||null,installed_date:tyreDraft.installed_date||null,
      tread_depth_mm:tyreDraft.tread_depth_mm?Number(tyreDraft.tread_depth_mm):null,
      storage_location:tyreDraft.storage_location.trim()||null,notes:tyreDraft.notes.trim()||null,updated_at:new Date().toISOString(),
    }
    const result=tyreDraft.id
      ?await supabase.from('vehicle_tyres').update(payload).eq('id',tyreDraft.id).eq('household_id',household.id)
      :await supabase.from('vehicle_tyres').insert({...payload,created_by_user_id:user.id})
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setTyreEditor(false);setMessage(tyreDraft.id?'Tyre set updated.':'Tyre set added.')
    await load(false)
  }
  async function archiveTyre(item:Tyre){
    const result=await supabase.from('vehicle_tyres').update({active:false,updated_at:new Date().toISOString()}).eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  async function linkDocument(event:FormEvent){
    event.preventDefault()
    if(!selected||!documentFileId)return
    const result=await supabase.from('vehicle_documents').insert({
      household_id:household.id,vehicle_id:selected.id,file_id:documentFileId,document_type:documentType,
      label:documentLabel.trim()||null,created_by_user_id:user.id,
    })
    if(result.error){setError(result.error.message);return}
    setDocumentFileId('');setDocumentLabel('');setDocumentType('document');setMessage('Document linked to vehicle.')
    await load(false)
  }
  async function unlinkDocument(doc:VehicleDocument){
    const result=await supabase.from('vehicle_documents').delete().eq('id',doc.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  if(loading)return <div className="page vehicles-page"><div className="vehicles-empty">Loading vehicles…</div></div>

  return <div className="page vehicles-page">
    <div className="page-heading-row vehicles-heading">
      <div><span className="eyebrow">VEHICLES</span><h1>Family vehicles</h1><p>Keep service, insurance, TÜV, tyres, costs, documents and reminders together.</p></div>
      {canWrite&&<button className="primary-button compact" onClick={()=>openVehicle()}><Plus size={15}/>Add vehicle</button>}
    </div>
    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    {vehicles.length===0?<div className="vehicles-empty"><CarFront size={34}/><strong>No family vehicles yet.</strong><span>Add a car, van, motorcycle or other vehicle to start tracking maintenance.</span>{canWrite&&<button className="primary-button compact" onClick={()=>openVehicle()}><Plus size={14}/>Add first vehicle</button>}</div>:<>
      <section className="vehicles-strip">{vehicles.map(vehicle=><button className={selected?.id===vehicle.id?'vehicle-chip active':'vehicle-chip'} onClick={()=>setSelectedId(vehicle.id)} key={vehicle.id}><CarFront size={17}/><span><strong>{vehicle.name}</strong><small>{[vehicle.make,vehicle.model,vehicle.registration_plate].filter(Boolean).join(' · ')||'Vehicle'}</small></span></button>)}</section>
      {selected&&<>
        <section className="vehicle-hero">
          <div className="vehicle-hero-icon"><CarFront size={28}/></div>
          <div><span className="eyebrow">{selected.registration_plate||'FAMILY VEHICLE'}</span><h2>{selected.name}</h2><p>{[selected.make,selected.model,selected.model_year].filter(Boolean).join(' ')||'No model details yet'}</p><small><Gauge size={13}/>{selected.odometer_km.toLocaleString()} km{selected.fuel_type?' · '+selected.fuel_type:''}</small></div>
          <div className="vehicle-hero-actions">{canWrite&&<button className="secondary-button compact" onClick={()=>openVehicle(selected)}>Edit</button>}{canWrite&&<button className="icon-button" title="Archive vehicle" onClick={()=>void archiveVehicle(selected)}><Archive size={15}/></button>}</div>
        </section>
        <nav className="projects-tabs vehicles-tabs">
          <button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Overview</button>
          <button className={tab==='maintenance'?'active':''} onClick={()=>setTab('maintenance')}>Service & reminders <span>{selectedEvents.length}</span></button>
          <button className={tab==='tyres'?'active':''} onClick={()=>setTab('tyres')}>Tyres <span>{selectedTyres.length}</span></button>
          <button className={tab==='documents'?'active':''} onClick={()=>setTab('documents')}>Documents <span>{selectedDocuments.length}</span></button>
        </nav>

        {tab==='overview'&&<section className="vehicle-overview-grid">
          <article className="vehicle-summary-card"><ShieldCheck size={18}/><span><small>NEXT DUE</small><strong>{upcoming[0]?upcoming[0].title:'Nothing scheduled'}</strong><em>{upcoming[0]?fmtDate(upcoming[0].due_date):'Add insurance, TÜV or service'}</em></span><button onClick={()=>{setTab('maintenance');openEvent(undefined,'insurance')}}>Add</button></article>
          <article className="vehicle-summary-card"><Wrench size={18}/><span><small>SERVICE RECORDS</small><strong>{selectedEvents.filter(e=>['service','maintenance'].includes(e.event_type)).length}</strong><em>service / maintenance items</em></span><button onClick={()=>{setTab('maintenance');openEvent(undefined,'service')}}>Add</button></article>
          <article className="vehicle-summary-card"><CircleDollarSign size={18}/><span><small>RECORDED COSTS</small><strong>{money(totalCosts)}</strong><em>also mirrored to Household Costs</em></span><button onClick={()=>setTab('maintenance')}>Open</button></article>
          <article className="vehicle-summary-card"><FileText size={18}/><span><small>DOCUMENTS</small><strong>{selectedDocuments.length}</strong><em>linked from Famioo Files</em></span><button onClick={()=>setTab('documents')}>Open</button></article>
          {upcoming.length>0&&<div className="vehicle-reminders"><span className="eyebrow">UPCOMING</span>{upcoming.slice(0,5).map(item=>{const days=daysUntil(item.due_date);return <div key={item.id}><span><strong>{item.title}</strong><small>{eventLabel(item.event_type)} · {fmtDate(item.due_date)}</small></span><b className={days!=null&&days<0?'overdue':days!=null&&days<=30?'soon':''}>{days==null?'':days<0?Math.abs(days)+'d overdue':days===0?'Today':days+'d'}</b></div>})}</div>}
          {selected.notes&&<div className="vehicle-notes"><span className="eyebrow">NOTES</span><p>{selected.notes}</p></div>}
        </section>}

        {tab==='maintenance'&&<section className="vehicle-section">
          <div className="vehicle-section-head"><div><span className="eyebrow">SERVICE & REMINDERS</span><h2>Insurance, TÜV, service & maintenance</h2><p>Due dates can be synced into Calendar; completed costs flow into Household Costs.</p></div>{canWrite&&<button className="primary-button compact" onClick={()=>openEvent()}><Plus size={14}/>Add record</button>}</div>
          {selectedEvents.length===0?<div className="vehicles-empty compact"><Wrench size={24}/><strong>No vehicle records yet.</strong></div>:<div className="vehicle-event-list">{selectedEvents.map(item=><article className="vehicle-event-row" key={item.id}>
            <span className={'vehicle-event-icon '+item.event_type}>{item.event_type==='insurance'?<ShieldCheck size={16}/>:item.event_type==='tuv'?<CalendarDays size={16}/>:<Wrench size={16}/>}</span>
            <div><small>{eventLabel(item.event_type).toUpperCase()}</small><strong>{item.title}</strong><span>{item.completed_date?'Completed '+fmtDate(item.completed_date):item.due_date?'Due '+fmtDate(item.due_date):'No date'}{item.provider?' · '+item.provider:''}</span>{item.odometer_km!=null&&<em>{item.odometer_km.toLocaleString()} km</em>}{item.notes&&<p>{item.notes}</p>}</div>
            <b>{money(item.cost_amount,item.currency)}</b>
            {canWrite&&<div className="vehicle-row-actions"><button onClick={()=>openEvent(item)}>Edit</button><button onClick={()=>void deleteEvent(item)}><Trash2 size={13}/></button></div>}
          </article>)}</div>}
        </section>}

        {tab==='tyres'&&<section className="vehicle-section">
          <div className="vehicle-section-head"><div><span className="eyebrow">TYRES</span><h2>Tyre sets & storage</h2></div>{canWrite&&<button className="primary-button compact" onClick={()=>openTyre()}><Plus size={14}/>Add tyre set</button>}</div>
          {selectedTyres.length===0?<div className="vehicles-empty compact"><strong>No tyre sets saved.</strong></div>:<div className="vehicle-tyre-grid">{selectedTyres.map(item=><article className="vehicle-tyre-card" key={item.id}><span>{item.season==='winter'?'❄️':item.season==='summer'?'☀️':'🌦️'}</span><div><small>{item.season.replace('_',' ').toUpperCase()}</small><strong>{[item.brand,item.tyre_size].filter(Boolean).join(' · ')||'Tyre set'}</strong><em>{item.installed_date?'Installed '+fmtDate(item.installed_date):'Installation date not set'}</em>{item.tread_depth_mm!=null&&<p>Tread: {item.tread_depth_mm} mm</p>}{item.storage_location&&<p>Storage: {item.storage_location}</p>}{item.notes&&<p>{item.notes}</p>}</div>{canWrite&&<footer><button onClick={()=>openTyre(item)}>Edit</button><button onClick={()=>void archiveTyre(item)}>Archive</button></footer>}</article>)}</div>}
        </section>}

        {tab==='documents'&&<section className="vehicle-section">
          <div className="vehicle-section-head"><div><span className="eyebrow">DOCUMENTS</span><h2>Registration, insurance & invoices</h2><p>Upload documents in Famioo Files, then link them to this vehicle.</p></div></div>
          {canWrite&&<form className="vehicle-document-linker" onSubmit={linkDocument}><select value={documentType} onChange={e=>setDocumentType(e.target.value as VehicleDocument['document_type'])}><option value="registration">Registration</option><option value="insurance">Insurance</option><option value="inspection">Inspection / TÜV</option><option value="service">Service</option><option value="invoice">Invoice</option><option value="document">Document</option></select><select value={documentFileId} onChange={e=>setDocumentFileId(e.target.value)} required><option value="">Choose file…</option>{files.map(file=><option key={file.id} value={file.id}>{file.title}</option>)}</select><input value={documentLabel} onChange={e=>setDocumentLabel(e.target.value)} placeholder="Optional label"/><button className="primary-button compact"><Plus size={13}/>Link</button></form>}
          {selectedDocuments.length===0?<div className="vehicles-empty compact"><FileText size={24}/><strong>No documents linked.</strong></div>:<div className="vehicle-document-list">{selectedDocuments.map(doc=>{const file=fileById.get(doc.file_id);if(!file)return null;return <article className="vehicle-document-row" key={doc.id}><span><FileText size={17}/></span><div><small>{doc.document_type.toUpperCase()}</small><strong>{doc.label||file.title}</strong><em>{file.file_name}</em></div><div>{fileUrls[file.id]&&<a className="secondary-button compact" href={fileUrls[file.id]} target="_blank" rel="noreferrer">Open</a>}{canWrite&&<button className="icon-button" onClick={()=>void unlinkDocument(doc)}><X size={14}/></button>}</div></article>})}</div>}
        </section>}
      </>}
    </>}

    {vehicleEditor&&<div className="modal-backdrop vehicle-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card vehicle-editor"><header><div><span className="eyebrow">{vehicleDraft.id?'EDIT VEHICLE':'NEW VEHICLE'}</span><h2>{vehicleDraft.id?'Update vehicle':'Add family vehicle'}</h2></div><button className="icon-button" onClick={()=>setVehicleEditor(false)}><X size={18}/></button></header><form onSubmit={saveVehicle}>
      <label><span>Name *</span><input required maxLength={120} value={vehicleDraft.name} onChange={e=>setVehicleDraft(v=>({...v,name:e.target.value}))} placeholder="e.g. Family car"/></label>
      <div className="vehicle-editor-row"><label><span>Make</span><input value={vehicleDraft.make} onChange={e=>setVehicleDraft(v=>({...v,make:e.target.value}))}/></label><label><span>Model</span><input value={vehicleDraft.model} onChange={e=>setVehicleDraft(v=>({...v,model:e.target.value}))}/></label></div>
      <div className="vehicle-editor-row"><label><span>Registration plate</span><input value={vehicleDraft.registration_plate} onChange={e=>setVehicleDraft(v=>({...v,registration_plate:e.target.value}))}/></label><label><span>Model year</span><input type="number" min="1900" max="2200" value={vehicleDraft.model_year} onChange={e=>setVehicleDraft(v=>({...v,model_year:e.target.value}))}/></label></div>
      <div className="vehicle-editor-row"><label><span>Fuel / drive</span><input value={vehicleDraft.fuel_type} onChange={e=>setVehicleDraft(v=>({...v,fuel_type:e.target.value}))} placeholder="Petrol, diesel, EV…"/></label><label><span>Odometer km</span><input type="number" min="0" value={vehicleDraft.odometer_km} onChange={e=>setVehicleDraft(v=>({...v,odometer_km:e.target.value}))}/></label></div>
      <label><span>VIN</span><input value={vehicleDraft.vin} onChange={e=>setVehicleDraft(v=>({...v,vin:e.target.value}))}/></label>
      <label><span>Notes</span><textarea rows={3} value={vehicleDraft.notes} onChange={e=>setVehicleDraft(v=>({...v,notes:e.target.value}))}/></label>
      <footer><button type="button" className="secondary-button" onClick={()=>setVehicleEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save vehicle'}</button></footer>
    </form></section></div>}

    {eventEditor&&selected&&<div className="modal-backdrop vehicle-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card vehicle-editor"><header><div><span className="eyebrow">{eventDraft.id?'EDIT RECORD':'NEW RECORD'}</span><h2>Service & reminder</h2></div><button className="icon-button" onClick={()=>setEventEditor(false)}><X size={18}/></button></header><form onSubmit={saveEvent}>
      <label><span>Type</span><select value={eventDraft.event_type} onChange={e=>setEventDraft(v=>({...v,event_type:e.target.value as VehicleEvent['event_type']}))}><option value="insurance">Insurance</option><option value="tuv">TÜV / inspection</option><option value="service">Service</option><option value="maintenance">Maintenance</option><option value="tyre_change">Tyre change</option><option value="registration">Registration</option><option value="other">Other</option></select></label>
      <label><span>Title *</span><input required value={eventDraft.title} onChange={e=>setEventDraft(v=>({...v,title:e.target.value}))}/></label>
      <div className="vehicle-editor-row"><label><span>Due date</span><input type="date" value={eventDraft.due_date} onChange={e=>setEventDraft(v=>({...v,due_date:e.target.value}))}/></label><label><span>Completed</span><input type="date" value={eventDraft.completed_date} onChange={e=>setEventDraft(v=>({...v,completed_date:e.target.value}))}/></label></div>
      <div className="vehicle-editor-row"><label><span>Odometer km</span><input type="number" min="0" value={eventDraft.odometer_km} onChange={e=>setEventDraft(v=>({...v,odometer_km:e.target.value}))}/></label><label><span>Cost (€)</span><input type="number" min="0" step="0.01" value={eventDraft.cost_amount} onChange={e=>setEventDraft(v=>({...v,cost_amount:e.target.value}))}/></label></div>
      <label><span>Provider / workshop</span><input value={eventDraft.provider} onChange={e=>setEventDraft(v=>({...v,provider:e.target.value}))}/></label>
      <label><span>Notes</span><textarea rows={3} value={eventDraft.notes} onChange={e=>setEventDraft(v=>({...v,notes:e.target.value}))}/></label>
      <label className="vehicle-sync-setting"><input type="checkbox" checked={eventDraft.sync_calendar} onChange={e=>setEventDraft(v=>({...v,sync_calendar:e.target.checked}))}/><span><CalendarDays size={14}/>Sync due date to Calendar</span></label>
      <footer><button type="button" className="secondary-button" onClick={()=>setEventEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save record'}</button></footer>
    </form></section></div>}

    {tyreEditor&&selected&&<div className="modal-backdrop vehicle-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card vehicle-editor"><header><div><span className="eyebrow">{tyreDraft.id?'EDIT TYRES':'NEW TYRE SET'}</span><h2>Tyre set</h2></div><button className="icon-button" onClick={()=>setTyreEditor(false)}><X size={18}/></button></header><form onSubmit={saveTyre}>
      <label><span>Season</span><select value={tyreDraft.season} onChange={e=>setTyreDraft(v=>({...v,season:e.target.value as Tyre['season']}))}><option value="summer">Summer</option><option value="winter">Winter</option><option value="all_season">All-season</option></select></label>
      <div className="vehicle-editor-row"><label><span>Brand</span><input value={tyreDraft.brand} onChange={e=>setTyreDraft(v=>({...v,brand:e.target.value}))}/></label><label><span>Size</span><input value={tyreDraft.tyre_size} onChange={e=>setTyreDraft(v=>({...v,tyre_size:e.target.value}))} placeholder="205/55 R16"/></label></div>
      <div className="vehicle-editor-row"><label><span>Installed</span><input type="date" value={tyreDraft.installed_date} onChange={e=>setTyreDraft(v=>({...v,installed_date:e.target.value}))}/></label><label><span>Tread depth mm</span><input type="number" min="0" step="0.1" value={tyreDraft.tread_depth_mm} onChange={e=>setTyreDraft(v=>({...v,tread_depth_mm:e.target.value}))}/></label></div>
      <label><span>Storage location</span><input value={tyreDraft.storage_location} onChange={e=>setTyreDraft(v=>({...v,storage_location:e.target.value}))}/></label>
      <label><span>Notes</span><textarea rows={3} value={tyreDraft.notes} onChange={e=>setTyreDraft(v=>({...v,notes:e.target.value}))}/></label>
      <footer><button type="button" className="secondary-button" onClick={()=>setTyreEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save tyres'}</button></footer>
    </form></section></div>}
  </div>
}
