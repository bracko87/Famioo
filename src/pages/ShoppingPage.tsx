import { Plus, ShoppingBag, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type ShoppingList = {
  id: string
  title: string
  status: 'active' | 'archived'
}

type ShoppingItem = {
  id: string
  shopping_list_id: string
  item_text: string
  quantity: string | null
  checked: boolean
}

export function ShoppingPage() {
  const { household, modules } = useHousehold()
  const access = modules.find((module) => module.code === 'shopping')
  const canWrite = Boolean(access?.can_write)

  const [lists, setLists] = useState<ShoppingList[]>([])
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({})
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  async function load() {
    setError('')

    const [listResult, itemResult] = await Promise.all([
      supabase
        .from('shopping_lists')
        .select('id,title,status')
        .eq('household_id', household.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      supabase
        .from('shopping_items')
        .select('id,shopping_list_id,item_text,quantity,checked')
        .eq('household_id', household.id)
        .order('sort_order')
        .order('created_at'),
    ])

    if (listResult.error) setError(listResult.error.message)
    else setLists((listResult.data ?? []) as ShoppingList[])

    if (itemResult.error) setError((current) => current || itemResult.error.message)
    else setItems((itemResult.data ?? []) as ShoppingItem[])
  }

  useEffect(() => { void load() }, [household.id])

  async function createList(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim()) return

    const result = await supabase.from('shopping_lists').insert({
      household_id: household.id,
      title: title.trim(),
    })

    if (result.error) {
      setError(result.error.message)
      return
    }

    setTitle('')
    setComposerOpen(false)
    await load()
  }

  async function addItem(listId: string) {
    if (!canWrite) return

    const itemText = (itemDrafts[listId] ?? '').trim()
    const quantity = (quantityDrafts[listId] ?? '').trim()
    if (!itemText) return

    const result = await supabase.from('shopping_items').insert({
      household_id: household.id,
      shopping_list_id: listId,
      item_text: itemText,
      quantity: quantity || null,
    })

    if (result.error) {
      setError(result.error.message)
      return
    }

    setItemDrafts((current) => ({ ...current, [listId]: '' }))
    setQuantityDrafts((current) => ({ ...current, [listId]: '' }))
    await load()
  }

  async function toggleItem(item: ShoppingItem) {
    if (!canWrite) return

    const checked = !item.checked
    const { data } = await supabase.auth.getUser()

    const result = await supabase
      .from('shopping_items')
      .update({
        checked,
        checked_at: checked ? new Date().toISOString() : null,
        checked_by_user_id: checked ? data.user?.id ?? null : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (result.error) setError(result.error.message)
    else await load()
  }

  async function archiveList(listId: string) {
    if (!canWrite) return

    const result = await supabase
      .from('shopping_lists')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', listId)

    if (result.error) setError(result.error.message)
    else await load()
  }

  return (
    <div className="page shopping-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">SHOPPING</div>
          <h1>Shopping lists</h1>
          <p className="page-subtitle">Shared household shopping lists everyone can keep up to date.</p>
        </div>

        {canWrite && (
          <button className="primary-button compact" onClick={() => setComposerOpen(true)}>
            <Plus size={16} />
            Create list
          </button>
        )}
      </div>

      {!access?.enabled && <div className="module-access-note">Shopping is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && <div className="notice error">{error}</div>}

      <section className="shopping-grid">
        {lists.length === 0 ? (
          <div className="list-card empty-state">
            <ShoppingBag size={24} />
            <span className="empty-state-title">No shopping lists yet.</span>
            <span>{canWrite ? 'Create the first shared shopping list.' : 'There are no shopping lists to show.'}</span>
          </div>
        ) : lists.map((list) => {
          const listItems = items.filter((item) => item.shopping_list_id === list.id)
          const completed = listItems.filter((item) => item.checked).length

          return (
            <article className="list-card shopping-card" key={list.id}>
              <header>
                <div>
                  <h2>{list.title}</h2>
                  <small>{completed}/{listItems.length} completed</small>
                </div>
                {canWrite && (
                  <button className="text-button" type="button" onClick={() => void archiveList(list.id)}>
                    Archive
                  </button>
                )}
              </header>

              <div className="shopping-items">
                {listItems.map((item) => (
                  <button
                    type="button"
                    className={item.checked ? 'shopping-item checked' : 'shopping-item'}
                    key={item.id}
                    onClick={() => void toggleItem(item)}
                    disabled={!canWrite}
                  >
                    <span className="shopping-check">{item.checked ? '✓' : ''}</span>
                    <span className="shopping-item-name">{item.item_text}</span>
                    {item.quantity && <small>{item.quantity}</small>}
                  </button>
                ))}
              </div>

              {canWrite && (
                <div className="shopping-add">
                  <input
                    value={itemDrafts[list.id] ?? ''}
                    onChange={(event) => setItemDrafts((current) => ({ ...current, [list.id]: event.target.value }))}
                    placeholder="Add item…"
                  />
                  <input
                    className="shopping-quantity"
                    value={quantityDrafts[list.id] ?? ''}
                    onChange={(event) => setQuantityDrafts((current) => ({ ...current, [list.id]: event.target.value }))}
                    placeholder="Qty"
                  />
                  <button className="secondary-button compact" onClick={() => void addItem(list.id)}>Add item</button>
                </div>
              )}
            </article>
          )
        })}
      </section>

      {composerOpen && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setComposerOpen(false)
          }}
        >
          <form className="modal-card shopping-composer" onSubmit={createList}>
            <header>
              <div>
                <span className="eyebrow">NEW SHOPPING LIST</span>
                <h2>Create shopping list</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close shopping list form" onClick={() => setComposerOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <label>
              List name
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Weekly groceries"
                autoFocus
                required
              />
            </label>

            <button className="primary-button">Create list</button>
          </form>
        </div>
      )}
    </div>
  )
}
