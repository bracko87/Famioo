import {
  Archive,
  Camera,
  Download,
  ExternalLink,
  File as FileIcon,
  FileImage,
  FileText,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Select } from '../components/ui/Select'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import { isFreePlanAccount } from '../lib/accountPlan'

type FileCategory='document'|'photo'|'receipt'|'school'|'home'|'other'
type FilesTab='all'|'photos'|'documents'|'links'|'archive'

type HouseholdFile={
  id:string
  title:string
  file_name:string
  storage_path:string
  mime_type:string|null
  file_size:number
  category:FileCategory
  notes:string|null
  source_module:string|null
  source_record_id:string|null
  archived_at:string|null
  created_at:string
}

type HouseholdLink={
  id:string
  title:string
  url:string
  notes:string|null
  source_module:string|null
  archived_at:string|null
  created_at:string
}

type StorageEntitlement={
  used_bytes:number
  quota_bytes:number
  paid_monthly_eur:number
  storage_tier:'free_1gb'|'paid_10gb'|'addon_10gb'|'downgrade_grace'
  can_upload:boolean
  needs_storage_offer:boolean
  storage_addon_price_eur:number
  downgrade_grace_until:string|null
}

type ConfirmState=
  | { kind:'archive';file:HouseholdFile }
  | { kind:'delete';file:HouseholdFile }
  | null

const categoryOptions=[
  { value:'document',label:'Document' },
  { value:'photo',label:'Photo' },
  { value:'receipt',label:'Receipt' },
  { value:'school',label:'School' },
  { value:'home',label:'Home' },
  { value:'other',label:'Other' },
]

function formatBytes(value:number){
  if(value<1024) return value+' B'
  if(value<1024*1024) return (value/1024).toFixed(1)+' KB'
  if(value<1024*1024*1024) return (value/(1024*1024)).toFixed(1)+' MB'
  return (value/(1024*1024*1024)).toFixed(2)+' GB'
}

function fileKind(file:HouseholdFile){
  if(file.mime_type?.startsWith('image/')) return 'photo'
  return file.category
}

function titleFromFile(name:string){
  return name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim() || 'File'
}

