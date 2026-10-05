import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type ArchivedTask = {
  id: string
  title: string
  due_date: string | null
  archived_at: string | null
  created_at: string
  category_id: string | null
}

type Category = {
  id: string
  name: string
}

export function TaskArchivePage() {
  const { household } = useHousehold()
  const [tasks, setTasks] = useState<ArchivedTask[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState('')

  async function load() {
    setError('')

    await Promise.all([
      supabase.rpc('archive_overdue_work_v1', { p_household_id: household.id }),
      supabase.rpc('purge_old_archives_v1', { p_household_id: household.id }),
    ])

    const [taskResult, categoryResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('id,title,due_date,archived_at,created_at,category_id')
        .eq('household_id', household.id)
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('event_categories')
        .select('id,name')
        .eq('household_id', household.id),
    ])

    if (taskResult.error) setError(taskResult.error.message)
    else setTasks((taskResult.data ?? []) as ArchivedTask[])

    if (categoryResult.error) setError((current) => current || categoryResult.error.message)
    else setCategories((categoryResult.data ?? []) as Category[])
  }

  useEffect(() => { void load() }, [household.id])

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  )

  function formatDate(value: string | null) {
    if (!value) return 'No date'
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(value + (value.length === 10 ? 'T12:00:00' : '')))
  }

  return (
    <div className="page task-archive-page">
      <div className="archive-page-heading">
        <div>
          <div className="page-label">TASK ARCHIVE</div>
          <h1>Archived tasks</h1>
          <p className="page-subtitle">
            Tasks with dates in the past are moved here automatically, whether completed or not. Archived tasks are removed after about 6 months.
          </p>
        </div>

        <Link className="secondary-button compact" to="/app/tasks">
          <ArrowLeft size={14} />
          Back to tasks
        </Link>
      </div>

      {error && <div className="notice error">{error}</div>}

      {tasks.length === 0 ? (
        <section className="list-card empty-state archive-page-empty">
          <span className="empty-state-title">No archived tasks.</span>
          <span>Past-dated tasks will appear here automatically.</span>
        </section>
      ) : (
        <section className="list-card archive-page-list">
          {tasks.map((task) => (
            <div className="archive-page-row" key={task.id}>
              <div className="archive-date-column">
                <span>{formatDate(task.due_date)}</span>
                <small>Task date</small>
              </div>

              <div className="archive-list-copy">
                <span>{task.title}</span>
                <small>
                  {task.category_id ? categoryById.get(task.category_id) ?? 'Task' : 'Task'}
                  {' · Archived '}
                  {formatDate(task.archived_at ?? task.created_at)}
                </small>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
