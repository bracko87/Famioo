import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { supabase } from '../lib/supabase'

type ArchivedProject = {
  id:string
  title:string
  category_id:string | null
  due_date:string | null
  status:'archived'
  updated_at:string
}

type ArchivedItem = {
  id:string
  project_id:string | null
  item_kind:'project_task' | 'chore'
  title:string
  category_id:string | null
  due_date:string | null
  status:'archived'
  updated_at:string
}

type Category = { id:string;name:string }

function formatDate(value:string | null) {
  if (!value) return 'No date'
  return new Intl.DateTimeFormat(undefined,{
    year:'numeric',month:'short',day:'2-digit',
  }).format(new Date(value + (value.length === 10 ? 'T12:00:00' : '')))
}

export function ProjectsArchivePage() {
  const { household,modules }=useHousehold()
  const canWrite=Boolean(modules.find((module) => module.code === 'projects')?.can_write)
  const [projects,setProjects]=useState<ArchivedProject[]>([])
  const [items,setItems]=useState<ArchivedItem[]>([])
  const [categories,setCategories]=useState<Category[]>([])
  const [error,setError]=useState('')
  const [confirm,setConfirm]=useState<
    | { kind:'project';id:string;title:string }
    | { kind:'item';id:string;title:string }
    | null
  >(null)
  const [busy,setBusy]=useState(false)

  async function load() {
    setError('')
    await supabase.rpc('archive_expired_projects_chores_v1',{ p_household_id:household.id })

    const [projectResult,itemResult,categoryResult]=await Promise.all([
      supabase
        .from('household_projects')
        .select('id,title,category_id,due_date,status,updated_at')
        .eq('household_id',household.id)
        .eq('status','archived')
        .order('updated_at',{ ascending:false }),
      supabase
        .from('project_work_items')
        .select('id,project_id,item_kind,title,category_id,due_date,status,updated_at')
        .eq('household_id',household.id)
        .eq('status','archived')
        .order('updated_at',{ ascending:false }),
      supabase
        .from('event_categories')
        .select('id,name')
        .eq('household_id',household.id),
    ])

    if (projectResult.error) setError(projectResult.error.message)
    else setProjects((projectResult.data ?? []) as ArchivedProject[])

    if (itemResult.error) setError((current) => current || itemResult.error.message)
    else setItems((itemResult.data ?? []) as ArchivedItem[])

    if (categoryResult.error) setError((current) => current || categoryResult.error.message)
    else setCategories((categoryResult.data ?? []) as Category[])
  }

  useEffect(() => { void load() },[household.id])

  const categoryById=useMemo(
    () => new Map(categories.map((category) => [category.id,category.name])),
    [categories],
  )

  async function restoreProject(project:ArchivedProject) {
    const result=await supabase.rpc('set_household_project_archived_v1',{
      p_project_id:project.id,p_household_id:household.id,p_archived:false,
    })
    if (result.error) setError(result.error.message)
    else await load()
  }

  async function deleteProject(project:ArchivedProject) {
    const result=await supabase.rpc('delete_archived_household_project_v1',{
      p_project_id:project.id,p_household_id:household.id,
    })
    if (result.error) setError(result.error.message)
    else await load()
  }

  async function restoreItem(item:ArchivedItem) {
    const result=await supabase.rpc('set_project_work_item_archived_v1',{
      p_item_id:item.id,p_household_id:household.id,p_archived:false,
    })
    if (result.error) setError(result.error.message)
    else await load()
  }

  async function deleteItem(item:ArchivedItem) {
    const result=await supabase.rpc('delete_archived_project_work_item_v1',{
      p_item_id:item.id,p_household_id:household.id,
    })
    if (result.error) setError(result.error.message)
    else await load()
  }

  function archiveRow(
    row:ArchivedProject | ArchivedItem,
    typeLabel:string,
    onRestore:()=>void,
    onDelete:()=>void,
  ) {
    return (
      <div className="archive-page-row" key={typeLabel+row.id}>
        <div className="archive-date-column">
          <span>{formatDate(row.due_date)}</span>
          <small>Due date</small>
        </div>

        <div className="archive-list-copy">
          <span>{row.title}</span>
          <small>
            {row.category_id ? categoryById.get(row.category_id) ?? typeLabel : typeLabel}
            {' · Archived '}
            {formatDate(row.updated_at)}
          </small>
        </div>

        {canWrite && (
          <div className="archive-row-actions">
            <button type="button" className="secondary-button compact" onClick={onRestore}>
              <RotateCcw size={13} />Restore
            </button>
            <button type="button" className="secondary-button compact danger-button" onClick={onDelete}>
              <Trash2 size={13} />Delete
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page task-archive-page">
      <div className="archive-page-heading">
        <div>
          <div className="page-label">PROJECTS & CHORES ARCHIVE</div>
          <h1>Archived projects & chores</h1>
          <p className="page-subtitle">
            Past-dated or manually archived Projects & Chores stay here. Restore them or permanently remove them when no longer needed.
          </p>
        </div>

        <Link className="secondary-button compact" to="/app/projects">
          <ArrowLeft size={14} />Back to Projects & Chores
        </Link>
      </div>

      {error && <div className="notice error">{error}</div>}

      <section className="task-section">
        <header className="task-section-head">
          <div><h2>Projects</h2><p>Archived household projects.</p></div>
          <span>{projects.length}</span>
        </header>
        {projects.length
          ? <div className="list-card archive-page-list">{projects.map((project) => archiveRow(project,'Project',() => void restoreProject(project),() => setConfirm({ kind:'project',id:project.id,title:project.title })))}</div>
          : <div className="task-section-empty">No archived projects.</div>}
      </section>

      <section className="task-section">
        <header className="task-section-head">
          <div><h2>Responsibilities & chores</h2><p>Archived project responsibilities and standalone chores.</p></div>
          <span>{items.length}</span>
        </header>
        {items.length
          ? <div className="list-card archive-page-list">{items.map((item) => archiveRow(item,item.item_kind === 'chore' ? 'Chore' : 'Project responsibility',() => void restoreItem(item),() => setConfirm({ kind:'item',id:item.id,title:item.title })))}</div>
          : <div className="task-section-empty">No archived responsibilities or chores.</div>}
      </section>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind==='project' ? 'Permanently delete project?' : 'Permanently delete responsibility?'}
        message="This archived Projects & Chores record will be permanently removed. Linked Calendar events and Tasks stay unchanged."
        confirmLabel="Delete permanently"
        danger
        busy={busy}
        onCancel={()=>setConfirm(null)}
        onConfirm={()=>void (async()=>{
          if(!confirm) return
          setBusy(true)
          if(confirm.kind==='project'){
            const target=projects.find((row)=>row.id===confirm.id)
            if(target) await deleteProject(target)
          } else {
            const target=items.find((row)=>row.id===confirm.id)
            if(target) await deleteItem(target)
          }
          setBusy(false)
          setConfirm(null)
        })()}
      />
    </div>
  )
}
