import {
  FileText,
  ImagePlus,
  MessageSquareText,
  Paperclip,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'

type CommentRow={
  id:string
  body:string
  created_by_user_id:string
  created_at:string
}

type AttachmentRow={
  id:string
  file_id:string
  attachment_kind:'photo'|'file'
  caption:string|null
  created_by_user_id:string
  created_at:string
}

type FileRow={
  id:string
  title:string
  file_name:string
  storage_path:string
  mime_type:string|null
  file_size:number
}

type HouseholdUser={
  user_id:string|null
  display_name:string
}

export function EventContextPanel({eventId}:{eventId:string}){
  const {household,modules,user}=useHousehold()
  const access=modules.find(module=>module.code==='calendar_context')
  const canWrite=Boolean(access?.enabled&&access?.can_write)
  const [comments,setComments]=useState<CommentRow[]>([])
  const [attachments,setAttachments]=useState<AttachmentRow[]>([])
  const [files,setFiles]=useState<Record<string,FileRow>>({})
  const [urls,setUrls]=useState<Record<string,string>>({})
  const [names,setNames]=useState<Record<string,string>>({})
  const [comment,setComment]=useState('')
  const [caption,setCaption]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const photos=useMemo(()=>attachments.filter(item=>item.attachment_kind==='photo'),[attachments])
  const documents=useMemo(()=>attachments.filter(item=>item.attachment_kind==='file'),[attachments])

  async function load(){
    setError('')
    const [commentResult,attachmentResult,userResult]=await Promise.all([
      supabase.from('calendar_event_comments')
        .select('id,body,created_by_user_id,created_at')
        .eq('household_id',household.id).eq('event_id',eventId)
        .order('created_at',{ascending:true}),
      supabase.from('calendar_event_attachments')
        .select('id,file_id,attachment_kind,caption,created_by_user_id,created_at')
        .eq('household_id',household.id).eq('event_id',eventId)
        .order('created_at',{ascending:false}),
      supabase.rpc('household_users_v1',{p_household_id:household.id}),
    ])
    const failure=commentResult.error||attachmentResult.error||userResult.error
    if(failure)setError(failure.message)

    const commentRows=(commentResult.data??[]) as CommentRow[]
    const attachmentRows=(attachmentResult.data??[]) as AttachmentRow[]
    setComments(commentRows)
    setAttachments(attachmentRows)
    const people=(userResult.data??[]) as HouseholdUser[]
    setNames(Object.fromEntries(people.filter(person=>person.user_id).map(person=>[person.user_id!,person.display_name])))

    const ids=[...new Set(attachmentRows.map(item=>item.file_id))]
    if(!ids.length){setFiles({});setUrls({});return}

    const fileResult=await supabase.from('household_files')
      .select('id,title,file_name,storage_path,mime_type,file_size')
      .eq('household_id',household.id).in('id',ids)
    if(fileResult.error){setError(fileResult.error.message);return}
    const fileRows=((fileResult.data??[]) as FileRow[]).map(row=>({...row,file_size:Number(row.file_size)}))
    setFiles(Object.fromEntries(fileRows.map(row=>[row.id,row])))

    const signed=await Promise.all(fileRows.map(async row=>{
      const result=await supabase.storage.from('famioo-files').createSignedUrl(row.storage_path,3600)
      return [row.id,result.data?.signedUrl??''] as const
    }))
    setUrls(Object.fromEntries(signed))
  }

  useEffect(()=>{void load()},[eventId,household.id])

  async function addComment(event:FormEvent){
    event.preventDefault()
    if(!comment.trim()||!canWrite)return
    setBusy(true);setError('');setMessage('')
    const result=await supabase.rpc('add_calendar_event_comment_v1',{
      p_household_id:household.id,p_event_id:eventId,p_body:comment.trim(),
    })
    setBusy(false)
    if(result.error){setError(result.error.message);return}
    setComment('')
    await load()
  }

  async function deleteComment(row:CommentRow){
    const result=await supabase.rpc('delete_calendar_event_comment_v1',{
      p_household_id:household.id,p_comment_id:row.id,
    })
    if(result.error)setError(result.error.message)
    else await load()
  }

  async function attach(file:File){
    if(!canWrite)return
    if(file.size>50*1024*1024){setError('Files can be up to 50 MB each.');return}
    const photo=file.type.startsWith('image/')
    setBusy(true);setError('');setMessage('')

    const reserve=await supabase.rpc('reserve_household_file_v1',{
      p_household_id:household.id,
      p_title:file.name.replace(/\.[^.]+$/,'')||'Calendar attachment',
      p_file_name:file.name,
      p_mime_type:file.type||'application/octet-stream',
      p_file_size:file.size,
      p_category:photo?'photo':'document',
      p_notes:'Attached to Calendar event',
    })
    if(reserve.error){
      setBusy(false);setError(reserve.error.message);return
    }
    const reservation=Array.isArray(reserve.data)?reserve.data[0]:reserve.data
    const fileId=reservation?.file_id as string|undefined
    const storagePath=reservation?.storage_path as string|undefined
    if(!fileId||!storagePath){setBusy(false);setError('Could not reserve file storage.');return}

    const upload=await supabase.storage.from('famioo-files').upload(storagePath,file,{
      upsert:false,contentType:file.type||undefined,
    })
    if(upload.error){
      await supabase.rpc('cancel_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
      setBusy(false);setError(upload.error.message);return
    }

    const complete=await supabase.rpc('complete_household_file_v1',{
      p_household_id:household.id,p_file_id:fileId,
    })
    if(complete.error){
      await supabase.storage.from('famioo-files').remove([storagePath])
      await supabase.rpc('cancel_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
      setBusy(false);setError(complete.error.message);return
    }

    const link=await supabase.rpc('attach_calendar_event_file_v1',{
      p_household_id:household.id,p_event_id:eventId,p_file_id:fileId,
      p_attachment_kind:photo?'photo':'file',p_caption:caption.trim()||null,
    })
    setBusy(false)
    if(link.error){setError(link.error.message);return}
    setCaption('')
    setMessage(photo?'Photo attached to event.':'File attached to event.')
    await load()
  }

  function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]??null
    event.target.value=''
    if(file)void attach(file)
  }

  async function removeAttachment(row:AttachmentRow){
    const file=files[row.file_id]
    if(!window.confirm('Remove this attachment from the event? The file will remain available in Famioo Files.'))return
    const result=await supabase.rpc('delete_calendar_event_attachment_v1',{
      p_household_id:household.id,p_attachment_id:row.id,
    })
    if(result.error)setError(result.error.message)
    else{
      setMessage(file?.title?'Removed '+file.title+' from this event.':'Attachment removed.')
      await load()
    }
  }

  const canDelete=(createdBy:string)=>createdBy===user.id||household.role==='owner'||household.role==='admin'

  return <section className="event-context-panel">
    <div className="event-context-heading">
      <div><span className="eyebrow">COMMENTS & PHOTOS</span><h3>Planning context</h3><p>Discussion, photos and files stay attached to this event.</p></div>
      <span className="event-context-count"><MessageSquareText size={13}/>{comments.length} · <Paperclip size={13}/>{attachments.length}</span>
    </div>

    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    <div className="event-context-comments">
      {comments.length===0?<div className="event-context-empty">No comments yet.</div>:comments.map(row=><article className="event-comment" key={row.id}>
        <div>
          <strong>{names[row.created_by_user_id]||'Family member'}</strong>
          <small>{new Date(row.created_at).toLocaleString()}</small>
          <p>{row.body}</p>
        </div>
        {canWrite&&canDelete(row.created_by_user_id)&&<button type="button" className="icon-button" onClick={()=>void deleteComment(row)} aria-label="Delete comment"><Trash2 size={13}/></button>}
      </article>)}
    </div>

    {canWrite&&<form className="event-comment-form" onSubmit={addComment}>
      <textarea value={comment} onChange={event=>setComment(event.target.value)} maxLength={2000} rows={2} placeholder="Add a comment for the family…"/>
      <button className="primary-button compact" disabled={busy||!comment.trim()}><Send size={13}/>Post</button>
    </form>}

    <div className="event-context-attachments">
      <div className="event-context-subhead"><strong>Photos & files</strong>{canWrite&&<span>Stored securely in Famioo Files</span>}</div>
      {photos.length>0&&<div className="event-photo-grid">{photos.map(row=>{const file=files[row.file_id];const url=urls[row.file_id];return <article key={row.id}>
        {url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={row.caption||file?.title||'Event photo'}/></a>:<span><ImagePlus size={22}/></span>}
        <div><strong>{row.caption||file?.title||'Photo'}</strong>{canWrite&&<button type="button" onClick={()=>void removeAttachment(row)}><Trash2 size={12}/></button>}</div>
      </article>})}</div>}

      {documents.length>0&&<div className="event-file-list">{documents.map(row=>{const file=files[row.file_id];const url=urls[row.file_id];return <article key={row.id}>
        <FileText size={17}/>
        <span><strong>{row.caption||file?.title||'File'}</strong><small>{file?.file_name||'Attachment'}</small></span>
        {url&&<a className="secondary-button compact" href={url} target="_blank" rel="noreferrer">Open</a>}
        {canWrite&&<button type="button" className="icon-button" onClick={()=>void removeAttachment(row)}><Trash2 size={13}/></button>}
      </article>})}</div>}

      {attachments.length===0&&<div className="event-context-empty">No photos or files attached.</div>}

      {canWrite&&<div className="event-attachment-controls">
        <input value={caption} onChange={event=>setCaption(event.target.value)} maxLength={200} placeholder="Optional caption"/>
        <label className="secondary-button compact event-attachment-button"><ImagePlus size={13}/>Add photo<input type="file" accept="image/*" onChange={chooseFile}/></label>
        <label className="secondary-button compact event-attachment-button"><Upload size={13}/>Add file<input type="file" onChange={chooseFile}/></label>
      </div>}
    </div>
  </section>
}
