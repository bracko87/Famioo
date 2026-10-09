import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Lightbulb,
  MapPin,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Star,
  StickyNote,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type MemoCategory='idea'|'place'|'activity'|'wish'|'note'|'someday'

type MemoRow={
  id:string
  category:MemoCategory
  title:string
  body:string|null
  link_url:string|null
  is_pinned:boolean
  created_by_user_id:string
  updated_by_user_id:string
  archived_at:string|null
  created_at:string
  updated_at:string
  created_by_name:string
  updated_by_name:string
}

type MemoDraft={
  id:string
  category:MemoCategory
  title:string
  body:string
  link_url:string
  is_pinned:boolean
}

const categoryLabels:Record<MemoCategory,string>={
  idea:'Idea',
  place:'Place to visit',
  activity:'Thing to do',
  wish:'Wish',
  note:'Note',
  someday:'Someday',
}

const emptyDraft:MemoDraft={
  id:'',
  category:'idea',
  title:'',
  body:'',
  link_url:'',
  is_pinned:false,
}

function categoryIcon(category:MemoCategory){
  switch(category){
    case 'place': return MapPin
    case 'activity': return Sparkles
    case 'wish': return Star
    case 'note': return StickyNote
    case 'someday': return NotebookPen
    default: return Lightbulb
  }
}

function formatDate(value:string){
  return new Date(value).toLocaleDateString(undefined,{
    day:'2-digit',
    month:'short',
    year:'numeric',
  })
}

function normalizeLink(value:string){
  const trimmed=value.trim()
  if(!trimmed) return ''
  return /^https?:\/\//i.test(trimmed)?trimmed:`https://${trimmed}`
}

