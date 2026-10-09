import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ContactRound,
  Phone,
  Plus,
  ShieldCheck,
  UserRoundCheck,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type PickupStatus='authorized'|'confirmed'|'cancelled'
type Filter='active'|'upcoming'|'history'

type Authorization={
  id:string
  child_profile_id:string
  pickup_contact_id:string
  pickup_date:string
  valid_from:string|null
  valid_until:string|null
  note:string|null
  status:PickupStatus
  created_by_user_id:string
  confirmed_by_user_id:string|null
  confirmed_at:string|null
  cancelled_by_user_id:string|null
  cancelled_at:string|null
  created_at:string
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
  is_favourite:boolean
  active?:boolean
}

type HouseholdUser={
  user_id:string|null
  display_name:string
}

type Draft={
  child_profile_id:string
  pickup_contact_id:string
  pickup_date:string
  valid_from:string
  valid_until:string
  note:string
}

function datePartsInZone(timezone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(new Date())
  const value=(type:string)=>parts.find(part=>part.type===type)?.value??''
  return {
    date:value('year')+'-'+value('month')+'-'+value('day'),
    minutes:Number(value('hour'))*60+Number(value('minute')),
  }
}

function timeMinutes(value:string|null){
  if(!value)return null
  const [hour,minute]=value.slice(0,5).split(':').map(Number)
  return hour*60+minute
}

function formatDate(value:string){
  return new Date(value+'T12:00:00').toLocaleDateString(undefined,{
    weekday:'short',day:'numeric',month:'short',year:'numeric',
  })
}

function formatTime(value:string|null){
  return value?value.slice(0,5):''
}

function statusFor(row:Authorization,timezone:string){
  if(row.status==='confirmed')return 'confirmed'
  if(row.status==='cancelled')return 'cancelled'
  const now=datePartsInZone(timezone)
  if(row.pickup_date<now.date)return 'expired'
  if(row.pickup_date===now.date&&row.valid_until){
    const end=timeMinutes(row.valid_until)
    if(end!=null&&now.minutes>end)return 'expired'
  }
  return row.pickup_date===now.date?'today':'upcoming'
}

