import {
  Archive,
  CalendarDays,
  ArrowLeft,
  MessageCircle,
  Share2,
  Images,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { useMobileKeyboardViewport } from '../hooks/useMobileKeyboardViewport'
import { supabase } from '../lib/supabase'
import { isFreePlanAccount } from '../lib/accountPlan'
import { optimizeMemoryPhoto } from '../lib/photoOptimization'

type AlbumType='birthday'|'trip'|'holiday'|'school'|'family'|'other'
type Album={
  id:string
  title:string
  album_type:AlbumType
  memory_date:string|null
  event_id:string|null
  description:string|null
  cover_file_id:string|null
  archived_at:string|null
  created_at:string
  updated_at:string
}
type MemoryPhoto={
  id:string
  album_id:string
  file_id:string
  caption:string|null
  taken_date:string|null
  sort_order:number
  created_at:string
}
type FileRow={
  id:string
  title:string
  file_name:string
  storage_path:string
  mime_type:string|null
  file_size:number
  created_at:string
}
type CalendarEvent={
  id:string
  title:string
  all_day:boolean
  start_date:string|null
  start_at:string|null
  event_timezone:string
}
type AlbumDraft={
  id:string
  title:string
  album_type:AlbumType
  memory_date:string
  event_id:string
  description:string
}
const emptyAlbum:AlbumDraft={id:'',title:'',album_type:'family',memory_date:'',event_id:'',description:''}

function fmtDate(value:string|null){
  if(!value)return ''
  return new Date(value+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})
}
function eventDate(item:CalendarEvent){
  if(item.all_day)return item.start_date
  if(!item.start_at)return null
  return new Date(item.start_at).toLocaleDateString('en-CA',{timeZone:item.event_timezone})
}
function albumTypeLabel(type:AlbumType){
  if(type==='birthday')return 'Birthday'
  if(type==='trip')return 'Trip'
  if(type==='holiday')return 'Holiday'
  if(type==='school')return 'School'
  if(type==='family')return 'Family'
  return 'Other'
}
function albumEmoji(type:AlbumType){
  if(type==='birthday')return '🎂'
  if(type==='trip')return '✈️'
  if(type==='holiday')return '🎉'
  if(type==='school')return '🎓'
  if(type==='family')return '❤️'
  return '📸'
}

