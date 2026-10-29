import { Archive, ArchiveRestore, ArrowLeftRight, BarChart3, CalendarDays, CheckCircle2, ClipboardCheck, ChevronRight, Plus, ReceiptText, ShoppingBag, Sparkles, Store, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { Select } from '../components/ui/Select'
import { DatePicker } from '../components/ui/DatePicker'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { moduleConnectionState } from '../lib/moduleAccess'
import { supabase } from '../lib/supabase'
import './ShoppingListView.css'
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
  const canWrite = Boolean(access?.can_write)
  const canSyncTasks = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)
  const assistantConnection = moduleConnectionState(modules, 'shopping', 'assistant')
  const hasAiAssistant = assistantConnection === 'active'

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
  const [receiptUploadOpen,setReceiptUploadOpen]=useState(false)
  const [standaloneReceiptStatus,setStandaloneReceiptStatus]=useState<'idle'|'reading'|'saving'|'done'>('idle')
  const [standaloneReceiptSummary,setStandaloneReceiptSummary]=useState<ReceiptDraft|null>(null)
  const standaloneReceiptInputRef=useRef<HTMLInputElement>(null)
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
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const listModalCloseRef = useRef<HTMLButtonElement>(null)
  const [compareOpen,setCompareOpen] = useState(false)
  const [comparePeriod,setComparePeriod] = useState<'month'|'30days'|'all'|'custom'>('month')
  const [compareFrom,setCompareFrom] = useState('')
  const [compareTo,setCompareTo] = useState('')
  const [compareStore,setCompareStore] = useState('all')
  const [compareCategory,setCompareCategory] = useState('all')
  const [compareCurrency,setCompareCurrency] = useState('all')
  const [compareProduct,setCompareProduct] = useState('')
  const [compareSort,setCompareSort] = useState<'total'|'count'>('total')
  const [receiptHistoryComplete,setReceiptHistoryComplete]=useState(true)
  const [error, setError] = useState('')

  async function loadAllReceiptHistory(){
    const receiptsFound:ShoppingReceipt[]=[]
    const itemsFound:ShoppingReceiptItem[]=[]
    let complete=true
    const [receiptHistory,itemHistory]=await Promise.all([
      (async()=>{
        for(let offset=0;offset<20000;offset+=500){
          const response=await supabase.from('shopping_receipts')
            .select('id,shopping_list_id,linked_cost_id,store_name,purchase_date,total_amount,currency,file_path,file_name,extraction_status,ai_model,created_at')
            .eq('household_id',household.id).order('purchase_date',{ascending:false}).order('id').range(offset,offset+499)
          if(response.error)return response.error.message
          const chunk=(response.data??[]) as ShoppingReceipt[]
          receiptsFound.push(...chunk)
          if(chunk.length<500)return null
          if(offset===19500)complete=false
        }
        return null
      })(),
      (async()=>{
        for(let offset=0;offset<20000;offset+=500){
          const response=await supabase.from('shopping_receipt_items')
            .select('id,receipt_id,product_name,normalized_name,quantity,unit,unit_price,line_total,category')
            .eq('household_id',household.id).order('id').range(offset,offset+499)
          if(response.error)return response.error.message
          const chunk=(response.data??[]) as ShoppingReceiptItem[]
          itemsFound.push(...chunk)
          if(chunk.length<500)return null
          if(offset===19500)complete=false
        }
        return null
      })(),
    ])
    return {receiptsFound,itemsFound,complete,error:receiptHistory||itemHistory}
  }

  async function load() {
    setError('')

    await supabase.rpc('purge_old_archives_v1', { p_household_id: household.id })

    const today = new Date().toISOString().slice(0, 10)
    const future = new Date()
    future.setDate(future.getDate() + 365)

    const [listResult, itemResult, categoryResult, eventResult, receiptHistory] = await Promise.all([
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
      loadAllReceiptHistory(),
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

    if (receiptHistory.error) setError((current) => current || receiptHistory.error || 'Could not load receipt history.')
    else {
      setReceipts(receiptHistory.receiptsFound)
      setReceiptItems(receiptHistory.itemsFound)
      setReceiptHistoryComplete(receiptHistory.complete)
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



  const compareStores = useMemo(()=>[...new Set(receipts.map(receipt=>receipt.store_name?.trim()||'Unknown store'))].sort((a,b)=>a.localeCompare(b)),[receipts])
  const compareCategories = useMemo(()=>[...new Set(receiptItems.map(item=>item.category?.trim()).filter((value):value is string=>Boolean(value)))].sort((a,b)=>a.localeCompare(b)),[receiptItems])
  const compareCurrencies = useMemo(()=>[...new Set(receipts.map(receipt=>receipt.currency||'EUR'))].sort(),[receipts])

  const receiptComparisonReport = useMemo(()=>{
    const now=new Date()
    const iso=(date:Date)=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')
    const start30=new Date(now);start30.setDate(start30.getDate()-29)
    const from=comparePeriod==='all'?'':comparePeriod==='month'?iso(new Date(now.getFullYear(),now.getMonth(),1)):comparePeriod==='30days'?iso(start30):compareFrom
    const to=comparePeriod==='custom'?compareTo:''
    const productTerm=compareProduct.trim().toLocaleLowerCase()
    const itemFiltered=Boolean(productTerm||compareCategory!=='all')

    const baseReceipts=receipts.filter(receipt=>{
      const name=receipt.store_name?.trim()||'Unknown store'
      return (!from||receipt.purchase_date>=from)&&(!to||receipt.purchase_date<=to)
        &&(compareStore==='all'||name===compareStore)
        &&(compareCurrency==='all'||(receipt.currency||'EUR')===compareCurrency)
    })
    const eligibleIds=new Set(baseReceipts.map(receipt=>receipt.id))
    const matchedItems=receiptItems.filter(item=>{
      if(!eligibleIds.has(item.receipt_id))return false
      if(compareCategory!=='all'&&item.category!==compareCategory)return false
      return !productTerm||(item.normalized_name||item.product_name).toLocaleLowerCase().includes(productTerm)
        ||item.product_name.toLocaleLowerCase().includes(productTerm)
    })
    const matchedIds=new Set(matchedItems.map(item=>item.receipt_id))
    const selectedReceipts=baseReceipts.filter(receipt=>!itemFiltered||matchedIds.has(receipt.id))
      .sort((a,b)=>a.purchase_date.localeCompare(b.purchase_date))
    const selectedIds=new Set(selectedReceipts.map(receipt=>receipt.id))
    const selectedItems=matchedItems.filter(item=>selectedIds.has(item.receipt_id))
    const totals=new Map<string,number>()
    const stores=new Map<string,{store:string;currency:string;total:number;count:number;unknown:number}>()
    let unknownTotals=0
    for(const receipt of selectedReceipts){
      const name=receipt.store_name?.trim()||'Unknown store'
      const currency=receipt.currency||'EUR'
      const receiptItemsForComparison=itemFiltered?selectedItems.filter(item=>item.receipt_id===receipt.id):[]
      // A product/category filter shows matching line totals, NOT a full receipt spend.
      const amounts=itemFiltered?receiptItemsForComparison.map(item=>item.line_total!=null?Number(item.line_total):(item.unit_price!=null&&item.quantity!=null?Number(item.unit_price)*Number(item.quantity):null)):[receipt.total_amount]
      const missing=amounts.filter(value=>value==null||!Number.isFinite(Number(value))).length
      const value=amounts.reduce<number>((sum,amount)=>sum+(amount==null||!Number.isFinite(Number(amount))?0:Number(amount)),0)
      unknownTotals+=missing
      totals.set(currency,(totals.get(currency)??0)+value)
      const key=name+'::'+currency
      const row=stores.get(key)??{store:name,currency,total:0,count:0,unknown:0}
      row.total+=value;row.count++;row.unknown+=missing
      stores.set(key,row)
    }
    const products=new Map<string,Array<{price:number;date:string;store:string;label:string;currency:string;unit:string}>>()
    for(const item of selectedItems){
      if(item.unit_price==null)continue
      const receipt=receiptById.get(item.receipt_id)
      if(!receipt)continue
      const name=(item.normalized_name||item.product_name).trim().toLocaleLowerCase()
      const currency=receipt.currency||'EUR'
      const unit=(item.unit||'unspecified').trim().toLocaleLowerCase()
      const key=[name,currency,unit].join('::')
      const group=products.get(key)??[]
      group.push({price:Number(item.unit_price),date:receipt.purchase_date,store:receipt.store_name?.trim()||'Unknown store',label:item.product_name,currency,unit})
      products.set(key,group)
    }
    const comparisons=[...products.entries()].filter(([,rows])=>rows.length>=2)
      .map(([key,rows])=>{
        const chronological=[...rows].sort((a,b)=>a.date.localeCompare(b.date))
        const cheapest=[...rows].sort((a,b)=>a.price-b.price)[0]
        const mostExpensive=[...rows].sort((a,b)=>b.price-a.price)[0]
        const first=chronological[0],last=chronological[chronological.length-1]
        const delta=last.price-first.price
        return {key,label:last.label,observations:rows.length,first,last,cheapest,mostExpensive,delta,
          percent:first.price>0?100*delta/first.price:0}
      })
      .sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))
    const biggestProduct=selectedItems
      .filter(item=>item.line_total!=null)
      .map(item=>({item,receipt:receiptById.get(item.receipt_id)}))
      .filter((row):row is {item:ShoppingReceiptItem;receipt:ShoppingReceipt}=>Boolean(row.receipt))
      .sort((a,b)=>Number(b.item.line_total)-Number(a.item.line_total))[0]??null
    const highestReceipt=[...selectedReceipts].filter(receipt=>receipt.total_amount!=null).sort((a,b)=>Number(b.total_amount)-Number(a.total_amount))[0]??null
    const storeRows=[...stores.values()].sort((a,b)=>compareSort==='count'?b.count-a.count:b.total-a.total)
    return {selectedReceipts,selectedItems,stores:storeRows,totals:[...totals].map(([currency,total])=>({currency,total})),
      averagePerCurrency:[...totals].map(([currency,total])=>({currency,average:selectedReceipts.filter(receipt=>(receipt.currency||'EUR')===currency).length?total/selectedReceipts.filter(receipt=>(receipt.currency||'EUR')===currency).length:0})),
      itemFiltered,from,to,unknownTotals,highestReceipt,biggestProduct,
      increases:comparisons.filter(item=>item.delta>0).slice(0,6),
      decreases:comparisons.filter(item=>item.delta<0).slice(0,6),
      priceComparisons:comparisons.slice(0,15)}
  },[receipts,receiptItems,receiptById,comparePeriod,compareFrom,compareTo,compareStore,compareCategory,compareCurrency,compareProduct,compareSort])

  function resetCompareFilters(){
    setComparePeriod('month')
    setCompareFrom('');setCompareTo('');setCompareStore('all');setCompareCategory('all')
    setCompareCurrency('all');setCompareProduct('');setCompareSort('total')
  }

  function askAssistantAboutShopping(){
    const report=receiptComparisonReport
    const currencies=report.totals.map(item=>moneyValue(item.total,item.currency)).join(' + ')
    const stores=report.stores.slice(0,8).map(row=>row.store+' '+moneyValue(row.total,row.currency)).join(', ')
    const period=comparePeriod==='custom'?'from '+(compareFrom||'earliest')+' to '+(compareTo||'today'):
      comparePeriod==='month'?'this month':comparePeriod==='30days'?'last 30 days':'all recorded history'
    window.dispatchEvent(new CustomEvent('famioo:assistant-prefill',{detail:{
      message:'Analyze ONLY the following shopping receipt comparison selection: period '+period+
        '; store '+(compareStore==='all'?'all shops':compareStore)+'; product search '+(compareProduct||'all products')+
        '; category '+(compareCategory==='all'?'all categories':compareCategory)+
        '; currency '+(compareCurrency==='all'?'all currencies separately':compareCurrency)+
        '. Filter the real household receipt database accordingly. Compare repeated identical products only with comparable units, highlight price increases, most expensive items and opportunities to save. Do not double-count receipt-linked costs. Current filtered view: '+
        report.selectedReceipts.length+' receipts, totals '+(currencies||'no complete amounts')+
        ', stores '+(stores||'none')+', '+report.unknownTotals+' missing prices. '+
        (receiptHistoryComplete?'The frontend receipt history was fully loaded.':'The frontend receipt history is incomplete.')+
        ' Clearly say when filtered data is unavailable, avoid inventing product prices, and never combine different currencies into one total.'
    }}))
    setCompareOpen(false)
  }

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

  async function processStandaloneReceipt(file:File){
    if(!canWrite||standaloneReceiptStatus==='reading'||standaloneReceiptStatus==='saving')return
    if(!hasAiAssistant){
      setError('AI Assistant is required to read receipt photos automatically.')
      return
    }
    if(file.size>15*1024*1024){
      setError('Receipt photos can be up to 15 MB.')
      return
    }
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      setError('Use a JPG, PNG or WebP receipt photo.')
      return
    }

    setReceiptUploadOpen(true)
    setStandaloneReceiptStatus('reading')
    setStandaloneReceiptSummary(null)
    setError('')

    let uploadedPath:string|null=null
    try{
      const imageData=await fileToDataUrl(file)
      const extraction=await supabase.functions.invoke('extract-shopping-receipt',{
        body:{
          household_id:household.id,
          image_data_url:imageData,
          reference_date:new Date().toISOString().slice(0,10),
        },
      })
      if(extraction.error||extraction.data?.error){
        throw new Error(String(extraction.data?.error||extraction.error?.message||'AI could not read this receipt.'))
      }
      const receipt=extraction.data?.receipt
      if(!receipt)throw new Error('AI returned no receipt information.')

      const draft:ReceiptDraft={
        store_name:String(receipt.store_name??''),
        purchase_date:String(receipt.purchase_date??new Date().toISOString().slice(0,10)),
        total_amount:receipt.total_amount==null?null:Number(receipt.total_amount),
        currency:String(receipt.currency||'EUR'),
        confidence:Number(receipt.confidence??0),
        items:Array.isArray(receipt.items)?receipt.items.map((item:ReceiptDraftItem)=>({
          ...item,
          product_name:String(item.product_name??''),
          normalized_name:String(item.normalized_name??item.product_name??''),
          quantity:item.quantity==null?null:Number(item.quantity),
          unit_price:item.unit_price==null?null:Number(item.unit_price),
          line_total:item.line_total==null?null:Number(item.line_total),
          confidence:Number(item.confidence??0),
        })):[],
      }
      if(draft.total_amount==null||!Number.isFinite(draft.total_amount)){
        throw new Error('AI could not determine the receipt total. Please take a clearer photo and try again.')
      }

      setStandaloneReceiptSummary(draft)
      setStandaloneReceiptStatus('saving')

      uploadedPath=`${household.id}/${crypto.randomUUID()}/${safeReceiptFileName(file.name||'receipt.jpg')}`
      const upload=await supabase.storage.from('shopping-receipts').upload(uploadedPath,file,{
        contentType:file.type,upsert:false,
      })
      if(upload.error)throw upload.error

      const saved=await supabase.rpc('save_standalone_shopping_receipt_v1',{
        p_household_id:household.id,
        p_total_cost:draft.total_amount,
        p_currency:draft.currency||'EUR',
        p_receipt_store:draft.store_name.trim()||null,
        p_purchase_date:draft.purchase_date,
        p_file_path:uploadedPath,
        p_file_name:file.name||'receipt.jpg',
        p_mime_type:file.type,
        p_file_size:file.size,
        p_ai_model:String(extraction.data?.model??'')||null,
        p_items:draft.items.map((item)=>({
          product_name:item.product_name.trim(),
          normalized_name:item.normalized_name.trim()||item.product_name.trim(),
          quantity:item.quantity,
          unit:item.unit,
          unit_price:item.unit_price,
          line_total:item.line_total,
          category:item.category,
        })),
      })
      if(saved.error)throw saved.error

      setStandaloneReceiptStatus('done')
      await load()
    }catch(reason){
      if(uploadedPath)await supabase.storage.from('shopping-receipts').remove([uploadedPath])
      setStandaloneReceiptStatus('idle')
      setError(reason instanceof Error?reason.message:'Receipt could not be processed.')
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

    await load()
  }

  function renderShoppingCard(list: ShoppingList) {
    const listItems = items.filter((item) => item.shopping_list_id === list.id)
    const completed = listItems.filter((item) => item.checked).length
    const category = list.category_id ? categoryById.get(list.category_id) : undefined

    return (
      <article className="list-card shopping-card" key={list.id}>
        <header>
          <div>
            <h2 id="shopping-list-dialog-title">{list.title}</h2>
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
                <button className="secondary-button compact" type="button" onClick={() => { setSelectedListId(null); beginArchive(list) }}>
                  <Archive size={14} />
                  Finish shopping
                </button>
              </>
            )}
          </div>
        </header>

        <div className="shopping-items">
          {listItems.length === 0 && <p className="shopping-list-empty-items">No articles yet. Add your first item below.</p>}
          {listItems.map((item) => (
            <div className={item.checked ? 'shopping-item checked' : 'shopping-item'} key={item.id}>
              <button
                type="button"
                className="shopping-item-toggle"
                onClick={() => void toggleItem(item)}
                disabled={!canWrite}
                aria-label={(item.checked ? "Uncheck " : "Check off ") + item.item_text}
                aria-pressed={item.checked}
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
              aria-label="Item name"
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
              aria-label="Item quantity"
            />
            <button type="button" className="secondary-button compact" onClick={() => void addItem(list.id)}>Add item</button>
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

        <div className="shopping-heading-actions">
          {access?.enabled&&<button type="button" className="secondary-button compact shopping-compare-action" onClick={()=>setCompareOpen(true)}><ArrowLeftRight size={15}/>Compare receipts</button>}
          {canWrite&&<>
            <label className="secondary-button compact shopping-upload-receipt-button">
              <Upload size={15}/>
              Upload receipt
              <input
                ref={standaloneReceiptInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event)=>{
                  const file=event.target.files?.[0]??null
                  event.target.value=''
                  if(file)void processStandaloneReceipt(file)
                }}
              />
            </label>
            <button className="primary-button compact" onClick={openComposer}>
              <Plus size={16} />
              Create list
            </button>
          </>}
        </div>
      </div>

      <button
        type="button"
        className={compareOpen ? 'shopping-compare-tab active' : 'shopping-compare-tab'}
        onClick={()=>setCompareOpen((current)=>!current)}
        aria-label={compareOpen ? 'Close shopping comparison' : 'Compare shopping receipts'}
        aria-expanded={compareOpen}
      >
        <ArrowLeftRight size={19}/><span>Compare</span>
      </button>

      {compareOpen && (
        <>
          <button className="shopping-compare-backdrop" type="button" aria-label="Close shopping comparison" onClick={()=>setCompareOpen(false)}/>
          <aside className="shopping-compare-drawer" aria-label="Shopping comparison">
            <header>
              <div>
                <span className="eyebrow">SHOPPING COMPARE</span>
                <h2>Receipt comparison</h2>
              </div>
              <button type="button" onClick={()=>setCompareOpen(false)} aria-label="Close shopping comparison"><X size={18}/></button>
            </header>

            <div className="shopping-compare-period">
              {(['month','30days','all','custom'] as const).map(period=>(
                <button type="button" key={period} className={comparePeriod===period?'active':''} onClick={()=>setComparePeriod(period)}>
                  {period==='month'?'This month':period==='30days'?'30 days':period==='all'?'All history':'Custom'}
                </button>
              ))}
            </div>
            <div className="compare-filter-head"><strong>Filter & compare</strong><button type="button" onClick={resetCompareFilters}>Reset filters</button></div>
            <div className="shopping-compare-filters">
              {comparePeriod==='custom'&&<div className="compare-filter-dates">
                <label>From<DatePicker value={compareFrom} onChange={setCompareFrom} ariaLabel="Comparison start date"/></label>
                <label>To<DatePicker value={compareTo} min={compareFrom||undefined} onChange={setCompareTo} ariaLabel="Comparison end date"/></label>
              </div>}
              <label>Shop / store
                <Select value={compareStore} onChange={setCompareStore}
                  options={[{value:'all',label:'All stores'},...compareStores.map(store=>({value:store,label:store}))]} ariaLabel="Select shop to compare"/>
              </label>
              <label>Product name
                <input type="search" value={compareProduct} onChange={event=>setCompareProduct(event.target.value)}
                  placeholder="e.g. milk, coffee, bread…" aria-label="Filter receipt products"/>
              </label>
              <div className="compare-filter-dates">
                <label>Product category
                  <Select value={compareCategory} onChange={setCompareCategory}
                    options={[{value:'all',label:'All categories'},...compareCategories.map(category=>({value:category,label:category}))]} ariaLabel="Compare product category"/>
                </label>
                <label>Currency
                  <Select value={compareCurrency} onChange={setCompareCurrency}
                    options={[{value:'all',label:'All currencies'},...compareCurrencies.map(currency=>({value:currency,label:currency}))]} ariaLabel="Comparison currency"/>
                </label>
              </div>
              <label>Sort stores
                <Select value={compareSort} onChange={value=>setCompareSort(value as 'total'|'count')}
                  options={[{value:'total',label:'Highest spending'},{value:'count',label:'Most visits / receipts'}]} ariaLabel="Store sort order"/>
              </label>
              {receiptComparisonReport.itemFiltered&&<small className="compare-filter-note">Totals use only matched product lines, not entire receipt amounts. Receipts without readable product lines are excluded.</small>}
            </div>

            {!receiptHistoryComplete&&<p className="shopping-compare-limited">This report may be incomplete: the history limit was reached. Do not treat these totals as exhaustive.</p>}
            <div className="shopping-compare-summary">
              <article><span>Total spend</span><strong>{receiptComparisonReport.totals.length
                ? receiptComparisonReport.totals.map(row=>moneyValue(row.total,row.currency)).join(' + '):'—'}</strong></article>
              <article><span>Receipts found</span><strong>{receiptComparisonReport.selectedReceipts.length}</strong></article>
              <article><span>Average / receipt</span><strong>{receiptComparisonReport.averagePerCurrency.length
                ? receiptComparisonReport.averagePerCurrency.map(row=>moneyValue(row.average,row.currency)).join(' + '):'—'}</strong></article>
            </div>
            {receiptComparisonReport.unknownTotals>0&&<p className="shopping-compare-limited">{receiptComparisonReport.unknownTotals} missing or invalid amount(s) excluded from totals.</p>}
            {receiptComparisonReport.selectedReceipts.length===0&&<p className="shopping-compare-limited">No matching receipts found. Try another date, store, product, or category.</p>}
            <section className="shopping-compare-section">
              <h3>Spending by shop</h3>
              {receiptComparisonReport.stores.length?receiptComparisonReport.stores.map(row=>(
                <div className="shopping-compare-row" key={row.store+'-'+row.currency}>
                  <span>{row.store}<small className="compare-row-sub">{row.count} receipt{row.count===1?'':'s'}</small></span>
                  <strong>{moneyValue(row.total,row.currency)}</strong>
                </div>
              )):<small>No matching shop totals available.</small>}
            </section>
            <section className="shopping-compare-section">
              <h3>Most expensive</h3>
              {receiptComparisonReport.highestReceipt&&!receiptComparisonReport.itemFiltered&&
                <div className="shopping-compare-row">
                  <span>Receipt: {receiptComparisonReport.highestReceipt.store_name||'Unknown store'}
                    <small className="compare-row-sub">{receiptComparisonReport.highestReceipt.purchase_date}</small>
                  </span>
                  <strong>{moneyValue(Number(receiptComparisonReport.highestReceipt.total_amount),receiptComparisonReport.highestReceipt.currency)}</strong>
                </div>}
              {receiptComparisonReport.biggestProduct&&
                <div className="shopping-compare-row">
                  <span>Product: {receiptComparisonReport.biggestProduct.item.product_name}
                    <small className="compare-row-sub">{receiptComparisonReport.biggestProduct.receipt.store_name||'Unknown store'}</small>
                  </span>
                  <strong>{moneyValue(Number(receiptComparisonReport.biggestProduct.item.line_total),receiptComparisonReport.biggestProduct.receipt.currency)}</strong>
                </div>}
              {!receiptComparisonReport.highestReceipt&&!receiptComparisonReport.biggestProduct&&<small>No priced purchases in this selection.</small>}
            </section>
            <section className="shopping-compare-section">
              <h3>Product prices across shops and dates</h3>
              {receiptComparisonReport.priceComparisons.length?receiptComparisonReport.priceComparisons.map(row=>(
                <div className="shopping-compare-product compare-price-product" key={row.key}>
                  <span><strong>{row.label}</strong>
                    <small>{row.cheapest.store}: {moneyValue(row.cheapest.price,row.cheapest.currency)} → {row.mostExpensive.store}: {moneyValue(row.mostExpensive.price,row.mostExpensive.currency)}</small>
                    <small>{row.observations} observations · {row.cheapest.unit==='unspecified'?'unit not recorded':row.cheapest.unit}</small>
                  </span>
                  <b>{moneyValue(row.mostExpensive.price-row.cheapest.price,row.cheapest.currency)}</b>
                </div>
              )):<small>At least two priced observations of the same product are needed for comparisons.</small>}
              <small className="compare-filter-note">Compare equivalent package sizes before judging which store is cheaper. Unit labels are taken from receipts.</small>
            </section>
            <section className="shopping-compare-section">
              <h3>Detected price changes</h3>
              {receiptComparisonReport.increases.length ? receiptComparisonReport.increases.map(row=>(
                <div className="shopping-compare-product" key={'rise-'+row.key}>
                  <span><strong>{row.label}</strong><small>{row.first.date} → {row.last.date}</small></span>
                  <b>+{row.percent.toFixed(1)}%</b>
                </div>
              )):<small>No verified increases for the current filters.</small>}
              {receiptComparisonReport.decreases.length ? receiptComparisonReport.decreases.map(row=>(
                <div className="shopping-compare-product" key={'fall-'+row.key}>
                  <span><strong>{row.label}</strong><small>{row.first.date} → {row.last.date}</small></span>
                  <b>{row.percent.toFixed(1)}%</b>
                </div>
              )):null}
            </section>
            <div className="compare-optional-ai">
              <p>Optional AI analysis</p>
              {assistantConnection === 'active' ? (
                <button type="button" className="secondary-button shopping-compare-ai" onClick={askAssistantAboutShopping}>
                  <Sparkles size={15}/>Ask AI to explain these results
                </button>
              ) : assistantConnection === 'locked' ? (
                <button type="button" className="secondary-button shopping-compare-ai module-connection-locked" disabled title="AI Assistant is not purchased">
                  <Sparkles size={15}/>AI Assistant not unlocked
                </button>
              ) : null}
            </div>
          </aside>
        </>
      )}

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

      {receiptUploadOpen&&(
        <div className="modal-backdrop shopping-receipt-capture-backdrop" role="presentation">
          <section className="modal-card shopping-receipt-capture-modal">
            <header>
              <div>
                <span className="eyebrow">AI RECEIPT CAPTURE</span>
                <h2>{standaloneReceiptStatus==='done'?'Receipt saved':'Reading receipt'}</h2>
              </div>
              {(standaloneReceiptStatus==='done'||standaloneReceiptStatus==='idle')&&<button className="icon-button" type="button" onClick={()=>{setReceiptUploadOpen(false);setStandaloneReceiptStatus('idle');setStandaloneReceiptSummary(null);setError('')}}><X size={18}/></button>}
            </header>
            {standaloneReceiptStatus!=='done'?(
              <div className="shopping-receipt-processing">
                <Sparkles size={28}/>
                <strong>{standaloneReceiptStatus==='saving'?'Saving receipt & spend…':'AI is reading the receipt…'}</strong>
                <span>Store, date, total and products are extracted automatically. No extra AI question is needed.</span>
                <div className="shopping-receipt-processing-bar"><i/></div>
              </div>
            ):standaloneReceiptSummary&&(
              <div className="shopping-receipt-success">
                <ReceiptText size={27}/>
                <div><span>{standaloneReceiptSummary.store_name||'Shopping receipt'}</span><strong>{moneyValue(Number(standaloneReceiptSummary.total_amount??0),standaloneReceiptSummary.currency)}</strong><small>{standaloneReceiptSummary.purchase_date} · {standaloneReceiptSummary.items.length} detected item{standaloneReceiptSummary.items.length===1?'':'s'}</small></div>
                <CheckCircle2 size={21}/>
              </div>
            )}
            {error&&<div className="notice error">{error}</div>}
            {standaloneReceiptStatus==='done'&&<footer><button className="primary-button" type="button" onClick={()=>{setReceiptUploadOpen(false);setStandaloneReceiptStatus('idle');setStandaloneReceiptSummary(null)}}>Done</button></footer>}
          </section>
        </div>
      )}

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