export function FilesPage(){
  const { household,modules,user }=useHousehold()
  const individualFree = isFreePlanAccount(user)
  const access=modules.find((module)=>module.code==='files')
  const canWrite=Boolean(access?.can_write)

  const [tab,setTab]=useState<FilesTab>('all')
  const [files,setFiles]=useState<HouseholdFile[]>([])
  const [links,setLinks]=useState<HouseholdLink[]>([])
  const [urls,setUrls]=useState<Record<string,string>>({})
  const [storage,setStorage]=useState<StorageEntitlement|null>(null)
  const [personalStorage,setPersonalStorage]=useState<{files_used_bytes:number;files_quota_bytes:number}|null>(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)

  const [composerOpen,setComposerOpen]=useState(false)
  const [editingId,setEditingId]=useState<string|null>(null)
  const [title,setTitle]=useState('')
  const [category,setCategory]=useState<FileCategory>('document')
  const [notes,setNotes]=useState('')
  const [pendingFile,setPendingFile]=useState<File|null>(null)
  const [confirm,setConfirm]=useState<ConfirmState>(null)

  const genericFileRef=useRef<HTMLInputElement|null>(null)
  const photoFileRef=useRef<HTMLInputElement|null>(null)

  async function load(){
    setError('')

    const [fileResult,linkResult,storageResult,personalResult]=await Promise.all([
      supabase
        .from('household_files')
        .select('id,title,file_name,storage_path,mime_type,file_size,category,notes,source_module,source_record_id,archived_at,created_at')
        .eq('household_id',household.id)
        .eq('status','active')
        .order('created_at',{ ascending:false }),
      supabase
        .from('household_links')
        .select('id,title,url,notes,source_module,archived_at,created_at')
        .eq('household_id',household.id)
        .order('created_at',{ascending:false}),
      supabase.rpc('files_storage_entitlement_v1',{ p_household_id:household.id }),
      individualFree ? supabase.rpc('free_account_storage_usage_v1') : Promise.resolve({data:null,error:null}),
    ])

    if(fileResult.error){
      setError(fileResult.error.message)
    } else {
      const rows=(fileResult.data??[]) as HouseholdFile[]
      setFiles(rows)

      const signed=await Promise.all(rows.map(async(row)=>{
        const result=await supabase.storage.from('famioo-files').createSignedUrl(row.storage_path,3600)
        return [row.id,result.data?.signedUrl??''] as const
      }))
      setUrls(Object.fromEntries(signed))
    }

    if(linkResult.error){
      setError((current)=>current||linkResult.error.message)
    }else{
      setLinks((linkResult.data??[]) as HouseholdLink[])
    }

    if (individualFree && !personalResult.error && personalResult.data) {
      const row=Array.isArray(personalResult.data) ? personalResult.data[0] : personalResult.data
      if(row) setPersonalStorage({files_used_bytes:Number(row.files_used_bytes),files_quota_bytes:Number(row.files_quota_bytes)})
    }

    if(storageResult.error){
      setError((current)=>current||storageResult.error.message)
    } else {
      const row=Array.isArray(storageResult.data) ? storageResult.data[0] : storageResult.data
      setStorage(row as StorageEntitlement)
    }
  }

  useEffect(()=>{ void load() },[household.id])

  const activeFiles=useMemo(()=>files.filter((file)=>!file.archived_at),[files])
  const archivedFiles=useMemo(()=>files.filter((file)=>Boolean(file.archived_at)),[files])
  const activeLinks=useMemo(()=>links.filter((link)=>!link.archived_at),[links])
  const archivedLinks=useMemo(()=>links.filter((link)=>Boolean(link.archived_at)),[links])

  const visibleFiles=useMemo(()=>{
    if(tab==='archive') return archivedFiles
    if(tab==='photos') return activeFiles.filter((file)=>fileKind(file)==='photo')
    if(tab==='documents') return activeFiles.filter((file)=>fileKind(file)!=='photo')
    return activeFiles
  },[tab,activeFiles,archivedFiles])

  const usagePercent=individualFree
    ? personalStorage ? Math.min(100,100*personalStorage.files_used_bytes/Math.max(1,personalStorage.files_quota_bytes)) : 0
    : storage ? Math.min(100,Math.max(0,(Number(storage.used_bytes)/Math.max(1,Number(storage.quota_bytes)))*100)) : 0

  function resetComposer(){
    setEditingId(null)
    setTitle('')
    setCategory('document')
    setNotes('')
    setPendingFile(null)
    setError('')
  }

  function openEdit(file:HouseholdFile){
    resetComposer()
    setEditingId(file.id)
    setTitle(file.title)
    setCategory(file.category)
    setNotes(file.notes??'')
    setComposerOpen(true)
  }

  function choosePendingFile(file:File|null,preferredCategory?:FileCategory){
    if(!file) return

    if(file.size>50*1024*1024){
      setError('Files can be up to 50 MB each.')
      return
    }

    resetComposer()
    setPendingFile(file)
    setTitle(titleFromFile(file.name))
    setCategory(preferredCategory ?? (file.type.startsWith('image/') ? 'photo' : 'document'))
    setComposerOpen(true)
  }

  function handleGenericFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]??null
    event.target.value=''
    choosePendingFile(file)
  }

  function handlePhotoFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]??null
    event.target.value=''
    choosePendingFile(file,'photo')
  }

  async function saveFile(event:FormEvent){
    event.preventDefault()
    if(!canWrite || !title.trim()) return

    setBusy(true)
    setError('')
    setMessage('')

    if(editingId){
      const result=await supabase
        .from('household_files')
        .update({
          title:title.trim(),
          category,
          notes:notes.trim()||null,
          updated_at:new Date().toISOString(),
        })
        .eq('id',editingId)
        .eq('household_id',household.id)

      setBusy(false)

      if(result.error){
        setError(result.error.message)
        return
      }

      setComposerOpen(false)
      resetComposer()
      setMessage('File details updated.')
      await load()
      return
    }

    if(!pendingFile){
      setBusy(false)
      setError('Choose a file or photo first.')
      return
    }

    const reserve=await supabase.rpc('reserve_household_file_v1',{
      p_household_id:household.id,
      p_title:title.trim(),
      p_file_name:pendingFile.name,
      p_mime_type:pendingFile.type||'application/octet-stream',
      p_file_size:pendingFile.size,
      p_category:category,
      p_notes:notes.trim()||null,
    })

    if(reserve.error){
      setBusy(false)
      setError(reserve.error.message)
      return
    }

    const reservation=Array.isArray(reserve.data) ? reserve.data[0] : reserve.data
    const fileId=reservation?.file_id as string|undefined
    const storagePath=reservation?.storage_path as string|undefined

    if(!fileId || !storagePath){
      setBusy(false)
      setError('Famioo could not reserve storage for this file.')
      return
    }

    const upload=await supabase.storage
      .from('famioo-files')
      .upload(storagePath,pendingFile,{
        upsert:false,
        contentType:pendingFile.type||undefined,
      })

    if(upload.error){
      await supabase.rpc('cancel_household_file_v1',{
        p_household_id:household.id,
        p_file_id:fileId,
      })
      setBusy(false)
      setError(upload.error.message)
      return
    }

    const complete=await supabase.rpc('complete_household_file_v1',{
      p_household_id:household.id,
      p_file_id:fileId,
    })

    if(complete.error){
      await supabase.storage.from('famioo-files').remove([storagePath])
      await supabase.rpc('cancel_household_file_v1',{
        p_household_id:household.id,
        p_file_id:fileId,
      })
      setBusy(false)
      setError(complete.error.message)
      return
    }

    setBusy(false)
    setComposerOpen(false)
    resetComposer()
    setMessage('File uploaded.')
    await load()
  }

  async function archiveFile(file:HouseholdFile){
    const result=await supabase
      .from('household_files')
      .update({ archived_at:new Date().toISOString(),updated_at:new Date().toISOString() })
      .eq('id',file.id)
      .eq('household_id',household.id)

    if(result.error) setError(result.error.message)
    else {
      setConfirm(null)
      await load()
    }
  }

  async function restoreFile(file:HouseholdFile){
    const result=await supabase
      .from('household_files')
      .update({ archived_at:null,updated_at:new Date().toISOString() })
      .eq('id',file.id)
      .eq('household_id',household.id)

    if(result.error) setError(result.error.message)
    else await load()
  }

  async function deleteFile(file:HouseholdFile){
    setBusy(true)
    const storageDelete=await supabase.storage.from('famioo-files').remove([file.storage_path])

    if(storageDelete.error){
      setBusy(false)
      setError(storageDelete.error.message)
      return
    }

    const rowDelete=await supabase
      .from('household_files')
      .delete()
      .eq('id',file.id)
      .eq('household_id',household.id)

    setBusy(false)

    if(rowDelete.error){
      setError(rowDelete.error.message)
      return
    }

    setConfirm(null)
    await load()
  }

  function renderFile(file:HouseholdFile){
    const photo=fileKind(file)==='photo'
    const url=urls[file.id]

    return (
      <article className="files-row list-card" key={file.id}>
        <div className={photo?'files-preview photo':'files-preview'}>
          {photo && url ? <img src={url} alt=""/> : photo ? <FileImage size={22}/> : <FileText size={22}/>}
        </div>

        <div className="files-main">
          <strong>{file.title}</strong>
          <div className="files-meta">
            <span>{file.category}</span>
            <span>{formatBytes(Number(file.file_size))}</span>
            <span>{new Date(file.created_at).toLocaleDateString()}</span>
          </div>
          <small>{file.file_name}</small>
          {file.notes && <p>{file.notes}</p>}
        </div>

        <div className="files-actions">
          {url && (
            <a className="secondary-button compact" href={url} target="_blank" rel="noreferrer">
              <FolderOpen size={14}/>Open
            </a>
          )}
          {url && (
            <a className="icon-button compact-icon" href={url} download={file.file_name} aria-label={'Download '+file.title}>
              <Download size={14}/>
            </a>
          )}
          {canWrite && !file.archived_at && (
            <>
              <button type="button" className="icon-button compact-icon" onClick={()=>openEdit(file)} aria-label={'Edit '+file.title}><Pencil size={14}/></button>
              <button type="button" className="icon-button compact-icon" onClick={()=>setConfirm({ kind:'archive',file })} aria-label={'Archive '+file.title}><Archive size={14}/></button>
            </>
          )}
          {canWrite && file.archived_at && (
            <>
              <button type="button" className="icon-button compact-icon" onClick={()=>void restoreFile(file)} aria-label={'Restore '+file.title}><RotateCcw size={14}/></button>
              <button type="button" className="icon-button compact-icon danger-icon-button" onClick={()=>setConfirm({ kind:'delete',file })} aria-label={'Delete '+file.title}><Trash2 size={14}/></button>
            </>
          )}
        </div>
      </article>
    )
  }

  function renderLink(link:HouseholdLink){
    let host=''
    try{ host=new URL(link.url).hostname.replace(/^www\./,'') }catch{ host='Website' }

    return (
      <article className="files-row files-link-row list-card" key={link.id}>
        <div className="files-preview link"><Link2 size={22}/></div>

        <div className="files-main">
          <strong>{link.title}</strong>
          <div className="files-meta">
            <span>Link</span>
            <span>{host}</span>
            <span>{new Date(link.created_at).toLocaleDateString()}</span>
          </div>
          <small className="files-link-url">{link.url}</small>
          {link.notes&&<p>{link.notes}</p>}
        </div>

        <div className="files-actions">
          <a className="secondary-button compact" href={link.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14}/>Open website
          </a>
        </div>
      </article>
    )
  }

  return (
    <div className="page files-page">
      <input
        ref={genericFileRef}
        type="file"
        className="hidden-file-input"
        onChange={handleGenericFile}
      />
      <input
        ref={photoFileRef}
        type="file"
        className="hidden-file-input"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoFile}
      />

      <div className="page-heading-row">
        <div>
          <div className="page-label">FILES</div>
          <h1>Files</h1>
          <p className="page-subtitle">Keep household documents, photos and useful web links together. Files is included in the free Famioo core.</p>
        </div>

        {canWrite && (
          <div className="files-heading-actions">
            <button type="button" className="secondary-button compact" onClick={()=>photoFileRef.current?.click()}>
              <Camera size={15}/>Take photo
            </button>
            <button type="button" className="primary-button compact" onClick={()=>genericFileRef.current?.click()}>
              <Upload size={15}/>Upload file
            </button>
          </div>
        )}
      </div>

      <PrivacyNotice compact />

      {error && !composerOpen && <div className="notice error">{error}</div>}
      {message && <div className="notice success">{message}</div>}

      {storage && (
        <section className="files-storage-card list-card">
          <div className="files-storage-copy">
            <span className="eyebrow">STORAGE</span>
            <h2>{individualFree ? personalStorage ? formatBytes(personalStorage.files_used_bytes)+' of 1 GB' : '1 GB personal Free allowance' : formatBytes(Number(storage.used_bytes))+' of '+formatBytes(Number(storage.quota_bytes))}</h2>
            <p>
              {individualFree ? 'Your personal Free upload allowance applies across households. Shared Levnajici household storage and other members are unchanged.' : storage.storage_tier==='free_1gb' && '1 GB is included free with Famioo Files.'}
              {!individualFree && storage.storage_tier==='paid_10gb' && '10 GB is included because your qualifying paid modules are above €3/month.'}
              {!individualFree && storage.storage_tier==='addon_10gb' && '10 GB Files storage add-on is active.'}
              {!individualFree && storage.storage_tier==='downgrade_grace' && 'Your paid-module total dropped below €3/month. Existing files stay safe during the downgrade grace period.'}
            </p>
          </div>

          {(!individualFree || personalStorage) && <div className="files-storage-usage">
            <span><i style={{ width:usagePercent+'%' }}/></span>
            <small>{usagePercent.toFixed(1)}% used</small>
          </div>}

          {!individualFree && storage.needs_storage_offer && (
            <div className="files-storage-offer">
              <strong>Keep 10 GB for €{Number(storage.storage_addon_price_eur).toFixed(2)}/month</strong>
              <small>Otherwise Files returns to the free 1 GB limit. Famioo never auto-deletes existing files.</small>
              {storage.downgrade_grace_until && <em>Grace until {new Date(storage.downgrade_grace_until).toLocaleDateString()}</em>}
            </div>
          )}
        </section>
      )}

      <nav className="projects-tabs files-tabs" aria-label="Files sections">
        <button type="button" className={tab==='all'?'active':''} onClick={()=>setTab('all')}>All <span>{activeFiles.length}</span></button>
        <button type="button" className={tab==='photos'?'active':''} onClick={()=>setTab('photos')}>Photos <span>{activeFiles.filter((file)=>fileKind(file)==='photo').length}</span></button>
        <button type="button" className={tab==='documents'?'active':''} onClick={()=>setTab('documents')}>Documents <span>{activeFiles.filter((file)=>fileKind(file)!=='photo').length}</span></button>
        <button type="button" className={tab==='links'?'active':''} onClick={()=>setTab('links')}>Links <span>{activeLinks.length}</span></button>
        <button type="button" className={tab==='archive'?'active':''} onClick={()=>setTab('archive')}>Archive <span>{archivedFiles.length+archivedLinks.length}</span></button>
      </nav>

      {tab==='links' ? (
        activeLinks.length ? (
          <section className="files-list files-links-list">
            {activeLinks.map(renderLink)}
          </section>
        ) : (
          <div className="list-card empty-state files-empty">
            <Link2 size={28}/>
            <span className="empty-state-title">No saved links yet.</span>
            <span>Links saved from the QR scanner will appear here without using Files storage quota.</span>
          </div>
        )
      ) : visibleFiles.length ? (
        <section className="files-list">
          {visibleFiles.map(renderFile)}
          {tab==='archive'&&archivedLinks.map(renderLink)}
        </section>
      ) : tab==='archive'&&archivedLinks.length ? (
        <section className="files-list files-links-list">
          {archivedLinks.map(renderLink)}
        </section>
      ) : (
        <div className="list-card empty-state files-empty">
          <FileIcon size={28}/>
          <span className="empty-state-title">{tab==='archive'?'Nothing archived.':'No files here yet.'}</span>
          <span>{tab==='archive'?'Archived files and links stay here until restored or permanently deleted.':'Upload a document, take a photo, or save a website from the QR scanner.'}</span>
        </div>
      )}

      {composerOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
          if(event.currentTarget===event.target && !busy){setComposerOpen(false);resetComposer()}
        }}>
          <form className="modal-card files-composer" onSubmit={saveFile}>
            <header>
              <div>
                <span className="eyebrow">{editingId?'EDIT FILE':'ADD FILE'}</span>
                <h2>{editingId?'Edit file details':'Save to Famioo Files'}</h2>
              </div>
              <button type="button" className="icon-button" onClick={()=>{setComposerOpen(false);resetComposer()}} disabled={busy} aria-label="Close Files form"><X size={18}/></button>
            </header>

            {!editingId && pendingFile && (
              <div className="files-selected-file">
                {pendingFile.type.startsWith('image/') ? <FileImage size={18}/> : <FileText size={18}/>}
                <span><strong>{pendingFile.name}</strong><small>{formatBytes(pendingFile.size)}</small></span>
              </div>
            )}

            <label>Title<input value={title} onChange={(event)=>setTitle(event.target.value)} required autoFocus/></label>
            <label>Category<Select value={category} onChange={(value)=>setCategory(value as FileCategory)} options={categoryOptions} ariaLabel="Choose file category"/></label>
            <label>Notes<textarea rows={4} value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Optional note"/></label>

            {error && <div className="form-message error">{error}</div>}
            <div className="composer-footer-right">
              <button className="primary-button compact" disabled={busy}>
                {busy?'Saving…':editingId?'Save changes':'Upload'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind==='archive'?'Archive file?':'Permanently delete file?'}
        message={confirm?.kind==='archive'
          ? 'The file stays stored and can be restored from the Files archive.'
          : 'The file will be removed from Famioo storage permanently.'}
        confirmLabel={confirm?.kind==='archive'?'Archive':'Delete permanently'}
        danger={confirm?.kind==='delete'}
        busy={busy}
        onCancel={()=>setConfirm(null)}
        onConfirm={()=>void (async()=>{
          if(!confirm) return
          if(confirm.kind==='archive') await archiveFile(confirm.file)
          else await deleteFile(confirm.file)
        })()}
      />
    </div>
  )
}