export function MemoriesPage(){
  const {household,modules,user}=useHousehold()
  const individualFree=isFreePlanAccount(user)
  const access=modules.find(module=>module.code==='memories')
  const canWrite=Boolean(access?.enabled&&access?.can_write)
  const [albums,setAlbums]=useState<Album[]>([])
  const [photos,setPhotos]=useState<MemoryPhoto[]>([])
  const [files,setFiles]=useState<FileRow[]>([])
  const [events,setEvents]=useState<CalendarEvent[]>([])
  const [urls,setUrls]=useState<Record<string,string>>({})
  const [memoriesUsage,setMemoriesUsage]=useState<{used:number;quota:number}|null>(null)
  const [selectedId,setSelectedId]=useState('')
  const [showArchived,setShowArchived]=useState(false)
  const [editorOpen,setEditorOpen]=useState(false)
  const editorViewportRef=useMobileKeyboardViewport<HTMLDivElement>(editorOpen)
  const [draft,setDraft]=useState<AlbumDraft>(emptyAlbum)
  const [busy,setBusy]=useState(false)
  const [uploadProgress,setUploadProgress]=useState('')
  const [sharingPhotoId,setSharingPhotoId]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const visibleAlbums=useMemo(
    ()=>albums.filter(album=>showArchived?Boolean(album.archived_at):!album.archived_at),
    [albums,showArchived],
  )
  const selected=visibleAlbums.find(album=>album.id===selectedId)??null
  const selectedPhotos=useMemo(
    ()=>photos.filter(photo=>photo.album_id===selected?.id),
    [photos,selected?.id],
  )
  const fileById=useMemo(()=>new Map(files.map(file=>[file.id,file])),[files])

  // Do not request a signed URL for every household image on every visit.
  // Only covers and photos in the open album need URLs, and off-screen images
  // will use native browser lazy loading.
  useEffect(()=>{
    let cancelled=false
    const neededIds=new Set<string>()
    for(const album of visibleAlbums)if(album.cover_file_id)neededIds.add(album.cover_file_id)
    for(const photo of selectedPhotos)neededIds.add(photo.file_id)
    const required=[...neededIds]
      .filter(id=>urls[id]===undefined)
      .map(id=>fileById.get(id))
      .filter((file):file is FileRow=>Boolean(file))

    if(!required.length)return
    void Promise.all(required.map(async file=>{
      const result=await supabase.storage.from('famioo-files').createSignedUrl(file.storage_path,21600)
      return [file.id,result.data?.signedUrl??''] as const
    })).then(signed=>{
      if(cancelled)return
      setUrls(current=>({...current,...Object.fromEntries(signed)}))
    })
    return ()=>{cancelled=true}
  },[visibleAlbums,selectedPhotos,fileById,urls])

  async function load(foreground=false){
    if(foreground)setBusy(true)
    setError('')
    const [albumResult,photoResult,fileResult,eventResult,quotaResult]=await Promise.all([
      supabase.from('family_memory_albums')
        .select('id,title,album_type,memory_date,event_id,description,cover_file_id,archived_at,created_at,updated_at')
        .eq('household_id',household.id).order('memory_date',{ascending:false}).order('created_at',{ascending:false}),
      supabase.from('family_memory_photos')
        .select('id,album_id,file_id,caption,taken_date,sort_order,created_at')
        .eq('household_id',household.id).order('sort_order').order('created_at'),
      supabase.from('household_files')
        .select('id,title,file_name,storage_path,mime_type,file_size,created_at')
        .eq('household_id',household.id).eq('status','active').is('archived_at',null)
        .order('created_at',{ascending:false}),
      supabase.from('calendar_events')
        .select('id,title,all_day,start_date,start_at,event_timezone')
        .eq('household_id',household.id).is('deleted_at',null).eq('status','active')
        .order('created_at',{ascending:false}).limit(250),
      individualFree ? supabase.rpc('free_account_storage_usage_v1') : Promise.resolve({data:null,error:null}),
    ])
    const failure=albumResult.error||photoResult.error||fileResult.error||eventResult.error
    if(individualFree && !quotaResult.error && quotaResult.data){
      const quotaRow=Array.isArray(quotaResult.data)?quotaResult.data[0]:quotaResult.data
      if(quotaRow)setMemoriesUsage({used:Number(quotaRow.memories_used_bytes),quota:Number(quotaRow.memories_quota_bytes)})
    }
    if(failure)setError(failure.message)
    const albumRows=(albumResult.data??[]) as Album[]
    const fileRows=((fileResult.data??[]) as FileRow[]).map(file=>({...file,file_size:Number(file.file_size)}))
    setAlbums(albumRows)
    setPhotos(((photoResult.data??[]) as MemoryPhoto[]).map(photo=>({...photo,sort_order:Number(photo.sort_order)})))
    setFiles(fileRows)
    setEvents((eventResult.data??[]) as CalendarEvent[])
    setSelectedId(current=>albumRows.some(album=>album.id===current)?current:'')

    if(foreground)setBusy(false)
  }

  useEffect(()=>{void load(true)},[household.id])

  function openAlbumEditor(album?:Album){
    setDraft(album?{
      id:album.id,title:album.title,album_type:album.album_type,memory_date:album.memory_date??'',
      event_id:album.event_id??'',description:album.description??'',
    }:{...emptyAlbum})
    setEditorOpen(true);setError('');setMessage('')
  }

  async function saveAlbum(event:FormEvent){
    event.preventDefault()
    setBusy(true);setError('')
    const result=await supabase.rpc('save_family_memory_album_v1',{
      p_id:draft.id||null,p_household_id:household.id,p_title:draft.title.trim(),
      p_album_type:draft.album_type,p_memory_date:draft.memory_date||null,
      p_event_id:draft.event_id||null,p_description:draft.description.trim()||null,
    })
    setBusy(false)
    if(result.error){setError(result.error.message);return}
    setSelectedId(String(result.data));setEditorOpen(false);setMessage(draft.id?'Album updated.':'Album created.')
    await load(false)
  }

  async function archiveAlbum(album:Album,restore=false){
    const result=await supabase.from('family_memory_albums')
      .update({archived_at:restore?null:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq('id',album.id).eq('household_id',household.id)
    if(result.error){setError(result.error.message);return}
    setMessage(restore?'Album restored.':'Album archived.')
    setSelectedId('')
    await load(false)
  }

  // Process one reservation at a time: each successful image counts toward
  // Free storage quota, and a failed photo cannot block the rest of the batch.
  async function uploadPhotoToAlbum(file:File,album:Album,usedBytes:number):Promise<{addedBytes:number;error?:string}>{
    if(!file.type.startsWith('image/'))return {addedBytes:0,error:'Not an image'}
    if(file.size>50*1024*1024)return {addedBytes:0,error:'Image exceeds the 50 MB limit'}
    let optimized:File
    try{optimized=await optimizeMemoryPhoto(file)}catch{return {addedBytes:0,error:'Could not prepare image'}}
    if(individualFree&&memoriesUsage&&usedBytes+optimized.size>memoriesUsage.quota){
      return {addedBytes:0,error:'Free Memories storage limit reached'}
    }
    const reserve=await supabase.rpc('reserve_household_file_v1',{
      p_household_id:household.id,p_title:file.name.replace(/\.[^.]+$/,'')||'Memory photo',
      p_file_name:optimized.name,p_mime_type:optimized.type,p_file_size:optimized.size,
      p_category:'photo',p_notes:'Family memory: '+album.title,
    })
    if(reserve.error)return {addedBytes:0,error:reserve.error.message}
    const reservation=Array.isArray(reserve.data)?reserve.data[0]:reserve.data
    const fileId=reservation?.file_id as string|undefined
    const storagePath=reservation?.storage_path as string|undefined
    if(!fileId||!storagePath)return {addedBytes:0,error:'Could not reserve photo storage'}

    const upload=await supabase.storage.from('famioo-files').upload(storagePath,optimized,{upsert:false,contentType:optimized.type})
    if(upload.error){
      await supabase.rpc('cancel_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
      return {addedBytes:0,error:upload.error.message}
    }
    const complete=await supabase.rpc('complete_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
    if(complete.error){
      await supabase.storage.from('famioo-files').remove([storagePath])
      await supabase.rpc('cancel_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
      return {addedBytes:0,error:complete.error.message}
    }
    const attach=await supabase.rpc('attach_family_memory_photo_v1',{
      p_household_id:household.id,p_album_id:album.id,p_file_id:fileId,
      p_caption:null,p_taken_date:album.memory_date,
    })
    if(attach.error)return {addedBytes:0,error:attach.error.message+' (photo saved in Files but not attached)'}
    return {addedBytes:optimized.size}
  }

  async function uploadPhotos(selectedFiles:File[]){
    const album=selected
    if(!album||!canWrite||busy||!selectedFiles.length)return
    // Prevent a massive photo-library selection from tying up mobile Safari.
    const batch=selectedFiles.slice(0,30)
    const errors:string[]=[]
    let added=0
    let usedBytes=memoriesUsage?.used??0
    setBusy(true);setError('');setMessage('')
    try{
      for(let i=0;i<batch.length;i++){
        setUploadProgress('Uploading '+(i+1)+' of '+batch.length+' photos…')
        try{
          const outcome=await uploadPhotoToAlbum(batch[i],album,usedBytes)
          if(outcome.error)errors.push(batch[i].name+': '+outcome.error)
          else {added++;usedBytes+=outcome.addedBytes}
        }catch{
          errors.push(batch[i].name+': unexpected upload error')
        }
      }
      if(selectedFiles.length>batch.length)errors.push('Choose up to 30 photos per batch.')
      if(added)setMessage(added+' photo'+(added===1?'':'s')+' added to '+album.title+'.')
      if(errors.length)setError(errors.length+' photo'+(errors.length===1?'':'s')+' could not be added. '+errors.slice(0,3).join('; ')+(errors.length>3?'; and '+(errors.length-3)+' more.':''))
      await load(false)
    }finally{
      setBusy(false)
      setUploadProgress('')
    }
  }

  function chooseUpload(event:ChangeEvent<HTMLInputElement>){
    const selectedFiles=Array.from(event.currentTarget.files??[])
    event.currentTarget.value=''
    if(selectedFiles.length)void uploadPhotos(selectedFiles)
  }

  async function importEventPhotos(){
    if(!selected?.event_id)return
    setBusy(true);setError('')
    const result=await supabase.rpc('import_event_photos_to_memory_album_v1',{
      p_household_id:household.id,p_album_id:selected.id,
    })
    setBusy(false)
    if(result.error){setError(result.error.message);return}
    const count=Number(result.data??0)
    setMessage(count?count+' event photo'+(count===1?'':'s')+' imported.':'All event photos are already in this album.')
    await load(false)
  }

  async function removePhoto(photo:MemoryPhoto){
    const file=fileById.get(photo.file_id)
    if(!window.confirm('Remove '+(file?.title||'this photo')+' from the album? The original remains in Famioo Files.'))return
    const result=await supabase.rpc('remove_family_memory_photo_v1',{
      p_household_id:household.id,p_photo_id:photo.id,
    })
    if(result.error)setError(result.error.message)
    else{setMessage('Photo removed from album.');await load(false)}
  }

  if(busy&&albums.length===0)return <div className="page memories-page"><div className="memories-empty">Loading memories…</div></div>

  return <div className="page memories-page">
    <div className="page-heading-row memories-heading">
      <div><span className="eyebrow">FAMILY PHOTO ALBUMS / MEMORIES</span><h1>Family memories</h1><p>Shared albums for birthdays, trips, holidays, school moments and everyday family life.</p>{individualFree&&<p className="free-storage-note">{memoriesUsage?'Free plan: '+(memoriesUsage.used/(1024*1024)).toFixed(1)+' of 100 MB used':'Free plan: 100 MB photo allowance'} · 10 GB upgrade available separately for €3/month.</p>}</div>
      {canWrite&&<button className="primary-button compact" onClick={()=>openAlbumEditor()}><Plus size={14}/>New album</button>}
    </div>

    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    {!selected?<>
      <div className="memories-toolbar">
        <button className={!showArchived?'active':''} onClick={()=>setShowArchived(false)}>Albums <span>{albums.filter(album=>!album.archived_at).length}</span></button>
        <button className={showArchived?'active':''} onClick={()=>setShowArchived(true)}>Archive <span>{albums.filter(album=>Boolean(album.archived_at)).length}</span></button>
      </div>

      {visibleAlbums.length===0?
        <div className="memories-empty"><Images size={34}/><strong>{showArchived?'No archived albums.':'No family albums yet.'}</strong>
          <span>{showArchived?'Archived albums will appear here.':'Create your first album to start collecting photos.'}</span>
          {canWrite&&!showArchived&&<button className="primary-button compact" onClick={()=>openAlbumEditor()}><Plus size={14}/>Create album</button>}
        </div>
      :<section className="memory-album-dashboard">
        {visibleAlbums.map(album=>{
          const albumPhotos=photos.filter(photo=>photo.album_id===album.id)
          const coverId=album.cover_file_id||albumPhotos[0]?.file_id
          const cover=coverId?urls[coverId]:null
          return <button type="button" className="memory-dashboard-album" onClick={()=>setSelectedId(album.id)} key={album.id}>
            <span className="memory-dashboard-cover">{cover?<img src={cover} loading="lazy" decoding="async" alt=""/>:<b>{albumEmoji(album.album_type)}</b>}</span>
            <span className="memory-dashboard-info">
              <small>{albumTypeLabel(album.album_type)}{album.memory_date?' · '+fmtDate(album.memory_date):''}</small>
              <strong>{album.title}</strong>
              <em>{albumPhotos.length} photo{albumPhotos.length===1?'':'s'}</em>
            </span>
          </button>
        })}
      </section>}
    </>:<section className="memory-album-detail">
      <div className="memory-album-navigation">
        <button type="button" className="secondary-button compact" onClick={()=>setSelectedId('')}><ArrowLeft size={15}/>All albums</button>
        <span>{albumTypeLabel(selected.album_type)}{selected.memory_date?' · '+fmtDate(selected.memory_date):''}</span>
      </div>
      <header className="memory-album-hero">
        <span className="memory-album-symbol">{albumEmoji(selected.album_type)}</span>
        <div><h2>{selected.title}</h2>{selectedPhotos.length>0&&selected.description&&<p>{selected.description}</p>}</div>
        {selectedPhotos.length>0&&canWrite&&<div className="memory-hero-actions">
          <button className="secondary-button compact" onClick={()=>openAlbumEditor(selected)}>Edit album</button>
          {selected.archived_at
            ?<button className="secondary-button compact" onClick={()=>void archiveAlbum(selected,true)}><RotateCcw size={13}/>Restore</button>
            :<button className="icon-button" title="Archive album" onClick={()=>void archiveAlbum(selected)}><Archive size={14}/></button>}
        </div>}
      </header>

      {selectedPhotos.length===0
        ?(!selected.archived_at&&canWrite&&<div className="memory-empty-album-upload">
          <label className="primary-button memory-batch-button">
            <Upload size={20}/>{uploadProgress||'Upload photos'}
            <input type="file" accept="image/*" multiple onChange={chooseUpload} disabled={busy}/>
          </label>
        </div>)
        :<>
          {!selected.archived_at&&canWrite&&<div className="memory-gallery-tools">
            <label className="primary-button compact memory-batch-button">
              <Plus size={15}/>{uploadProgress||'Add photos'}
              <input type="file" accept="image/*" multiple onChange={chooseUpload} disabled={busy}/>
            </label>
            <span>{selectedPhotos.length} photos</span>
          </div>}
          <section className="memory-photo-grid">
            {selectedPhotos.map(photo=>{
              const file=fileById.get(photo.file_id)
              const url=urls[photo.file_id]
              return <article className="memory-photo-card" key={photo.id}>
                {url?<a href={url} target="_blank" rel="noreferrer" aria-label={'View '+(photo.caption||file?.title||'photo')}><img src={url} alt={photo.caption||file?.title||'Family memory'} loading="lazy" decoding="async"/></a>:<div className="memory-photo-placeholder"><Images size={24}/></div>}
                <div className="memory-photo-actions">
                  <span title={photo.caption||file?.title||'Family photo'}>{photo.caption||file?.title||'Photo'}</span>
                  <button type="button" title="Discuss in family chat" aria-label="Send photo to family chat" disabled={Boolean(sharingPhotoId)} onClick={()=>void sendPhotoToFamilyChat(photo)}><MessageCircle size={15}/></button>
                  <button type="button" title="Share photo" aria-label="Share photo with another app" disabled={Boolean(sharingPhotoId)} onClick={()=>void sharePhoto(photo)}><Share2 size={15}/></button>
                  {canWrite&&!selected.archived_at&&<button type="button" title="Remove from album" aria-label="Remove photo from album" disabled={Boolean(sharingPhotoId)} onClick={()=>void removePhoto(photo)}><Trash2 size={15}/></button>}
                </div>
              </article>
            })}
          </section>
        </>}
    </section>}

    {editorOpen&&<div ref={editorViewportRef} className="modal-backdrop memory-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card memory-editor">
      <header><div><span className="eyebrow">{draft.id?'EDIT ALBUM':'NEW ALBUM'}</span><h2>{draft.id?'Update memory':'Create family album'}</h2></div><button className="icon-button" onClick={()=>setEditorOpen(false)}><X size={18}/></button></header>
      <form onSubmit={saveAlbum}>
        <label><span>Album title *</span><input required maxLength={160} value={draft.title} onChange={event=>setDraft(current=>({...current,title:event.target.value}))} placeholder="e.g. Emma's 8th birthday"/></label>
        <div className="memory-editor-row"><label><span>Type</span><select value={draft.album_type} onChange={event=>setDraft(current=>({...current,album_type:event.target.value as AlbumType}))}><option value="birthday">Birthday</option><option value="trip">Trip</option><option value="holiday">Holiday</option><option value="school">School</option><option value="family">Family</option><option value="other">Other</option></select></label><label><span>Memory date</span><input type="date" value={draft.memory_date} onChange={event=>setDraft(current=>({...current,memory_date:event.target.value}))}/></label></div>
        <label><span>Link Calendar event</span><select value={draft.event_id} onChange={event=>{const id=event.target.value;const linked=events.find(item=>item.id===id);setDraft(current=>({...current,event_id:id,memory_date:current.memory_date||(linked?eventDate(linked):null)||''}))}}><option value="">No Calendar event</option>{events.map(item=><option value={item.id} key={item.id}>{item.title}{eventDate(item)?' · '+fmtDate(eventDate(item)):''}</option>)}</select></label>
        <label><span>Description</span><textarea rows={4} value={draft.description} onChange={event=>setDraft(current=>({...current,description:event.target.value}))} placeholder="What do you want to remember about this moment?"/></label>
        <footer><button type="button" className="secondary-button" onClick={()=>setEditorOpen(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save album'}</button></footer>
      </form>
    </section></div>}
  </div>
}
