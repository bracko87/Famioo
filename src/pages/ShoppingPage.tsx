import { Archive, ArchiveRestore, BarChart3, CalendarDays, Camera, ClipboardCheck, GripVertical, Plus, ReceiptText, ShoppingBag, Sparkles, Store, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { Select } from '../components/ui/Select'
import { PrivacyNotice } from '../components/PrivacyNotice'
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

type ShoppingReceipt = {
  id: string
  shopping_list_id: string | null
  linked_cost_id: string | null
  store_name: string | null
  purchase_date: string
  total_amount: number | null
  currency: string
  file_path: string | null
  file_name: string | null
  extraction_status: 'manual' | 'pending' | 'reviewed' | 'failed'
  ai_model: string | null
  created_at: string
}

type ShoppingReceiptItem = {
  id: string
  receipt_id: string
  product_name: string
  normalized_name: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  line_total: number | null
  category: string | null
}

type ReceiptDraftItem = {
  product_name: string
  normalized_name: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  line_total: number | null
  category: string | null
  confidence: number
}

type ReceiptDraft = {
  store_name: string
  purchase_date: string
  total_amount: number | null
  currency: string
  confidence: number
  items: ReceiptDraftItem[]
}

type ListSource = 'standalone' | 'event'

function occurrenceDate(event: CalendarOccurrence) {
  if (event.occurrence_start_date) return event.occurrence_start_date
  if (event.occurrence_start_at) return event.occurrence_start_at.slice(0, 10)
  return ''
}

function safeReceiptFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120) || 'receipt'
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Receipt image could not be read.'))
    reader.readAsDataURL(file)
  })
}

function moneyValue(value: number, currency = 'EUR') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(value)
}

