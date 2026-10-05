import { Archive, ArchiveRestore, CalendarDays, ClipboardCheck, GripVertical, Plus, ShoppingBag, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence, EventCategory } from '../lib/types'

type ShoppingList = {
  id: string
  title: string
  status: 'active' | 'archived'
  linked_event_id: string | null
  sync_task: boolean
  linked_task_id: string | null
  category_id: string | null
  scheduled_date: string | null
  location_text: string | null
  total_cost: number | null
  currency: string
  archived_at: string | null
  expanded_slot: number | null
  created_at: string
}

type ShoppingItem = {
  id: string
  shopping_list_id: string
  item_text: string
  quantity: string | null
  checked: boolean
}

type ListSource = 'standalone' | 'event'

function occurrenceDate(event: CalendarOccurrence) {
  if (event.occurrence_start_date) return event.occurrence_start_date
  if (event.occurrence_start_at) return event.occurrence_start_at.slice(0, 10)
  return ''
}

export function ShoppingPage() {
  const { household, modules } = useHousehold()
  const access = modules.find((module) => module.code === 'shopping')
  const canWrite = Boolean(access?.can_write)
  const canSyncTasks = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)

  const [lists, setLists] = useState<ShoppingList[]>([])
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [events, setEvents] = useState<CalendarOccurrence[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<ShoppingList | null>(null)
  const [archiveCost, setArchiveCost] = useState('')
  const [sourceType, setSourceType] = useState<ListSource>('standalone')
  const [sourceEventKey, setSourceEventKey] = useState('')
  const [title, setTitle] = useState('')
  const [linkedEventId, setLinkedEventId] = useState<string | null>(null)
  const [scheduledDate, setScheduledDate] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [locationText, setLocationText] = useState<string | null>(null)
  const [syncTask, setSyncTask] = useState(false)
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({})
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [draggedListId, setDraggedListId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setError('')

    await supabase.rpc('purge_old_archives_v1', { p_household_id: household.id })

    const today = new Date().toISOString().slice(0, 10)
    const future = new Date()
    future.setDate(future.getDate() + 365)

    const [listResult, itemResult, categoryResult, eventResult] = await Promise.all([
      supabase
        .from('shopping_lists')
        .select('id,title,status,linked_event_id,sync_task,linked_task_id,category_id,scheduled_date,location_text,total_cost,currency,archived_at,expanded_slot,created_at')
        .eq('household_id', household.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('shopping_items')
        .select('id,shopping_list_id,item_text,quantity,checked')
        .eq('household_id', household.id)
        .order('sort_order')
        .order('created_at'),
      supabase
        .from('event_categories')
        .select('id,name,color_key')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('sort_order'),
      supabase.rpc('calendar_occurrences_v1', {
        p_household_id: household.id,
        p_range_start: today,
        p_range_end: future.toISOString().slice(0, 10),
      }),
    ])

    if (listResult.error) setError(listResult.error.message)
    else setLists((listResult.data ?? []) as ShoppingList[])

    if (itemResult.error) setError((current) => current || itemResult.error.message)
    else setItems((itemResult.data ?? []) as ShoppingItem[])

    if (categoryResult.error) setError((current) => current || categoryResult.error.message)
    else setCategories((categoryResult.data ?? []) as EventCategory[])

    if (eventResult.error) {
      setError((current) => current || eventResult.error.message)
    } else {
      setEvents((eventResult.data ?? []) as CalendarOccurrence[])
    }
  }

  useEffect(() => { void load() }, [household.id])

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  const activeLists = useMemo(
    () => lists.filter((list) => list.status === 'active'),
    [lists],
  )

  const expandedLists = useMemo(
    () => [1, 2].map((slot) => activeLists.find((list) => list.expanded_slot === slot) ?? null),
    [activeLists],
  )

  const collapsedLists = useMemo(
    () => activeLists
      .filter((list) => list.expanded_slot == null)
      .sort((a, b) => {
        const byDate = (a.scheduled_date ?? '9999-12-31').localeCompare(b.scheduled_date ?? '9999-12-31')
        return byDate || b.created_at.localeCompare(a.created_at)
      }),
    [activeLists],
  )

  const archivedLists = useMemo(
    () => lists
      .filter((list) => list.status === 'archived')
      .sort((a, b) => (b.archived_at ?? b.created_at).localeCompare(a.archived_at ?? a.created_at)),
    [lists],
  )

  function resetComposer() {
    setSourceType('standalone')
    setSourceEventKey('')
    setTitle('')
    setLinkedEventId(null)
    setScheduledDate(null)
    setCategoryId(null)
    setLocationText(null)
    setSyncTask(false)
    setError('')
  }

  function openComposer() {
    resetComposer()
    setComposerOpen(true)
  }

  function applyEventSource(key: string) {
    setSourceEventKey(key)
    const event = events.find((item) => item.occurrence_key === key)
    if (!event) {
      setLinkedEventId(null)
      setScheduledDate(null)
      setCategoryId(null)
      setLocationText(null)
      return
    }

    setLinkedEventId(event.event_id)
    setTitle(event.title)
    setScheduledDate(occurrenceDate(event))
    setCategoryId(event.category_id)
    setLocationText(event.location_text)
  }

  async function createList(event: FormEvent) {
    event.preventDefault()
    if (!canWrite) return
    if (sourceType === 'standalone' && !title.trim()) return
    if (sourceType === 'event' && !linkedEventId) return

    setSaving(true)
    setError('')

    const result = await supabase.rpc('create_shopping_list_v2', {
      p_household_id: household.id,
      p_title: sourceType === 'standalone' ? title.trim() : null,
      p_linked_event_id: sourceType === 'event' ? linkedEventId : null,
      p_scheduled_date: sourceType === 'event' ? scheduledDate : null,
      p_sync_task: syncTask,
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setComposerOpen(false)
    resetComposer()
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

  function beginArchive(list: ShoppingList) {
    setArchiveTarget(list)
    setArchiveCost('')
    setError('')
  }

  async function confirmArchive(event: FormEvent) {
    event.preventDefault()
    if (!archiveTarget || !canWrite) return

    const normalized = archiveCost.trim().replace(',', '.')
    const amount = normalized ? Number(normalized) : null

    if (normalized && (!Number.isFinite(amount) || Number(amount) < 0)) {
      setError('Enter a valid shopping cost.')
      return
    }

    setSaving(true)
    setError('')

    const result = await supabase.rpc('archive_shopping_list_v1', {
      p_shopping_list_id: archiveTarget.id,
      p_household_id: household.id,
      p_total_cost: amount,
      p_currency: 'EUR',
    })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setArchiveTarget(null)
    setArchiveCost('')
    await load()
  }

  async function restoreList(list: ShoppingList) {
    if (!canWrite) return

    setError('')
    const result = await supabase.rpc('restore_shopping_list_v1', {
      p_shopping_list_id: list.id,
      p_household_id: household.id,
    })

    if (result.error) setError(result.error.message)
    else await load()
  }

  async function setExpandedSlot(listId: string, slot: 1 | 2) {
    if (!canWrite) return

    setError('')
    const result = await supabase.rpc('set_list_expanded_slot_v1', {
      p_household_id: household.id,
      p_list_type: 'shopping',
      p_list_id: listId,
      p_slot: slot,
    })

    if (result.error) {
      setError(result.error.message)
      return
    }

    setDraggedListId(null)
    await load()
  }

  function dropIntoSlot(slot: 1 | 2) {
    if (!draggedListId) return
    void setExpandedSlot(draggedListId, slot)
  }

  function renderShoppingCard(list: ShoppingList) {
    const listItems = items.filter((item) => item.shopping_list_id === list.id)
    const completed = listItems.filter((item) => item.checked).length
    const category = list.category_id ? categoryById.get(list.category_id) : undefined

    return (
      <article className="list-card shopping-card" key={list.id}>
        <header>
          <div>
            <h2>{list.title}</h2>
            <div className="shopping-list-meta">
              {category && (
                <span>
                  <i className="meta-dot" style={{ backgroundColor: categoryColor(category.color_key) }} />
                  {category.name}
                </span>
              )}
              {list.scheduled_date && <span>{list.scheduled_date}</span>}
              {list.location_text && <GoogleMapsLink location={list.location_text} />}
            {list.linked_task_id && <span><ClipboardCheck size={11} />Tasks</span>}
              {list.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
              {list.linked_task_id && <span><ClipboardCheck size={11} />Tasks</span>}
            </div>
          </div>

          <div className="shopping-card-head-actions">
            <small>{completed}/{listItems.length}</small>
            {canWrite && (
              <button className="secondary-button compact" type="button" onClick={() => beginArchive(list)}>
                <Archive size={14} />
                Archive
              </button>
            )}
          </div>
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
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void addItem(list.id)
                }
              }}
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
  }

  function renderCollapsedShoppingList(list: ShoppingList) {
    const listItems = items.filter((item) => item.shopping_list_id === list.id)
    const completed = listItems.filter((item) => item.checked).length
    const category = list.category_id ? categoryById.get(list.category_id) : undefined

    return (
      <article
        className="list-card compact-list-card"
        key={list.id}
        draggable={canWrite}
        onDragStart={() => setDraggedListId(list.id)}
        onDragEnd={() => setDraggedListId(null)}
      >
        <span className="compact-list-drag" aria-hidden="true"><GripVertical size={16} /></span>
        <div className="compact-list-main">
          <h3>{list.title}</h3>
          <div>
            {category && <span><i className="meta-dot" style={{ backgroundColor: categoryColor(category.color_key) }} />{category.name}</span>}
            {list.scheduled_date && <span>{list.scheduled_date}</span>}
            {list.location_text && <GoogleMapsLink location={list.location_text} />}
          </div>
        </div>
        <span className="compact-list-progress">{completed}/{listItems.length}</span>
        {canWrite && (
          <button className="secondary-button compact" type="button" onClick={() => beginArchive(list)}>
            <Archive size={14} />
            Archive
          </button>
        )}
      </article>
    )
  }

  return (
    <div className="page shopping-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">SHOPPING</div>
          <h1>Shopping lists</h1>
          <p className="page-subtitle">Create several shared lists, or connect a list to a Calendar event and inherit its date, category and location.</p>
        </div>

        {canWrite && (
          <button className="primary-button compact" onClick={openComposer}>
            <Plus size={16} />
            Create list
          </button>
        )}
      </div>

      {!access?.enabled && <div className="module-access-note">Shopping is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !composerOpen && !archiveTarget && <div className="notice error">{error}</div>}

      {activeLists.length === 0 ? (
        <section className="shopping-grid">
          <div className="list-card empty-state">
            <ShoppingBag size={24} />
            <span className="empty-state-title">No active shopping lists.</span>
            <span>{canWrite ? 'Create the first shared shopping list.' : 'There are no shopping lists to show.'}</span>
          </div>
        </section>
      ) : (
        <>
          <section className="list-expanded-grid" aria-label="Expanded shopping lists">
            {expandedLists.map((list, index) => {
              const slot = (index + 1) as 1 | 2
              return (
                <div
                  className={'list-expanded-slot ' + (draggedListId ? 'drag-ready' : '')}
                  key={slot}
                  onDragOver={(event) => {
                    if (!canWrite) return
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    dropIntoSlot(slot)
                  }}
                >
                  {list ? (
                    <div
                      draggable={canWrite}
                      onDragStart={() => setDraggedListId(list.id)}
                      onDragEnd={() => setDraggedListId(null)}
                    >
                      {renderShoppingCard(list)}
                    </div>
                  ) : (
                    <div className="list-drop-placeholder">
                      <GripVertical size={18} />
                      <span>Drag a shopping list here to keep it expanded.</span>
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          {collapsedLists.length > 0 && (
            <section className="collapsed-list-section">
              <div className="collapsed-list-heading">
                <div>
                  <span className="eyebrow">MORE SHOPPING LISTS</span>
                  <h2>Other active shopping lists</h2>
                </div>
                <small>Drag any list onto one of the two expanded cards above.</small>
              </div>
              <div className="collapsed-list-stack">
                {collapsedLists.map((list) => renderCollapsedShoppingList(list))}
              </div>
            </section>
          )}
        </>
      )}

      <div className="archive-repository-bar">
        <button
          type="button"
          className="secondary-button archive-repository-button"
          onClick={() => setArchiveOpen(true)}
        >
          <Archive size={15} />
          Archived shopping lists
          <span>{archivedLists.length}</span>
        </button>
      </div>

      {archiveOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setArchiveOpen(false)
          }}
        >
          <section className="modal-card archive-repository-modal">
            <header>
              <div>
                <span className="eyebrow">SHOPPING ARCHIVE</span>
                <h2>Archived shopping lists</h2>
                <p className="archive-retention-note">Archived shopping lists are removed automatically after about 6 months.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close shopping archive" onClick={() => setArchiveOpen(false)}>
                <X size={18} />
              </button>
            </header>

            {archivedLists.length === 0 ? (
              <div className="archive-empty-state">No archived shopping lists yet.</div>
            ) : (
              <div className="archive-repository-list">
                {archivedLists.map((list) => (
                  <div className="archive-repository-row" key={list.id}>
                    <div>
                      <strong>{list.title}</strong>
                      <small>
                        {list.total_cost != null
                          ? new Intl.NumberFormat(undefined, { style: 'currency', currency: list.currency || 'EUR' }).format(Number(list.total_cost))
                          : 'No cost saved'}
                      </small>
                    </div>
                    {canWrite && (
                      <button className="secondary-button compact" type="button" onClick={() => void restoreList(list)}>
                        <ArchiveRestore size={14} />
                        Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {archiveTarget && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setArchiveTarget(null)
          }}
        >
          <form className="modal-card shopping-archive-composer" onSubmit={confirmArchive}>
            <header>
              <div>
                <span className="eyebrow">CLOSE SHOPPING LIST</span>
                <h2>{archiveTarget.title}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close archive form" onClick={() => setArchiveTarget(null)}>
                <X size={18} />
              </button>
            </header>

            <p className="form-intro">Enter the final cost if you want this shopping trip recorded automatically in Household Costs.</p>

            <label>
              Total cost
              <div className="money-input">
                <span>€</span>
                <input
                  inputMode="decimal"
                  value={archiveCost}
                  onChange={(event) => setArchiveCost(event.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <small className="field-hint">Optional. If entered, Famioo creates an additional Household Cost entry.</small>
            </label>

            <label className="composer-option">
              <input
                type="checkbox"
                checked={syncTask}
                disabled={!canSyncTasks}
                onChange={(event) => setSyncTask(event.target.checked)}
              />
              <span>
                <span>Show this shopping list in Tasks</span>
                <small>{canSyncTasks ? 'Creates one linked household Task. Archiving the shopping list completes the Task; restoring it reopens the Task.' : 'Tasks write access is required.'}</small>
              </span>
            </label>

            {error && <div className="form-message error">{error}</div>}

            <button className="primary-button" disabled={saving}>
              {saving ? 'Archiving…' : 'Archive shopping list'}
            </button>
          </form>
        </div>
      )}

      {composerOpen && canWrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setComposerOpen(false)
              resetComposer()
            }
          }}
        >
          <form className="modal-card shopping-composer" onSubmit={createList}>
            <header>
              <div>
                <span className="eyebrow">NEW SHOPPING LIST</span>
                <h2>Create shopping list</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close shopping list form" onClick={() => {
                setComposerOpen(false)
                resetComposer()
              }}>
                <X size={18} />
              </button>
            </header>

            <label>
              Start from
              <Select
                value={sourceType}
                onChange={(value) => {
                  const next = value as ListSource
                  setSourceType(next)
                  setSourceEventKey('')
                  setLinkedEventId(null)
                  setScheduledDate(null)
                  setCategoryId(null)
                  setLocationText(null)
                  if (next === 'event') setTitle('')
                }}
                options={[
                  { value: 'standalone', label: 'New shopping list' },
                  { value: 'event', label: 'Existing calendar event' },
                ]}
                ariaLabel="Shopping list source"
              />
            </label>

            {sourceType === 'event' && (
              <label>
                Calendar event
                <Select
                  value={sourceEventKey}
                  onChange={applyEventSource}
                  placeholder="Choose calendar event…"
                  options={events.map((item) => ({
                    value: item.occurrence_key,
                    label: item.title + (occurrenceDate(item) ? ' · ' + occurrenceDate(item) : ''),
                  }))}
                  ariaLabel="Choose calendar event for shopping list"
                />
              </label>
            )}

            <label>
              List name
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Weekly groceries"
                disabled={sourceType === 'event'}
                autoFocus={sourceType === 'standalone'}
                required
              />
            </label>

            {sourceType === 'event' && linkedEventId && (
              <div className="shopping-event-preview">
                <div>
                  <span>Category</span>
                  <strong>
                    {categoryId && categoryById.get(categoryId) ? (
                      <>
                        <i className="meta-dot" style={{ backgroundColor: categoryColor(categoryById.get(categoryId)!.color_key) }} />
                        {categoryById.get(categoryId)!.name}
                      </>
                    ) : 'No category'}
                  </strong>
                </div>
                <div>
                  <span>Date</span>
                  <strong>{scheduledDate ?? 'No date'}</strong>
                </div>
                <div className="shopping-event-location">
                  <span>Location</span>
                  {locationText
                    ? <GoogleMapsLink location={locationText} />
                    : <strong>No location</strong>}
                </div>
              </div>
            )}

            {error && <div className="form-message error">{error}</div>}

            <button className="primary-button" disabled={saving || (sourceType === 'event' && !linkedEventId)}>
              {saving ? 'Creating…' : 'Create list'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
