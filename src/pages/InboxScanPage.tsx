import {
  CalendarDays,
  Check,
  CheckSquare,
  Download,
  FileText,
  GraduationCap,
  Inbox,
  ScanLine,
  Share2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { DocumentScannerModal } from '../components/DocumentScannerModal'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type InboxItem={
  id:string
  file_id:string
  source_kind:'camera'|'upload'
  status:'new'|'reviewed'|'archived'
  document_type:string|null
  title:string|null
  summary:string|null
  sender:string|null
  event_date:string|null
  deadline_date:string|null
  location_text:string|null
  confidence:number|null
  extracted_at:string|null
  created_at:string
}
type InboxAction={
  id:string
  inbox_item_id:string
  action_type:'calendar'|'task'|'file'|'school'
  title:string
  action_date:string|null
  start_time:string|null
  end_time:string|null
  location_text:string|null
  notes:string|null
  file_category:string|null
  status:'suggested'|'applied'|'dismissed'
  result_id:string|null
}
type FileRow={
  id:string
  title:string
  file_name:string
  storage_path:string
  mime_type:string|null
}
type ViewFilter='new'|'reviewed'|'archived'|'all'

function dateLabel(value:string|null){
  if(!value)return ''
  return new Date(value+'T12:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})
}
function fileToDataUrl(file:Blob){
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=()=>resolve(String(reader.result??''))
    reader.onerror=()=>reject(reader.error??new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
}
function actionIcon(type:InboxAction['action_type']){
  if(type==='calendar')return <CalendarDays size={15}/>
  if(type==='task')return <CheckSquare size={15}/>
  if(type==='school')return <GraduationCap size={15}/>
  return <FileText size={15}/>
}

export function InboxScanPage(){
  const {household,modules,profiles,user}=useHousehold()
  const canWrite=Boolean(modules.find(module=>module.code==='inbox_scan')?.can_write)
  const assistantEnabled=Boolean(modules.find(module=>module.code==='assistant')?.enabled)
  const childProfiles=profiles.filter(profile=>profile.profile_type==='child'||profile.profile_type==='profile_only')

  const [items,setItems]=useState<InboxItem[]>([])
  const [actions,setActions]=useState<InboxAction[]>([])
  const [files,setFiles]=useState<Record<string,FileRow>>({})
  const [fileUrls,setFileUrls]=useState<Record<string,string>>({})
  const [filter,setFilter]=useState<ViewFilter>('new')
  const [busy,setBusy]=useState(false)
  const [extractingId,setExtractingId]=useState('')
  const [actionBusy,setActionBusy]=useState('')
  const [childByAction,setChildByAction]=useState<Record<string,string>>({})
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [scannerFile,setScannerFile]=useState<File|null>(null)
  const [scannerSource,setScannerSource]=useState<'camera'|'upload'>('upload')

  const visibleItems=useMemo(
    ()=>items.filter(item=>filter==='all'||item.status===filter),
    [items,filter],
  )
  const actionsByItem=useMemo(()=>{
    const map=new Map<string,InboxAction[]>()
    actions.forEach(action=>{
      const current=map.get(action.inbox_item_id)??[]
      current.push(action);map.set(action.inbox_item_id,current)
    })
    return map
  },[actions])

  async function load(foreground=false){
    if(foreground)setBusy(true)
    setError('')
    const [itemResult,actionResult]=await Promise.all([
      supabase.from('family_inbox_items')
        .select('id,file_id,source_kind,status,document_type,title,summary,sender,event_date,deadline_date,location_text,confidence,extracted_at,created_at')
        .eq('household_id',household.id).order('created_at',{ascending:false}),
      supabase.from('family_inbox_actions')
        .select('id,inbox_item_id,action_type,title,action_date,start_time,end_time,location_text,notes,file_category,status,result_id')
        .eq('household_id',household.id).order('created_at'),
    ])
    const failure=itemResult.error||actionResult.error
    if(failure){setError(failure.message);if(foreground)setBusy(false);return}

    const itemRows=(itemResult.data??[]) as InboxItem[]
    setItems(itemRows)
    setActions((actionResult.data??[]) as InboxAction[])

    const ids=[...new Set(itemRows.map(item=>item.file_id))]
    if(ids.length){
      const fileResult=await supabase.from('household_files')
        .select('id,title,file_name,storage_path,mime_type')
        .eq('household_id',household.id).in('id',ids)
      if(fileResult.error)setError(fileResult.error.message)
      else{
        const rows=(fileResult.data??[]) as FileRow[]
        setFiles(Object.fromEntries(rows.map(row=>[row.id,row])))
        const signed=await Promise.all(rows.map(async row=>{
          const result=await supabase.storage.from('famioo-files').createSignedUrl(row.storage_path,3600)
          return [row.id,result.data?.signedUrl??''] as const
        }))
        setFileUrls(Object.fromEntries(signed))
      }
    }else{
      setFiles({});setFileUrls({})
    }
    if(foreground)setBusy(false)
  }

  useEffect(()=>{void load(true)},[household.id])

  async function reserveAndUpload(file:File,sourceKind:'camera'|'upload'):Promise<boolean>{
    if(!canWrite)return false
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){
      setError('Family Inbox currently scans JPG, PNG and WebP images.')
      return false
    }
    if(file.size>10*1024*1024){
      setError('Scan images can be up to 10 MB.')
      return false
    }

    setBusy(true);setError('');setMessage('')
    const reserve=await supabase.rpc('reserve_household_file_v1',{
      p_household_id:household.id,
      p_title:file.name.replace(/\.[^.]+$/,'')||'Inbox scan',
      p_file_name:file.name,
      p_mime_type:file.type,
      p_file_size:file.size,
      p_category:'document',
      p_notes:'Added from Family Inbox / Scan',
    })
    if(reserve.error||!reserve.data?.[0]){
      setBusy(false);setError(reserve.error?.message??'Could not reserve file storage.');return false
    }
    const fileId=String(reserve.data[0].file_id)
    const storagePath=String(reserve.data[0].storage_path)

    const upload=await supabase.storage.from('famioo-files').upload(storagePath,file,{upsert:false,contentType:file.type})
    if(upload.error){
      await supabase.rpc('cancel_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
      setBusy(false);setError(upload.error.message);return false
    }
    const complete=await supabase.rpc('complete_household_file_v1',{p_household_id:household.id,p_file_id:fileId})
    if(complete.error){
      setBusy(false);setError(complete.error.message);return false
    }
    const inbox=await supabase.rpc('create_family_inbox_item_v1',{
      p_household_id:household.id,p_file_id:fileId,p_source_kind:sourceKind,
    })
    if(inbox.error||!inbox.data){
      setBusy(false);setError(inbox.error?.message??'Could not create inbox item.');return false
    }

    const inboxId=String(inbox.data)
    if(assistantEnabled){
      try{
        const imageData=await fileToDataUrl(file)
        await extractItem(inboxId,imageData,false)
      }catch(reason){
        setError(reason instanceof Error?reason.message:'The file was saved, but extraction failed.')
      }
    }else{
      setMessage('Scan saved. Enable AI Assistant to extract dates and suggested actions automatically.')
    }
    setBusy(false)
    await load(false)
    return true
  }

  async function extractItem(itemId:string,imageData?:string,showBusy=true){
    if(!assistantEnabled){
      setError('AI Assistant is required for document extraction.')
      return
    }
    if(showBusy)setExtractingId(itemId)
    setError('');setMessage('')
    try{
      let dataUrl=imageData
      if(!dataUrl){
        const item=items.find(row=>row.id===itemId)
        if(!item)throw new Error('Inbox item not found.')
        const url=fileUrls[item.file_id]
        if(!url)throw new Error('Document preview is not available.')
        const response=await fetch(url)
        if(!response.ok)throw new Error('Could not read the stored document.')
        dataUrl=await fileToDataUrl(await response.blob())
      }
      const result=await supabase.functions.invoke('extract-family-inbox',{
        body:{
          household_id:household.id,
          inbox_item_id:itemId,
          image_data_url:dataUrl,
          reference_date:new Date().toISOString().slice(0,10),
        },
      })
      if(result.error)throw result.error
      if(result.data?.error)throw new Error(String(result.data.error))
      setMessage('Document scanned and suggestions are ready for review.')
      await load(false)
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Document extraction failed.')
    }finally{
      if(showBusy)setExtractingId('')
    }
  }

  async function applyAction(action:InboxAction){
    setActionBusy(action.id);setError('');setMessage('')
    const childId=action.action_type==='school'?(childByAction[action.id]||null):null
    const result=await supabase.rpc('apply_family_inbox_action_v1',{
      p_household_id:household.id,p_action_id:action.id,p_child_profile_id:childId,
    })
    setActionBusy('')
    if(result.error){setError(result.error.message);return}
    setMessage(
      action.action_type==='calendar'?'Added to Calendar.'
      :action.action_type==='task'?'Task created.'
      :action.action_type==='school'?'School & Kita entry created.'
      :'File details updated.',
    )
    await load(false)
  }

  async function dismissAction(action:InboxAction){
    const result=await supabase.rpc('dismiss_family_inbox_action_v1',{
      p_household_id:household.id,p_action_id:action.id,
    })
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  async function setItemStatus(item:InboxItem,status:InboxItem['status']){
    const result=await supabase.from('family_inbox_items')
      .update({status,updated_at:new Date().toISOString()})
      .eq('id',item.id).eq('household_id',household.id)
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  async function storedScanFile(item:InboxItem){
    const url=fileUrls[item.file_id]
    const file=files[item.file_id]
    if(!url)throw new Error('Scanned file is not available.')
    const response=await fetch(url)
    if(!response.ok)throw new Error('Could not download the scanned file.')
    const blob=await response.blob()
    return new File([blob],file?.file_name||'famioo-scan.jpg',{
      type:file?.mime_type||blob.type||'image/jpeg',
      lastModified:Date.now(),
    })
  }

  async function downloadStoredScan(item:InboxItem){
    setError('');setMessage('')
    try{
      const file=await storedScanFile(item)
      const url=URL.createObjectURL(file)
      const link=document.createElement('a')
      link.href=url
      link.download=file.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Could not download scan.')
    }
  }

  async function shareStoredScan(item:InboxItem){
    setError('');setMessage('')
    try{
      const file=await storedScanFile(item)
      if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
        await navigator.share({title:item.title||'Famioo scan',text:'Shared from Famioo',files:[file]})
      }else{
        const url=URL.createObjectURL(file)
        const link=document.createElement('a')
        link.href=url
        link.download=file.name
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(()=>URL.revokeObjectURL(url),1000)
        setMessage('This browser cannot share files directly, so the scan was downloaded instead.')
      }
    }catch(reason){
      if((reason as DOMException)?.name!=='AbortError'){
        setError(reason instanceof Error?reason.message:'Could not share scan.')
      }
    }
  }

  async function sendScanInMessenger(file:File,target:string):Promise<boolean>{
    setError('');setMessage('')
    try{
      let threadId=''
      if(target==='family'){
        const threads=await supabase.rpc('messenger_threads_v1',{p_household_id:household.id})
        if(threads.error)throw threads.error
        const family=(threads.data??[]).find((row:{thread_type?:string;id?:string})=>row.thread_type==='household')
        if(!family?.id)throw new Error('Family chat is not available yet.')
        threadId=String(family.id)
      }else{
        const direct=await supabase.rpc('create_direct_messenger_thread_v1',{
          p_household_id:household.id,p_other_user_id:target,
        })
        if(direct.error||!direct.data)throw direct.error??new Error('Could not open direct chat.')
        threadId=String(direct.data)
      }

      const path=`${household.id}/${threadId}/${user.id}/${crypto.randomUUID()}.jpg`
      const upload=await supabase.storage.from('messenger-media').upload(path,file,{
        contentType:'image/jpeg',upsert:false,cacheControl:'3600',
      })
      if(upload.error)throw upload.error

      const send=await supabase.rpc('send_messenger_message_v1',{
        p_thread_id:threadId,p_body:'Scanned document from Inbox / Scan',
        p_message_type:'photo',p_media_path:path,p_media_name:file.name,
        p_media_mime:'image/jpeg',p_media_duration_s:null,
      })
      if(send.error){
        await supabase.storage.from('messenger-media').remove([path])
        throw send.error
      }
      setMessage('Scanned document sent in Famioo Messenger.')
      return true
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Could not send scanned document.')
      return false
    }
  }

  function handleFile(event:ChangeEvent<HTMLInputElement>,source:'camera'|'upload'){
    const file=event.target.files?.[0]??null
    event.target.value=''
    if(!file)return
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){
      setError('Document scanner supports JPG, PNG and WebP images.')
      return
    }
    if(file.size>10*1024*1024){
      setError('Scan images can be up to 10 MB.')
      return
    }
    setError('')
    setScannerSource(source)
    setScannerFile(file)
  }

  return <div className="page inbox-scan-page">
    <div className="page-heading-row inbox-heading">
      <div>
        <span className="eyebrow">FAMILY INBOX / SCAN</span>
        <h1>Turn paper into family actions</h1>
        <p>Photograph letters, flyers, invitations and school notices. Famioo keeps the original and suggests what to do next.</p>
      </div>
      {canWrite&&<div className="inbox-capture-actions">
        <label className="primary-button compact inbox-file-button"><ScanLine size={15}/>Scan photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event=>handleFile(event,'camera')}/></label>
        <label className="secondary-button compact inbox-file-button"><Upload size={15}/>Upload image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>handleFile(event,'upload')}/></label>
      </div>}
    </div>

    {!assistantEnabled&&<div className="inbox-ai-note"><Sparkles size={16}/><span><strong>AI extraction is optional.</strong> Scans can still be stored here, but automatic summaries and action suggestions require the AI Assistant module.</span></div>}
    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    <div className="inbox-filter-bar">
      {(['new','reviewed','archived','all'] as ViewFilter[]).map(value=><button type="button" className={filter===value?'active':''} onClick={()=>setFilter(value)} key={value}>{value==='all'?'All':value.charAt(0).toUpperCase()+value.slice(1)} <span>{value==='all'?items.length:items.filter(item=>item.status===value).length}</span></button>)}
    </div>

    {busy&&items.length===0?<div className="inbox-empty">Loading Family Inbox…</div>:visibleItems.length===0?<div className="inbox-empty"><Inbox size={32}/><strong>No {filter==='all'?'':filter+' '}items.</strong><span>Scan or upload a document to start.</span></div>:<section className="inbox-grid">
      {visibleItems.map(item=>{
        const file=files[item.file_id]
        const itemActions=actionsByItem.get(item.id)??[]
        const suggested=itemActions.filter(action=>action.status==='suggested')
        const applied=itemActions.filter(action=>action.status==='applied')
        return <article className="inbox-card" key={item.id}>
          <div className="inbox-preview">
            {fileUrls[item.file_id]?<img src={fileUrls[item.file_id]} alt={item.title||file?.title||'Scanned document'}/>:<FileText size={34}/>}
            <span>{item.source_kind==='camera'?'SCANNED':'UPLOADED'}</span>
          </div>
          <div className="inbox-card-body">
            <div className="inbox-card-title">
              <div><small>{(item.document_type||'DOCUMENT').replace('_',' ').toUpperCase()}</small><h2>{item.title||file?.title||'Unprocessed document'}</h2></div>
              <span className={'inbox-status '+item.status}>{item.status}</span>
            </div>

            {item.extracted_at?<div className="inbox-extraction">
              {item.summary&&<p>{item.summary}</p>}
              <div className="inbox-facts">
                {item.sender&&<span><b>From</b>{item.sender}</span>}
                {item.event_date&&<span><b>Event</b>{dateLabel(item.event_date)}</span>}
                {item.deadline_date&&<span><b>Deadline</b>{dateLabel(item.deadline_date)}</span>}
                {item.location_text&&<span><b>Location</b>{item.location_text}</span>}
              </div>
            </div>:<div className="inbox-awaiting"><Sparkles size={16}/><span>This document has not been extracted yet.</span>{assistantEnabled&&<button type="button" disabled={extractingId===item.id} onClick={()=>void extractItem(item.id)}>{extractingId===item.id?'Scanning…':'Scan with AI'}</button>}</div>}

            {suggested.length>0&&<div className="inbox-suggestions">
              <span className="eyebrow">SUGGESTED ACTIONS</span>
              {suggested.map(action=><div className="inbox-action" key={action.id}>
                <span className={'inbox-action-icon '+action.action_type}>{actionIcon(action.action_type)}</span>
                <div><small>{action.action_type.toUpperCase()}</small><strong>{action.title}</strong>{action.action_date&&<em>{dateLabel(action.action_date)}{action.start_time?' · '+action.start_time.slice(0,5):''}</em>}{action.notes&&<p>{action.notes}</p>}</div>
                {action.action_type==='school'&&childProfiles.length>0&&<select value={childByAction[action.id]??''} onChange={e=>setChildByAction(current=>({...current,[action.id]:e.target.value}))}><option value="">General / no child</option>{childProfiles.map(profile=><option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select>}
                <div className="inbox-action-buttons"><button type="button" className="apply" disabled={actionBusy===action.id} onClick={()=>void applyAction(action)}><Check size={13}/>{actionBusy===action.id?'Applying…':'Apply'}</button><button type="button" onClick={()=>void dismissAction(action)}><X size={13}/>Dismiss</button></div>
              </div>)}
            </div>}

            {applied.length>0&&<div className="inbox-applied"><Check size={14}/>{applied.length} action{applied.length===1?'':'s'} applied</div>}

            <footer>
              {fileUrls[item.file_id]&&<a className="secondary-button compact" href={fileUrls[item.file_id]} target="_blank" rel="noreferrer">Open scan</a>}
              {fileUrls[item.file_id]&&<button type="button" className="secondary-button compact" onClick={()=>void downloadStoredScan(item)}><Download size={13}/>Download</button>}
              {fileUrls[item.file_id]&&<button type="button" className="secondary-button compact" onClick={()=>void shareStoredScan(item)}><Share2 size={13}/>Share</button>}
              {assistantEnabled&&item.extracted_at&&<button type="button" className="secondary-button compact" disabled={extractingId===item.id} onClick={()=>void extractItem(item.id)}><Sparkles size={13}/>{extractingId===item.id?'Scanning…':'Extract again'}</button>}
              {item.status!=='archived'?<button type="button" className="secondary-button compact" onClick={()=>void setItemStatus(item,'archived')}>Archive</button>:<button type="button" className="secondary-button compact" onClick={()=>void setItemStatus(item,'new')}>Restore</button>}
            </footer>
          </div>
        </article>
      })}
    </section>}

    {scannerFile&&<DocumentScannerModal
      file={scannerFile}
      busy={busy}
      shareTargets={profiles
        .filter(profile=>Boolean(profile.linked_user_id)&&profile.linked_user_id!==user.id)
        .map(profile=>({value:String(profile.linked_user_id),label:profile.display_name}))}
      onClose={()=>{if(!busy)setScannerFile(null)}}
      onSave={async(file)=>{
        const ok=await reserveAndUpload(file,scannerSource)
        if(ok)setScannerFile(null)
        return ok
      }}
      onSendFamioo={sendScanInMessenger}
    />}
  </div>
}
