import {
  Archive,
  CalendarDays,
  Camera,
  ImagePlus,
  Images,
  Link2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
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
  const {household,modules}=useHousehold()
  const access=modules.find(module=>module.code==='memories')
  const canWrite=Boolean(access?.enabled&&access?.can_write)
  const [albums,setAlbums]=useState<Album[]>([])
  const [photos,setPhotos]=useState<MemoryPhoto[]>([])
  const [files,setFiles]=useState<FileRow[]>([])
  const [events,setEvents]=useState<CalendarEvent[]>([])
  const [urls,setUrls]=useState<Record<string,string>>({})
  const [selectedId,setSelectedId]=useState('')
  const [showArchived,setShowArchived]=useState(false)
  const [editorOpen,setEditorOpen]=useState(false)
  const [draft,setDraft]=useState<AlbumDraft>(emptyAlbum)
  const [caption,setCaption]=useState('')
  const [takenDate,setTakenDate]=useState('')
  const [existingFileId,setExistingFileId]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const visibleAlbums=useMemo(
    ()=>albums.filter(album=>showArchived?Boolean(album.archived_at):!album.archived_at),
    [albums,showArchived],
  )
  const selected=visibleAlbums.find(album=>album.id===selectedId)??visibleAlbums[0]??null
  const selectedPhotos=useMemo(
    ()=>photos.filter(photo=>photo.album_id===selected?.id),
    [photos,selected?.id],
  )
  const photoFileIds=new Set(selectedPhotos.map(photo=>photo.file_id))
  const availableExistingPhotos=files.filter(file=>file.mime_type?.startsWith('image/')&&!photoFileIds.has(file.id))
  const fileById=useMemo(()=>new Map(files.map(file=>[file.id,file])),[files])
  const eventById=useMemo(()=>new Map(events.map(event=>[event.id,event])),[events])

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
    const [albumResult,photoResult,fileResult,eventResult]=await Promise.all([
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
    ])
    const failure=albumResult.error||photoResult.error||fileResult.error||eventResult.error
    if(failure)setError(failure.message)
    const albumRows=(albumResult.data??[]) as Album[]
    const fileRows=((fileResult.data??[]) as FileRow[]).map(file=>({...file,file_size:Number(file.file_size)}))
    setAlbums(albumRows)
    setPhotos(((photoResult.data??[]) as MemoryPhoto[]).map(photo=>({...photo,sort_order:Number(photo.sort_order)})))
    setFiles(fileRows)
    setEvents((eventResult.data??[]) as CalendarEvent[])
    setSelectedId(current=>albumRows.some(album=>album.id===current)?current:(albumRows.find(album=>!album.archived_at)?.id??albumRows[0]?.id??''))

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
    await load(false)
  }

  async function uploadPhoto(file:File){
    if(!selected||!canWrite)return
    if(!file.type.startsWith('image/')){setError('Choose an image file.');return}
    if(file.size>50*1024*1024){setError('Photos can be up to 50 MB each.');return}
    setBusy(true);setError('');setMessage('')
    const optimized=await optimizeMemoryPhoto(file)
    const reserve=await supabase.rpc('reserve_household_file_v1',{
      p_household_id:household.id,p_title:file.name.replace(/\.[^.]+$/,'')||'Memory photo',
      p_file_name:optimized.name,p_mime_type:optimized.type,p_file_size:optimized.size,
      p_category:'photo',p_notes:'Family memory: '+selected.title,
    })
    if(reserve.error){setBusy(false);setError(reserve.error.message);return}
    const reservation=Array.isArray(reserve.data)?reserve.data[0]:reserve.data
    const fileId=reservation?.file_id as string|undefined
    const storagePath=reservation?.storage_path as string|undefined
    if(!fileId||!storagePath){setBusy(false);setError('Could not reserve photo storage.');return}

    const upload=await supabase.storage.from('famioo-files').upload(storagePath,optimized,{upsert:false,contentType:optimized.type})
    if(upload.error){
      await supabase.rpc('cancel_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
      setBusy(false);setError(upload.error.message);return
    }
    const complete=await supabase.rpc('complete_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
    if(complete.error){
      await supabase.storage.from('famioo-files').remove([storagePath])
      await supabase.rpc('cancel_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
      setBusy(false);setError(complete.error.message);return
    }
    const attach=await supabase.rpc('attach_family_memory_photo_v1',{
      p_household_id:household.id,p_album_id:selected.id,p_file_id:fileId,
      p_caption:caption.trim()||null,p_taken_date:takenDate||selected.memory_date||null,
    })
    setBusy(false)
    if(attach.error){setError(attach.error.message);return}
    setCaption('');setTakenDate('');setMessage('Photo added to '+selected.title+'.')
    await load(false)
  }

  function chooseUpload(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]??null
    event.target.value=''
    if(file)void uploadPhoto(file)
  }

  async function addExistingPhoto(){
    if(!selected||!existingFileId)return
    setBusy(true);setError('')
    const result=await supabase.rpc('attach_family_memory_photo_v1',{
      p_household_id:household.id,p_album_id:selected.id,p_file_id:existingFileId,
      p_caption:caption.trim()||null,p_taken_date:takenDate||selected.memory_date||null,
    })
    setBusy(false)
    if(result.error){setError(result.error.message);return}
    setExistingFileId('');setCaption('');setTakenDate('');setMessage('Existing photo added to album.')
    await load(false)
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
      <div><span className="eyebrow">FAMILY PHOTO ALBUMS / MEMORIES</span><h1>Family memories</h1><p>Shared albums for birthdays, trips, holidays, school moments and everyday family life.</p></div>
      {canWrite&&<button className="primary-button compact" onClick={()=>openAlbumEditor()}><Plus size={14}/>New album</button>}
    </div>

    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    <div className="memories-toolbar">
      <button className={!showArchived?'active':''} onClick={()=>setShowArchived(false)}>Albums <span>{albums.filter(album=>!album.archived_at).length}</span></button>
      <button className={showArchived?'active':''} onClick={()=>setShowArchived(true)}>Archive <span>{albums.filter(album=>Boolean(album.archived_at)).length}</span></button>
    </div>

    {visibleAlbums.length===0?<div className="memories-empty"><Images size={34}/><strong>{showArchived?'No archived albums.':'No family albums yet.'}</strong><span>{showArchived?'Archived albums will appear here.':'Create an album for a birthday, trip, holiday or family moment.'}</span>{canWrite&&!showArchived&&<button className="primary-button compact" onClick={()=>openAlbumEditor()}><Plus size={14}/>Create first album</button>}</div>:<>
      <section className="memory-album-strip">
        {visibleAlbums.map(album=>{
          const cover=album.cover_file_id?urls[album.cover_file_id]:null
          const count=photos.filter(photo=>photo.album_id===album.id).length
          return <button className={selected?.id===album.id?'memory-album-chip active':'memory-album-chip'} onClick={()=>setSelectedId(album.id)} key={album.id}>
            <span className="memory-chip-cover">{cover?<img src={cover} alt="" loading="lazy" decoding="async"/>:<b>{albumEmoji(album.album_type)}</b>}</span>
            <span><small>{albumTypeLabel(album.album_type).toUpperCase()}</small><strong>{album.title}</strong><em>{count} photo{count===1?'':'s'}{album.memory_date?' · '+fmtDate(album.memory_date):''}</em></span>
          </button>
        })}
      </section>

      {selected&&<section className="memory-album-detail">
        <header className="memory-album-hero">
          <span className="memory-album-symbol">{albumEmoji(selected.album_type)}</span>
          <div><span className="eyebrow">{albumTypeLabel(selected.album_type).toUpperCase()}</span><h2>{selected.title}</h2><p>{selected.description||'Family memory album'}</p><small>{selected.memory_date&&<><CalendarDays size={12}/>{fmtDate(selected.memory_date)}</>}{selected.event_id&&<><Link2 size={12}/>{eventById.get(selected.event_id)?.title||'Linked Calendar event'}</>}</small></div>
          {canWrite&&<div className="memory-hero-actions"><button className="secondary-button compact" onClick={()=>openAlbumEditor(selected)}>Edit</button>{selected.archived_at?<button className="secondary-button compact" onClick={()=>void archiveAlbum(selected,true)}><RotateCcw size={13}/>Restore</button>:<button className="icon-button" title="Archive album" onClick={()=>void archiveAlbum(selected)}><Archive size={14}/></button>}</div>}
        </header>

        {!selected.archived_at&&canWrite&&<section className="memory-add-panel">
          <div className="memory-add-meta"><input value={caption} onChange={event=>setCaption(event.target.value)} placeholder="Optional photo caption"/><input type="date" value={takenDate} onChange={event=>setTakenDate(event.target.value)}/></div>
          <div className="memory-add-actions">
            <label className="primary-button compact memory-file-button"><Camera size={14}/>Upload photo<input type="file" accept="image/*" multiple={false} onChange={chooseUpload}/></label>
            <select value={existingFileId} onChange={event=>setExistingFileId(event.target.value)}><option value="">Choose existing Famioo photo…</option>{availableExistingPhotos.map(file=><option value={file.id} key={file.id}>{file.title}</option>)}</select>
            <button className="secondary-button compact" disabled={!existingFileId||busy} onClick={()=>void addExistingPhoto()}><ImagePlus size={13}/>Add existing</button>
            {selected.event_id&&<button className="secondary-button compact" disabled={busy} onClick={()=>void importEventPhotos()}><Sparkles size={13}/>Import event photos</button>}
          </div>
          {selected.event_id&&<p>New photos added here are also attached to the linked Calendar event.</p>}
        </section>}

        {selectedPhotos.length===0?<div className="memories-empty compact"><ImagePlus size={25}/><strong>No photos in this album yet.</strong></div>:<section className="memory-photo-grid">
          {selectedPhotos.map(photo=>{
            const file=fileById.get(photo.file_id)
            const url=urls[photo.file_id]
            return <article className="memory-photo-card" key={photo.id}>
              {url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={photo.caption||file?.title||'Family memory'} loading="lazy" decoding="async"/></a>:<div className="memory-photo-placeholder"><Images size={24}/></div>}
              <div><span><strong>{photo.caption||file?.title||'Family photo'}</strong><small>{photo.taken_date?fmtDate(photo.taken_date):file?.file_name||''}</small></span>{canWrite&&!selected.archived_at&&<button onClick={()=>void removePhoto(photo)} title="Remove from album"><Trash2 size={13}/></button>}</div>
            </article>
          })}
        </section>}
      </section>}
    </>}

    {editorOpen&&<div className="modal-backdrop memory-editor-backdrop" role="dialog" aria-modal="true"><section className="modal-card memory-editor">
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
