import {
  AlertTriangle,
  BadgeAlert,
  Check,
  Copy,
  Edit3,
  HeartPulse,
  Phone,
  Plus,
  ShieldCheck,
  Stethoscope,
  UserRoundCheck,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type EmergencyProfile={
  profile_id:string
  household_id:string
  blood_type:string|null
  allergies:string|null
  medications:string|null
  medical_notes:string|null
  safety_notes:string|null
  primary_doctor_contact_id:string|null
  insurance_provider:string|null
  insurance_member_number:string|null
  insurance_policy_number:string|null
  insurance_phone:string|null
  insurance_notes:string|null
  updated_at:string
}
type DirectoryContact={
  id:string
  contact_type:string
  display_name:string
  relation_label:string|null
  organisation:string|null
  phone:string|null
  secondary_phone:string|null
  email:string|null
  notes:string|null
  is_emergency:boolean
}
type Guardian={
  id:string
  profile_id:string
  contact_id:string
  relation_label:string|null
  priority:number
  notes:string|null
}
type ProfileDraft={
  blood_type:string
  allergies:string
  medications:string
  medical_notes:string
  safety_notes:string
  primary_doctor_contact_id:string
  insurance_provider:string
  insurance_member_number:string
  insurance_policy_number:string
  insurance_phone:string
  insurance_notes:string
}
type GuardianDraft={
  id:string
  contact_id:string
  relation_label:string
  priority:string
  notes:string
}

const emptyProfile:ProfileDraft={
  blood_type:'',
  allergies:'',
  medications:'',
  medical_notes:'',
  safety_notes:'',
  primary_doctor_contact_id:'',
  insurance_provider:'',
  insurance_member_number:'',
  insurance_policy_number:'',
  insurance_phone:'',
  insurance_notes:'',
}
const emptyGuardian:GuardianDraft={id:'',contact_id:'',relation_label:'',priority:'1',notes:''}

function copyText(value:string){
  if(!navigator.clipboard)return
  void navigator.clipboard.writeText(value)
}

export function EmergencyPage(){
  const {household,modules,profiles}=useHousehold()
  const canWrite=Boolean(modules.find(module=>module.code==='emergency_info')?.can_write)
  const [records,setRecords]=useState<EmergencyProfile[]>([])
  const [contacts,setContacts]=useState<DirectoryContact[]>([])
  const [guardians,setGuardians]=useState<Guardian[]>([])
  const [selectedId,setSelectedId]=useState(profiles[0]?.id??'')
  const [quickMode,setQuickMode]=useState(false)
  const [profileEditor,setProfileEditor]=useState(false)
  const [guardianEditor,setGuardianEditor]=useState(false)
  const [profileDraft,setProfileDraft]=useState<ProfileDraft>(emptyProfile)
  const [guardianDraft,setGuardianDraft]=useState<GuardianDraft>(emptyGuardian)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const activeProfiles=profiles.filter(profile=>profile.active!==false)
  const selected=activeProfiles.find(profile=>profile.id===selectedId)??activeProfiles[0]??null
  const record=records.find(item=>item.profile_id===selected?.id)??null
  const contactById=useMemo(()=>new Map(contacts.map(contact=>[contact.id,contact])),[contacts])
  const doctor=record?.primary_doctor_contact_id?contactById.get(record.primary_doctor_contact_id)??null:null
  const selectedGuardians=guardians
    .filter(item=>item.profile_id===selected?.id)
    .sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))
  const emergencyContacts=contacts.filter(contact=>contact.is_emergency||contact.contact_type==='emergency')
  const selectableContacts=contacts.filter(contact=>contact.phone||contact.secondary_phone)

  async function load(foreground=false){
    if(foreground)setLoading(true)
    setError('')
    const [profileResult,contactResult,guardianResult]=await Promise.all([
      supabase.from('family_emergency_profiles')
        .select('profile_id,household_id,blood_type,allergies,medications,medical_notes,safety_notes,primary_doctor_contact_id,insurance_provider,insurance_member_number,insurance_policy_number,insurance_phone,insurance_notes,updated_at')
        .eq('household_id',household.id),
      supabase.rpc('family_contacts_v1',{p_household_id:household.id}),
      supabase.from('family_emergency_guardians')
        .select('id,profile_id,contact_id,relation_label,priority,notes')
        .eq('household_id',household.id),
    ])

    const failure=profileResult.error||contactResult.error||guardianResult.error
    if(failure)setError(failure.message)
    setRecords((profileResult.data??[]) as EmergencyProfile[])
    setContacts((contactResult.data??[]) as DirectoryContact[])
    setGuardians(((guardianResult.data??[]) as Guardian[]).map(row=>({...row,priority:Number(row.priority)})))
    setSelectedId(current=>activeProfiles.some(profile=>profile.id===current)?current:(activeProfiles[0]?.id??''))
    if(foreground)setLoading(false)
  }

  useEffect(()=>{void load(true)},[household.id])

  function openProfileEditor(){
    if(!selected)return
    setProfileDraft(record?{
      blood_type:record.blood_type??'',
      allergies:record.allergies??'',
      medications:record.medications??'',
      medical_notes:record.medical_notes??'',
      safety_notes:record.safety_notes??'',
      primary_doctor_contact_id:record.primary_doctor_contact_id??'',
      insurance_provider:record.insurance_provider??'',
      insurance_member_number:record.insurance_member_number??'',
      insurance_policy_number:record.insurance_policy_number??'',
      insurance_phone:record.insurance_phone??'',
      insurance_notes:record.insurance_notes??'',
    }:{...emptyProfile})
    setError('');setMessage('');setProfileEditor(true)
  }

  async function saveProfile(event:FormEvent){
    event.preventDefault()
    if(!selected)return
    setSaving(true);setError('')
    const result=await supabase.rpc('save_family_emergency_profile_v1',{
      p_household_id:household.id,
      p_profile_id:selected.id,
      p_blood_type:profileDraft.blood_type.trim()||null,
      p_allergies:profileDraft.allergies.trim()||null,
      p_medications:profileDraft.medications.trim()||null,
      p_medical_notes:profileDraft.medical_notes.trim()||null,
      p_safety_notes:profileDraft.safety_notes.trim()||null,
      p_primary_doctor_contact_id:profileDraft.primary_doctor_contact_id||null,
      p_insurance_provider:profileDraft.insurance_provider.trim()||null,
      p_insurance_member_number:profileDraft.insurance_member_number.trim()||null,
      p_insurance_policy_number:profileDraft.insurance_policy_number.trim()||null,
      p_insurance_phone:profileDraft.insurance_phone.trim()||null,
      p_insurance_notes:profileDraft.insurance_notes.trim()||null,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setProfileEditor(false);setMessage('Emergency information updated.')
    await load(false)
  }

  function openGuardian(item?:Guardian){
    setGuardianDraft(item?{
      id:item.id,
      contact_id:item.contact_id,
      relation_label:item.relation_label??'',
      priority:String(item.priority),
      notes:item.notes??'',
    }:{...emptyGuardian,priority:String(selectedGuardians.length+1)})
    setGuardianEditor(true);setError('');setMessage('')
  }

  async function saveGuardian(event:FormEvent){
    event.preventDefault()
    if(!selected||!guardianDraft.contact_id)return
    setSaving(true);setError('')
    const result=await supabase.rpc('save_family_emergency_guardian_v1',{
      p_household_id:household.id,
      p_id:guardianDraft.id||null,
      p_profile_id:selected.id,
      p_contact_id:guardianDraft.contact_id,
      p_relation_label:guardianDraft.relation_label.trim()||null,
      p_priority:Math.max(1,Math.min(10,Number(guardianDraft.priority)||1)),
      p_notes:guardianDraft.notes.trim()||null,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setGuardianEditor(false);setMessage(guardianDraft.id?'Guardian contact updated.':'Guardian contact added.')
    await load(false)
  }

  async function deleteGuardian(item:Guardian){
    if(!window.confirm('Remove this guardian contact from the emergency profile?'))return
    const result=await supabase.rpc('delete_family_emergency_guardian_v1',{
      p_household_id:household.id,p_id:item.id,
    })
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  if(loading)return <div className="page emergency-page"><div className="emergency-empty">Loading Emergency Information…</div></div>

  return <div className={quickMode?'page emergency-page quick':'page emergency-page'}>
    <div className="page-heading-row emergency-heading">
      <div>
        <span className="eyebrow">EMERGENCY INFORMATION</span>
        <h1>{quickMode?'Quick Guardian View':'Family emergency information'}</h1>
        <p>{quickMode?'Large, fast access to the information a guardian may need.':'Keep essential contacts, doctors, insurance and medical/safety notes ready when they matter.'}</p>
      </div>
      <div className="emergency-heading-actions">
        <button type="button" className={quickMode?'primary-button compact':'secondary-button compact'} onClick={()=>setQuickMode(value=>!value)}>
          <BadgeAlert size={15}/>{quickMode?'Exit quick view':'Quick guardian view'}
        </button>
        {!quickMode&&canWrite&&selected&&<button type="button" className="primary-button compact" onClick={openProfileEditor}><Edit3 size={14}/>Edit information</button>}
      </div>
    </div>

    <div className="emergency-privacy-note">
      <ShieldCheck size={16}/>
      <span><strong>Private household information.</strong> This page is only available inside an authenticated Famioo household session.</span>
    </div>

    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    {activeProfiles.length===0?<div className="emergency-empty"><BadgeAlert size={30}/><strong>No family profiles available.</strong></div>:<>
      <section className="emergency-profile-strip">
        {activeProfiles.map(profile=><button type="button" className={selected?.id===profile.id?'active':''} onClick={()=>setSelectedId(profile.id)} key={profile.id}>
          <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm"/>
          <span><strong>{profile.display_name}</strong><small>{profile.profile_type==='child'?'Child':'Family member'}</small></span>
        </button>)}
      </section>

      {selected&&<section className="emergency-content">
        <article className="emergency-person-card">
          <ProfileAvatar avatarPath={selected.avatar_path} name={selected.display_name} size={quickMode?'lg':'md'}/>
          <div><span className="eyebrow">{selected.profile_type==='child'?'CHILD':'FAMILY MEMBER'}</span><h2>{selected.display_name}</h2>{selected.birth_date&&<small>Born {new Date(selected.birth_date+'T12:00:00').toLocaleDateString()}</small>}</div>
          {record?.blood_type&&<b>Blood type {record.blood_type}</b>}
        </article>

        {!record?<div className="emergency-empty compact"><HeartPulse size={26}/><strong>No emergency details saved for {selected.display_name}.</strong>{canWrite&&!quickMode&&<button className="primary-button compact" onClick={openProfileEditor}><Plus size={14}/>Add information</button>}</div>:<>
          <div className="emergency-critical-grid">
            <article className="emergency-info-card critical">
              <header><AlertTriangle size={17}/><span>Allergies</span></header>
              <p>{record.allergies||'None recorded'}</p>
            </article>
            <article className="emergency-info-card medication">
              <header><HeartPulse size={17}/><span>Medication</span></header>
              <p>{record.medications||'None recorded'}</p>
            </article>
            <article className="emergency-info-card safety">
              <header><ShieldCheck size={17}/><span>Safety notes</span></header>
              <p>{record.safety_notes||'No safety notes recorded'}</p>
            </article>
          </div>

          <div className="emergency-main-grid">
            <article className="emergency-panel">
              <header><Stethoscope size={18}/><div><span className="eyebrow">PRIMARY DOCTOR</span><h3>{doctor?.display_name||'No doctor linked'}</h3></div></header>
              {doctor&&<>
                <p>{doctor.organisation||doctor.relation_label||'Medical contact'}</p>
                <div className="emergency-call-row">
                  {doctor.phone&&<a href={'tel:'+doctor.phone}><Phone size={15}/>Call {doctor.phone}</a>}
                  {doctor.secondary_phone&&<a href={'tel:'+doctor.secondary_phone}><Phone size={15}/>Call {doctor.secondary_phone}</a>}
                </div>
              </>}
              {!doctor&&!quickMode&&<small>Add a doctor in Family Contacts, then link the contact here.</small>}
            </article>

            <article className="emergency-panel">
              <header><ShieldCheck size={18}/><div><span className="eyebrow">INSURANCE</span><h3>{record.insurance_provider||'No insurance saved'}</h3></div></header>
              {record.insurance_member_number&&<div className="emergency-copy-line"><span><small>Member number</small><strong>{record.insurance_member_number}</strong></span><button onClick={()=>copyText(record.insurance_member_number!)} title="Copy"><Copy size={14}/></button></div>}
              {record.insurance_policy_number&&<div className="emergency-copy-line"><span><small>Policy number</small><strong>{record.insurance_policy_number}</strong></span><button onClick={()=>copyText(record.insurance_policy_number!)} title="Copy"><Copy size={14}/></button></div>}
              {record.insurance_phone&&<a className="emergency-call-primary" href={'tel:'+record.insurance_phone}><Phone size={15}/>Call insurance {record.insurance_phone}</a>}
              {record.insurance_notes&&<p>{record.insurance_notes}</p>}
            </article>
          </div>

          {record.medical_notes&&<article className="emergency-medical-notes"><span className="eyebrow">IMPORTANT MEDICAL NOTES</span><p>{record.medical_notes}</p></article>}
        </>}

        <section className="emergency-guardians">
          <div className="emergency-section-head">
            <div><span className="eyebrow">GUARDIAN / EMERGENCY CONTACTS</span><h2>Who to call first</h2></div>
            {!quickMode&&canWrite&&<button className="primary-button compact" onClick={()=>openGuardian()} disabled={!selectableContacts.length}><Plus size={14}/>Add contact</button>}
          </div>

          {selectedGuardians.length?selectedGuardians.map(item=>{
            const contact=contactById.get(item.contact_id)
            if(!contact)return null
            const phone=contact.phone||contact.secondary_phone
            return <article className="emergency-guardian-card" key={item.id}>
              <span className="emergency-priority">{item.priority}</span>
              <div><small>{item.relation_label||contact.relation_label||'Emergency contact'}</small><strong>{contact.display_name}</strong><em>{contact.organisation||''}</em>{item.notes&&<p>{item.notes}</p>}</div>
              {phone&&<a href={'tel:'+phone}><Phone size={quickMode?20:15}/><span>{quickMode?phone:'Call'}</span></a>}
              {!quickMode&&canWrite&&<div className="emergency-guardian-actions"><button onClick={()=>openGuardian(item)}>Edit</button><button onClick={()=>void deleteGuardian(item)}>Remove</button></div>}
            </article>
          }):<div className="emergency-empty compact"><UserRoundCheck size={24}/><strong>No priority guardian contacts linked.</strong>{emergencyContacts.length>0&&<span>{emergencyContacts.length} emergency contact{emergencyContacts.length===1?' is':'s are'} already available in Family Contacts.</span>}{!selectableContacts.length&&!quickMode&&<Link to="/app/contacts" className="secondary-button compact">Add contacts first</Link>}</div>}
        </section>
      </section>}
    </>}

    {profileEditor&&selected&&<div className="modal-backdrop emergency-modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card emergency-editor">
      <header><div><span className="eyebrow">EMERGENCY PROFILE</span><h2>{selected.display_name}</h2></div><button className="icon-button" onClick={()=>setProfileEditor(false)}><X size={18}/></button></header>
      <form onSubmit={saveProfile}>
        <div className="emergency-editor-row">
          <label><span>Blood type</span><input value={profileDraft.blood_type} onChange={e=>setProfileDraft(v=>({...v,blood_type:e.target.value}))} placeholder="e.g. A+"/></label>
          <label><span>Primary doctor</span><select value={profileDraft.primary_doctor_contact_id} onChange={e=>setProfileDraft(v=>({...v,primary_doctor_contact_id:e.target.value}))}><option value="">No doctor linked</option>{contacts.filter(contact=>contact.contact_type==='doctor').map(contact=><option value={contact.id} key={contact.id}>{contact.display_name}{contact.organisation?' · '+contact.organisation:''}</option>)}</select></label>
        </div>
        <label><span>Allergies</span><textarea rows={2} value={profileDraft.allergies} onChange={e=>setProfileDraft(v=>({...v,allergies:e.target.value}))} placeholder="Important allergies or 'None known'"/></label>
        <label><span>Current medication</span><textarea rows={2} value={profileDraft.medications} onChange={e=>setProfileDraft(v=>({...v,medications:e.target.value}))}/></label>
        <label><span>Important medical notes</span><textarea rows={3} value={profileDraft.medical_notes} onChange={e=>setProfileDraft(v=>({...v,medical_notes:e.target.value}))}/></label>
        <label><span>Safety notes</span><textarea rows={3} value={profileDraft.safety_notes} onChange={e=>setProfileDraft(v=>({...v,safety_notes:e.target.value}))} placeholder="Communication needs, mobility, pickup or safety information…"/></label>
        <div className="emergency-editor-divider"><span>INSURANCE</span></div>
        <div className="emergency-editor-row"><label><span>Provider</span><input value={profileDraft.insurance_provider} onChange={e=>setProfileDraft(v=>({...v,insurance_provider:e.target.value}))}/></label><label><span>Phone</span><input type="tel" value={profileDraft.insurance_phone} onChange={e=>setProfileDraft(v=>({...v,insurance_phone:e.target.value}))}/></label></div>
        <div className="emergency-editor-row"><label><span>Member number</span><input value={profileDraft.insurance_member_number} onChange={e=>setProfileDraft(v=>({...v,insurance_member_number:e.target.value}))}/></label><label><span>Policy number</span><input value={profileDraft.insurance_policy_number} onChange={e=>setProfileDraft(v=>({...v,insurance_policy_number:e.target.value}))}/></label></div>
        <label><span>Insurance notes</span><textarea rows={2} value={profileDraft.insurance_notes} onChange={e=>setProfileDraft(v=>({...v,insurance_notes:e.target.value}))}/></label>
        <footer><button type="button" className="secondary-button" onClick={()=>setProfileEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save emergency information'}</button></footer>
      </form>
    </section></div>}

    {guardianEditor&&selected&&<div className="modal-backdrop emergency-modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card emergency-editor small">
      <header><div><span className="eyebrow">{guardianDraft.id?'EDIT CONTACT':'PRIORITY CONTACT'}</span><h2>{selected.display_name}</h2></div><button className="icon-button" onClick={()=>setGuardianEditor(false)}><X size={18}/></button></header>
      <form onSubmit={saveGuardian}>
        <label><span>Contact *</span><select required value={guardianDraft.contact_id} onChange={e=>setGuardianDraft(v=>({...v,contact_id:e.target.value}))}><option value="">Choose Family Contact…</option>{selectableContacts.map(contact=><option value={contact.id} key={contact.id}>{contact.display_name}{contact.phone?' · '+contact.phone:''}</option>)}</select></label>
        <div className="emergency-editor-row"><label><span>Relationship / role</span><input value={guardianDraft.relation_label} onChange={e=>setGuardianDraft(v=>({...v,relation_label:e.target.value}))} placeholder="Grandmother, neighbour…"/></label><label><span>Call priority</span><input type="number" min="1" max="10" value={guardianDraft.priority} onChange={e=>setGuardianDraft(v=>({...v,priority:e.target.value}))}/></label></div>
        <label><span>Notes</span><textarea rows={3} value={guardianDraft.notes} onChange={e=>setGuardianDraft(v=>({...v,notes:e.target.value}))}/></label>
        <footer><button type="button" className="secondary-button" onClick={()=>setGuardianEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save contact'}</button></footer>
      </form>
    </section></div>}
  </div>
}
