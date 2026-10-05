import {
  Archive,
  ArchiveRestore,
  BellRing,
  CalendarDays,
  Clock3,
  CreditCard,
  FileLock2,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { DatePicker } from '../components/ui/DatePicker'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { firstName } from '../lib/personName'
import { supabase } from '../lib/supabase'

type LifeAdminTab =
  | 'overview'
  | 'documents'
  | 'contracts'
  | 'renewals'
  | 'insurance'
  | 'subscriptions'
  | 'deadlines'
  | 'archive'

type LifeAdminType = string
type LifeAdminBaseType = 'document' | 'contract' | 'insurance' | 'subscription' | 'deadline'
type FinanceFlow = 'expense' | 'income'
type Frequency = 'none' | 'monthly' | 'quarterly' | 'yearly'

type LifeAdminItem = {
  id: string
  item_type: LifeAdminType
  title: string
  provider: string | null
  reference_number: string | null
  start_date: string | null
  due_date: string | null
  renewal_date: string | null
  expiry_date: string | null
  amount: number | null
  currency: string
  frequency: Frequency
  auto_renew: boolean
  cancellation_notice_days: number | null
  responsible_profile_id: string | null
  notes: string | null
  add_to_calendar: boolean
  linked_event_id: string | null
  flow_type: FinanceFlow
  include_in_finance: boolean
  household_cost_id: string | null
  sync_task: boolean
  linked_task_id: string | null
  status: 'active' | 'archived'
  archived_at: string | null
  created_at: string
}

type LifeAdminAttachment = {
  id: string
  life_admin_item_id: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
}

const tabs: Array<{ key: LifeAdminTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'documents', label: 'Documents' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'renewals', label: 'Renewals' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'deadlines', label: 'Deadlines' },
  { key: 'archive', label: 'Archive' },
]

function todayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function addDaysKey(days: number) {
  const next = new Date()
  next.setDate(next.getDate() + days)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function prettyDate(value: string | null) {
  if (!value) return '—'
  return new Date(value + 'T12:00:00').toLocaleDateString()
}

function money(value: number | null | undefined, currency = 'EUR') {
  if (value == null) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function frequencyLabel(frequency: Frequency) {
  if (frequency === 'monthly') return 'Monthly'
  if (frequency === 'quarterly') return 'Quarterly'
  if (frequency === 'yearly') return 'Yearly'
  return 'One-time / no cycle'
}

function typeIcon(type: LifeAdminType) {
  if (type === 'document') return FileText
  if (type === 'contract') return FileLock2
  if (type === 'insurance') return ShieldCheck
  if (type === 'subscription') return CreditCard
  return Clock3
}

function nextActionDate(item: LifeAdminItem) {
  return item.due_date ?? item.renewal_date ?? item.expiry_date
}

function monthlyEquivalent(item: LifeAdminItem) {
  const amount = Number(item.amount ?? 0)
  if (!amount) return 0
  if (item.frequency === 'monthly') return amount
  if (item.frequency === 'quarterly') return amount / 3
  if (item.frequency === 'yearly') return amount / 12
  return 0
}

export function LifeAdminPage() {
  const { household, modules, profiles } = useHousehold()
  const access = modules.find((module) => module.code === 'life_admin')
  const canWrite = Boolean(access?.can_write)
  const canSyncCalendar = Boolean(modules.find((module) => module.code === 'calendar')?.can_write)
  const canSyncTasks = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)
  const costsCanWrite = Boolean(modules.find((module) => module.code === 'costs')?.can_write)

  const [tab, setTab] = useState<LifeAdminTab>('overview')
  const [items, setItems] = useState<LifeAdminItem[]>([])
  const [typeOptions, setTypeOptions] = useState<Array<{ value: string; label: string; baseType: LifeAdminBaseType }>>([
    { value: 'document', label: 'Document', baseType: 'document' },
    { value: 'contract', label: 'Contract', baseType: 'contract' },
    { value: 'insurance', label: 'Insurance', baseType: 'insurance' },
    { value: 'subscription', label: 'Subscription', baseType: 'subscription' },
    { value: 'deadline', label: 'Deadline', baseType: 'deadline' },
  ])
  const [attachments, setAttachments] = useState<LifeAdminAttachment[]>([])
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [itemType, setItemType] = useState<LifeAdminType>('document')
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [renewalDate, setRenewalDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [frequency, setFrequency] = useState<Frequency>('none')
  const [autoRenew, setAutoRenew] = useState(false)
  const [cancellationNotice, setCancellationNotice] = useState('')
  const [responsibleProfileId, setResponsibleProfileId] = useState('')
  const [notes, setNotes] = useState('')
  const [addToCalendar, setAddToCalendar] = useState(false)
  const [flowType, setFlowType] = useState<FinanceFlow>('expense')
  const [includeInFinance, setIncludeInFinance] = useState(false)
  const [syncTask, setSyncTask] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')

    const [itemResult, attachmentResult, typeResult] = await Promise.all([
      supabase
        .from('life_admin_items')
        .select('id,item_type,title,provider,reference_number,start_date,due_date,renewal_date,expiry_date,amount,currency,frequency,auto_renew,cancellation_notice_days,responsible_profile_id,notes,add_to_calendar,linked_event_id,flow_type,include_in_finance,household_cost_id,sync_task,linked_task_id,status,archived_at,created_at')
        .eq('household_id', household.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('life_admin_attachments')
        .select('id,life_admin_item_id,file_name,storage_path,mime_type,file_size')
        .eq('household_id', household.id)
        .order('created_at'),
      supabase
        .from('household_module_types')
        .select('type_key,label,base_type,sort_order')
        .eq('household_id', household.id)
        .eq('module_code', 'life_admin')
        .eq('group_code', 'item_type')
        .eq('active', true)
        .order('sort_order')
        .order('label'),
    ])

    if (itemResult.error) setError(itemResult.error.message)
    else setItems((itemResult.data ?? []) as LifeAdminItem[])

    if (typeResult.error) {
      setError((current) => current || typeResult.error.message)
    } else {
      const options = (typeResult.data ?? []).map((row) => ({
        value: row.type_key,
        label: row.label,
        baseType: (row.base_type ?? 'document') as LifeAdminBaseType,
      }))
      if (options.length) setTypeOptions(options)
    }

    if (attachmentResult.error) {
      setError((current) => current || attachmentResult.error.message)
    } else {
      const rows = (attachmentResult.data ?? []) as LifeAdminAttachment[]
      setAttachments(rows)

      const signed = await Promise.all(rows.map(async (attachment) => {
        const result = await supabase.storage
          .from('life-admin-attachments')
          .createSignedUrl(attachment.storage_path, 3600)

        return [attachment.id, result.data?.signedUrl ?? ''] as const
      }))

      setAttachmentUrls(Object.fromEntries(signed))
    }
  }

  useEffect(() => { void load() }, [household.id])

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  )

  const typeByKey = useMemo(
    () => new Map(typeOptions.map((option) => [option.value, option])),
    [typeOptions],
  )

  function baseTypeOf(item: LifeAdminItem): LifeAdminBaseType {
    return typeByKey.get(item.item_type)?.baseType
      ?? (['document','contract','insurance','subscription','deadline'].includes(item.item_type)
        ? item.item_type as LifeAdminBaseType
        : 'document')
  }

  const profileOptions = useMemo(
    () => [
      { value: '', label: 'No responsible person' },
      ...profiles.map((profile) => ({
        value: profile.id,
        label: firstName(profile.display_name),
      })),
    ],
    [profiles],
  )

  const activeItems = useMemo(
    () => items.filter((item) => item.status === 'active'),
    [items],
  )

  const archivedItems = useMemo(
    () => items
      .filter((item) => item.status === 'archived')
      .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? '')),
    [items],
  )

  const renewals = useMemo(
    () => activeItems
      .filter((item) => item.renewal_date)
      .sort((a, b) => (a.renewal_date ?? '').localeCompare(b.renewal_date ?? '')),
    [activeItems],
  )

  const deadlines = useMemo(
    () => activeItems
      .filter((item) => item.due_date || item.expiry_date)
      .sort((a, b) => {
        const aDate = a.due_date ?? a.expiry_date ?? '9999-12-31'
        const bDate = b.due_date ?? b.expiry_date ?? '9999-12-31'
        return aDate.localeCompare(bDate)
      }),
    [activeItems],
  )

  const renewalsSoon = useMemo(
    () => renewals.filter((item) => Boolean(item.renewal_date && item.renewal_date >= todayKey() && item.renewal_date <= addDaysKey(60))),
    [renewals],
  )

  const deadlinesSoon = useMemo(
    () => deadlines.filter((item) => {
      const date = item.due_date ?? item.expiry_date
      return Boolean(date && date >= todayKey() && date <= addDaysKey(60))
    }),
    [deadlines],
  )

  const subscriptionMonthly = useMemo(
    () => activeItems
      .filter((item) => baseTypeOf(item) === 'subscription' && item.flow_type !== 'income')
      .reduce((sum, item) => sum + monthlyEquivalent(item), 0),
    [activeItems,typeOptions],
  )

  function rowsForTab() {
    if (tab === 'documents') return activeItems.filter((item) => baseTypeOf(item) === 'document')
    if (tab === 'contracts') return activeItems.filter((item) => baseTypeOf(item) === 'contract')
    if (tab === 'renewals') return renewals
    if (tab === 'insurance') return activeItems.filter((item) => baseTypeOf(item) === 'insurance')
    if (tab === 'subscriptions') return activeItems.filter((item) => baseTypeOf(item) === 'subscription')
    if (tab === 'deadlines') return deadlines
    if (tab === 'archive') return archivedItems
    return []
  }

  function typeForBase(baseType: LifeAdminBaseType) {
    return typeOptions.find((option) => option.baseType === baseType)?.value
      ?? typeOptions[0]?.value
      ?? 'document'
  }

  function resetComposer() {
    setEditingId(null)
    setItemType(typeOptions[0]?.value ?? 'document')
    setTitle('')
    setProvider('')
    setReferenceNumber('')
    setStartDate('')
    setDueDate('')
    setRenewalDate('')
    setExpiryDate('')
    setAmount('')
    setCurrency('EUR')
    setFrequency('none')
    setAutoRenew(false)
    setCancellationNotice('')
    setResponsibleProfileId('')
    setNotes('')
    setAddToCalendar(false)
    setFlowType('expense')
    setIncludeInFinance(false)
    setSyncTask(false)
    setPendingFile(null)
    setError('')
  }

  function openComposer(type?: LifeAdminType) {
    resetComposer()
    if (type) setItemType(type)
    setComposerOpen(true)
  }

  function openEdit(item: LifeAdminItem) {
    setEditingId(item.id)
    setItemType(item.item_type)
    setTitle(item.title)
    setProvider(item.provider ?? '')
    setReferenceNumber(item.reference_number ?? '')
    setStartDate(item.start_date ?? '')
    setDueDate(item.due_date ?? '')
    setRenewalDate(item.renewal_date ?? '')
    setExpiryDate(item.expiry_date ?? '')
    setAmount(item.amount != null ? String(item.amount) : '')
    setCurrency(item.currency || 'EUR')
    setFrequency(item.frequency)
    setAutoRenew(item.auto_renew)
    setCancellationNotice(item.cancellation_notice_days != null ? String(item.cancellation_notice_days) : '')
    setResponsibleProfileId(item.responsible_profile_id ?? '')
    setNotes(item.notes ?? '')
    setAddToCalendar(item.add_to_calendar)
    setFlowType(item.flow_type ?? 'expense')
    setIncludeInFinance(Boolean(item.include_in_finance))
    setSyncTask(Boolean(item.sync_task))
    setPendingFile(null)
    setError('')
    setComposerOpen(true)
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      setPendingFile(null)
      return
    }

    if (file.size > 15 * 1024 * 1024) {
      setError('Life Admin attachments can be up to 15 MB.')
      return
    }

    setPendingFile(file)
  }

  async function uploadAttachment(itemId: string, file: File) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
    const path = household.id + '/' + itemId + '/' + Date.now() + '-' + safeName

    const upload = await supabase.storage
      .from('life-admin-attachments')
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      })

    if (upload.error) throw upload.error

    const inserted = await supabase.from('life_admin_attachments').insert({
      household_id: household.id,
      life_admin_item_id: itemId,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      file_size: file.size,
    })

    if (inserted.error) {
      await supabase.storage.from('life-admin-attachments').remove([path])
      throw inserted.error
    }
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim()) return

    const normalizedAmount = amount.trim().replace(',', '.')
    const numericAmount = normalizedAmount ? Number(normalizedAmount) : null
    const notice = cancellationNotice.trim() ? Number(cancellationNotice) : null

    if (numericAmount != null && (!Number.isFinite(numericAmount) || numericAmount < 0)) {
      setError('Enter a valid amount.')
      return
    }

    if (notice != null && (!Number.isInteger(notice) || notice < 0 || notice > 3650)) {
      setError('Cancellation notice must be between 0 and 3650 days.')
      return
    }

    if (addToCalendar && !dueDate && !renewalDate && !expiryDate && !startDate) {
      setError('Add a due, renewal, expiry or start date before adding this item to Calendar.')
      return
    }

    setSaving(true)
    setError('')

    const result = await supabase.rpc('save_life_admin_item_v2', {
      p_id: editingId,
      p_household_id: household.id,
      p_item_type: itemType,
      p_title: title.trim(),
      p_provider: provider.trim() || null,
      p_reference_number: referenceNumber.trim() || null,
      p_start_date: startDate || null,
      p_due_date: dueDate || null,
      p_renewal_date: renewalDate || null,
      p_expiry_date: expiryDate || null,
      p_amount: numericAmount,
      p_currency: currency,
      p_frequency: frequency,
      p_auto_renew: autoRenew,
      p_cancellation_notice_days: notice,
      p_responsible_profile_id: responsibleProfileId || null,
      p_notes: notes.trim() || null,
      p_add_to_calendar: addToCalendar,
      p_flow_type: flowType,
      p_include_in_finance: includeInFinance,
      p_sync_task: syncTask,
    })

    if (result.error || !result.data) {
      setSaving(false)
      setError(result.error?.message ?? 'Could not save the Life Admin item.')
      return
    }

    if (pendingFile) {
      try {
        await uploadAttachment(String(result.data), pendingFile)
      } catch (reason) {
        setSaving(false)
        setError(reason instanceof Error ? reason.message : 'Item saved, but the attachment could not be uploaded.')
        await load()
        return
      }
    }

    setSaving(false)
    setComposerOpen(false)
    resetComposer()
    await load()
  }

  async function setArchived(item: LifeAdminItem, restore: boolean) {
    if (!canWrite) return

    setError('')
    const result = await supabase.rpc('archive_life_admin_item_v1', {
      p_id: item.id,
      p_household_id: household.id,
      p_restore: restore,
    })

    if (result.error) {
      setError(result.error.message)
      return
    }

    await load()
  }

  function renderResponsible(item: LifeAdminItem) {
    if (!item.responsible_profile_id) return null
    const profile = profileById.get(item.responsible_profile_id)
    if (!profile) return null

    return (
      <span className="life-admin-person">
        <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
        {firstName(profile.display_name)}
      </span>
    )
  }

  function renderAttachments(item: LifeAdminItem) {
    const rows = attachments.filter((attachment) => attachment.life_admin_item_id === item.id)
    if (!rows.length) return null

    return (
      <div className="life-admin-attachments">
        {rows.map((attachment) => {
          const url = attachmentUrls[attachment.id]
          return url ? (
            <a href={url} target="_blank" rel="noreferrer" key={attachment.id}>
              <Paperclip size={12} />
              {attachment.file_name}
            </a>
          ) : null
        })}
      </div>
    )
  }

  function renderItem(item: LifeAdminItem, archived = false) {
    const baseType = baseTypeOf(item)
    const Icon = typeIcon(baseType)
    const actionDate = nextActionDate(item)
    const overdue = Boolean(actionDate && actionDate < todayKey())

    return (
      <article className="list-card life-admin-item-card" key={item.id}>
        <span className={'life-admin-type-icon type-' + baseType}><Icon size={17} /></span>

        <div className="life-admin-item-main">
          <div className="life-admin-item-title-row">
            <div>
              <span className="life-admin-item-type">{typeByKey.get(item.item_type)?.label ?? item.item_type}</span>
              <h3>{item.title}</h3>
            </div>

            {!archived && actionDate && (
              <span className={overdue ? 'status-chip danger' : 'status-chip'}>
                {overdue ? 'Past due' : prettyDate(actionDate)}
              </span>
            )}
          </div>

          <div className="life-admin-item-meta">
            {item.provider && <span>{item.provider}</span>}
            {item.reference_number && <span>Ref. {item.reference_number}</span>}
            {item.amount != null && <span><Receipt size={11} />{item.flow_type === 'income' ? 'Income · ' : 'Cost · '}{money(item.amount,item.currency)}{item.frequency !== 'none' ? ' · ' + frequencyLabel(item.frequency) : ''}</span>}
            {item.auto_renew && <span><RefreshCw size={11} />Auto-renew</span>}
            {renderResponsible(item)}
            {item.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
            {item.linked_task_id && <span><Clock3 size={11} />Task</span>}
            {item.household_cost_id && <span><Receipt size={11} />Household Costs</span>}
          </div>

          <div className="life-admin-date-strip">
            {item.start_date && <span><small>Start</small>{prettyDate(item.start_date)}</span>}
            {item.due_date && <span><small>Due</small>{prettyDate(item.due_date)}</span>}
            {item.renewal_date && <span><small>Renewal</small>{prettyDate(item.renewal_date)}</span>}
            {item.expiry_date && <span><small>Expiry</small>{prettyDate(item.expiry_date)}</span>}
            {item.cancellation_notice_days != null && <span><small>Notice</small>{item.cancellation_notice_days} days</span>}
          </div>

          {item.notes && <p>{item.notes}</p>}
          {renderAttachments(item)}
        </div>

        {canWrite && (
          <div className="life-admin-item-actions">
            {archived ? (
              <button className="secondary-button compact" type="button" onClick={() => void setArchived(item,true)}>
                <ArchiveRestore size={14} />
                Restore
              </button>
            ) : (
              <>
                <button className="icon-button compact-icon" type="button" aria-label={'Edit ' + item.title} onClick={() => openEdit(item)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button compact-icon" type="button" aria-label={'Archive ' + item.title} onClick={() => void setArchived(item,false)}>
                  <Archive size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </article>
    )
  }

  const tabRows = rowsForTab()

  return (
    <div className="page life-admin-page">
      <div className="page-heading-row life-admin-heading">
        <div>
          <div className="page-label">LIFE ADMIN</div>
          <h1>Life Admin</h1>
          <p className="page-subtitle">Keep contracts, documents, insurance, subscriptions, renewals and important household deadlines in one place.</p>
        </div>

        {canWrite && (
          <button className="primary-button compact" type="button" onClick={() => openComposer()}>
            <Plus size={15} />
            Add item
          </button>
        )}
      </div>

      <nav className="life-admin-tabs" aria-label="Life Admin sections">
        {tabs.map((item) => (
          <button type="button" className={tab === item.key ? 'active' : ''} key={item.key} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>

      {!access?.enabled && <div className="module-access-note">Life Admin is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !composerOpen && <div className="notice error">{error}</div>}

      {tab === 'overview' ? (
        <>
          <section className="life-admin-summary-grid">
            <article className="life-admin-summary-card tone-1" onClick={() => setTab('documents')}>
              <span><FileText size={18} /></span>
              <div><small>DOCUMENTS</small><strong>{activeItems.filter((item) => baseTypeOf(item) === 'document').length}</strong><em>stored records</em></div>
            </article>
            <article className="life-admin-summary-card tone-2" onClick={() => setTab('contracts')}>
              <span><FileLock2 size={18} /></span>
              <div><small>CONTRACTS</small><strong>{activeItems.filter((item) => baseTypeOf(item) === 'contract').length}</strong><em>active records</em></div>
            </article>
            <article className="life-admin-summary-card tone-6" onClick={() => setTab('renewals')}>
              <span><RefreshCw size={18} /></span>
              <div><small>RENEWALS</small><strong>{renewalsSoon.length}</strong><em>within 60 days</em></div>
            </article>
            <article className="life-admin-summary-card tone-3" onClick={() => setTab('deadlines')}>
              <span><BellRing size={18} /></span>
              <div><small>DEADLINES</small><strong>{deadlinesSoon.length}</strong><em>within 60 days</em></div>
            </article>
            <article className="life-admin-summary-card tone-4" onClick={() => setTab('insurance')}>
              <span><ShieldCheck size={18} /></span>
              <div><small>INSURANCE</small><strong>{activeItems.filter((item) => baseTypeOf(item) === 'insurance').length}</strong><em>active records</em></div>
            </article>
            <article className="life-admin-summary-card tone-5" onClick={() => setTab('subscriptions')}>
              <span><CreditCard size={18} /></span>
              <div><small>SUBSCRIPTIONS</small><strong>{money(subscriptionMonthly,'EUR')}</strong><em>monthly equivalent</em></div>
            </article>
          </section>

          <section className="life-admin-overview-grid">
            <div className="life-admin-overview-panel">
              <header>
                <div><span className="eyebrow">NEXT</span><h2>Renewals</h2></div>
                <button type="button" className="text-button" onClick={() => setTab('renewals')}>View all</button>
              </header>
              <div className="life-admin-overview-list">
                {renewals.slice(0,4).length
                  ? renewals.slice(0,4).map((item) => renderItem(item))
                  : <div className="list-card empty-state life-admin-mini-empty">No renewals stored.</div>}
              </div>
            </div>

            <div className="life-admin-overview-panel">
              <header>
                <div><span className="eyebrow">ATTENTION</span><h2>Deadlines & expiry</h2></div>
                <button type="button" className="text-button" onClick={() => setTab('deadlines')}>View all</button>
              </header>
              <div className="life-admin-overview-list">
                {deadlines.slice(0,4).length
                  ? deadlines.slice(0,4).map((item) => renderItem(item))
                  : <div className="list-card empty-state life-admin-mini-empty">No deadlines stored.</div>}
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="life-admin-section">
          <div className="life-admin-section-heading">
            <div>
              <span className="eyebrow">{tab.toUpperCase()}</span>
              <h2>
                {tab === 'documents' ? 'Household documents' :
                  tab === 'contracts' ? 'Contracts' :
                    tab === 'renewals' ? 'Upcoming renewals' :
                      tab === 'insurance' ? 'Insurance' :
                        tab === 'subscriptions' ? 'Subscriptions' :
                          tab === 'deadlines' ? 'Deadlines & expiry' :
                            'Archived Life Admin items'}
              </h2>
            </div>

            {canWrite && tab !== 'archive' && (
              <button
                className="primary-button compact"
                type="button"
                onClick={() => openComposer(
                  tab === 'documents' ? typeForBase('document') :
                    tab === 'contracts' ? typeForBase('contract') :
                      tab === 'insurance' ? typeForBase('insurance') :
                        tab === 'subscriptions' ? typeForBase('subscription') :
                          tab === 'deadlines' ? typeForBase('deadline') : undefined,
                )}
              >
                <Plus size={15} />
                Add item
              </button>
            )}
          </div>

          {tabRows.length === 0 ? (
            <div className="list-card empty-state life-admin-empty">
              {tab === 'archive' ? <Archive size={24} /> : <FileLock2 size={24} />}
              <span className="empty-state-title">{tab === 'archive' ? 'Archive is empty.' : 'Nothing stored here yet.'}</span>
              <span>{tab === 'archive' ? 'Archived Life Admin records will appear here.' : 'Add the first record when you need it.'}</span>
            </div>
          ) : (
            <div className="life-admin-list">
              {tabRows.map((item) => renderItem(item,tab === 'archive'))}
            </div>
          )}
        </section>
      )}

      {composerOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            setComposerOpen(false)
            resetComposer()
          }
        }}>
          <form className="modal-card life-admin-composer" onSubmit={saveItem}>
            <header>
              <div><span className="eyebrow">{editingId ? 'EDIT LIFE ADMIN ITEM' : 'NEW LIFE ADMIN ITEM'}</span><h2>{editingId ? 'Edit item' : 'Add Life Admin item'}</h2></div>
              <button type="button" className="icon-button" aria-label="Close Life Admin form" onClick={() => { setComposerOpen(false); resetComposer() }}><X size={18} /></button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>Type<Select value={itemType} onChange={setItemType} options={typeOptions.map(({ value,label }) => ({ value,label }))} ariaLabel="Choose Life Admin item type" /></label>
              <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Home insurance" autoFocus required /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Provider / organization<input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Optional" /></label>
              <label>Reference / contract number<input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} placeholder="Optional" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Start date<DatePicker value={startDate} onChange={setStartDate} format={household.date_format} ariaLabel="Choose start date" /></label>
              <label>Due date<DatePicker value={dueDate} onChange={setDueDate} format={household.date_format} ariaLabel="Choose due date" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Renewal date<DatePicker value={renewalDate} onChange={setRenewalDate} format={household.date_format} ariaLabel="Choose renewal date" /></label>
              <label>Expiry date<DatePicker value={expiryDate} onChange={setExpiryDate} format={household.date_format} ariaLabel="Choose expiry date" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Amount
                <div className="life-admin-money-row">
                  <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Optional" />
                  <Select
                    value={currency}
                    onChange={setCurrency}
                    options={[
                      { value: 'EUR', label: 'EUR' },
                      { value: 'USD', label: 'USD' },
                      { value: 'GBP', label: 'GBP' },
                      { value: 'CHF', label: 'CHF' },
                    ]}
                    ariaLabel="Choose currency"
                  />
                </div>
              </label>
              <label>Frequency
                <Select
                  value={frequency}
                  onChange={(value) => setFrequency(value as Frequency)}
                  options={[
                    { value: 'none', label: 'One-time / no cycle' },
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'quarterly', label: 'Quarterly' },
                    { value: 'yearly', label: 'Yearly' },
                  ]}
                  ariaLabel="Choose payment or renewal frequency"
                />
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Amount direction
                <Select
                  value={flowType}
                  onChange={(value) => setFlowType(value as FinanceFlow)}
                  options={[
                    { value: 'expense', label: 'Cost / expense' },
                    { value: 'income', label: 'Income' },
                  ]}
                  ariaLabel="Choose whether the amount is a cost or income"
                />
                <small className="field-hint">Controls how this amount is shown in Household Costs.</small>
              </label>
              <div className="life-admin-finance-option">
                <label className="composer-option">
                  <input type="checkbox" checked={includeInFinance} disabled={!costsCanWrite} onChange={(event) => setIncludeInFinance(event.target.checked)} />
                  <span><span>Include in Household Costs</span><small>{costsCanWrite ? 'Keeps the amount and frequency synchronized with Household Costs.' : 'Household Costs write access is required.'}</small></span>
                </label>
              </div>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Cancellation notice (days)<input type="number" min="0" max="3650" value={cancellationNotice} onChange={(event) => setCancellationNotice(event.target.value)} placeholder="Optional" /></label>
              <label>Responsible person<Select value={responsibleProfileId} onChange={setResponsibleProfileId} options={profileOptions} ariaLabel="Choose responsible person" /></label>
            </div>

            <label className="composer-option">
              <input type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} />
              <span><span>Automatic renewal</span><small>Mark this record when the provider renews it automatically.</small></span>
            </label>

            <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional details, cancellation information or household notes" /></label>

            <label className="life-admin-upload-field">
              <span><Upload size={14} />Photo or document</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={chooseFile} />
              <small>{pendingFile ? pendingFile.name : 'Optional. JPG, PNG, WebP or PDF up to 15 MB.'}</small>
            </label>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={addToCalendar} disabled={!canSyncCalendar} onChange={(event) => setAddToCalendar(event.target.checked)} />
                <span>
                  <span>Add next date to Calendar</span>
                  <small>{canSyncCalendar ? 'Uses the due date first, then renewal, expiry or start date.' : 'Calendar write access is required.'}</small>
                </span>
              </label>
              <label className="composer-option">
                <input type="checkbox" checked={syncTask} disabled={!canSyncTasks} onChange={(event) => setSyncTask(event.target.checked)} />
                <span>
                  <span>Create linked Task</span>
                  <small>{canSyncTasks ? 'Makes this Life Admin responsibility visible in the Tasks module as well.' : 'Tasks write access is required.'}</small>
                </span>
              </label>
            </div>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add item'}</button>
          </form>
        </div>
      )}
    </div>
  )
}
