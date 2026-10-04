import { Plus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type Checklist = { id: string; title: string }
type Item = { id: string; checklist_id: string; item_text: string; checked: boolean }

export function ChecklistsPage() {
  const { household } = useHousehold()
  const [lists, setLists] = useState<Checklist[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [title, setTitle] = useState('')
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  async function load() {
    const [listResult, itemResult] = await Promise.all([
      supabase.from('checklists').select('id,title').eq('household_id', household.id).eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('checklist_items').select('id,checklist_id,item_text,checked').eq('household_id', household.id).order('sort_order'),
    ])

    if (listResult.error) setError(listResult.error.message)
    else setLists((listResult.data ?? []) as Checklist[])
    if (itemResult.error) setError(itemResult.error.message)
    else setItems((itemResult.data ?? []) as Item[])
  }

  useEffect(() => { void load() }, [household.id])

  async function createList(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const result = await supabase.from('checklists').insert({
      household_id: household.id,
      title: title.trim(),
    })
    if (result.error) setError(result.error.message)
    else {
      setTitle('')
      await load()
    }
  }

  async function addItem(listId: string) {
    const itemText = (itemDrafts[listId] ?? '').trim()
    if (!itemText) return
    const result = await supabase.from('checklist_items').insert({
      household_id: household.id,
      checklist_id: listId,
      item_text: itemText,
    })
    if (result.error) setError(result.error.message)
    else {
      setItemDrafts((current) => ({ ...current, [listId]: '' }))
      await load()
    }
  }

  async function toggle(item: Item) {
    const checked = !item.checked
    const user = (await supabase.auth.getUser()).data.user
    const result = await supabase.from('checklist_items').update({
      checked,
      checked_at: checked ? new Date().toISOString() : null,
      checked_by_user_id: checked ? user?.id ?? null : null,
    }).eq('id', item.id)

    if (result.error) setError(result.error.message)
    else await load()
  }

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">CHECKLISTS</span>
          <h1>Shared lists</h1>
          <p>Create lists independently. Linking them to events can be added without changing this foundation.</p>
        </div>
      </section>

      <form className="quick-create" onSubmit={createList}>
        <Plus size={18} />
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Create a checklist…" />
        <button>Create</button>
      </form>

      {error && <div className="notice error">{error}</div>}

      <section className="checklist-grid">
        {lists.length === 0 ? (
          <div className="list-card empty-state"><strong>No checklists yet.</strong><span>Create the first reusable list.</span></div>
        ) : lists.map((list) => {
          const listItems = items.filter((item) => item.checklist_id === list.id)
          return (
            <article className="list-card checklist-card" key={list.id}>
              <header><h2>{list.title}</h2><small>{listItems.filter((item) => item.checked).length}/{listItems.length}</small></header>
              <div className="checklist-items">
                {listItems.map((item) => (
                  <button className={item.checked ? 'checklist-item checked' : 'checklist-item'} key={item.id} onClick={() => void toggle(item)}>
                    <span>{item.checked ? '✓' : ''}</span>{item.item_text}
                  </button>
                ))}
              </div>
              <div className="checklist-add">
                <input
                  value={itemDrafts[list.id] ?? ''}
                  onChange={(event) => setItemDrafts((current) => ({ ...current, [list.id]: event.target.value }))}
                  placeholder="Add item…"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void addItem(list.id)
                    }
                  }}
                />
                <button onClick={() => void addItem(list.id)}>Add</button>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}
