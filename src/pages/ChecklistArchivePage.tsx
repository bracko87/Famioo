import { ArchiveRestore, ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type ArchivedChecklist = {
  id: string
  title: string
  archived_at: string | null
  created_at: string
  category_id: string | null
}

type Category = {
  id: string
  name: string
}

export function ChecklistArchivePage() {
  const { household, modules } = useHousehold()
  const canWrite = Boolean(modules.find((module) => module.code === 'checklists')?.can_write)
  const [lists, setLists] = useState<ArchivedChecklist[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState('')

  async function load() {
    setError('')

    const [listResult, categoryResult, itemResult] = await Promise.all([
      supabase
        .from('checklists')
        .select('id,title,archived_at,created_at,category_id')
        .eq('household_id', household.id)
        .eq('status', 'archived')
        .order('archived_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('event_categories')
        .select('id,name')
        .eq('household_id', household.id),
      supabase
        .from('checklist_items')
        .select('checklist_id')
        .eq('household_id', household.id),
    ])

    if (listResult.error) setError(listResult.error.message)
    if (categoryResult.error) setError((current) => current || categoryResult.error.message)
    if (itemResult.error) setError((current) => current || itemResult.error.message)

    const categoryRows = (categoryResult.data ?? []) as Category[]
    setCategories(categoryRows)

    const shoppingCategoryIds = new Set(
      categoryRows
        .filter((category) => ['shopping', 'shoping'].includes(category.name.trim().toLowerCase()))
        .map((category) => category.id),
    )

    const archivedRows = ((listResult.data ?? []) as ArchivedChecklist[])
      .filter((list) => !list.category_id || !shoppingCategoryIds.has(list.category_id))

    setLists(archivedRows)

    const counts: Record<string, number> = {}
    for (const row of (itemResult.data ?? []) as Array<{ checklist_id: string }>) {
      counts[row.checklist_id] = (counts[row.checklist_id] ?? 0) + 1
    }
    setItemCounts(counts)
  }

  useEffect(() => { void load() }, [household.id])

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  )

  async function restore(listId: string) {
    if (!canWrite) return

    const result = await supabase.rpc('set_checklist_archived_v1', {
      p_checklist_id: listId,
      p_household_id: household.id,
      p_archived: false,
    })

    if (result.error) setError(result.error.message)
    else await load()
  }

  function formatDate(value: string | null) {
    if (!value) return 'Unknown date'
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(value))
  }

  return (
    <div className="page checklist-archive-page">
      <div className="archive-page-heading">
        <div>
          <div className="page-label">CHECKLIST ARCHIVE</div>
          <h1>Archived checklists</h1>
          <p className="page-subtitle">Finished checklists are sorted by archive date and can be restored for reuse.</p>
        </div>

        <Link className="secondary-button compact" to="/app/checklists">
          <ArrowLeft size={14} />
          Back to checklists
        </Link>
      </div>

      {error && <div className="notice error">{error}</div>}

      {lists.length === 0 ? (
        <section className="list-card empty-state archive-page-empty">
          <span className="empty-state-title">No archived checklists.</span>
          <span>Archived checklists will appear here.</span>
        </section>
      ) : (
        <section className="list-card archive-page-list">
          {lists.map((list) => (
            <div className="archive-page-row" key={list.id}>
              <div className="archive-date-column">
                <span>{formatDate(list.archived_at ?? list.created_at)}</span>
                <small>Archived</small>
              </div>

              <div className="archive-list-copy">
                <span>{list.title}</span>
                <small>
                  {list.category_id ? categoryById.get(list.category_id) ?? 'Checklist' : 'Checklist'}
                  {' · '}
                  {itemCounts[list.id] ?? 0} items
                </small>
              </div>

              {canWrite && (
                <button className="secondary-button compact" type="button" onClick={() => void restore(list.id)}>
                  <ArchiveRestore size={14} />
                  Restore
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
