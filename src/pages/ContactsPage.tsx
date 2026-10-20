import {
  AlertTriangle,
  Building2,
  ContactRound,
  Edit3,
  ExternalLink,
  Heart,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type ContactType=
  |'family'
  |'babysitter'
  |'doctor'
  |'pharmacy'
  |'school'
  |'kita'
  |'neighbour'
  |'emergency'
  |'service'
  |'other'

type DirectoryContact={
  id:string
  contact_type:ContactType
  display_name:string
  relation_label:string|null
  organisation:string|null
  phone:string|null
  secondary_phone:string|null
  email:string|null
  address_line:string|null
  postal_code:string|null
  city:string|null
  country:string|null
  website:string|null
  notes:string|null
  is_favourite:boolean
  is_emergency:boolean
  created_by_user_id:string
  updated_at:string
}

type HouseholdUser={
  profile_id:string
  user_id:string|null
  email:string|null
  phone:string|null
  display_name:string
  avatar_path:string|null
  profile_type:'adult'|'child'|'profile_only'
  role:'owner'|'admin'|'user'|'profile'
  status:string
}

type ContactDraft={
  id:string
  contact_type:ContactType
  display_name:string
  relation_label:string
  organisation:string
  phone:string
  secondary_phone:string
  email:string
  address_line:string
  postal_code:string
  city:string
  country:string
  website:string
  notes:string
  is_favourite:boolean
  is_emergency:boolean
}

const typeLabels:Record<ContactType,string>={
  family:'Family / Relative',
  babysitter:'Babysitter',
  doctor:'Doctor',
  pharmacy:'Pharmacy',
  school:'School',
  kita:'Kita',
  neighbour:'Neighbour',
  emergency:'Emergency',
  service:'Service',
  other:'Other',
}

const emptyDraft:ContactDraft={
  id:'',
  contact_type:'family',
  display_name:'',
  relation_label:'',
  organisation:'',
  phone:'',
  secondary_phone:'',
  email:'',
  address_line:'',
  postal_code:'',
  city:'',
  country:'',
  website:'',
  notes:'',
  is_favourite:false,
  is_emergency:false,
}

function normaliseWebsite(value:string){
  const trimmed=value.trim()
  if(!trimmed) return ''
  return /^https?:\/\//i.test(trimmed)?trimmed:`https://${trimmed}`
}

function fullAddress(contact:Pick<DirectoryContact,'address_line'|'postal_code'|'city'|'country'>){
  return [
    contact.address_line,
    [contact.postal_code,contact.city].filter(Boolean).join(' '),
    contact.country,
  ].filter(Boolean).join(', ')
}

function initials(value:string){
  return value
    .trim()
    .split(/\s+/)
    .slice(0,2)
    .map((part)=>part.slice(0,1).toUpperCase())
    .join('')||'?'
}

export function ContactsPage(){
  const {household,user}=useHousehold()

  const [contacts,setContacts]=useState<DirectoryContact[]>([])
  const [householdUsers,setHouseholdUsers]=useState<HouseholdUser[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [search,setSearch]=useState('')
  const [typeFilter,setTypeFilter]=useState<'all'|ContactType>('all')
  const [favouritesOnly,setFavouritesOnly]=useState(false)
  const [emergencyOnly,setEmergencyOnly]=useState(false)
  const [editorOpen,setEditorOpen]=useState(false)
  const [draft,setDraft]=useState<ContactDraft>(emptyDraft)
  const [saving,setSaving]=useState(false)
  const [deletingId,setDeletingId]=useState('')
  const [phoneEditor,setPhoneEditor]=useState('')
  const [phoneDraft,setPhoneDraft]=useState('')
  const [phoneSaving,setPhoneSaving]=useState(false)
  const [phoneError,setPhoneError]=useState('')

  const load=useCallback(async (foreground=false)=>{
    if(foreground) setLoading(true)
    setError('')

    const [contactsResult,usersResult]=await Promise.all([
      supabase.rpc('family_contacts_v1',{p_household_id:household.id}),
      supabase.rpc('household_users_v1',{p_household_id:household.id}),
    ])

    if(contactsResult.error){
      setError(contactsResult.error.message)
    }else{
      setContacts((contactsResult.data??[]) as DirectoryContact[])
    }

    if(usersResult.error){
      setError((current)=>current||usersResult.error.message)
    }else{
      setHouseholdUsers((usersResult.data??[]) as HouseholdUser[])
    }

    if(foreground) setLoading(false)
  },[household.id])

  useEffect(()=>{
    void load(true)
  },[load])

  const filteredContacts=useMemo(()=>{
    const needle=search.trim().toLowerCase()

    return contacts.filter((contact)=>{
      if(typeFilter!=='all'&&contact.contact_type!==typeFilter) return false
      if(favouritesOnly&&!contact.is_favourite) return false
      if(emergencyOnly&&!contact.is_emergency) return false

      if(!needle) return true

      return [
        contact.display_name,
        contact.relation_label,
        contact.organisation,
        contact.phone,
        contact.secondary_phone,
        contact.email,
        contact.address_line,
        contact.postal_code,
        contact.city,
        contact.country,
        contact.notes,
        typeLabels[contact.contact_type],
      ].filter(Boolean).some((value)=>String(value).toLowerCase().includes(needle))
    })
  },[contacts,emergencyOnly,favouritesOnly,search,typeFilter])

  const filteredHousehold=useMemo(()=>{
    const needle=search.trim().toLowerCase()
    return householdUsers.filter((member)=>{
      if(member.status!=='active') return false
      if(!needle) return true
      return [
        member.display_name,
        member.email,
        member.phone,
        member.profile_type,
        member.role,
      ].filter(Boolean).some((value)=>String(value).toLowerCase().includes(needle))
    })
  },[householdUsers,search])

  const emergencyContacts=contacts.filter((contact)=>contact.is_emergency)
  const favouriteContacts=contacts.filter((contact)=>contact.is_favourite)

  function openNew(){
    setDraft({...emptyDraft})
    setError('')
    setMessage('')
    setEditorOpen(true)
  }

  function openEdit(contact:DirectoryContact){
    setDraft({
      id:contact.id,
      contact_type:contact.contact_type,
      display_name:contact.display_name,
      relation_label:contact.relation_label??'',
      organisation:contact.organisation??'',
      phone:contact.phone??'',
      secondary_phone:contact.secondary_phone??'',
      email:contact.email??'',
      address_line:contact.address_line??'',
      postal_code:contact.postal_code??'',
      city:contact.city??'',
      country:contact.country??'',
      website:contact.website??'',
      notes:contact.notes??'',
      is_favourite:contact.is_favourite,
      is_emergency:contact.is_emergency,
    })
    setError('')
    setMessage('')
    setEditorOpen(true)
  }

  async function saveContact(event:FormEvent){
    event.preventDefault()
    if(!draft.display_name.trim()) return

    setSaving(true)
    setError('')
    setMessage('')

    const result=await supabase.rpc('save_family_contact_v1',{
      p_household_id:household.id,
      p_id:draft.id||null,
      p_contact_type:draft.contact_type,
      p_display_name:draft.display_name.trim(),
      p_relation_label:draft.relation_label.trim()||null,
      p_organisation:draft.organisation.trim()||null,
      p_phone:draft.phone.trim()||null,
      p_secondary_phone:draft.secondary_phone.trim()||null,
      p_email:draft.email.trim()||null,
      p_address_line:draft.address_line.trim()||null,
      p_postal_code:draft.postal_code.trim()||null,
      p_city:draft.city.trim()||null,
      p_country:draft.country.trim()||null,
      p_website:draft.website.trim()||null,
      p_notes:draft.notes.trim()||null,
      p_is_favourite:draft.is_favourite,
      p_is_emergency:draft.is_emergency,
    })

    setSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    const wasEditing=Boolean(draft.id)
    setEditorOpen(false)
    setDraft({...emptyDraft})
    setMessage(wasEditing?'Contact updated.':'Contact added to the family directory.')
    await load(false)
  }

  async function deleteContact(contact:DirectoryContact){
    if(!window.confirm(`Remove ${contact.display_name} from Family Contacts?`)) return

    setDeletingId(contact.id)
    setError('')

    const result=await supabase.rpc('archive_family_contact_v1',{
      p_household_id:household.id,
      p_id:contact.id,
    })

    setDeletingId('')

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage(contact.display_name+' removed from Family Contacts.')
    await load(false)
  }

  function contactActions(contact:DirectoryContact){
    const address=fullAddress(contact)
    const website=normaliseWebsite(contact.website??'')

    return (
      <div className="contacts-actions">
        {contact.phone&&(
          <>
            <a href={`tel:${contact.phone}`} title={'Call '+contact.display_name}><Phone size={14}/><span>Call</span></a>
            <a href={`sms:${contact.phone}`} title={'Text '+contact.display_name}><MessageSquareText size={14}/><span>Text</span></a>
          </>
        )}
        {contact.email&&<a href={`mailto:${contact.email}`} title={'Email '+contact.display_name}><Mail size={14}/><span>Email</span></a>}
        {address&&(
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noreferrer"
            title={'Open '+contact.display_name+' in maps'}
          >
            <MapPin size={14}/><span>Map</span>
          </a>
        )}
        {website&&<a href={website} target="_blank" rel="noreferrer" title={'Open '+contact.display_name+' website'}><ExternalLink size={14}/><span>Web</span></a>}
      </div>
    )
  }


  function canEditHouseholdPhone(member:HouseholdUser){
    return household.role==='owner'||household.role==='admin'||member.user_id===user.id
  }

  function openHouseholdPhone(member:HouseholdUser){
    if(!canEditHouseholdPhone(member))return
    setPhoneEditor(member.profile_id)
    setPhoneDraft(member.phone??'')
    setPhoneError('')
  }

  async function saveHouseholdPhone(event:FormEvent,member:HouseholdUser,clear=false){
    event.preventDefault()
    if(!canEditHouseholdPhone(member)||phoneSaving)return
    const number=clear?'':phoneDraft.trim()
    if(number&&(number.length<6||number.length>32||!/^[+]?[0-9 ()/.-]+$/.test(number))){
      setPhoneError('Use a valid number (6–32 characters, optional + country code).')
      return
    }
    if(clear&&!window.confirm('Remove the saved phone number for '+member.display_name+'? Their household membership and login will remain.'))return
    setPhoneSaving(true)
    setPhoneError('')
    const result=await supabase.rpc('set_household_profile_phone_v1',{
      p_household_id:household.id,p_profile_id:member.profile_id,p_phone:number,
    })
    setPhoneSaving(false)
    if(result.error){setPhoneError(result.error.message);return}
    setPhoneEditor('')
    setPhoneDraft('')
    await load(false)
    setMessage(clear?'Phone number removed; household member kept.':'Household phone number saved.')
  }

  function householdActions(member:HouseholdUser){
    return (
      <div className="contacts-actions">
        {member.phone&&(
          <>
            <a href={`tel:${member.phone}`} title={'Call '+member.display_name}><Phone size={14}/><span>Call</span></a>
            <a href={`sms:${member.phone}`} title={'Text '+member.display_name}><MessageSquareText size={14}/><span>Text</span></a>
          </>
        )}
        {member.email&&<a href={`mailto:${member.email}`} title={'Email '+member.display_name}><Mail size={14}/><span>Email</span></a>}
      </div>
    )
  }

  return (
    <div className="page contacts-page">
      <div className="page-heading-row contacts-heading">
        <div>
          <span className="eyebrow">FAMILY CONTACTS</span>
          <h1>Family Contacts Directory</h1>
          <p>Keep important family people and services together — relatives, babysitters, doctors, school, neighbours and emergency contacts.</p>
        </div>
        <button type="button" className="primary-button compact" onClick={openNew}>
          <Plus size={15}/>Add contact
        </button>
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice">{message}</div>}

      <section className="contacts-summary">
        <div>
          <span className="contacts-summary-icon"><ContactRound size={19}/></span>
          <span><strong>{contacts.length}</strong><small>Shared contacts</small></span>
        </div>
        <div>
          <span className="contacts-summary-icon favourite"><Star size={19}/></span>
          <span><strong>{favouriteContacts.length}</strong><small>Favourites</small></span>
        </div>
        <div>
          <span className="contacts-summary-icon emergency"><AlertTriangle size={19}/></span>
          <span><strong>{emergencyContacts.length}</strong><small>Emergency</small></span>
        </div>
        <div>
          <span className="contacts-summary-icon household"><Users size={19}/></span>
          <span><strong>{householdUsers.filter((member)=>member.status==='active').length}</strong><small>Household people</small></span>
        </div>
      </section>

      <section className="contacts-toolbar">
        <label className="contacts-search">
          <Search size={16}/>
          <input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search contacts, phone, organisation, city…"/>
          {search&&<button type="button" onClick={()=>setSearch('')} aria-label="Clear search"><X size={14}/></button>}
        </label>

        <select value={typeFilter} onChange={(event)=>setTypeFilter(event.target.value as 'all'|ContactType)} aria-label="Filter contacts by type">
          <option value="all">All contact types</option>
          {Object.entries(typeLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
        </select>

        <button type="button" className={favouritesOnly?'contacts-filter active':'contacts-filter'} onClick={()=>setFavouritesOnly((current)=>!current)}>
          <Star size={14}/>Favourites
        </button>
        <button type="button" className={emergencyOnly?'contacts-filter emergency active':'contacts-filter emergency'} onClick={()=>setEmergencyOnly((current)=>!current)}>
          <AlertTriangle size={14}/>Emergency
        </button>
      </section>

      <section className="contacts-sos-preparation" aria-label="Family SOS contact and notification preparation">
        <div>
          <strong>Family SOS readiness</strong>
          <p>Keep at least one household phone number and one emergency contact saved. For a safer setup, add numbers for everyone and test notifications on every person's phone.</p>
        </div>
        <Link className="secondary-button compact" to="/app/settings?tab=notifications-security">Enable and test notifications</Link>
      </section>

      <section className="contacts-household-section">
        <div className="contacts-section-head">
          <div>
            <span className="eyebrow">HOUSEHOLD</span>
            <h2>Your Famioo household</h2>
          </div>
          <small>Synced from household profiles</small>
        </div>

        <div className="contacts-household-grid">
          {filteredHousehold.length?filteredHousehold.map((member)=>(
            <article className="household-contact-card" key={member.profile_id}>
              <ProfileAvatar avatarPath={member.avatar_path} name={member.display_name} size="md"/>
              <div className="household-contact-copy">
                <strong>{member.display_name}</strong>
                <small>{member.profile_type==='child'?'Child':member.role==='owner'?'Household owner':'Household member'}</small>
                <span>{member.phone||member.email||'No phone/email saved'}</span>
              </div>
              {householdActions(member)}
              {canEditHouseholdPhone(member)&&<div className="contacts-household-phone-editor">
                {phoneEditor===member.profile_id?(
                  <form className="contacts-household-phone-form" onSubmit={event=>void saveHouseholdPhone(event,member)}>
                    <input type="tel" autoComplete="tel" aria-label={'Phone number for '+member.display_name}
                      maxLength={32} value={phoneDraft} placeholder="+49…" onChange={event=>{setPhoneDraft(event.target.value);setPhoneError('')}}/>
                    <div>
                      <button type="submit" className="secondary-button compact" disabled={phoneSaving}>{phoneSaving?'Saving…':'Save'}</button>
                      {member.phone&&<button type="button" className="secondary-button compact" disabled={phoneSaving}
                        onClick={event=>void saveHouseholdPhone(event,member,true)}>Remove number</button>}
                      <button type="button" className="secondary-button compact" disabled={phoneSaving}
                        onClick={()=>{setPhoneEditor('');setPhoneError('')}}>Cancel</button>
                    </div>
                    {phoneError&&<span role="alert" className="contacts-phone-error">{phoneError}</span>}
                  </form>
                ):<button type="button" className="contacts-phone-edit-button" onClick={()=>openHouseholdPhone(member)}>
                  <Edit3 size={13}/>{member.phone?'Edit / remove number':'Add phone number'}
                </button>}
              </div>}
            </article>
          )):<div className="contacts-empty compact">No household people match this search.</div>}
        </div>
      </section>

      <section className="contacts-directory-section">
        <div className="contacts-section-head">
          <div>
            <span className="eyebrow">SHARED DIRECTORY</span>
            <h2>Important people & services</h2>
          </div>
          <small>{filteredContacts.length} shown</small>
        </div>

        {loading?(
          <div className="contacts-empty">Loading Family Contacts…</div>
        ):filteredContacts.length===0?(
          <div className="contacts-empty">
            <ContactRound size={28}/>
            <strong>{contacts.length?'No contacts match your filters':'Your shared directory is empty'}</strong>
            <span>{contacts.length?'Try another search or filter.':'Add grandparents, doctors, babysitters, school contacts, neighbours or emergency contacts.'}</span>
            {!contacts.length&&<button type="button" className="primary-button compact" onClick={openNew}><Plus size={14}/>Add first contact</button>}
          </div>
        ):(
          <div className="contacts-directory-grid">
            {filteredContacts.map((contact)=>{
              const address=fullAddress(contact)
              return (
                <article className={contact.is_emergency?'directory-contact-card emergency':'directory-contact-card'} key={contact.id}>
                  <header>
                    <span className={'directory-contact-avatar '+contact.contact_type}>{initials(contact.display_name)}</span>
                    <span className="directory-contact-title">
                      <small>{typeLabels[contact.contact_type]}</small>
                      <strong>{contact.display_name}</strong>
                      <em>{contact.relation_label||contact.organisation||'Shared family contact'}</em>
                    </span>
                    <span className="directory-contact-flags">
                      {contact.is_favourite&&<Star size={15} fill="currentColor" aria-label="Favourite"/>}
                      {contact.is_emergency&&<AlertTriangle size={15} aria-label="Emergency contact"/>}
                    </span>
                  </header>

                  <div className="directory-contact-details">
                    {contact.phone&&<span><Phone size={13}/><b>{contact.phone}</b></span>}
                    {contact.secondary_phone&&<span><Phone size={13}/><b>{contact.secondary_phone}</b></span>}
                    {contact.email&&<span><Mail size={13}/><b>{contact.email}</b></span>}
                    {contact.organisation&&<span><Building2 size={13}/><b>{contact.organisation}</b></span>}
                    {address&&<span><MapPin size={13}/><b>{address}</b></span>}
                  </div>

                  {contact.notes&&<p className="directory-contact-notes">{contact.notes}</p>}

                  {contactActions(contact)}

                  <footer>
                    <button type="button" onClick={()=>openEdit(contact)}><Edit3 size={13}/>Edit</button>
                    <button type="button" className="danger" disabled={deletingId===contact.id} onClick={()=>void deleteContact(contact)}>
                      <Trash2 size={13}/>{deletingId===contact.id?'Removing…':'Remove'}
                    </button>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <div className="contacts-info-note">
        <Heart size={16}/>
        <span>
          <strong>Shared with the household</strong>
          <small>Family Contacts are visible to active members of this Famioo household. Household member cards above are synced automatically; shared-directory contacts are managed here separately.</small>
        </span>
      </div>

      {editorOpen&&(
        <div className="modal-backdrop contacts-editor-backdrop" role="dialog" aria-modal="true" aria-label={draft.id?'Edit family contact':'Add family contact'}>
          <section className="modal-card contacts-editor">
            <header>
              <div>
                <span className="eyebrow">{draft.id?'EDIT CONTACT':'NEW CONTACT'}</span>
                <h2>{draft.id?'Update contact':'Add to Family Contacts'}</h2>
              </div>
              <button type="button" className="icon-button" onClick={()=>setEditorOpen(false)} aria-label="Close"><X size={18}/></button>
            </header>

            <form onSubmit={saveContact}>
              <div className="contacts-form-grid">
                <label>
                  <span>Contact type</span>
                  <select value={draft.contact_type} onChange={(event)=>setDraft((current)=>({...current,contact_type:event.target.value as ContactType}))}>
                    {Object.entries(typeLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
                  </select>
                </label>

                <label className="contacts-field-wide">
                  <span>Name *</span>
                  <input value={draft.display_name} onChange={(event)=>setDraft((current)=>({...current,display_name:event.target.value}))} required maxLength={160} placeholder="e.g. Dr. Anna Müller"/>
                </label>

                <label>
                  <span>Relation / role</span>
                  <input value={draft.relation_label} onChange={(event)=>setDraft((current)=>({...current,relation_label:event.target.value}))} placeholder="e.g. Grandma, Paediatrician"/>
                </label>

                <label>
                  <span>Organisation</span>
                  <input value={draft.organisation} onChange={(event)=>setDraft((current)=>({...current,organisation:event.target.value}))} placeholder="Practice, school, company…"/>
                </label>

                <label>
                  <span>Phone</span>
                  <input type="tel" value={draft.phone} onChange={(event)=>setDraft((current)=>({...current,phone:event.target.value}))} placeholder="+49…"/>
                </label>

                <label>
                  <span>Second phone</span>
                  <input type="tel" value={draft.secondary_phone} onChange={(event)=>setDraft((current)=>({...current,secondary_phone:event.target.value}))}/>
                </label>

                <label className="contacts-field-wide">
                  <span>Email</span>
                  <input type="email" value={draft.email} onChange={(event)=>setDraft((current)=>({...current,email:event.target.value}))} placeholder="name@example.com"/>
                </label>

                <label className="contacts-field-wide">
                  <span>Street / address</span>
                  <input value={draft.address_line} onChange={(event)=>setDraft((current)=>({...current,address_line:event.target.value}))} placeholder="Street and house number"/>
                </label>

                <label>
                  <span>Postal code</span>
                  <input value={draft.postal_code} onChange={(event)=>setDraft((current)=>({...current,postal_code:event.target.value}))}/>
                </label>

                <label>
                  <span>City</span>
                  <input value={draft.city} onChange={(event)=>setDraft((current)=>({...current,city:event.target.value}))}/>
                </label>

                <label>
                  <span>Country</span>
                  <input value={draft.country} onChange={(event)=>setDraft((current)=>({...current,country:event.target.value}))}/>
                </label>

                <label className="contacts-field-wide">
                  <span>Website</span>
                  <input value={draft.website} onChange={(event)=>setDraft((current)=>({...current,website:event.target.value}))} placeholder="www.example.com"/>
                </label>

                <label className="contacts-field-wide">
                  <span>Notes</span>
                  <textarea value={draft.notes} onChange={(event)=>setDraft((current)=>({...current,notes:event.target.value}))} rows={4} maxLength={5000} placeholder="Opening hours, preferred contact person, instructions…"/>
                </label>
              </div>

              <div className="contacts-form-flags">
                <label>
                  <input type="checkbox" checked={draft.is_favourite} onChange={(event)=>setDraft((current)=>({...current,is_favourite:event.target.checked}))}/>
                  <span><Star size={14}/>Favourite</span>
                </label>
                <label className="emergency">
                  <input type="checkbox" checked={draft.is_emergency} onChange={(event)=>setDraft((current)=>({...current,is_emergency:event.target.checked}))}/>
                  <span><AlertTriangle size={14}/>Emergency contact</span>
                </label>
              </div>

              <footer className="contacts-editor-actions">
                <button type="button" className="secondary-button" onClick={()=>setEditorOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving||!draft.display_name.trim()}>
                  {saving?'Saving…':draft.id?'Save changes':'Add contact'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
