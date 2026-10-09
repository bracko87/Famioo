import {
  CalendarDays,
  Check,
  FileText,
  HeartPulse,
  ImagePlus,
  PawPrint,
  Pill,
  Plus,
  ShieldCheck,
  Stethoscope,
  Syringe,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type Pet={
  id:string
  name:string
  species:string
  breed:string|null
  sex:'female'|'male'|'unknown'|null
  birth_date:string|null
  chip_number:string|null
  weight_kg:number|null
  color_markings:string|null
  notes:string|null
  photo_path:string|null
  active:boolean
}
type HealthEvent={
  id:string
  pet_id:string
  event_type:'vet'|'vaccination'|'medication'|'insurance'|'other'
  title:string
  due_date:string|null
  completed_date:string|null
  provider:string|null
  medication_name:string|null
  dosage:string|null
  recurring_every_days:number|null
  cost_amount:number|null
  currency:string
  notes:string|null
  calendar_event_id:string|null
}
type CareRoutine={
  id:string
  pet_id:string
  title:string
  frequency_days:number
  next_due_date:string
  last_completed_date:string|null
  notes:string|null
  active:boolean
}
type InsurancePolicy={
  id:string
  pet_id:string
  provider:string
  policy_number:string|null
  valid_from:string|null
  valid_until:string|null
  notes:string|null
  active:boolean
}
type HouseholdFile={id:string;title:string;file_name:string;storage_path:string}
type PetDocument={
  id:string
  pet_id:string
  file_id:string
  document_type:'vaccination'|'insurance'|'vet'|'prescription'|'registration'|'document'
  label:string|null
}
type PetDraft={
  id:string
  name:string
  species:string
  breed:string
  sex:'female'|'male'|'unknown'
  birth_date:string
  chip_number:string
  weight_kg:string
  color_markings:string
  notes:string
}
type HealthDraft={
  id:string
  event_type:HealthEvent['event_type']
  title:string
  due_date:string
  completed_date:string
  provider:string
  medication_name:string
  dosage:string
  recurring_every_days:string
  cost_amount:string
  notes:string
  sync_calendar:boolean
}
type CareDraft={id:string;title:string;frequency_days:string;next_due_date:string;notes:string}
type InsuranceDraft={id:string;provider:string;policy_number:string;valid_from:string;valid_until:string;notes:string}

const emptyPet:PetDraft={id:'',name:'',species:'Dog',breed:'',sex:'unknown',birth_date:'',chip_number:'',weight_kg:'',color_markings:'',notes:''}
const emptyHealth:HealthDraft={id:'',event_type:'vet',title:'',due_date:'',completed_date:'',provider:'',medication_name:'',dosage:'',recurring_every_days:'',cost_amount:'',notes:'',sync_calendar:true}
const emptyCare:CareDraft={id:'',title:'',frequency_days:'7',next_due_date:'',notes:''}
const emptyInsurance:InsuranceDraft={id:'',provider:'',policy_number:'',valid_from:'',valid_until:'',notes:''}

function fmtDate(value:string|null){
  if(!value)return 'Not set'
  return new Date(value+'T12:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})
}
function money(value:number|null,currency='EUR'){
  if(value==null)return '—'
  return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(value)
}
function daysUntil(value:string|null){
  if(!value)return null
  const today=new Date();today.setHours(12,0,0,0)
  return Math.ceil((new Date(value+'T12:00:00').getTime()-today.getTime())/86400000)
}
function healthIcon(type:HealthEvent['event_type']){
  if(type==='vaccination')return <Syringe size={16}/>
  if(type==='medication')return <Pill size={16}/>
  if(type==='insurance')return <ShieldCheck size={16}/>
  return <Stethoscope size={16}/>
}

export function PetsPage(){
  const {household,modules,user}=useHousehold()
  const canWrite=Boolean(modules.find(module=>module.code==='pets')?.can_write)
  const [pets,setPets]=useState<Pet[]>([])
  const [health,setHealth]=useState<HealthEvent[]>([])
  const [care,setCare]=useState<CareRoutine[]>([])
  const [insurance,setInsurance]=useState<InsurancePolicy[]>([])
  const [files,setFiles]=useState<HouseholdFile[]>([])
  const [documents,setDocuments]=useState<PetDocument[]>([])
  const [fileUrls,setFileUrls]=useState<Record<string,string>>({})
  const [selectedId,setSelectedId]=useState('')
  const [tab,setTab]=useState<'overview'|'health'|'care'|'insurance'|'documents'>('overview')
  const [petEditor,setPetEditor]=useState(false)
  const [petDraft,setPetDraft]=useState<PetDraft>(emptyPet)
  const [healthEditor,setHealthEditor]=useState(false)
  const [healthDraft,setHealthDraft]=useState<HealthDraft>(emptyHealth)
  const [careEditor,setCareEditor]=useState(false)
  const [careDraft,setCareDraft]=useState<CareDraft>(emptyCare)
  const [insuranceEditor,setInsuranceEditor]=useState(false)
  const [insuranceDraft,setInsuranceDraft]=useState<InsuranceDraft>(emptyInsurance)
  const [documentFileId,setDocumentFileId]=useState('')
  const [documentType,setDocumentType]=useState<PetDocument['document_type']>('document')
  const [documentLabel,setDocumentLabel]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [petPhotoFile,setPetPhotoFile]=useState<File|null>(null)
  const [petPhotoPreview,setPetPhotoPreview]=useState('')
  const [petPhotoUrls,setPetPhotoUrls]=useState<Record<string,string>>({})

  const selected=pets.find(pet=>pet.id===selectedId)??pets[0]??null
  const selectedHealth=health.filter(item=>item.pet_id===selected?.id)
  const selectedCare=care.filter(item=>item.pet_id===selected?.id)
  const selectedInsurance=insurance.filter(item=>item.pet_id===selected?.id)
  const selectedDocuments=documents.filter(item=>item.pet_id===selected?.id)
  const fileById=useMemo(()=>new Map(files.map(file=>[file.id,file])),[files])
  const upcomingHealth=useMemo(
    ()=>selectedHealth.filter(item=>item.due_date&&!item.completed_date).sort((a,b)=>(a.due_date??'').localeCompare(b.due_date??'')),
    [selectedHealth],
  )
  const totalCosts=selectedHealth.reduce((sum,item)=>sum+Number(item.cost_amount??0),0)

  async function load(foreground=false){
    if(foreground)setLoading(true)
    setError('')
    const [petResult,healthResult,careResult,insuranceResult,fileResult,docResult]=await Promise.all([
      supabase.from('family_pets').select('id,name,species,breed,sex,birth_date,chip_number,weight_kg,color_markings,notes,photo_path,active').eq('household_id',household.id).eq('active',true).order('name'),
      supabase.from('pet_health_events').select('id,pet_id,event_type,title,due_date,completed_date,provider,medication_name,dosage,recurring_every_days,cost_amount,currency,notes,calendar_event_id').eq('household_id',household.id).order('due_date',{ascending:true}),
      supabase.from('pet_care_routines').select('id,pet_id,title,frequency_days,next_due_date,last_completed_date,notes,active').eq('household_id',household.id).eq('active',true).order('next_due_date'),
      supabase.from('pet_insurance_policies').select('id,pet_id,provider,policy_number,valid_from,valid_until,notes,active').eq('household_id',household.id).eq('active',true).order('valid_until',{ascending:true}),
      supabase.from('household_files').select('id,title,file_name,storage_path').eq('household_id',household.id).eq('status','active').is('archived_at',null).order('created_at',{ascending:false}),
      supabase.from('pet_documents').select('id,pet_id,file_id,document_type,label').eq('household_id',household.id),
    ])
    const failure=petResult.error||healthResult.error||careResult.error||insuranceResult.error||fileResult.error||docResult.error
    if(failure)setError(failure.message)
    const petRows=((petResult.data??[]) as Pet[]).map(row=>({...row,weight_kg:row.weight_kg==null?null:Number(row.weight_kg)}))
    const fileRows=(fileResult.data??[]) as HouseholdFile[]
    setPets(petRows)
    setHealth(((healthResult.data??[]) as HealthEvent[]).map(row=>({...row,cost_amount:row.cost_amount==null?null:Number(row.cost_amount),recurring_every_days:row.recurring_every_days==null?null:Number(row.recurring_every_days)})))
    setCare(((careResult.data??[]) as CareRoutine[]).map(row=>({...row,frequency_days:Number(row.frequency_days)})))
    setInsurance((insuranceResult.data??[]) as InsurancePolicy[])
    setFiles(fileRows)
    setDocuments((docResult.data??[]) as PetDocument[])
    setSelectedId(current=>petRows.some(row=>row.id===current)?current:(petRows[0]?.id??''))
    const signed=await Promise.all(fileRows.map(async file=>{
      const result=await supabase.storage.from('famioo-files').createSignedUrl(file.storage_path,3600)
      return [file.id,result.data?.signedUrl??''] as const
    }))
    setFileUrls(Object.fromEntries(signed))
    const petPhotos=await Promise.all(petRows.filter(pet=>pet.photo_path).map(async pet=>{
      const result=await supabase.storage.from('pet-media').createSignedUrl(String(pet.photo_path),3600)
      return [pet.id,result.data?.signedUrl??''] as const
    }))
    setPetPhotoUrls(Object.fromEntries(petPhotos))
    if(foreground)setLoading(false)
  }
  useEffect(()=>{void load(true)},[household.id])

  function openPet(pet?:Pet){
    if(petPhotoPreview.startsWith('blob:'))URL.revokeObjectURL(petPhotoPreview)
    setPetPhotoFile(null)
    setPetPhotoPreview(pet?petPhotoUrls[pet.id]??'':'')
    setPetDraft(pet?{
      id:pet.id,name:pet.name,species:pet.species,breed:pet.breed??'',sex:pet.sex??'unknown',
      birth_date:pet.birth_date??'',chip_number:pet.chip_number??'',weight_kg:pet.weight_kg==null?'':String(pet.weight_kg),
      color_markings:pet.color_markings??'',notes:pet.notes??'',
    }:{...emptyPet})
    setPetEditor(true);setError('');setMessage('')
  }

  function choosePetPhoto(file:File|null){
    if(!file)return
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      setError('Pet photo must be JPG, PNG or WebP.')
      return
    }
    if(file.size>5*1024*1024){
      setError('Pet photo can be up to 5 MB.')
      return
    }
    if(petPhotoPreview.startsWith('blob:'))URL.revokeObjectURL(petPhotoPreview)
    setPetPhotoFile(file)
    setPetPhotoPreview(URL.createObjectURL(file))
    setError('')
  }
  async function savePet(event:FormEvent){
    event.preventDefault()
    setSaving(true);setError('')
    const result=await supabase.rpc('save_family_pet_v1',{
      p_id:petDraft.id||null,p_household_id:household.id,p_name:petDraft.name.trim(),p_species:petDraft.species.trim(),
      p_breed:petDraft.breed.trim()||null,p_sex:petDraft.sex,p_birth_date:petDraft.birth_date||null,
      p_chip_number:petDraft.chip_number.trim()||null,p_weight_kg:petDraft.weight_kg?Number(petDraft.weight_kg):null,
      p_color_markings:petDraft.color_markings.trim()||null,p_notes:petDraft.notes.trim()||null,
    })
    if(result.error){setSaving(false);setError(result.error.message);return}

    const petId=String(result.data)
    if(petPhotoFile){
      const previousPath=pets.find(pet=>pet.id===petDraft.id)?.photo_path??null
      const extension=petPhotoFile.type==='image/png'?'png':petPhotoFile.type==='image/webp'?'webp':'jpg'
      const path=`${household.id}/${petId}/${crypto.randomUUID()}.${extension}`
      const upload=await supabase.storage.from('pet-media').upload(path,petPhotoFile,{
        contentType:petPhotoFile.type,
        upsert:false,
      })
      if(upload.error){setSaving(false);setError(upload.error.message);return}

      const update=await supabase.from('family_pets')
        .update({photo_path:path,updated_at:new Date().toISOString()})
        .eq('id',petId).eq('household_id',household.id)
      if(update.error){
        await supabase.storage.from('pet-media').remove([path])
        setSaving(false);setError(update.error.message);return
      }
      if(previousPath&&previousPath!==path)await supabase.storage.from('pet-media').remove([previousPath])
    }

    setSaving(false)
    if(petPhotoPreview.startsWith('blob:'))URL.revokeObjectURL(petPhotoPreview)
    setPetPhotoFile(null);setPetPhotoPreview('')
    setSelectedId(petId);setPetEditor(false);setMessage(petDraft.id?'Pet updated.':'Pet added.')
    await load(false)
  }
  async function archivePet(pet:Pet){
    if(!window.confirm('Archive '+pet.name+'?'))return
    const result=await supabase.from('family_pets').update({active:false,updated_at:new Date().toISOString()}).eq('id',pet.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  function openHealth(item?:HealthEvent,type:HealthEvent['event_type']='vet'){
    setHealthDraft(item?{
      id:item.id,event_type:item.event_type,title:item.title,due_date:item.due_date??'',completed_date:item.completed_date??'',
      provider:item.provider??'',medication_name:item.medication_name??'',dosage:item.dosage??'',
      recurring_every_days:item.recurring_every_days==null?'':String(item.recurring_every_days),
      cost_amount:item.cost_amount==null?'':String(item.cost_amount),notes:item.notes??'',sync_calendar:Boolean(item.calendar_event_id),
    }:{...emptyHealth,event_type:type,title:type==='vaccination'?'Vaccination':type==='medication'?'Medication':type==='insurance'?'Insurance renewal':'Vet appointment'})
    setHealthEditor(true);setError('');setMessage('')
  }
  async function saveHealth(event:FormEvent){
    event.preventDefault()
    if(!selected)return
    setSaving(true);setError('')
    const result=await supabase.rpc('save_pet_health_event_v1',{
      p_id:healthDraft.id||null,p_household_id:household.id,p_pet_id:selected.id,p_event_type:healthDraft.event_type,
      p_title:healthDraft.title.trim(),p_due_date:healthDraft.due_date||null,p_completed_date:healthDraft.completed_date||null,
      p_provider:healthDraft.provider.trim()||null,p_medication_name:healthDraft.medication_name.trim()||null,
      p_dosage:healthDraft.dosage.trim()||null,p_recurring_every_days:healthDraft.recurring_every_days?Math.round(Number(healthDraft.recurring_every_days)):null,
      p_cost_amount:healthDraft.cost_amount?Number(healthDraft.cost_amount):null,p_currency:'EUR',
      p_notes:healthDraft.notes.trim()||null,p_sync_calendar:healthDraft.sync_calendar,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setHealthEditor(false);setMessage(healthDraft.id?'Health record updated.':'Health record added.')
    await load(false)
  }
  async function deleteHealth(item:HealthEvent){
    if(!window.confirm('Delete '+item.title+'?'))return
    const result=await supabase.from('pet_health_events').delete().eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  function openCare(item?:CareRoutine){
    setCareDraft(item?{id:item.id,title:item.title,frequency_days:String(item.frequency_days),next_due_date:item.next_due_date,notes:item.notes??''}:{...emptyCare})
    setCareEditor(true)
  }
  async function saveCare(event:FormEvent){
    event.preventDefault()
    if(!selected)return
    setSaving(true);setError('')
    const payload={
      household_id:household.id,pet_id:selected.id,title:careDraft.title.trim(),
      frequency_days:Math.max(1,Math.round(Number(careDraft.frequency_days)||1)),
      next_due_date:careDraft.next_due_date,notes:careDraft.notes.trim()||null,active:true,updated_at:new Date().toISOString(),
    }
    const result=careDraft.id
      ?await supabase.from('pet_care_routines').update(payload).eq('id',careDraft.id).eq('household_id',household.id)
      :await supabase.from('pet_care_routines').insert({...payload,created_by_user_id:user.id})
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setCareEditor(false);setMessage(careDraft.id?'Care routine updated.':'Care routine added.')
    await load(false)
  }
  async function completeCare(item:CareRoutine){
    const result=await supabase.rpc('complete_pet_care_routine_v1',{p_household_id:household.id,p_routine_id:item.id})
    if(result.error){setError(result.error.message);return}
    setMessage(item.title+' completed. Next due '+fmtDate(String(result.data))+'.')
    await load(false)
  }
  async function archiveCare(item:CareRoutine){
    const result=await supabase.from('pet_care_routines').update({active:false,updated_at:new Date().toISOString()}).eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  function openInsurance(item?:InsurancePolicy){
    setInsuranceDraft(item?{id:item.id,provider:item.provider,policy_number:item.policy_number??'',valid_from:item.valid_from??'',valid_until:item.valid_until??'',notes:item.notes??''}:{...emptyInsurance})
    setInsuranceEditor(true)
  }
  async function saveInsurance(event:FormEvent){
    event.preventDefault()
    if(!selected)return
    setSaving(true);setError('')
    const payload={
      household_id:household.id,pet_id:selected.id,provider:insuranceDraft.provider.trim(),
      policy_number:insuranceDraft.policy_number.trim()||null,valid_from:insuranceDraft.valid_from||null,
      valid_until:insuranceDraft.valid_until||null,notes:insuranceDraft.notes.trim()||null,active:true,updated_at:new Date().toISOString(),
    }
    const result=insuranceDraft.id
      ?await supabase.from('pet_insurance_policies').update(payload).eq('id',insuranceDraft.id).eq('household_id',household.id)
      :await supabase.from('pet_insurance_policies').insert({...payload,created_by_user_id:user.id})
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setInsuranceEditor(false);setMessage(insuranceDraft.id?'Insurance updated.':'Insurance policy added.')
    await load(false)
  }
  async function archiveInsurance(item:InsurancePolicy){
    const result=await supabase.from('pet_insurance_policies').update({active:false,updated_at:new Date().toISOString()}).eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  async function linkDocument(event:FormEvent){
    event.preventDefault()
    if(!selected||!documentFileId)return
    const result=await supabase.from('pet_documents').insert({
      household_id:household.id,pet_id:selected.id,file_id:documentFileId,document_type:documentType,
      label:documentLabel.trim()||null,created_by_user_id:user.id,
    })
    if(result.error){setError(result.error.message);return}
    setDocumentFileId('');setDocumentLabel('');setDocumentType('document');setMessage('Document linked to pet.')
    await load(false)
  }
  async function unlinkDocument(doc:PetDocument){
    const result=await supabase.from('pet_documents').delete().eq('id',doc.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message);else await load(false)
  }

  if(loading)return <div className="page pets-page"><div className="pets-empty">Loading pets…</div></div>

  return <div className="page pets-page">
    <div className="page-heading-row pets-heading">
      <div><span className="eyebrow">PETS</span><h1>Family pets</h1><p>Keep health, vaccinations, medication, insurance, care routines and documents together.</p></div>
      {canWrite&&<button className="primary-button compact" onClick={()=>openPet()}><Plus size={15}/>Add pet</button>}
    </div>
    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    {pets.length===0?<div className="pets-empty"><PawPrint size={34}/><strong>No pets yet.</strong><span>Add a pet profile to start tracking care and health information.</span>{canWrite&&<button className="primary-button compact" onClick={()=>openPet()}><Plus size={14}/>Add first pet</button>}</div>:<>
      <section className="pets-strip">{pets.map(pet=><button className={selected?.id===pet.id?'pet-chip active':'pet-chip'} onClick={()=>setSelectedId(pet.id)} key={pet.id}>{petPhotoUrls[pet.id]?<img className="pet-chip-photo" src={petPhotoUrls[pet.id]} alt=""/>:<PawPrint size={17}/>}<span><strong>{pet.name}</strong><small>{[pet.species,pet.breed].filter(Boolean).join(' · ')}</small></span></button>)}</section>
      {selected&&<>
        <section className="pet-hero">
          <div className={petPhotoUrls[selected.id]?'pet-hero-icon has-photo':'pet-hero-icon'}>{petPhotoUrls[selected.id]?<img src={petPhotoUrls[selected.id]} alt={selected.name}/>:<PawPrint size={28}/>}</div>
          <div><span className="eyebrow">{selected.species.toUpperCase()}</span><h2>{selected.name}</h2><p>{[selected.breed,selected.sex&&selected.sex!=='unknown'?selected.sex:null].filter(Boolean).join(' · ')||'Family pet'}</p><small>{selected.birth_date?'Born '+fmtDate(selected.birth_date):'Birth date not set'}{selected.weight_kg!=null?' · '+selected.weight_kg+' kg':''}</small></div>
          <div className="pet-hero-actions">{canWrite&&<button className="secondary-button compact" onClick={()=>openPet(selected)}>Edit</button>}{canWrite&&<button className="icon-button" title="Archive pet" onClick={()=>void archivePet(selected)}><Trash2 size={15}/></button>}</div>
        </section>
        <nav className="projects-tabs pets-tabs">
          <button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Overview</button>
          <button className={tab==='health'?'active':''} onClick={()=>setTab('health')}>Health <span>{selectedHealth.length}</span></button>
          <button className={tab==='care'?'active':''} onClick={()=>setTab('care')}>Recurring care <span>{selectedCare.length}</span></button>
          <button className={tab==='insurance'?'active':''} onClick={()=>setTab('insurance')}>Insurance <span>{selectedInsurance.length}</span></button>
          <button className={tab==='documents'?'active':''} onClick={()=>setTab('documents')}>Documents <span>{selectedDocuments.length}</span></button>
        </nav>

        {tab==='overview'&&<section className="pet-overview-grid">
          <article className="pet-summary-card"><HeartPulse size={18}/><span><small>NEXT HEALTH ITEM</small><strong>{upcomingHealth[0]?.title||'Nothing scheduled'}</strong><em>{upcomingHealth[0]?fmtDate(upcomingHealth[0].due_date):'Add vet, vaccine or medication'}</em></span><button onClick={()=>{setTab('health');openHealth()}}>Add</button></article>
          <article className="pet-summary-card"><Syringe size={18}/><span><small>VACCINATIONS</small><strong>{selectedHealth.filter(item=>item.event_type==='vaccination').length}</strong><em>records</em></span><button onClick={()=>{setTab('health');openHealth(undefined,'vaccination')}}>Add</button></article>
          <article className="pet-summary-card"><Pill size={18}/><span><small>CARE ROUTINES</small><strong>{selectedCare.length}</strong><em>active routines</em></span><button onClick={()=>{setTab('care');openCare()}}>Add</button></article>
          <article className="pet-summary-card"><ShieldCheck size={18}/><span><small>RECORDED COSTS</small><strong>{money(totalCosts)}</strong><em>also mirrored to Household Costs</em></span><button onClick={()=>setTab('health')}>Open</button></article>
          {upcomingHealth.length>0&&<div className="pet-reminders"><span className="eyebrow">UPCOMING HEALTH</span>{upcomingHealth.slice(0,5).map(item=>{const days=daysUntil(item.due_date);return <div key={item.id}><span><strong>{item.title}</strong><small>{item.event_type} · {fmtDate(item.due_date)}</small></span><b className={days!=null&&days<0?'overdue':days!=null&&days<=30?'soon':''}>{days==null?'':days<0?Math.abs(days)+'d overdue':days===0?'Today':days+'d'}</b></div>})}</div>}
          {selectedCare.length>0&&<div className="pet-care-preview"><span className="eyebrow">NEXT CARE</span>{selectedCare.slice(0,5).map(item=><div key={item.id}><span><strong>{item.title}</strong><small>Every {item.frequency_days} day(s)</small></span><b>{fmtDate(item.next_due_date)}</b></div>)}</div>}
          {selected.notes&&<div className="pet-notes"><span className="eyebrow">NOTES</span><p>{selected.notes}</p></div>}
        </section>}

        {tab==='health'&&<section className="pet-section">
          <div className="pet-section-head"><div><span className="eyebrow">HEALTH</span><h2>Vet, vaccinations & medication</h2><p>Due dates can be synced to Calendar. Costs can flow into Household Costs.</p></div>{canWrite&&<button className="primary-button compact" onClick={()=>openHealth()}><Plus size={14}/>Add health record</button>}</div>
          {selectedHealth.length===0?<div className="pets-empty compact"><Stethoscope size={24}/><strong>No health records yet.</strong></div>:<div className="pet-health-list">{selectedHealth.map(item=><article className="pet-health-row" key={item.id}>
            <span className={'pet-health-icon '+item.event_type}>{healthIcon(item.event_type)}</span>
            <div><small>{item.event_type.toUpperCase()}</small><strong>{item.title}</strong><span>{item.completed_date?'Completed '+fmtDate(item.completed_date):item.due_date?'Due '+fmtDate(item.due_date):'No date'}{item.provider?' · '+item.provider:''}</span>{item.medication_name&&<em>{item.medication_name}{item.dosage?' · '+item.dosage:''}</em>}{item.recurring_every_days&&<em>Repeats every {item.recurring_every_days} day(s)</em>}{item.notes&&<p>{item.notes}</p>}</div>
            <b>{money(item.cost_amount,item.currency)}</b>
            {canWrite&&<div className="pet-row-actions"><button onClick={()=>openHealth(item)}>Edit</button><button onClick={()=>void deleteHealth(item)}><Trash2 size={13}/></button></div>}
          </article>)}</div>}
        </section>}

        {tab==='care'&&<section className="pet-section">
          <div className="pet-section-head"><div><span className="eyebrow">RECURRING CARE</span><h2>Feeding, grooming & routine care</h2></div>{canWrite&&<button className="primary-button compact" onClick={()=>openCare()}><Plus size={14}/>Add routine</button>}</div>
          {selectedCare.length===0?<div className="pets-empty compact"><PawPrint size={24}/><strong>No care routines yet.</strong></div>:<div className="pet-care-list">{selectedCare.map(item=><article className="pet-care-row" key={item.id}><button className="pet-care-check" onClick={()=>void completeCare(item)} disabled={!canWrite}><Check size={15}/></button><div><strong>{item.title}</strong><small>Every {item.frequency_days} day(s) · Next {fmtDate(item.next_due_date)}</small>{item.last_completed_date&&<em>Last completed {fmtDate(item.last_completed_date)}</em>}{item.notes&&<p>{item.notes}</p>}</div>{canWrite&&<div className="pet-row-actions"><button onClick={()=>openCare(item)}>Edit</button><button onClick={()=>void archiveCare(item)}>Archive</button></div>}</article>)}</div>}
        </section>}

        {tab==='insurance'&&<section className="pet-section">
          <div className="pet-section-head"><div><span className="eyebrow">INSURANCE</span><h2>Pet insurance policies</h2></div>{canWrite&&<button className="primary-button compact" onClick={()=>openInsurance()}><Plus size={14}/>Add policy</button>}</div>
          {selectedInsurance.length===0?<div className="pets-empty compact"><ShieldCheck size={24}/><strong>No insurance policy saved.</strong></div>:<div className="pet-insurance-grid">{selectedInsurance.map(item=><article className="pet-insurance-card" key={item.id}><ShieldCheck size={21}/><div><small>INSURANCE</small><strong>{item.provider}</strong><span>{item.policy_number||'Policy number not set'}</span><em>{item.valid_until?'Valid until '+fmtDate(item.valid_until):'No expiry date'}</em>{item.notes&&<p>{item.notes}</p>}</div>{canWrite&&<footer><button onClick={()=>openInsurance(item)}>Edit</button><button onClick={()=>void archiveInsurance(item)}>Archive</button></footer>}</article>)}</div>}
        </section>}

        {tab==='documents'&&<section className="pet-section">
          <div className="pet-section-head"><div><span className="eyebrow">DOCUMENTS</span><h2>Vaccination cards, insurance & vet files</h2><p>Upload documents in Famioo Files, then link them to this pet.</p></div></div>
          {canWrite&&<form className="pet-document-linker" onSubmit={linkDocument}><select value={documentType} onChange={e=>setDocumentType(e.target.value as PetDocument['document_type'])}><option value="vaccination">Vaccination</option><option value="insurance">Insurance</option><option value="vet">Vet</option><option value="prescription">Prescription</option><option value="registration">Registration</option><option value="document">Document</option></select><select value={documentFileId} onChange={e=>setDocumentFileId(e.target.value)} required><option value="">Choose file…</option>{files.map(file=><option key={file.id} value={file.id}>{file.title}</option>)}</select><input value={documentLabel} onChange={e=>setDocumentLabel(e.target.value)} placeholder="Optional label"/><button className="primary-button compact"><Plus size={13}/>Link</button></form>}
          {selectedDocuments.length===0?<div className="pets-empty compact"><FileText size={24}/><strong>No pet documents linked.</strong></div>:<div className="pet-document-list">{selectedDocuments.map(doc=>{const file=fileById.get(doc.file_id);if(!file)return null;return <article className="pet-document-row" key={doc.id}><span><FileText size={17}/></span><div><small>{doc.document_type.toUpperCase()}</small><strong>{doc.label||file.title}</strong><em>{file.file_name}</em></div><div>{fileUrls[file.id]&&<a className="secondary-button compact" href={fileUrls[file.id]} target="_blank" rel="noreferrer">Open</a>}{canWrite&&<button className="icon-button" onClick={()=>void unlinkDocument(doc)}><X size={14}/></button>}</div></article>})}</div>}
        </section>}
      </>}
    </>}

    {petEditor&&<div className="modal-backdrop pet-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card pet-editor"><header><div><span className="eyebrow">{petDraft.id?'EDIT PET':'NEW PET'}</span><h2>{petDraft.id?'Update pet':'Add family pet'}</h2></div><button className="icon-button" onClick={()=>setPetEditor(false)}><X size={18}/></button></header><form onSubmit={savePet}>
      <div className="pet-photo-field">
        <div className="pet-photo-preview">{petPhotoPreview?<img src={petPhotoPreview} alt="Pet preview"/>:<PawPrint size={26}/>}</div>
        <div><strong>Pet photo</strong><small>JPG, PNG or WebP · up to 5 MB</small><label className="secondary-button compact pet-photo-button"><ImagePlus size={14}/>{petPhotoPreview?'Change photo':'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{const file=event.target.files?.[0]??null;event.target.value='';choosePetPhoto(file)}}/></label></div>
      </div>
      <label><span>Name *</span><input required maxLength={120} value={petDraft.name} onChange={e=>setPetDraft(v=>({...v,name:e.target.value}))}/></label>
      <div className="pet-editor-row"><label><span>Species *</span><input required value={petDraft.species} onChange={e=>setPetDraft(v=>({...v,species:e.target.value}))} placeholder="Dog, cat…"/></label><label><span>Breed</span><input value={petDraft.breed} onChange={e=>setPetDraft(v=>({...v,breed:e.target.value}))}/></label></div>
      <div className="pet-editor-row"><label><span>Sex</span><select value={petDraft.sex} onChange={e=>setPetDraft(v=>({...v,sex:e.target.value as PetDraft['sex']}))}><option value="unknown">Unknown</option><option value="female">Female</option><option value="male">Male</option></select></label><label><span>Birth date</span><input type="date" value={petDraft.birth_date} onChange={e=>setPetDraft(v=>({...v,birth_date:e.target.value}))}/></label></div>
      <div className="pet-editor-row"><label><span>Weight kg</span><input type="number" min="0" step="0.01" value={petDraft.weight_kg} onChange={e=>setPetDraft(v=>({...v,weight_kg:e.target.value}))}/></label><label><span>Chip number</span><input value={petDraft.chip_number} onChange={e=>setPetDraft(v=>({...v,chip_number:e.target.value}))}/></label></div>
      <label><span>Color / markings</span><input value={petDraft.color_markings} onChange={e=>setPetDraft(v=>({...v,color_markings:e.target.value}))}/></label>
      <label><span>Notes</span><textarea rows={3} value={petDraft.notes} onChange={e=>setPetDraft(v=>({...v,notes:e.target.value}))}/></label>
      <footer><button type="button" className="secondary-button" onClick={()=>setPetEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save pet'}</button></footer>
    </form></section></div>}

    {healthEditor&&selected&&<div className="modal-backdrop pet-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card pet-editor"><header><div><span className="eyebrow">{healthDraft.id?'EDIT HEALTH RECORD':'NEW HEALTH RECORD'}</span><h2>{selected.name}'s health</h2></div><button className="icon-button" onClick={()=>setHealthEditor(false)}><X size={18}/></button></header><form onSubmit={saveHealth}>
      <label><span>Type</span><select value={healthDraft.event_type} onChange={e=>setHealthDraft(v=>({...v,event_type:e.target.value as HealthEvent['event_type']}))}><option value="vet">Vet appointment</option><option value="vaccination">Vaccination</option><option value="medication">Medication</option><option value="insurance">Insurance reminder</option><option value="other">Other</option></select></label>
      <label><span>Title *</span><input required value={healthDraft.title} onChange={e=>setHealthDraft(v=>({...v,title:e.target.value}))}/></label>
      <div className="pet-editor-row"><label><span>Due date</span><input type="date" value={healthDraft.due_date} onChange={e=>setHealthDraft(v=>({...v,due_date:e.target.value}))}/></label><label><span>Completed</span><input type="date" value={healthDraft.completed_date} onChange={e=>setHealthDraft(v=>({...v,completed_date:e.target.value}))}/></label></div>
      <label><span>Vet / provider</span><input value={healthDraft.provider} onChange={e=>setHealthDraft(v=>({...v,provider:e.target.value}))}/></label>
      <div className="pet-editor-row"><label><span>Medication</span><input value={healthDraft.medication_name} onChange={e=>setHealthDraft(v=>({...v,medication_name:e.target.value}))}/></label><label><span>Dosage</span><input value={healthDraft.dosage} onChange={e=>setHealthDraft(v=>({...v,dosage:e.target.value}))}/></label></div>
      <div className="pet-editor-row"><label><span>Repeat every days</span><input type="number" min="1" max="3650" value={healthDraft.recurring_every_days} onChange={e=>setHealthDraft(v=>({...v,recurring_every_days:e.target.value}))}/></label><label><span>Cost (€)</span><input type="number" min="0" step="0.01" value={healthDraft.cost_amount} onChange={e=>setHealthDraft(v=>({...v,cost_amount:e.target.value}))}/></label></div>
      <label><span>Notes</span><textarea rows={3} value={healthDraft.notes} onChange={e=>setHealthDraft(v=>({...v,notes:e.target.value}))}/></label>
      <label className="pet-sync-setting"><input type="checkbox" checked={healthDraft.sync_calendar} onChange={e=>setHealthDraft(v=>({...v,sync_calendar:e.target.checked}))}/><span><CalendarDays size={14}/>Sync due date to Calendar</span></label>
      <footer><button type="button" className="secondary-button" onClick={()=>setHealthEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save record'}</button></footer>
    </form></section></div>}

    {careEditor&&selected&&<div className="modal-backdrop pet-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card pet-editor small"><header><div><span className="eyebrow">{careDraft.id?'EDIT CARE':'NEW CARE ROUTINE'}</span><h2>Recurring care</h2></div><button className="icon-button" onClick={()=>setCareEditor(false)}><X size={18}/></button></header><form onSubmit={saveCare}>
      <label><span>Routine *</span><input required value={careDraft.title} onChange={e=>setCareDraft(v=>({...v,title:e.target.value}))} placeholder="Grooming, flea treatment…"/></label>
      <div className="pet-editor-row"><label><span>Every days *</span><input type="number" min="1" max="3650" required value={careDraft.frequency_days} onChange={e=>setCareDraft(v=>({...v,frequency_days:e.target.value}))}/></label><label><span>Next due *</span><input type="date" required value={careDraft.next_due_date} onChange={e=>setCareDraft(v=>({...v,next_due_date:e.target.value}))}/></label></div>
      <label><span>Notes</span><textarea rows={3} value={careDraft.notes} onChange={e=>setCareDraft(v=>({...v,notes:e.target.value}))}/></label>
      <footer><button type="button" className="secondary-button" onClick={()=>setCareEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save routine'}</button></footer>
    </form></section></div>}

    {insuranceEditor&&selected&&<div className="modal-backdrop pet-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card pet-editor small"><header><div><span className="eyebrow">{insuranceDraft.id?'EDIT INSURANCE':'NEW INSURANCE'}</span><h2>Pet insurance</h2></div><button className="icon-button" onClick={()=>setInsuranceEditor(false)}><X size={18}/></button></header><form onSubmit={saveInsurance}>
      <label><span>Provider *</span><input required value={insuranceDraft.provider} onChange={e=>setInsuranceDraft(v=>({...v,provider:e.target.value}))}/></label>
      <label><span>Policy number</span><input value={insuranceDraft.policy_number} onChange={e=>setInsuranceDraft(v=>({...v,policy_number:e.target.value}))}/></label>
      <div className="pet-editor-row"><label><span>Valid from</span><input type="date" value={insuranceDraft.valid_from} onChange={e=>setInsuranceDraft(v=>({...v,valid_from:e.target.value}))}/></label><label><span>Valid until</span><input type="date" value={insuranceDraft.valid_until} onChange={e=>setInsuranceDraft(v=>({...v,valid_until:e.target.value}))}/></label></div>
      <label><span>Notes</span><textarea rows={3} value={insuranceDraft.notes} onChange={e=>setInsuranceDraft(v=>({...v,notes:e.target.value}))}/></label>
      <footer><button type="button" className="secondary-button" onClick={()=>setInsuranceEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save insurance'}</button></footer>
    </form></section></div>}
  </div>
}