export function PickupAuthorizationPage(){
  const {household,profiles,user,modules}=useHousehold()
  const access=modules.find(module=>module.code==='pickup_authorization')
  const currentProfile=profiles.find(profile=>profile.linked_user_id===user.id)??null
  const canManage=Boolean(
    access?.enabled&&access?.can_write&&(
      household.role==='owner'||household.role==='admin'||currentProfile?.profile_type==='adult'
    ),
  )
  const children=profiles.filter(profile=>profile.profile_type==='child'||profile.profile_type==='profile_only')

  const [authorizations,setAuthorizations]=useState<Authorization[]>([])
  const [contacts,setContacts]=useState<DirectoryContact[]>([])
  const [householdUsers,setHouseholdUsers]=useState<HouseholdUser[]>([])
  const [filter,setFilter]=useState<Filter>('active')
  const [editorOpen,setEditorOpen]=useState(false)
  const [draft,setDraft]=useState<Draft>({
    child_profile_id:'',
    pickup_contact_id:'',
    pickup_date:datePartsInZone(household.timezone).date,
    valid_from:'',
    valid_until:'',
    note:'',
  })
  const [saving,setSaving]=useState(false)
  const [actingId,setActingId]=useState('')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const profileById=useMemo(()=>new Map(profiles.map(profile=>[profile.id,profile])),[profiles])
  const contactById=useMemo(()=>new Map(contacts.map(contact=>[contact.id,contact])),[contacts])
  const userNameById=useMemo(()=>new Map(
    householdUsers.filter(member=>member.user_id).map(member=>[member.user_id!,member.display_name]),
  ),[householdUsers])

  const eligibleContacts=useMemo(()=>contacts
    .filter(contact=>contact.active!==false)
    .sort((a,b)=>{
      const rank=(item:DirectoryContact)=>
        item.contact_type==='family'?0:item.contact_type==='babysitter'?1:item.contact_type==='neighbour'?2:3
      return rank(a)-rank(b)||a.display_name.localeCompare(b.display_name)
    }),[contacts])

  const visible=useMemo(()=>{
    const now=datePartsInZone(household.timezone)
    return authorizations.filter(row=>{
      const visual=statusFor(row,household.timezone)
      if(filter==='active')return row.status==='authorized'&&row.pickup_date===now.date&&visual!=='expired'
      if(filter==='upcoming')return row.status==='authorized'&&row.pickup_date>now.date
      return row.status!=='authorized'||visual==='expired'||row.pickup_date<now.date
    })
  },[authorizations,filter,household.timezone])

  const activeCount=authorizations.filter(row=>{
    const now=datePartsInZone(household.timezone)
    return row.status==='authorized'&&row.pickup_date===now.date&&statusFor(row,household.timezone)!=='expired'
  }).length
  const upcomingCount=authorizations.filter(row=>row.status==='authorized'&&row.pickup_date>datePartsInZone(household.timezone).date).length

  const load=useCallback(async(foreground=false)=>{
    if(foreground)setLoading(true)
    setError('')
    const [authorizationResult,contactResult,userResult]=await Promise.all([
      supabase.from('family_pickup_authorizations')
        .select('id,child_profile_id,pickup_contact_id,pickup_date,valid_from,valid_until,note,status,created_by_user_id,confirmed_by_user_id,confirmed_at,cancelled_by_user_id,cancelled_at,created_at')
        .eq('household_id',household.id)
        .order('pickup_date',{ascending:false})
        .order('created_at',{ascending:false}),
      supabase.rpc('family_contacts_v1',{p_household_id:household.id}),
      supabase.rpc('household_users_v1',{p_household_id:household.id}),
    ])

    if(authorizationResult.error)setError(authorizationResult.error.message)
    else setAuthorizations((authorizationResult.data??[]) as Authorization[])

    if(contactResult.error)setError(current=>current||contactResult.error.message)
    else setContacts((contactResult.data??[]) as DirectoryContact[])

    if(!userResult.error)setHouseholdUsers((userResult.data??[]) as HouseholdUser[])
    if(foreground)setLoading(false)
  },[household.id])

  useEffect(()=>{void load(true)},[load])

  function openNew(){
    const today=datePartsInZone(household.timezone).date
    setDraft({
      child_profile_id:children[0]?.id??'',
      pickup_contact_id:'',
      pickup_date:today,
      valid_from:'',
      valid_until:'',
      note:'',
    })
    setError('')
    setMessage('')
    setEditorOpen(true)
  }

  async function saveAuthorization(event:FormEvent){
    event.preventDefault()
    if(!canManage||!draft.child_profile_id||!draft.pickup_contact_id||!draft.pickup_date)return
    if(draft.valid_from&&draft.valid_until&&draft.valid_until<=draft.valid_from){
      setError('End time must be after start time.')
      return
    }

    setSaving(true);setError('')
    const result=await supabase.rpc('create_family_pickup_authorization_v1',{
      p_household_id:household.id,
      p_child_profile_id:draft.child_profile_id,
      p_pickup_contact_id:draft.pickup_contact_id,
      p_pickup_date:draft.pickup_date,
      p_valid_from:draft.valid_from||null,
      p_valid_until:draft.valid_until||null,
      p_note:draft.note.trim()||null,
    })
    setSaving(false)

    if(result.error){setError(result.error.message);return}
    setEditorOpen(false)
    setMessage('One-time pickup authorization created.')
    setFilter(draft.pickup_date===datePartsInZone(household.timezone).date?'active':'upcoming')
    await load(false)
  }

  async function confirmPickup(row:Authorization){
    if(!window.confirm('Confirm that this pickup has taken place?'))return
    setActingId(row.id);setError('');setMessage('')
    const result=await supabase.rpc('confirm_family_pickup_authorization_v1',{
      p_household_id:household.id,p_authorization_id:row.id,
    })
    setActingId('')
    if(result.error){setError(result.error.message);return}
    if(result.data!==true){setError('This authorization could not be confirmed yet or is no longer active.');return}
    setMessage('Pickup confirmed by guardian.')
    await load(false)
  }

  async function cancelAuthorization(row:Authorization){
    if(!window.confirm('Cancel this one-time pickup authorization?'))return
    setActingId(row.id);setError('');setMessage('')
    const result=await supabase.rpc('cancel_family_pickup_authorization_v1',{
      p_household_id:household.id,p_authorization_id:row.id,
    })
    setActingId('')
    if(result.error){setError(result.error.message);return}
    if(result.data!==true){setError('This authorization is no longer active.');return}
    setMessage('Pickup authorization cancelled.')
    await load(false)
  }

  if(loading)return <div className="page pickup-page"><div className="pickup-empty">Loading pickup authorizations…</div></div>

  return <div className="page pickup-page">
    <div className="page-heading-row pickup-heading">
      <div>
        <span className="eyebrow">PICKUP AUTHORIZATION</span>
        <h1>Who can pick up your child?</h1>
        <p>Create a one-time authorization for a trusted Family Contact, then confirm the pickup when it has happened.</p>
      </div>
      {canManage&&children.length>0&&<button className="primary-button compact" onClick={openNew}><Plus size={14}/>Authorize pickup</button>}
    </div>

    <div className="pickup-safety-note">
      <ShieldCheck size={16}/>
      <span><strong>Guardian-controlled.</strong> Children can view household pickup information, but only adult guardians can create, cancel or confirm an authorization.</span>
    </div>

    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    {children.length===0?<div className="pickup-empty"><UserRoundCheck size={30}/><strong>No child profiles available.</strong><span>Add a child or profile-only family member before creating pickup authorization.</span></div>:<>
      <section className="pickup-summary-grid">
        <article><span><BadgeCheck size={18}/></span><div><small>TODAY</small><strong>{activeCount}</strong><em>active authorization{activeCount===1?'':'s'}</em></div></article>
        <article><span><CalendarDays size={18}/></span><div><small>UPCOMING</small><strong>{upcomingCount}</strong><em>scheduled pickup{upcomingCount===1?'':'s'}</em></div></article>
        <article><span><ContactRound size={18}/></span><div><small>TRUSTED PEOPLE</small><strong>{eligibleContacts.length}</strong><em>Family Contacts available</em></div></article>
      </section>

      <div className="pickup-filter-bar">
        <button className={filter==='active'?'active':''} onClick={()=>setFilter('active')}>Today <span>{activeCount}</span></button>
        <button className={filter==='upcoming'?'active':''} onClick={()=>setFilter('upcoming')}>Upcoming <span>{upcomingCount}</span></button>
        <button className={filter==='history'?'active':''} onClick={()=>setFilter('history')}>History</button>
      </div>

      {visible.length===0?<div className="pickup-empty compact"><BadgeCheck size={25}/><strong>{filter==='active'?'No active pickup authorizations today.':filter==='upcoming'?'No upcoming pickup authorizations.':'No pickup history yet.'}</strong>{canManage&&filter==='active'&&<button className="primary-button compact" onClick={openNew}><Plus size={13}/>Authorize pickup</button>}</div>:<section className="pickup-list">
        {visible.map(row=>{
          const child=profileById.get(row.child_profile_id)
          const contact=contactById.get(row.pickup_contact_id)
          const visual=statusFor(row,household.timezone)
          const phone=contact?.phone||contact?.secondary_phone||null
          const today=datePartsInZone(household.timezone).date
          const confirmAllowed=canManage&&row.status==='authorized'&&row.pickup_date<=today
          return <article className={'pickup-card '+visual} key={row.id}>
            <header>
              <div className="pickup-child">
                {child&&<ProfileAvatar avatarPath={child.avatar_path} name={child.display_name} size="md"/>}
                <span><small>CHILD</small><strong>{child?.display_name??'Family child'}</strong><em>{formatDate(row.pickup_date)}</em></span>
              </div>
              <span className={'pickup-status '+visual}>{visual==='today'?'AUTHORIZED TODAY':visual.toUpperCase()}</span>
            </header>

            <div className="pickup-person">
              <span className="pickup-person-icon"><UserRoundCheck size={20}/></span>
              <div><small>APPROVED PICKUP PERSON</small><strong>{contact?.display_name??'Family Contact'}</strong><em>{contact?.relation_label||contact?.organisation||contact?.contact_type||'Trusted contact'}</em></div>
              {phone&&<a href={'tel:'+phone}><Phone size={14}/>{phone}</a>}
            </div>

            <div className="pickup-details">
              <span><CalendarDays size={13}/><b>{formatDate(row.pickup_date)}</b></span>
              {(row.valid_from||row.valid_until)&&<span><Clock3 size={13}/><b>{row.valid_from?formatTime(row.valid_from):'Any time'}{row.valid_until?' – '+formatTime(row.valid_until):''}</b></span>}
              <span><BadgeCheck size={13}/><b>One-time authorization</b></span>
            </div>

            {row.note&&<p className="pickup-note">{row.note}</p>}

            {(row.status==='confirmed'||row.status==='cancelled')&&<div className={'pickup-resolution '+row.status}>
              {row.status==='confirmed'?<CheckCircle2 size={15}/>:<XCircle size={15}/>}
              <span><strong>{row.status==='confirmed'?'Pickup confirmed':'Authorization cancelled'}</strong><small>{row.status==='confirmed'&&row.confirmed_at?formatWhen(row.confirmed_at):row.cancelled_at?formatWhen(row.cancelled_at):''}{row.status==='confirmed'&&row.confirmed_by_user_id?' · '+(userNameById.get(row.confirmed_by_user_id)??'Guardian'):row.status==='cancelled'&&row.cancelled_by_user_id?' · '+(userNameById.get(row.cancelled_by_user_id)??'Guardian'):''}</small></span>
            </div>}

            {visual==='expired'&&row.status==='authorized'&&<div className="pickup-resolution expired"><Clock3 size={15}/><span><strong>Authorization expired</strong><small>No pickup confirmation was recorded.</small></span></div>}

            {canManage&&row.status==='authorized'&&<footer>
              {confirmAllowed&&<button className="primary-button compact" disabled={actingId===row.id} onClick={()=>void confirmPickup(row)}><CheckCircle2 size={13}/>Confirm pickup</button>}
              <button className="secondary-button compact" disabled={actingId===row.id} onClick={()=>void cancelAuthorization(row)}><X size={13}/>Cancel</button>
            </footer>}
          </article>
        })}
      </section>}
    </>}

    {editorOpen&&<div className="modal-backdrop pickup-modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card pickup-editor">
      <header><div><span className="eyebrow">ONE-TIME AUTHORIZATION</span><h2>Authorize pickup</h2></div><button className="icon-button" onClick={()=>setEditorOpen(false)}><X size={18}/></button></header>
      <form onSubmit={saveAuthorization}>
        <label><span>Child *</span><select required value={draft.child_profile_id} onChange={event=>setDraft(current=>({...current,child_profile_id:event.target.value}))}>{children.map(child=><option value={child.id} key={child.id}>{child.display_name}</option>)}</select></label>
        <label><span>Approved pickup person *</span><select required value={draft.pickup_contact_id} onChange={event=>setDraft(current=>({...current,pickup_contact_id:event.target.value}))}><option value="">Choose Family Contact…</option>{eligibleContacts.map(contact=><option value={contact.id} key={contact.id}>{contact.display_name}{contact.relation_label?' · '+contact.relation_label:contact.contact_type?' · '+contact.contact_type:''}</option>)}</select></label>
        {eligibleContacts.length===0&&<div className="pickup-contact-warning"><ContactRound size={15}/><span>No Family Contacts are available yet. <Link to="/app/contacts">Add a trusted pickup person first.</Link></span></div>}
        <div className="pickup-editor-row">
          <label><span>Pickup date *</span><input required type="date" min={datePartsInZone(household.timezone).date} value={draft.pickup_date} onChange={event=>setDraft(current=>({...current,pickup_date:event.target.value}))}/></label>
          <label><span>Valid from</span><input type="time" value={draft.valid_from} onChange={event=>setDraft(current=>({...current,valid_from:event.target.value}))}/></label>
          <label><span>Valid until</span><input type="time" value={draft.valid_until} onChange={event=>setDraft(current=>({...current,valid_until:event.target.value}))}/></label>
        </div>
        <label><span>Note</span><textarea rows={3} maxLength={1000} value={draft.note} onChange={event=>setDraft(current=>({...current,note:event.target.value}))} placeholder="e.g. Pickup from main school entrance. ID may be requested."/></label>
        <div className="pickup-one-time-note"><BadgeCheck size={15}/><span>This authorization is valid only for the selected date. It does not permanently approve this person for future pickups.</span></div>
        <footer><button type="button" className="secondary-button" onClick={()=>setEditorOpen(false)}>Cancel</button><button className="primary-button" disabled={saving||!draft.pickup_contact_id}>{saving?'Authorizing…':'Create authorization'}</button></footer>
      </form>
    </section></div>}
  </div>
}

function formatWhen(value:string){
  return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
}