export function ShoppingPage() {
  const { household, modules } = useHousehold()
  const access = modules.find((module) => module.code === 'shopping')
  const assistantAccess = modules.find((module) => module.code === 'assistant')
  const canWrite = Boolean(access?.can_write)
  const canSyncTasks = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)
  const hasAiAssistant = Boolean(assistantAccess?.enabled)

  const [lists, setLists] = useState<ShoppingList[]>([])
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [events, setEvents] = useState<CalendarOccurrence[]>([])
  const [receipts, setReceipts] = useState<ShoppingReceipt[]>([])
  const [receiptItems, setReceiptItems] = useState<ShoppingReceiptItem[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<ShoppingList | null>(null)
  const [archiveCost, setArchiveCost] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraft | null>(null)
  const [receiptModel, setReceiptModel] = useState('')
  const [receiptAiLoading, setReceiptAiLoading] = useState(false)
  const receiptInputRef = useRef<HTMLInputElement>(null)
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

    const [listResult, itemResult, categoryResult, eventResult, receiptResult, receiptItemResult] = await Promise.all([
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
      supabase
        .from('shopping_receipts')
        .select('id,shopping_list_id,linked_cost_id,store_name,purchase_date,total_amount,currency,file_path,file_name,extraction_status,ai_model,created_at')
        .eq('household_id', household.id)
        .order('purchase_date', { ascending: false })
        .limit(500),
      supabase
        .from('shopping_receipt_items')
        .select('id,receipt_id,product_name,normalized_name,quantity,unit,unit_price,line_total,category')
        .eq('household_id', household.id)
        .limit(4000),
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
      const shoppingCategoryIds = new Set(
        (categoryResult.data ?? [])
          .filter((category) => ['shopping','shoping','einkaufen'].includes(String(category.name).trim().toLowerCase()))
          .map((category) => category.id),
      )
      setEvents(((eventResult.data ?? []) as CalendarOccurrence[]).filter(
        (event) => Boolean(event.category_id && shoppingCategoryIds.has(event.category_id)),
      ))
    }

    if (receiptResult.error) setError((current) => current || receiptResult.error.message)
    else setReceipts((receiptResult.data ?? []) as ShoppingReceipt[])

    if (receiptItemResult.error) setError((current) => current || receiptItemResult.error.message)
    else setReceiptItems((receiptItemResult.data ?? []) as ShoppingReceiptItem[])
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

  const receiptById = useMemo(
    () => new Map(receipts.map((receipt) => [receipt.id, receipt])),
    [receipts],
  )

  const currentMonthKey = new Date().toISOString().slice(0, 7)

  const monthlyReceipts = useMemo(
    () => receipts.filter((receipt) => receipt.purchase_date.startsWith(currentMonthKey)),
    [receipts, currentMonthKey],
  )

  const receiptInsights = useMemo(() => {
    const storeTotals = new Map<string, number>()
    for (const receipt of monthlyReceipts) {
      const store = receipt.store_name?.trim() || 'Unknown store'
      storeTotals.set(store, (storeTotals.get(store) ?? 0) + Number(receipt.total_amount ?? 0))
    }

    const stores = Array.from(storeTotals.entries())
      .map(([store, total]) => ({ store, total }))
      .sort((a, b) => b.total - a.total)

    const monthlyReceiptIds = new Set(monthlyReceipts.map((receipt) => receipt.id))
    const monthlyItems = receiptItems.filter((item) => monthlyReceiptIds.has(item.receipt_id))
    const mostExpensive = [...monthlyItems]
      .filter((item) => item.line_total != null)
      .sort((a, b) => Number(b.line_total) - Number(a.line_total))[0] ?? null

    const productMap = new Map<string, Array<{ price: number; store: string; date: string }>>()
    for (const item of receiptItems) {
      if (item.unit_price == null || !item.normalized_name.trim()) continue
      const receipt = receiptById.get(item.receipt_id)
      if (!receipt) continue
      const key = item.normalized_name.trim().toLowerCase()
      const rows = productMap.get(key) ?? []
      rows.push({
        price: Number(item.unit_price),
        store: receipt.store_name?.trim() || 'Unknown store',
        date: receipt.purchase_date,
      })
      productMap.set(key, rows)
    }

    const comparisons = Array.from(productMap.entries())
      .filter(([, rows]) => rows.length >= 2)
      .map(([name, rows]) => {
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
        const prices = rows.map((row) => row.price)
        return {
          name,
          observations: rows.length,
          min: Math.min(...prices),
          max: Math.max(...prices),
          last: sorted[sorted.length - 1],
        }
      })
      .sort((a, b) => (b.max - b.min) - (a.max - a.min))
      .slice(0, 6)

    return {
      total: monthlyReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount ?? 0), 0),
      stores,
      mostExpensive,
      comparisons,
    }
  }, [monthlyReceipts, receiptItems, receiptById])

  function resetReceiptState() {
    setReceiptFile(null)
    setReceiptDraft(null)
    setReceiptModel('')
    setReceiptAiLoading(false)
  }

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

  async function removeItem(item: ShoppingItem) {
    if (!canWrite) return

    setError('')
    const result = await supabase
      .from('shopping_items')
      .delete()
      .eq('household_id', household.id)
      .eq('id', item.id)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setItems((current) => current.filter((row) => row.id !== item.id))
  }

  function beginArchive(list: ShoppingList) {
    setArchiveTarget(list)
    setArchiveCost('')
    resetReceiptState()
    setError('')
  }

  function chooseReceiptFile(file: File | null) {
    setError('')
    if (!file) return

    if (file.size > 15 * 1024 * 1024) {
      setError('Receipt files can be up to 15 MB.')
      return
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(file.type)) {
      setError('Use a JPG, PNG, WebP or PDF receipt.')
      return
    }

    setReceiptFile(file)
    setReceiptDraft(null)
    setReceiptModel('')
  }

  async function extractReceiptWithAssistant() {
    if (!receiptFile || receiptAiLoading) return
    if (!hasAiAssistant) {
      setError('AI Assistant is required to read receipt products automatically.')
      return
    }
    if (!receiptFile.type.startsWith('image/')) {
      setError('Assistant receipt extraction currently supports receipt photos (JPG, PNG or WebP). PDFs can still be stored with a manual total.')
      return
    }

    setReceiptAiLoading(true)
    setError('')

    try {
      const imageData = await fileToDataUrl(receiptFile)
      const result = await supabase.functions.invoke('extract-shopping-receipt', {
        body: {
          household_id: household.id,
          image_data_url: imageData,
          reference_date: archiveTarget?.scheduled_date ?? new Date().toISOString().slice(0, 10),
        },
      })

      if (result.error || result.data?.error) {
        setError(String(result.data?.error || result.error?.message || 'Assistant could not read this receipt.'))
        return
      }

      const receipt = result.data?.receipt
      if (!receipt) {
        setError('Assistant returned no receipt information.')
        return
      }

      const draft: ReceiptDraft = {
        store_name: String(receipt.store_name ?? ''),
        purchase_date: String(receipt.purchase_date ?? archiveTarget?.scheduled_date ?? new Date().toISOString().slice(0, 10)),
        total_amount: receipt.total_amount == null ? null : Number(receipt.total_amount),
        currency: String(receipt.currency || 'EUR'),
        confidence: Number(receipt.confidence ?? 0),
        items: Array.isArray(receipt.items) ? receipt.items.map((item: ReceiptDraftItem) => ({
          ...item,
          product_name: String(item.product_name ?? ''),
          normalized_name: String(item.normalized_name ?? item.product_name ?? ''),
          quantity: item.quantity == null ? null : Number(item.quantity),
          unit_price: item.unit_price == null ? null : Number(item.unit_price),
          line_total: item.line_total == null ? null : Number(item.line_total),
          confidence: Number(item.confidence ?? 0),
        })) : [],
      }

      setReceiptDraft(draft)
      setReceiptModel(String(result.data?.model ?? ''))
      if (draft.total_amount != null) setArchiveCost(String(draft.total_amount.toFixed(2)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Assistant could not read this receipt.')
    } finally {
      setReceiptAiLoading(false)
    }
  }

  function updateReceiptItem(index: number, patch: Partial<ReceiptDraftItem>) {
    setReceiptDraft((current) => current ? {
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    } : current)
  }

  function removeReceiptItem(index: number) {
    setReceiptDraft((current) => current ? {
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    } : current)
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

    let uploadedPath: string | null = null

    try {
      if (receiptFile) {
        uploadedPath = `${household.id}/${crypto.randomUUID()}/${safeReceiptFileName(receiptFile.name)}`
        const upload = await supabase.storage
          .from('shopping-receipts')
          .upload(uploadedPath, receiptFile, {
            contentType: receiptFile.type,
            upsert: false,
          })

        if (upload.error) throw upload.error
      }

      const result = await supabase.rpc('finalize_shopping_v2', {
        p_shopping_list_id: archiveTarget.id,
        p_household_id: household.id,
        p_total_cost: amount,
        p_currency: receiptDraft?.currency || 'EUR',
        p_receipt_store: receiptDraft?.store_name.trim() || null,
        p_purchase_date: receiptDraft?.purchase_date || archiveTarget.scheduled_date || new Date().toISOString().slice(0, 10),
        p_file_path: uploadedPath,
        p_file_name: receiptFile?.name ?? null,
        p_mime_type: receiptFile?.type ?? null,
        p_file_size: receiptFile?.size ?? null,
        p_extraction_status: receiptDraft ? 'reviewed' : 'manual',
        p_ai_model: receiptDraft ? receiptModel || null : null,
        p_items: receiptDraft?.items.map((item) => ({
          product_name: item.product_name.trim(),
          normalized_name: item.normalized_name.trim() || item.product_name.trim(),
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          line_total: item.line_total,
          category: item.category,
        })) ?? [],
      })

      if (result.error) throw result.error

      setArchiveTarget(null)
      setArchiveCost('')
      resetReceiptState()
      await load()
    } catch (reason) {
      if (uploadedPath) {
        await supabase.storage.from('shopping-receipts').remove([uploadedPath])
      }
      setError(reason instanceof Error ? reason.message : 'Shopping could not be finished.')
    } finally {
      setSaving(false)
    }
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
              {list.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
              {list.linked_task_id && <span><ClipboardCheck size={11} />Tasks</span>}
            </div>
          </div>

          <div className="shopping-card-head-actions">
            <small>{completed}/{listItems.length}</small>
            {canWrite && (
              <>
                <span className="mobile-slot-actions" aria-label={'Pin ' + list.title}>
                  <button type="button" className="secondary-button compact" disabled={list.expanded_slot === 1} onClick={() => void setExpandedSlot(list.id, 1)}>Top 1</button>
                  <button type="button" className="secondary-button compact" disabled={list.expanded_slot === 2} onClick={() => void setExpandedSlot(list.id, 2)}>Top 2</button>
                </span>
                <button className="secondary-button compact" type="button" onClick={() => beginArchive(list)}>
                  <Archive size={14} />
                  Finish shopping
                </button>
              </>
            )}
          </div>
        </header>

        <div className="shopping-items">
          {listItems.map((item) => (
            <div className={item.checked ? 'shopping-item checked' : 'shopping-item'} key={item.id}>
              <button
                type="button"
                className="shopping-item-toggle"
                onClick={() => void toggleItem(item)}
                disabled={!canWrite}
              >
                <span className="shopping-check">{item.checked ? '✓' : ''}</span>
                <span className="shopping-item-name">{item.item_text}</span>
                {item.quantity && <small>{item.quantity}</small>}
              </button>
              {canWrite && (
                <button
                  type="button"
                  className="shopping-item-remove"
                  onClick={() => void removeItem(item)}
                  aria-label={'Remove '+item.item_text+' from shopping list'}
                  title="Remove item"
                >
                  <Trash2 size={14}/>
                </button>
              )}
            </div>
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
          <div className="compact-list-actions">
            <div className="mobile-slot-actions" aria-label="Pin shopping list">
              <button type="button" className="secondary-button compact" onClick={() => void setExpandedSlot(list.id, 1)}>Top 1</button>
              <button type="button" className="secondary-button compact" onClick={() => void setExpandedSlot(list.id, 2)}>Top 2</button>
            </div>
            <button className="secondary-button compact" type="button" onClick={() => beginArchive(list)}>
              <Archive size={14} />
              Finish
            </button>
          </div>
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

      <PrivacyNotice compact />

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
                      <span>Drop a shopping list here on desktop. On mobile, use Top 1 / Top 2.</span>
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
                <small>Desktop: drag a list above. Mobile: use Top 1 / Top 2.</small>
              </div>
              <div className="collapsed-list-stack">
                {collapsedLists.map((list) => renderCollapsedShoppingList(list))}
              </div>
            </section>
          )}
        </>
      )}

      {receipts.length > 0 && (
        <section className="shopping-receipt-insights list-card">
          <header>
            <div>
              <span className="eyebrow">RECEIPT INSIGHTS</span>
              <h2>Shopping spend & price history</h2>
              <p>Built from reviewed receipt data. Household Costs keeps the total; Shopping keeps the store and product detail.</p>
            </div>
            <BarChart3 size={21}/>
          </header>

          <div className="receipt-insight-summary">
            <article>
              <span>This month</span>
              <strong>{moneyValue(receiptInsights.total)}</strong>
              <small>{monthlyReceipts.length} receipt{monthlyReceipts.length === 1 ? '' : 's'}</small>
            </article>
            <article>
              <span>Top store</span>
              <strong>{receiptInsights.stores[0]?.store ?? '—'}</strong>
              <small>{receiptInsights.stores[0] ? moneyValue(receiptInsights.stores[0].total) : 'No store data'}</small>
            </article>
            <article>
              <span>Highest line item</span>
              <strong>{receiptInsights.mostExpensive?.product_name ?? '—'}</strong>
              <small>{receiptInsights.mostExpensive?.line_total != null ? moneyValue(Number(receiptInsights.mostExpensive.line_total)) : 'No item data'}</small>
            </article>
          </div>

          <div className="receipt-insight-columns">
            <div>
              <h3><Store size={14}/>Spend by store · this month</h3>
              {receiptInsights.stores.length ? receiptInsights.stores.slice(0, 6).map((row) => (
                <div className="receipt-store-row" key={row.store}>
                  <span>{row.store}</span>
                  <strong>{moneyValue(row.total)}</strong>
                </div>
              )) : <small>No store totals this month.</small>}
            </div>

            <div>
              <h3>Price comparisons</h3>
              {receiptInsights.comparisons.length ? receiptInsights.comparisons.map((row) => (
                <div className="receipt-price-row" key={row.name}>
                  <div>
                    <strong>{row.name}</strong>
                    <small>{row.observations} observations · latest at {row.last.store}</small>
                  </div>
                  <span>{moneyValue(row.min)} – {moneyValue(row.max)}</span>
                </div>
              )) : <small>Price comparisons appear after the same product is detected on at least two receipts.</small>}
            </div>
          </div>
        </section>
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

            <p className="form-intro">Enter the total manually, or attach a receipt. With AI Assistant, Famioo can read the store, products and prices for review before saving.</p>

            <div className="shopping-finish-grid">
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
                <small className="field-hint">If entered, Famioo creates one Shopping entry in Household Costs.</small>
              </label>

              <section className="shopping-receipt-upload">
                <input
                  ref={receiptInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  hidden
                  onChange={(event) => {
                    chooseReceiptFile(event.target.files?.[0] ?? null)
                    event.target.value = ''
                  }}
                />
                <div>
                  <ReceiptText size={18}/>
                  <span>
                    <strong>{receiptFile?.name ?? 'Receipt photo / PDF'}</strong>
                    <small>Keep the receipt with this shopping trip and build price history.</small>
                  </span>
                </div>
                <button type="button" className="secondary-button compact" onClick={() => receiptInputRef.current?.click()}>
                  <Upload size={14}/>{receiptFile ? 'Change receipt' : 'Upload receipt'}
                </button>
                {receiptFile && receiptFile.type.startsWith('image/') && (
                  hasAiAssistant ? (
                    <button type="button" className="primary-button compact" disabled={receiptAiLoading} onClick={() => void extractReceiptWithAssistant()}>
                      <Sparkles size={14}/>{receiptAiLoading ? 'Reading receipt…' : 'Read with Assistant'}
                    </button>
                  ) : (
                    <small className="receipt-assistant-lock"><Sparkles size={11}/>AI Assistant is required for automatic product extraction.</small>
                  )
                )}
              </section>
            </div>

            {receiptDraft && (
              <section className="receipt-review-panel">
                <header>
                  <div>
                    <span className="eyebrow">ASSISTANT REVIEW</span>
                    <h3>Check receipt data before saving</h3>
                  </div>
                  <small>{Math.round(receiptDraft.confidence * 100)}% extraction confidence</small>
                </header>

                <div className="composer-grid-two aligned-field-row">
                  <label>
                    Store
                    <input
                      value={receiptDraft.store_name}
                      onChange={(event) => setReceiptDraft((current) => current ? { ...current, store_name: event.target.value } : current)}
                      placeholder="Store name"
                    />
                  </label>
                  <label>
                    Purchase date
                    <input
                      type="date"
                      value={receiptDraft.purchase_date}
                      onChange={(event) => setReceiptDraft((current) => current ? { ...current, purchase_date: event.target.value } : current)}
                    />
                  </label>
                </div>

                <div className="receipt-review-items">
                  {receiptDraft.items.map((item, index) => (
                    <div className="receipt-review-item" key={index}>
                      <input
                        value={item.product_name}
                        onChange={(event) => updateReceiptItem(index, {
                          product_name: event.target.value,
                          normalized_name: item.normalized_name || event.target.value,
                        })}
                        aria-label={'Receipt product ' + (index + 1)}
                      />
                      <input
                        inputMode="decimal"
                        value={item.quantity ?? ''}
                        onChange={(event) => updateReceiptItem(index, {
                          quantity: event.target.value ? Number(event.target.value.replace(',', '.')) : null,
                        })}
                        placeholder="Qty"
                        aria-label="Quantity"
                      />
                      <input
                        inputMode="decimal"
                        value={item.unit_price ?? ''}
                        onChange={(event) => updateReceiptItem(index, {
                          unit_price: event.target.value ? Number(event.target.value.replace(',', '.')) : null,
                        })}
                        placeholder="Unit €"
                        aria-label="Unit price"
                      />
                      <input
                        inputMode="decimal"
                        value={item.line_total ?? ''}
                        onChange={(event) => updateReceiptItem(index, {
                          line_total: event.target.value ? Number(event.target.value.replace(',', '.')) : null,
                        })}
                        placeholder="Total €"
                        aria-label="Line total"
                      />
                      <button type="button" className="icon-button compact-icon" onClick={() => removeReceiptItem(index)} aria-label={'Remove ' + item.product_name}>
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

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
              {saving ? 'Finishing…' : 'Finish shopping'}
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
