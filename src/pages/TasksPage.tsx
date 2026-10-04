import { Plus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type Task = {
  id: string
  title: string
  status: 'open' | 'done' | 'archived'
  priority: 'low' | 'normal' | 'high'
  due_date: string | null
}

export function TasksPage() {
  const { household, modules } = useHousehold()
  const canWrite = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)

  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const result = await supabase
      .from('tasks')
      .select('id,title,status,priority,due_date')
      .eq('household_id', household.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })

    if (result.error) setError(result.error.message)
    else setTasks((result.data ?? []) as Task[])
  }

  useEffect(() => { void load() }, [household.id])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim()) return

    const result = await supabase.from('tasks').insert({
      household_id: household.id,
      title: title.trim(),
    })

    if (result.error) setError(result.error.message)
    else {
      setTitle('')
      await load()
    }
  }

  async function toggle(task: Task) {
    if (!canWrite) return

    const done = task.status !== 'done'
    const result = await supabase.from('tasks').update({
      status: done ? 'done' : 'open',
      completed_at: done ? new Date().toISOString() : null,
      completed_by_profile_id: null,
    }).eq('id', task.id)

    if (result.error) setError(result.error.message)
    else await load()
  }

  return (
    <div className="page">
      <div className="page-label">TASKS</div>

      {canWrite ? (
        <form className="quick-create" onSubmit={add}>
          <Plus size={18} />
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a household task…" />
          <button className="primary-button compact"><Plus size={16} />Add task</button>
        </form>
      ) : (
        <div className="module-access-note">Read-only access</div>
      )}

      {error && <div className="notice error">{error}</div>}

      <section className="list-card">
        {tasks.length === 0 ? (
          <div className="empty-state"><strong>No tasks yet.</strong><span>{canWrite ? 'Add the first household task above.' : 'There are no household tasks to show.'}</span></div>
        ) : tasks.map((task) => (
          <button
            className={task.status === 'done' ? 'task-row done' : 'task-row'}
            key={task.id}
            onClick={() => void toggle(task)}
            disabled={!canWrite}
          >
            <span className="task-check">{task.status === 'done' ? '✓' : ''}</span>
            <span><strong>{task.title}</strong><small>{task.due_date ?? 'No date'} · {task.priority}</small></span>
          </button>
        ))}
      </section>
    </div>
  )
}