export function MemoPage(){
  const {household}=useHousehold()

  const [memos,setMemos]=useState<MemoRow[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [search,setSearch]=useState('')
  const [categoryFilter,setCategoryFilter]=useState<'all'|MemoCategory>('all')
  const [showArchived,setShowArchived]=useState(false)
  const [editorOpen,setEditorOpen]=useState(false)
  const [draft,setDraft]=useState<MemoDraft>(emptyDraft)
  const [saving,setSaving]=useState(false)
  const [busyId,setBusyId]=useState('')

  const load=useCallback(async (foreground=false)=>{
    if(foreground) setLoading(true)
    setError('')

    const result=await supabase.rpc('family_memos_v1',{
      p_household_id:household.id,
      p_include_archived:showArchived,
    })

    if(result.error){
      setError(result.error.message)
    }else{
      setMemos((result.data??[]) as MemoRow[])
    }

    if(foreground) setLoading(false)
  },[household.id,showArchived])

  useEffect(()=>{
    void load(true)
  },[load])

  const visibleMemos=useMemo(()=>{
    const needle=search.trim().toLowerCase()
    return memos.filter((memo)=>{
      if(!showArchived&&memo.archived_at) return false
      if(categoryFilter!=='all'&&memo.category!==categoryFilter) return false
      if(!needle) return true

      return [
        memo.title,
        memo.body,
        memo.created_by_name,
        memo.updated_by_name,
        categoryLabels[memo.category],
      ].filter(Boolean).some((value)=>String(value).toLowerCase().includes(needle))
    })
  },[categoryFilter,memos,search,showArchived])

  const pinned=visibleMemos.filter((memo)=>memo.is_pinned&&!memo.archived_at)
  const unpinned=visibleMemos.filter((memo)=>!memo.is_pinned||memo.archived_at)
  const archivedCount=memos.filter((memo)=>memo.archived_at).length

  function openNew(category:MemoCategory='idea'){
    setDraft({...emptyDraft,category})
    setEditorOpen(true)
    setError('')
    setMessage('')
  }

  function openEdit(memo:MemoRow){
    if(memo.archived_at) return
    setDraft({
      id:memo.id,
      category:memo.category,
      title:memo.title,
      body:memo.body??'',
      link_url:memo.link_url??'',
      is_pinned:memo.is_pinned,
    })
    setEditorOpen(true)
    setError('')
    setMessage('')
  }

  async function saveMemo(event:FormEvent){
    event.preventDefault()
    if(!draft.title.trim()) return

    setSaving(true)
    setError('')
    setMessage('')

    const link=normalizeLink(draft.link_url)

    const result=await supabase.rpc('save_family_memo_v1',{
      p_household_id:household.id,
      p_id:draft.id||null,
      p_category:draft.category,
      p_title:draft.title.trim(),
      p_body:draft.body.trim()||null,
      p_link_url:link||null,
      p_is_pinned:draft.is_pinned,
    })

    setSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    const edited=Boolean(draft.id)
    setEditorOpen(false)
    setDraft({...emptyDraft})
    setMessage(edited?'Memo updated.':'Added to the family Someday area.')
    await load(false)
  }

  async function togglePinned(memo:MemoRow){
    if(memo.archived_at) return
    setBusyId(memo.id)
    const result=await supabase.rpc('set_family_memo_pinned_v1',{
      p_household_id:household.id,
      p_id:memo.id,
      p_is_pinned:!memo.is_pinned,
    })
    setBusyId('')
    if(result.error){
      setError(result.error.message)
      return
    }
    await load(false)
  }

  async function setArchived(memo:MemoRow,archived:boolean){
    setBusyId(memo.id)
    const result=await supabase.rpc('archive_family_memo_v1',{
      p_household_id:household.id,
      p_id:memo.id,
      p_archived:archived,
    })
    setBusyId('')
    if(result.error){
      setError(result.error.message)
      return
    }
    setMessage(archived?memo.title+' moved to archive.':memo.title+' restored.')
    await load(false)
  }

  function memoCard(memo:MemoRow){
    const Icon=categoryIcon(memo.category)
    const archived=Boolean(memo.archived_at)
    return (
      <article className={archived?'memo-card archived':'memo-card'} key={memo.id}>
        <header>
          <span className={'memo-category-icon '+memo.category}><Icon size={17}/></span>
          <span className="memo-card-heading">
            <small>{categoryLabels[memo.category]}</small>
            <strong>{memo.title}</strong>
          </span>
          {!archived&&(
            <button
              type="button"
              className={memo.is_pinned?'memo-pin active':'memo-pin'}
              disabled={busyId===memo.id}
              onClick={()=>void togglePinned(memo)}
              aria-label={memo.is_pinned?'Unpin memo':'Pin memo'}
              title={memo.is_pinned?'Unpin':'Pin'}
            >
              <Star size={15} fill={memo.is_pinned?'currentColor':'none'}/>
            </button>
          )}
        </header>

        {memo.body&&<p>{memo.body}</p>}

        {memo.link_url&&(
          <a className="memo-link" href={memo.link_url} target="_blank" rel="noreferrer">
            <ExternalLink size={13}/>
            <span>{memo.link_url.replace(/^https?:\/\//i,'')}</span>
          </a>
        )}

        <div className="memo-meta">
          <span>By {memo.created_by_name}</span>
          <span>Updated {formatDate(memo.updated_at)}</span>
        </div>

        <footer>
          {archived ? (
            <button type="button" disabled={busyId===memo.id} onClick={()=>void setArchived(memo,false)}>
              <ArchiveRestore size={13}/>{busyId===memo.id?'Restoring…':'Restore'}
            </button>
          ) : (
            <>
              <button type="button" onClick={()=>openEdit(memo)}>Edit</button>
              <button type="button" disabled={busyId===memo.id} onClick={()=>void setArchived(memo,true)}>
                <Archive size={13}/>{busyId===memo.id?'Archiving…':'Archive'}
              </button>
            </>
          )}
        </footer>
      </article>
    )
  }

  return (
    <div className="page memo-page">
      <div className="page-heading-row memo-heading">
        <div>
          <span className="eyebrow">SHARED MEMO / SOMEDAY</span>
          <h1>Ideas for later</h1>
          <p>Keep undated family ideas, places to visit, wishes and notes without forcing them into the Calendar or Tasks.</p>
        </div>
        <button type="button" className="primary-button compact" onClick={()=>openNew()}>
          <Plus size={15}/>Add memo
        </button>
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice">{message}</div>}

      <section className="memo-quick-add">
        <button type="button" onClick={()=>openNew('idea')}><Lightbulb size={17}/><span><strong>New idea</strong><small>Something worth remembering</small></span></button>
        <button type="button" onClick={()=>openNew('place')}><MapPin size={17}/><span><strong>Place to visit</strong><small>Restaurant, city, park or trip</small></span></button>
        <button type="button" onClick={()=>openNew('activity')}><Sparkles size={17}/><span><strong>Thing to do</strong><small>Family activity for later</small></span></button>
        <button type="button" onClick={()=>openNew('someday')}><NotebookPen size={17}/><span><strong>Someday</strong><small>No date needed</small></span></button>
      </section>

      <section className="memo-toolbar">
        <label className="memo-search">
          <Search size={15}/>
          <input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search family ideas and notes…"/>
          {search&&<button type="button" onClick={()=>setSearch('')} aria-label="Clear search"><X size={14}/></button>}
        </label>

        <select value={categoryFilter} onChange={(event)=>setCategoryFilter(event.target.value as 'all'|MemoCategory)}>
          <option value="all">All categories</option>
          {Object.entries(categoryLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
        </select>

        <button type="button" className={showArchived?'memo-archive-toggle active':'memo-archive-toggle'} onClick={()=>setShowArchived((current)=>!current)}>
          <Archive size={14}/>{showArchived?'Hide archive':'Show archive'}{archivedCount>0&&<b>{archivedCount}</b>}
        </button>
      </section>

      {loading?(
        <div className="memo-empty">Loading family memos…</div>
      ):visibleMemos.length===0?(
        <div className="memo-empty">
          <StickyNote size={30}/>
          <strong>{memos.length?'Nothing matches your filters':'Nothing is waiting for “someday” yet'}</strong>
          <span>{memos.length?'Try another search or category.':'Add an idea, a place to visit or anything the family wants to remember for later.'}</span>
          {!memos.length&&<button type="button" className="primary-button compact" onClick={()=>openNew()}><Plus size={14}/>Add first memo</button>}
        </div>
      ):(
        <>
          {pinned.length>0&&(
            <section className="memo-section">
              <div className="memo-section-head">
                <div><span className="eyebrow">PINNED</span><h2>Keep these visible</h2></div>
                <small>{pinned.length}</small>
              </div>
              <div className="memo-grid pinned">
                {pinned.map(memoCard)}
              </div>
            </section>
          )}

          <section className="memo-section">
            <div className="memo-section-head">
              <div>
                <span className="eyebrow">{showArchived?'MEMOS & ARCHIVE':'SOMEDAY'}</span>
                <h2>{showArchived?'Everything saved':'Family ideas & notes'}</h2>
              </div>
              <small>{unpinned.length}</small>
            </div>
            <div className="memo-grid">
              {unpinned.map(memoCard)}
            </div>
          </section>
        </>
      )}

      <div className="memo-future-note">
        <Sparkles size={15}/>
        <span>
          <strong>Keep it undated until it becomes real.</strong>
          <small>Direct conversion into Calendar events, Tasks or Projects is planned as a later connection between modules.</small>
        </span>
      </div>

      {editorOpen&&(
        <div className="modal-backdrop memo-editor-backdrop" role="dialog" aria-modal="true" aria-label={draft.id?'Edit family memo':'Add family memo'}>
          <section className="modal-card memo-editor">
            <header>
              <div>
                <span className="eyebrow">{draft.id?'EDIT MEMO':'NEW MEMO'}</span>
                <h2>{draft.id?'Update idea':'Save for later'}</h2>
              </div>
              <button type="button" className="icon-button" onClick={()=>setEditorOpen(false)} aria-label="Close"><X size={18}/></button>
            </header>

            <form onSubmit={saveMemo}>
              <label>
                <span>Category</span>
                <select value={draft.category} onChange={(event)=>setDraft((current)=>({...current,category:event.target.value as MemoCategory}))}>
                  {Object.entries(categoryLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
                </select>
              </label>

              <label>
                <span>Title *</span>
                <input value={draft.title} onChange={(event)=>setDraft((current)=>({...current,title:event.target.value}))} maxLength={180} required placeholder="What should the family remember?"/>
              </label>

              <label>
                <span>Notes</span>
                <textarea value={draft.body} onChange={(event)=>setDraft((current)=>({...current,body:event.target.value}))} rows={6} maxLength={12000} placeholder="Details, ideas, why it would be fun, what to bring…"/>
              </label>

              <label>
                <span>Optional link</span>
                <input type="text" value={draft.link_url} onChange={(event)=>setDraft((current)=>({...current,link_url:event.target.value}))} placeholder="https://…"/>
              </label>

              <label className="memo-pin-setting">
                <input type="checkbox" checked={draft.is_pinned} onChange={(event)=>setDraft((current)=>({...current,is_pinned:event.target.checked}))}/>
                <span><Star size={14}/>Pin this memo near the top</span>
              </label>

              <footer>
                <button type="button" className="secondary-button" onClick={()=>setEditorOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving||!draft.title.trim()}>
                  {saving?'Saving…':draft.id?'Save changes':'Save memo'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
