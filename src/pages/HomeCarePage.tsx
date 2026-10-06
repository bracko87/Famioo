import {
  Archive,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  Hammer,
  Home,
  PackageOpen,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  ShieldCheck,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { firstName } from '../lib/personName'
import { supabase } from '../lib/supabase'

type HomeCareTab = 'overview' | 'assets' | 'maintenance' | 'repairs' | 'warranties' | 'history'
type RepairStatus = 'open' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type RecurrenceType = 'none' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'custom'
type AttachmentTarget = 'asset' | 'maintenance' | 'repair'

type HomeAsset = {
  id: string
  name: string
  asset_type: string
  room_location: string | null
  brand: string | null
  model: string | null
  serial_number: string | null
  purchase_date: string | null
  purchase_price: number | null
  purchase_cost_id: string | null
  retailer: string | null
  warranty_until: string | null
  responsible_profile_id: string | null
  notes: string | null
  active: boolean
  created_at: string
}

type MaintenanceItem = {
  id: string
  asset_id: string | null
  title: string
  due_date: string
  recurrence_type: RecurrenceType
  recurrence_months: number | null
  responsible_profile_id: string | null
  estimated_cost: number | null
  notes: string | null
  sync_calendar: boolean
  sync_task: boolean
  linked_event_id: string | null
  linked_task_id: string | null
  last_completed_at: string | null
  active: boolean
  created_at: string
}

type RepairItem = {
  id: string
  asset_id: string | null
  title: string
  description: string | null
  status: RepairStatus
  appointment_date: string | null
  service_company: string | null
  contact_text: string | null
  location_text: string | null
  responsible_profile_id: string | null
  expected_cost: number | null
  actual_cost: number | null
  notes: string | null
  sync_calendar: boolean
  sync_task: boolean
  linked_event_id: string | null
  linked_task_id: string | null
  completed_at: string | null
  household_cost_id: string | null
  created_at: string
}

type HomeActivity = {
  id: string
  asset_id: string | null
  activity_type: 'maintenance' | 'repair' | 'asset'
  title: string
  activity_date: string
  cost_amount: number | null
  source_maintenance_id: string | null
  source_repair_id: string | null
  notes: string | null
  created_at: string
}

type HomeAttachment = {
  id: string
  asset_id: string | null
  maintenance_id: string | null
  repair_id: string | null
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
}

type CompletionTarget = {
  kind: 'maintenance' | 'repair'
  id: string
  title: string
  suggestedCost: number | null
} | null

const tabs: Array<{ key: HomeCareTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'assets', label: 'Assets' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'repairs', label: 'Repairs' },
  { key: 'warranties', label: 'Warranties' },
  { key: 'history', label: 'History' },
]

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function todayKey() {
  return dateKey(new Date())
}

function addDaysKey(days: number) {
  const next = new Date()
  next.setDate(next.getDate() + days)
  return dateKey(next)
}

function money(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function prettyDate(value: string | null) {
  if (!value) return '—'
  return new Date(value + 'T12:00:00').toLocaleDateString()
}

function recurrenceLabel(item: MaintenanceItem) {
  if (item.recurrence_type === 'none') return 'One-time'
  if (item.recurrence_type === 'monthly') return 'Monthly'
  if (item.recurrence_type === 'quarterly') return 'Every 3 months'
  if (item.recurrence_type === 'half_yearly') return 'Every 6 months'
  if (item.recurrence_type === 'yearly') return 'Yearly'
  return 'Every ' + (item.recurrence_months ?? 1) + ' months'
}

function warrantyTone(date: string | null) {
  if (!date) return 'neutral'
  const today = todayKey()
  if (date < today) return 'expired'
  if (date <= addDaysKey(60)) return 'soon'
  return 'active'
}

function repairStatusLabel(status: RepairStatus) {
  if (status === 'in_progress') return 'In progress'
  return status.slice(0, 1).toUpperCase() + status.slice(1)
}

export function HomeCarePage() {
  const { household, modules, profiles } = useHousehold()
  const access = modules.find((module) => module.code === 'home_care')
  const canWrite = Boolean(access?.can_write)
  const canSyncCalendar = Boolean(modules.find((module) => module.code === 'calendar')?.can_write)
  const canSyncTasks = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)
  const costsModule = modules.find((module) => module.code === 'costs')
  const costsEnabled = Boolean(costsModule?.enabled)
  const costsCanWrite = Boolean(costsModule?.can_write)

  const [tab, setTab] = useState<HomeCareTab>('overview')
  const [assets, setAssets] = useState<HomeAsset[]>([])
  const [assetTypeOptions, setAssetTypeOptions] = useState<Array<{ value: string; label: string; dotColor?: string }>>([{ value: 'Appliance', label: 'Appliance', dotColor: categoryColor('purple') }])
  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>([])
  const [repairs, setRepairs] = useState<RepairItem[]>([])
  const [activity, setActivity] = useState<HomeActivity[]>([])
  const [attachments, setAttachments] = useState<HomeAttachment[]>([])
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const [assetOpen, setAssetOpen] = useState(false)
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)
  const [assetName, setAssetName] = useState('')
  const [assetType, setAssetType] = useState('Appliance')
  const [assetRoom, setAssetRoom] = useState('')
  const [assetBrand, setAssetBrand] = useState('')
  const [assetModel, setAssetModel] = useState('')
  const [assetSerial, setAssetSerial] = useState('')
  const [assetPurchaseDate, setAssetPurchaseDate] = useState('')
  const [assetPurchasePrice, setAssetPurchasePrice] = useState('')
  const [assetIncludeCost, setAssetIncludeCost] = useState(false)
  const [assetRetailer, setAssetRetailer] = useState('')
  const [assetWarranty, setAssetWarranty] = useState('')
  const [assetResponsible, setAssetResponsible] = useState('')
  const [assetNotes, setAssetNotes] = useState('')
  const [assetFile, setAssetFile] = useState<File | null>(null)

  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [editingMaintenanceId, setEditingMaintenanceId] = useState<string | null>(null)
  const [maintenanceAssetId, setMaintenanceAssetId] = useState('')
  const [maintenanceTitle, setMaintenanceTitle] = useState('')
  const [maintenanceDue, setMaintenanceDue] = useState(todayKey())
  const [maintenanceRecurrence, setMaintenanceRecurrence] = useState<RecurrenceType>('none')
  const [maintenanceCustomMonths, setMaintenanceCustomMonths] = useState('2')
  const [maintenanceResponsible, setMaintenanceResponsible] = useState('')
  const [maintenanceCost, setMaintenanceCost] = useState('')
  const [maintenanceNotes, setMaintenanceNotes] = useState('')
  const [maintenanceCalendar, setMaintenanceCalendar] = useState(false)
  const [maintenanceTask, setMaintenanceTask] = useState(false)
  const [maintenanceFile, setMaintenanceFile] = useState<File | null>(null)

  const [repairOpen, setRepairOpen] = useState(false)
  const [editingRepairId, setEditingRepairId] = useState<string | null>(null)
  const [repairAssetId, setRepairAssetId] = useState('')
  const [repairTitle, setRepairTitle] = useState('')
  const [repairDescription, setRepairDescription] = useState('')
  const [repairStatus, setRepairStatus] = useState<Exclude<RepairStatus, 'completed'>>('open')
  const [repairDate, setRepairDate] = useState('')
  const [repairCompany, setRepairCompany] = useState('')
  const [repairContact, setRepairContact] = useState('')
  const [repairLocation, setRepairLocation] = useState('')
  const [repairResponsible, setRepairResponsible] = useState('')
  const [repairExpectedCost, setRepairExpectedCost] = useState('')
  const [repairNotes, setRepairNotes] = useState('')
  const [repairCalendar, setRepairCalendar] = useState(false)
  const [repairTask, setRepairTask] = useState(false)
  const [repairFile, setRepairFile] = useState<File | null>(null)

  const [completion, setCompletion] = useState<CompletionTarget>(null)
  const [completionCost, setCompletionCost] = useState('')
  const [completionNotes, setCompletionNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setError('')

    const [assetResult, maintenanceResult, repairResult, activityResult, attachmentResult, typeResult] = await Promise.all([
      supabase
        .from('home_care_assets')
        .select('id,name,asset_type,room_location,brand,model,serial_number,purchase_date,purchase_price,purchase_cost_id,retailer,warranty_until,responsible_profile_id,notes,active,created_at')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('home_care_maintenance')
        .select('id,asset_id,title,due_date,recurrence_type,recurrence_months,responsible_profile_id,estimated_cost,notes,sync_calendar,sync_task,linked_event_id,linked_task_id,last_completed_at,active,created_at')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('due_date'),
      supabase
        .from('home_care_repairs')
        .select('id,asset_id,title,description,status,appointment_date,service_company,contact_text,location_text,responsible_profile_id,expected_cost,actual_cost,notes,sync_calendar,sync_task,linked_event_id,linked_task_id,completed_at,household_cost_id,created_at')
        .eq('household_id', household.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('home_care_activity')
        .select('id,asset_id,activity_type,title,activity_date,cost_amount,source_maintenance_id,source_repair_id,notes,created_at')
        .eq('household_id', household.id)
        .order('activity_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('home_care_attachments')
        .select('id,asset_id,maintenance_id,repair_id,file_name,storage_path,mime_type,file_size')
        .eq('household_id', household.id)
        .order('created_at'),
      supabase
        .from('household_module_types')
        .select('type_key,label,color_key,sort_order')
        .eq('household_id', household.id)
        .eq('module_code', 'home_care')
        .eq('group_code', 'asset_type')
        .eq('active', true)
        .order('sort_order')
        .order('label'),
    ])

    if (assetResult.error) setError(assetResult.error.message)
    else setAssets((assetResult.data ?? []) as HomeAsset[])

    if (maintenanceResult.error) setError((current) => current || maintenanceResult.error.message)
    else setMaintenance((maintenanceResult.data ?? []) as MaintenanceItem[])

    if (repairResult.error) setError((current) => current || repairResult.error.message)
    else setRepairs((repairResult.data ?? []) as RepairItem[])

    if (activityResult.error) setError((current) => current || activityResult.error.message)
    else setActivity((activityResult.data ?? []) as HomeActivity[])

    if (typeResult.error) {
      setError((current) => current || typeResult.error.message)
    } else {
      const options = (typeResult.data ?? []).map((row) => ({ value: row.type_key, label: row.label, dotColor: categoryColor(row.color_key) }))
      setAssetTypeOptions(options.length ? options : [{ value: 'Appliance', label: 'Appliance', dotColor: categoryColor('purple') }])
    }

    if (attachmentResult.error) {
      setError((current) => current || attachmentResult.error.message)
    } else {
      const rows = (attachmentResult.data ?? []) as HomeAttachment[]
      setAttachments(rows)

      const signed = await Promise.all(rows.map(async (item) => {
        const result = await supabase.storage
          .from('home-care-attachments')
          .createSignedUrl(item.storage_path, 3600)

        return [item.id, result.data?.signedUrl ?? ''] as const
      }))

      setAttachmentUrls(Object.fromEntries(signed))
    }
  }

  useEffect(() => { void load() }, [household.id])

  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  )

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  )

  const overdueMaintenance = useMemo(
    () => maintenance.filter((item) => item.due_date < todayKey()),
    [maintenance],
  )

  const dueSoonMaintenance = useMemo(
    () => maintenance.filter((item) => item.due_date >= todayKey() && item.due_date <= addDaysKey(30)),
    [maintenance],
  )

  const openRepairs = useMemo(
    () => repairs.filter((item) => !['completed', 'cancelled'].includes(item.status)),
    [repairs],
  )

  const completedRepairs = useMemo(
    () => repairs.filter((item) => item.status === 'completed').slice(0, 8),
    [repairs],
  )

  const warrantyAssets = useMemo(
    () => assets
      .filter((asset) => asset.warranty_until)
      .sort((a, b) => (a.warranty_until ?? '').localeCompare(b.warranty_until ?? '')),
    [assets],
  )

  const warrantiesEndingSoon = useMemo(
    () => warrantyAssets.filter((asset) => {
      const date = asset.warranty_until
      return Boolean(date && date >= todayKey() && date <= addDaysKey(60))
    }),
    [warrantyAssets],
  )

  const monthCost = useMemo(() => {
    const month = todayKey().slice(0, 7)
    return activity
      .filter((item) => item.activity_date.startsWith(month))
      .reduce((sum, item) => sum + Number(item.cost_amount ?? 0), 0)
  }, [activity])

  const assetOptions = useMemo(
    () => [
      { value: '', label: 'No specific asset' },
      ...assets.map((asset) => ({ value: asset.id, label: asset.name })),
    ],
    [assets],
  )

  const profileOptions = useMemo(
    () => [
      { value: '', label: 'No responsible person' },
      ...profiles.map((profile) => ({ value: profile.id, label: firstName(profile.display_name) })),
    ],
    [profiles],
  )

  function fileForTarget(target: AttachmentTarget, id: string) {
    return attachments.filter((item) => {
      if (target === 'asset') return item.asset_id === id
      if (target === 'maintenance') return item.maintenance_id === id
      return item.repair_id === id
    })
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>, setter: (file: File | null) => void) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      setter(null)
      return
    }

    if (file.size > 15 * 1024 * 1024) {
      setError('Home Care attachments can be up to 15 MB.')
      return
    }

    setter(file)
  }

  async function uploadAttachment(target: AttachmentTarget, targetId: string, file: File) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
    const path = household.id + '/' + target + '/' + targetId + '/' + Date.now() + '-' + safeName

    const upload = await supabase.storage
      .from('home-care-attachments')
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      })

    if (upload.error) throw upload.error

    const row = {
      household_id: household.id,
      asset_id: target === 'asset' ? targetId : null,
      maintenance_id: target === 'maintenance' ? targetId : null,
      repair_id: target === 'repair' ? targetId : null,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      file_size: file.size,
    }

    const inserted = await supabase.from('home_care_attachments').insert(row)

    if (inserted.error) {
      await supabase.storage.from('home-care-attachments').remove([path])
      throw inserted.error
    }
  }

  function resetAsset() {
    setEditingAssetId(null)
    setAssetName('')
    setAssetType(assetTypeOptions[0]?.value ?? 'Appliance')
    setAssetRoom('')
    setAssetBrand('')
    setAssetModel('')
    setAssetSerial('')
    setAssetPurchaseDate('')
    setAssetPurchasePrice('')
    setAssetIncludeCost(false)
    setAssetRetailer('')
    setAssetWarranty('')
    setAssetResponsible('')
    setAssetNotes('')
    setAssetFile(null)
  }

  function openAsset(asset?: HomeAsset) {
    resetAsset()

    if (asset) {
      setEditingAssetId(asset.id)
      setAssetName(asset.name)
      setAssetType(asset.asset_type)
      setAssetRoom(asset.room_location ?? '')
      setAssetBrand(asset.brand ?? '')
      setAssetModel(asset.model ?? '')
      setAssetSerial(asset.serial_number ?? '')
      setAssetPurchaseDate(asset.purchase_date ?? '')
      setAssetPurchasePrice(asset.purchase_price != null ? String(asset.purchase_price) : '')
      setAssetIncludeCost(Boolean(asset.purchase_cost_id))
      setAssetRetailer(asset.retailer ?? '')
      setAssetWarranty(asset.warranty_until ?? '')
      setAssetResponsible(asset.responsible_profile_id ?? '')
      setAssetNotes(asset.notes ?? '')
    }

    setError('')
    setAssetOpen(true)
  }

  async function saveAsset(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !assetName.trim()) return

    const normalizedPrice = assetPurchasePrice.trim().replace(',', '.')
    const numericPrice = normalizedPrice ? Number(normalizedPrice) : null

    if (numericPrice != null && (!Number.isFinite(numericPrice) || numericPrice < 0)) {
      setError('Enter a valid purchase price.')
      return
    }

    setSaving(true)
    setError('')

    if (assetIncludeCost && (!numericPrice || numericPrice <= 0)) {
      setError('Enter a purchase price before adding it to Household Costs.')
      return
    }

    const result = await supabase.rpc('save_home_asset_v1', {
      p_id: editingAssetId,
      p_household_id: household.id,
      p_name: assetName.trim(),
      p_asset_type: assetType,
      p_room_location: assetRoom.trim() || null,
      p_brand: assetBrand.trim() || null,
      p_model: assetModel.trim() || null,
      p_serial_number: assetSerial.trim() || null,
      p_purchase_date: assetPurchaseDate || null,
      p_purchase_price: numericPrice,
      p_retailer: assetRetailer.trim() || null,
      p_warranty_until: assetWarranty || null,
      p_responsible_profile_id: assetResponsible || null,
      p_notes: assetNotes.trim() || null,
      p_include_cost: assetIncludeCost,
    })

    if (result.error || !result.data) {
      setSaving(false)
      setError(result.error?.message ?? 'Could not save the asset.')
      return
    }

    if (assetFile) {
      try {
        await uploadAttachment('asset', String(result.data), assetFile)
      } catch (reason) {
        setSaving(false)
        setError(reason instanceof Error ? reason.message : 'Asset saved, but the document could not be uploaded.')
        await load()
        return
      }
    }

    setSaving(false)
    setAssetOpen(false)
    resetAsset()
    await load()
  }

  function resetMaintenance() {
    setEditingMaintenanceId(null)
    setMaintenanceAssetId('')
    setMaintenanceTitle('')
    setMaintenanceDue(todayKey())
    setMaintenanceRecurrence('none')
    setMaintenanceCustomMonths('2')
    setMaintenanceResponsible('')
    setMaintenanceCost('')
    setMaintenanceNotes('')
    setMaintenanceCalendar(false)
    setMaintenanceTask(false)
    setMaintenanceFile(null)
  }

  function openMaintenance(item?: MaintenanceItem) {
    resetMaintenance()

    if (item) {
      setEditingMaintenanceId(item.id)
      setMaintenanceAssetId(item.asset_id ?? '')
      setMaintenanceTitle(item.title)
      setMaintenanceDue(item.due_date)
      setMaintenanceRecurrence(item.recurrence_type)
      setMaintenanceCustomMonths(String(item.recurrence_months ?? 2))
      setMaintenanceResponsible(item.responsible_profile_id ?? '')
      setMaintenanceCost(item.estimated_cost != null ? String(item.estimated_cost) : '')
      setMaintenanceNotes(item.notes ?? '')
      setMaintenanceCalendar(item.sync_calendar)
      setMaintenanceTask(item.sync_task)
    }

    setError('')
    setMaintenanceOpen(true)
  }

  async function saveMaintenance(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !maintenanceTitle.trim() || !maintenanceDue) return

    const normalizedCost = maintenanceCost.trim().replace(',', '.')
    const numericCost = normalizedCost ? Number(normalizedCost) : null
    const customMonths = maintenanceRecurrence === 'custom' ? Number(maintenanceCustomMonths) : null

    if (numericCost != null && (!Number.isFinite(numericCost) || numericCost < 0)) {
      setError('Enter a valid estimated cost.')
      return
    }

    if (maintenanceRecurrence === 'custom' && (!Number.isInteger(customMonths) || Number(customMonths) < 1 || Number(customMonths) > 60)) {
      setError('Custom recurrence must be between 1 and 60 months.')
      return
    }

    setSaving(true)
    setError('')

    const result = await supabase.rpc('save_home_maintenance_v1', {
      p_id: editingMaintenanceId,
      p_household_id: household.id,
      p_asset_id: maintenanceAssetId || null,
      p_title: maintenanceTitle.trim(),
      p_due_date: maintenanceDue,
      p_recurrence_type: maintenanceRecurrence,
      p_recurrence_months: customMonths,
      p_responsible_profile_id: maintenanceResponsible || null,
      p_estimated_cost: numericCost,
      p_notes: maintenanceNotes.trim() || null,
      p_sync_calendar: maintenanceCalendar,
      p_sync_task: maintenanceTask,
    })

    if (result.error || !result.data) {
      setSaving(false)
      setError(result.error?.message ?? 'Could not save maintenance.')
      return
    }

    if (maintenanceFile) {
      try {
        await uploadAttachment('maintenance', String(result.data), maintenanceFile)
      } catch (reason) {
        setSaving(false)
        setError(reason instanceof Error ? reason.message : 'Maintenance saved, but the document could not be uploaded.')
        await load()
        return
      }
    }

    setSaving(false)
    setMaintenanceOpen(false)
    resetMaintenance()
    await load()
  }

  function resetRepair() {
    setEditingRepairId(null)
    setRepairAssetId('')
    setRepairTitle('')
    setRepairDescription('')
    setRepairStatus('open')
    setRepairDate('')
    setRepairCompany('')
    setRepairContact('')
    setRepairLocation('')
    setRepairResponsible('')
    setRepairExpectedCost('')
    setRepairNotes('')
    setRepairCalendar(false)
    setRepairTask(false)
    setRepairFile(null)
  }

  function openRepair(item?: RepairItem) {
    resetRepair()

    if (item) {
      setEditingRepairId(item.id)
      setRepairAssetId(item.asset_id ?? '')
      setRepairTitle(item.title)
      setRepairDescription(item.description ?? '')
      if (item.status !== 'completed') setRepairStatus(item.status)
      setRepairDate(item.appointment_date ?? '')
      setRepairCompany(item.service_company ?? '')
      setRepairContact(item.contact_text ?? '')
      setRepairLocation(item.location_text ?? '')
      setRepairResponsible(item.responsible_profile_id ?? '')
      setRepairExpectedCost(item.expected_cost != null ? String(item.expected_cost) : '')
      setRepairNotes(item.notes ?? '')
      setRepairCalendar(item.sync_calendar)
      setRepairTask(item.sync_task)
    }

    setError('')
    setRepairOpen(true)
  }

  async function saveRepair(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !repairTitle.trim()) return

    const normalizedCost = repairExpectedCost.trim().replace(',', '.')
    const numericCost = normalizedCost ? Number(normalizedCost) : null

    if (numericCost != null && (!Number.isFinite(numericCost) || numericCost < 0)) {
      setError('Enter a valid expected cost.')
      return
    }

    if (repairCalendar && !repairDate) {
      setError('Choose an appointment date before adding the repair to Calendar.')
      return
    }

    setSaving(true)
    setError('')

    const result = await supabase.rpc('save_home_repair_v1', {
      p_id: editingRepairId,
      p_household_id: household.id,
      p_asset_id: repairAssetId || null,
      p_title: repairTitle.trim(),
      p_description: repairDescription.trim() || null,
      p_status: repairStatus,
      p_appointment_date: repairDate || null,
      p_service_company: repairCompany.trim() || null,
      p_contact_text: repairContact.trim() || null,
      p_location_text: repairLocation.trim() || null,
      p_responsible_profile_id: repairResponsible || null,
      p_expected_cost: numericCost,
      p_notes: repairNotes.trim() || null,
      p_sync_calendar: repairCalendar,
      p_sync_task: repairTask,
    })

    if (result.error || !result.data) {
      setSaving(false)
      setError(result.error?.message ?? 'Could not save the repair.')
      return
    }

    if (repairFile) {
      try {
        await uploadAttachment('repair', String(result.data), repairFile)
      } catch (reason) {
        setSaving(false)
        setError(reason instanceof Error ? reason.message : 'Repair saved, but the document could not be uploaded.')
        await load()
        return
      }
    }

    setSaving(false)
    setRepairOpen(false)
    resetRepair()
    await load()
  }

  function beginCompletion(target: CompletionTarget) {
    if (!target) return
    setCompletion(target)
    setCompletionCost(target.suggestedCost != null ? String(target.suggestedCost) : '')
    setCompletionNotes('')
    setError('')
  }

  async function completeRecord(event: FormEvent) {
    event.preventDefault()
    if (!completion) return

    const normalized = completionCost.trim().replace(',', '.')
    const numericCost = normalized ? Number(normalized) : null

    if (numericCost != null && (!Number.isFinite(numericCost) || numericCost < 0)) {
      setError('Enter a valid actual cost.')
      return
    }

    setSaving(true)
    setError('')

    const result = completion.kind === 'maintenance'
      ? await supabase.rpc('complete_home_maintenance_v1', {
        p_id: completion.id,
        p_household_id: household.id,
        p_actual_cost: numericCost,
        p_notes: completionNotes.trim() || null,
      })
      : await supabase.rpc('complete_home_repair_v1', {
        p_id: completion.id,
        p_household_id: household.id,
        p_actual_cost: numericCost,
        p_notes: completionNotes.trim() || null,
      })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setCompletion(null)
    setCompletionCost('')
    setCompletionNotes('')
    await load()
  }

  function renderAttachmentLinks(target: AttachmentTarget, id: string) {
    const rows = fileForTarget(target, id)
    if (!rows.length) return null

    return (
      <div className="home-care-attachment-list">
        {rows.map((item) => {
          const url = attachmentUrls[item.id]
          return url ? (
            <a href={url} target="_blank" rel="noreferrer" key={item.id}>
              <Paperclip size={12} />
              {item.file_name}
            </a>
          ) : null
        })}
      </div>
    )
  }

  function renderResponsible(profileId: string | null) {
    if (!profileId) return null
    const profile = profileById.get(profileId)
    if (!profile) return null

    return (
      <span className="home-care-person">
        <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
        {firstName(profile.display_name)}
      </span>
    )
  }

  function renderMaintenanceRow(item: MaintenanceItem, compact = false) {
    const asset = item.asset_id ? assetById.get(item.asset_id) : undefined
    const overdue = item.due_date < todayKey()

    return (
      <article className={'list-card home-care-maintenance-row ' + (compact ? 'compact-row' : '')} key={item.id}>
        <span className={'home-care-date-box ' + (overdue ? 'overdue' : '')}>
          <strong>{new Date(item.due_date + 'T12:00:00').getDate()}</strong>
          <small>{new Date(item.due_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' })}</small>
        </span>

        <div className="home-care-row-main">
          <div className="home-care-row-title">
            <h3>{item.title}</h3>
            <span className={overdue ? 'status-chip danger' : 'status-chip'}>
              {overdue ? 'Overdue' : recurrenceLabel(item)}
            </span>
          </div>

          <div className="home-care-row-meta">
            {asset && <span><Home size={11} />{asset.name}</span>}
            {renderResponsible(item.responsible_profile_id)}
            {item.estimated_cost != null && <span><Receipt size={11} />{money(item.estimated_cost)}</span>}
            {item.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
            {item.linked_task_id && <span><ClipboardList size={11} />Task</span>}
          </div>

          {!compact && item.notes && <p>{item.notes}</p>}
          {!compact && renderAttachmentLinks('maintenance', item.id)}
        </div>

        {!compact && canWrite && (
          <div className="home-care-row-actions">
            <button className="icon-button compact-icon" type="button" aria-label={'Edit ' + item.title} onClick={() => openMaintenance(item)}>
              <Pencil size={14} />
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => beginCompletion({
                kind: 'maintenance',
                id: item.id,
                title: item.title,
                suggestedCost: item.estimated_cost,
              })}
            >
              <CheckCircle2 size={14} />
              Complete
            </button>
          </div>
        )}
      </article>
    )
  }

  function renderRepairRow(item: RepairItem, compact = false) {
    const asset = item.asset_id ? assetById.get(item.asset_id) : undefined

    return (
      <article className={'list-card home-care-repair-row ' + (compact ? 'compact-row' : '')} key={item.id}>
        <span className="home-care-repair-icon"><Hammer size={17} /></span>

        <div className="home-care-row-main">
          <div className="home-care-row-title">
            <h3>{item.title}</h3>
            <span className={'status-chip repair-' + item.status}>{repairStatusLabel(item.status)}</span>
          </div>

          <div className="home-care-row-meta">
            {asset && <span><Home size={11} />{asset.name}</span>}
            {item.appointment_date && <span><CalendarDays size={11} />{prettyDate(item.appointment_date)}</span>}
            {item.service_company && <span>{item.service_company}</span>}
            {renderResponsible(item.responsible_profile_id)}
            {item.expected_cost != null && item.status !== 'completed' && <span><Receipt size={11} />Est. {money(item.expected_cost)}</span>}
            {item.actual_cost != null && item.status === 'completed' && <span><Receipt size={11} />{money(item.actual_cost)}</span>}
          </div>

          {!compact && item.location_text && <GoogleMapsLink location={item.location_text} />}
          {!compact && item.description && <p>{item.description}</p>}
          {!compact && renderAttachmentLinks('repair', item.id)}
        </div>

        {!compact && canWrite && item.status !== 'completed' && (
          <div className="home-care-row-actions">
            <button className="icon-button compact-icon" type="button" aria-label={'Edit ' + item.title} onClick={() => openRepair(item)}>
              <Pencil size={14} />
            </button>
            {item.status !== 'cancelled' && (
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => beginCompletion({
                  kind: 'repair',
                  id: item.id,
                  title: item.title,
                  suggestedCost: item.expected_cost,
                })}
              >
                <CheckCircle2 size={14} />
                Complete
              </button>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="page home-care-page">
      <div className="page-heading-row home-care-heading">
        <div>
          <div className="page-label">HOME CARE</div>
          <h1>Home Care</h1>
          <p className="page-subtitle">Manage household assets, maintenance, repairs, warranties and service history without duplicating Calendar, Tasks or Costs.</p>
        </div>

        {canWrite && (
          <div className="home-care-heading-actions">
            <button className="secondary-button compact" type="button" onClick={() => {
              setTab('maintenance')
              openMaintenance()
            }}>
              <Wrench size={15} />
              Maintenance
            </button>
            <button className="primary-button compact" type="button" onClick={() => {
              setTab('assets')
              openAsset()
            }}>
              <Plus size={15} />
              Add asset
            </button>
          </div>
        )}
      </div>

      <PrivacyNotice compact />

      <nav className="home-care-tabs" aria-label="Home Care sections">
        {tabs.map((item) => (
          <button
            type="button"
            className={tab === item.key ? 'active' : ''}
            key={item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {!access?.enabled && <div className="module-access-note">Home Care is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !assetOpen && !maintenanceOpen && !repairOpen && !completion && <div className="notice error">{error}</div>}

      {tab === 'overview' && (
        <>
          <section className="home-care-summary-grid">
            <article className="list-card home-care-summary-card" onClick={() => setTab('assets')}>
              <span className="summary-icon"><PackageOpen size={18} /></span>
              <div><span>Assets</span><strong>{assets.length}</strong><small>registered at home</small></div>
            </article>
            <article className="list-card home-care-summary-card" onClick={() => setTab('maintenance')}>
              <span className="summary-icon warning"><Wrench size={18} /></span>
              <div><span>Needs attention</span><strong>{overdueMaintenance.length + dueSoonMaintenance.length}</strong><small>{overdueMaintenance.length} overdue</small></div>
            </article>
            <article className="list-card home-care-summary-card" onClick={() => setTab('repairs')}>
              <span className="summary-icon repair"><Hammer size={18} /></span>
              <div><span>Open repairs</span><strong>{openRepairs.length}</strong><small>active service cases</small></div>
            </article>
            <article className="list-card home-care-summary-card" onClick={() => setTab('warranties')}>
              <span className="summary-icon warranty"><ShieldCheck size={18} /></span>
              <div><span>Warranty ending</span><strong>{warrantiesEndingSoon.length}</strong><small>within 60 days</small></div>
            </article>
            <article className="list-card home-care-summary-card" onClick={() => setTab('history')}>
              <span className="summary-icon cost"><Receipt size={18} /></span>
              <div><span>This month</span><strong>{money(monthCost)}</strong><small>Home Care service costs</small></div>
            </article>
          </section>

          <section className="home-care-overview-grid">
            <div className="home-care-overview-panel">
              <header>
                <div><span className="eyebrow">UPCOMING</span><h2>Maintenance</h2></div>
                <button type="button" className="text-button" onClick={() => setTab('maintenance')}>View all</button>
              </header>
              <div className="home-care-mini-list">
                {maintenance.slice(0, 5).length
                  ? maintenance.slice(0, 5).map((item) => renderMaintenanceRow(item, true))
                  : <div className="list-card empty-state home-care-mini-empty">No maintenance planned.</div>}
              </div>
            </div>

            <div className="home-care-overview-panel">
              <header>
                <div><span className="eyebrow">SERVICE</span><h2>Open repairs</h2></div>
                <button type="button" className="text-button" onClick={() => setTab('repairs')}>View all</button>
              </header>
              <div className="home-care-mini-list">
                {openRepairs.slice(0, 5).length
                  ? openRepairs.slice(0, 5).map((item) => renderRepairRow(item, true))
                  : <div className="list-card empty-state home-care-mini-empty">No open repairs.</div>}
              </div>
            </div>

            <div className="home-care-overview-panel">
              <header>
                <div><span className="eyebrow">WARRANTY</span><h2>Ending soon</h2></div>
                <button type="button" className="text-button" onClick={() => setTab('warranties')}>View all</button>
              </header>
              <div className="home-care-warranty-mini-list">
                {warrantiesEndingSoon.length ? warrantiesEndingSoon.slice(0, 5).map((asset) => (
                  <button type="button" className="list-card warranty-mini-row" key={asset.id} onClick={() => setTab('warranties')}>
                    <span><ShieldCheck size={15} /></span>
                    <div><strong>{asset.name}</strong><small>{prettyDate(asset.warranty_until)}</small></div>
                  </button>
                )) : <div className="list-card empty-state home-care-mini-empty">No warranties ending soon.</div>}
              </div>
            </div>
          </section>
        </>
      )}

      {tab === 'assets' && (
        <section className="home-care-section">
          <div className="home-care-section-heading">
            <div><span className="eyebrow">ASSETS & APPLIANCES</span><h2>Household inventory</h2></div>
            {canWrite && <button className="primary-button compact" type="button" onClick={() => openAsset()}><Plus size={15} />Add asset</button>}
          </div>

          {assets.length === 0 ? (
            <div className="list-card empty-state"><PackageOpen size={24} /><span className="empty-state-title">No assets yet.</span><span>Add appliances, equipment and important household items.</span></div>
          ) : (
            <div className="home-care-asset-grid">
              {assets.map((asset) => {
                const responsible = asset.responsible_profile_id ? profileById.get(asset.responsible_profile_id) : undefined
                const warranty = warrantyTone(asset.warranty_until)

                return (
                  <article className="list-card home-care-asset-card" key={asset.id}>
                    <header>
                      <div>
                        <span className="home-care-asset-type">{asset.asset_type}</span>
                        <h3>{asset.name}</h3>
                      </div>
                      {canWrite && <button className="icon-button compact-icon" type="button" aria-label={'Edit ' + asset.name} onClick={() => openAsset(asset)}><Pencil size={14} /></button>}
                    </header>

                    <div className="home-care-asset-meta">
                      {asset.room_location && <span><Home size={11} />{asset.room_location}</span>}
                      {(asset.brand || asset.model) && <span>{[asset.brand, asset.model].filter(Boolean).join(' ')}</span>}
                      {responsible && <span className="home-care-person"><ProfileAvatar avatarPath={responsible.avatar_path} name={responsible.display_name} size="sm" />{firstName(responsible.display_name)}</span>}
                    </div>

                    <dl className="home-care-asset-details">
                      <div><dt>Serial number</dt><dd>{asset.serial_number || '—'}</dd></div>
                      <div><dt>Purchased</dt><dd>{prettyDate(asset.purchase_date)}</dd></div>
                      <div><dt>Purchase price</dt><dd>{money(asset.purchase_price)}</dd></div>
                      <div><dt>Retailer</dt><dd>{asset.retailer || '—'}</dd></div>
                      <div><dt>Warranty</dt><dd><span className={'status-chip warranty-' + warranty}>{prettyDate(asset.warranty_until)}</span></dd></div>
                    </dl>

                    {asset.notes && <p>{asset.notes}</p>}
                    {renderAttachmentLinks('asset', asset.id)}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'maintenance' && (
        <section className="home-care-section">
          <div className="home-care-section-heading">
            <div><span className="eyebrow">MAINTENANCE</span><h2>Upcoming household maintenance</h2></div>
            {canWrite && <button className="primary-button compact" type="button" onClick={() => openMaintenance()}><Plus size={15} />Add maintenance</button>}
          </div>

          {maintenance.length === 0 ? (
            <div className="list-card empty-state"><Wrench size={24} /><span className="empty-state-title">No maintenance planned.</span><span>Add recurring or one-time maintenance for your home and assets.</span></div>
          ) : (
            <div className="home-care-list">{maintenance.map((item) => renderMaintenanceRow(item))}</div>
          )}
        </section>
      )}

      {tab === 'repairs' && (
        <section className="home-care-section">
          <div className="home-care-section-heading">
            <div><span className="eyebrow">REPAIRS & SERVICE</span><h2>Repair cases</h2></div>
            {canWrite && <button className="primary-button compact" type="button" onClick={() => openRepair()}><Plus size={15} />Add repair</button>}
          </div>

          {openRepairs.length === 0 ? (
            <div className="list-card empty-state"><Hammer size={24} /><span className="empty-state-title">No open repairs.</span><span>Create a repair when something at home needs service.</span></div>
          ) : (
            <div className="home-care-list">{openRepairs.map((item) => renderRepairRow(item))}</div>
          )}

          {completedRepairs.length > 0 && (
            <div className="home-care-completed-section">
              <span className="eyebrow">RECENTLY COMPLETED</span>
              <div className="home-care-list">{completedRepairs.map((item) => renderRepairRow(item))}</div>
            </div>
          )}
        </section>
      )}

      {tab === 'warranties' && (
        <section className="home-care-section">
          <div className="home-care-section-heading">
            <div><span className="eyebrow">WARRANTIES</span><h2>Warranty overview</h2></div>
          </div>

          {warrantyAssets.length === 0 ? (
            <div className="list-card empty-state"><ShieldCheck size={24} /><span className="empty-state-title">No warranties stored.</span><span>Add warranty dates while editing your assets.</span></div>
          ) : (
            <div className="list-card home-care-warranty-table">
              {warrantyAssets.map((asset) => {
                const tone = warrantyTone(asset.warranty_until)
                return (
                  <div className="home-care-warranty-row" key={asset.id}>
                    <span className="warranty-row-icon"><ShieldCheck size={15} /></span>
                    <div><strong>{asset.name}</strong><small>{[asset.brand, asset.model].filter(Boolean).join(' ') || asset.asset_type}</small></div>
                    <span>{asset.room_location || '—'}</span>
                    <span>{prettyDate(asset.warranty_until)}</span>
                    <span className={'status-chip warranty-' + tone}>
                      {tone === 'expired' ? 'Expired' : tone === 'soon' ? 'Ending soon' : 'Active'}
                    </span>
                    {canWrite && <button className="icon-button compact-icon" type="button" aria-label={'Edit ' + asset.name} onClick={() => openAsset(asset)}><Pencil size={14} /></button>}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'history' && (
        <section className="home-care-section">
          <div className="home-care-section-heading">
            <div><span className="eyebrow">HISTORY</span><h2>Service history</h2></div>
          </div>

          {activity.length === 0 ? (
            <div className="list-card empty-state"><FileText size={24} /><span className="empty-state-title">No Home Care history yet.</span><span>Completed maintenance and repairs will appear here automatically.</span></div>
          ) : (
            <div className="home-care-history">
              {activity.map((item) => {
                const asset = item.asset_id ? assetById.get(item.asset_id) : undefined
                return (
                  <article className="home-care-history-row" key={item.id}>
                    <span className={'history-marker ' + item.activity_type}>
                      {item.activity_type === 'maintenance' ? <Wrench size={14} /> : item.activity_type === 'repair' ? <Hammer size={14} /> : <PackageOpen size={14} />}
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{prettyDate(item.activity_date)}{asset ? ' · ' + asset.name : ''}</span>
                      {item.notes && <small>{item.notes}</small>}
                    </div>
                    <strong className="history-cost">{item.cost_amount != null ? money(item.cost_amount) : '—'}</strong>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      {assetOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            setAssetOpen(false)
            resetAsset()
          }
        }}>
          <form className="modal-card home-care-composer" onSubmit={saveAsset}>
            <header>
              <div><span className="eyebrow">{editingAssetId ? 'EDIT ASSET' : 'NEW ASSET'}</span><h2>{editingAssetId ? 'Edit asset' : 'Add asset'}</h2></div>
              <button type="button" className="icon-button" aria-label="Close asset form" onClick={() => { setAssetOpen(false); resetAsset() }}><X size={18} /></button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>Name<input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="e.g. Washing machine" autoFocus required /></label>
              <label>Type<Select value={assetType} onChange={setAssetType} options={assetTypeOptions} ariaLabel="Choose asset type" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Room / location<input value={assetRoom} onChange={(event) => setAssetRoom(event.target.value)} placeholder="e.g. Laundry room" /></label>
              <label>Responsible person<Select value={assetResponsible} onChange={setAssetResponsible} options={profileOptions} ariaLabel="Choose responsible person" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Brand<input value={assetBrand} onChange={(event) => setAssetBrand(event.target.value)} placeholder="Optional" /></label>
              <label>Model<input value={assetModel} onChange={(event) => setAssetModel(event.target.value)} placeholder="Optional" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Serial number<input value={assetSerial} onChange={(event) => setAssetSerial(event.target.value)} placeholder="Optional" /></label>
              <label>Retailer<input value={assetRetailer} onChange={(event) => setAssetRetailer(event.target.value)} placeholder="Optional" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Purchase date<DatePicker value={assetPurchaseDate} onChange={setAssetPurchaseDate} format={household.date_format} ariaLabel="Choose purchase date" /></label>
              <label>Purchase price<div className="money-input"><span>€</span><input inputMode="decimal" value={assetPurchasePrice} onChange={(event) => setAssetPurchasePrice(event.target.value)} placeholder="Optional" /></div></label>
            </div>

            <label>Warranty until<DatePicker value={assetWarranty} onChange={setAssetWarranty} format={household.date_format} ariaLabel="Choose warranty end date" /></label>
            <label>Notes<textarea value={assetNotes} onChange={(event) => setAssetNotes(event.target.value)} rows={3} placeholder="Optional asset notes" /></label>

            <label className="composer-option">
              <input
                type="checkbox"
                checked={assetIncludeCost}
                disabled={!costsCanWrite}
                onChange={(event) => setAssetIncludeCost(event.target.checked)}
              />
              <span>
                <span>Include purchase price in Household Costs</span>
                <small>
                  {costsCanWrite
                    ? 'Creates or updates one one-time Household Cost using the purchase date and purchase price.'
                    : 'Household Costs must be unlocked with write access to use this option.'}
                </small>
              </span>
            </label>

            <label className="home-care-upload-field">
              <span><Upload size={14} />Receipt, manual, photo or document</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(event) => chooseFile(event, setAssetFile)} />
              <small>{assetFile ? assetFile.name : 'Optional. JPG, PNG, WebP or PDF up to 15 MB.'}</small>
            </label>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : editingAssetId ? 'Save changes' : 'Add asset'}</button>
          </form>
        </div>
      )}

      {maintenanceOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            setMaintenanceOpen(false)
            resetMaintenance()
          }
        }}>
          <form className="modal-card home-care-composer" onSubmit={saveMaintenance}>
            <header>
              <div><span className="eyebrow">{editingMaintenanceId ? 'EDIT MAINTENANCE' : 'NEW MAINTENANCE'}</span><h2>{editingMaintenanceId ? 'Edit maintenance' : 'Add maintenance'}</h2></div>
              <button type="button" className="icon-button" aria-label="Close maintenance form" onClick={() => { setMaintenanceOpen(false); resetMaintenance() }}><X size={18} /></button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>Maintenance name<input value={maintenanceTitle} onChange={(event) => setMaintenanceTitle(event.target.value)} placeholder="e.g. Boiler service" autoFocus required /></label>
              <label>Asset<Select value={maintenanceAssetId} onChange={setMaintenanceAssetId} options={assetOptions} ariaLabel="Choose asset" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Due date<DatePicker value={maintenanceDue} onChange={setMaintenanceDue} format={household.date_format} ariaLabel="Choose maintenance due date" /></label>
              <label>Responsible person<Select value={maintenanceResponsible} onChange={setMaintenanceResponsible} options={profileOptions} ariaLabel="Choose responsible person" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Repeat
                <Select
                  value={maintenanceRecurrence}
                  onChange={(value) => setMaintenanceRecurrence(value as RecurrenceType)}
                  options={[
                    { value: 'none', label: 'One-time' },
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'quarterly', label: 'Every 3 months' },
                    { value: 'half_yearly', label: 'Every 6 months' },
                    { value: 'yearly', label: 'Yearly' },
                    { value: 'custom', label: 'Custom months' },
                  ]}
                  ariaLabel="Choose maintenance recurrence"
                />
              </label>
              {maintenanceRecurrence === 'custom' ? (
                <label>Repeat every<input type="number" min="1" max="60" value={maintenanceCustomMonths} onChange={(event) => setMaintenanceCustomMonths(event.target.value)} /></label>
              ) : (
                <label>Estimated cost<div className="money-input"><span>€</span><input inputMode="decimal" value={maintenanceCost} onChange={(event) => setMaintenanceCost(event.target.value)} placeholder="Optional" /></div></label>
              )}
            </div>

            {maintenanceRecurrence === 'custom' && (
              <label className="home-care-half-field">Estimated cost<div className="money-input"><span>€</span><input inputMode="decimal" value={maintenanceCost} onChange={(event) => setMaintenanceCost(event.target.value)} placeholder="Optional" /></div></label>
            )}

            <label>Notes<textarea value={maintenanceNotes} onChange={(event) => setMaintenanceNotes(event.target.value)} rows={3} placeholder="Optional maintenance instructions" /></label>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={maintenanceCalendar} disabled={!canSyncCalendar} onChange={(event) => setMaintenanceCalendar(event.target.checked)} />
                <span><span>Add to Calendar</span><small>{canSyncCalendar ? 'The maintenance date is synchronized with the shared Calendar.' : 'Calendar write access is required.'}</small></span>
              </label>
              <label className="composer-option">
                <input type="checkbox" checked={maintenanceTask} disabled={!canSyncTasks} onChange={(event) => setMaintenanceTask(event.target.checked)} />
                <span><span>Create linked Task</span><small>{canSyncTasks ? 'The responsible person and due date are synchronized with Tasks.' : 'Tasks write access is required.'}</small></span>
              </label>
            </div>

            <label className="home-care-upload-field">
              <span><Upload size={14} />Document or photo</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(event) => chooseFile(event, setMaintenanceFile)} />
              <small>{maintenanceFile ? maintenanceFile.name : 'Optional. JPG, PNG, WebP or PDF up to 15 MB.'}</small>
            </label>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : editingMaintenanceId ? 'Save changes' : 'Add maintenance'}</button>
          </form>
        </div>
      )}

      {repairOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            setRepairOpen(false)
            resetRepair()
          }
        }}>
          <form className="modal-card home-care-composer" onSubmit={saveRepair}>
            <header>
              <div><span className="eyebrow">{editingRepairId ? 'EDIT REPAIR' : 'NEW REPAIR'}</span><h2>{editingRepairId ? 'Edit repair' : 'Add repair'}</h2></div>
              <button type="button" className="icon-button" aria-label="Close repair form" onClick={() => { setRepairOpen(false); resetRepair() }}><X size={18} /></button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>Repair / problem<input value={repairTitle} onChange={(event) => setRepairTitle(event.target.value)} placeholder="e.g. Dishwasher leaking" autoFocus required /></label>
              <label>Asset<Select value={repairAssetId} onChange={setRepairAssetId} options={assetOptions} ariaLabel="Choose asset" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Status
                <Select
                  value={repairStatus}
                  onChange={(value) => setRepairStatus(value as Exclude<RepairStatus, 'completed'>)}
                  options={[
                    { value: 'open', label: 'Open' },
                    { value: 'scheduled', label: 'Scheduled' },
                    { value: 'in_progress', label: 'In progress' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ]}
                  ariaLabel="Choose repair status"
                />
              </label>
              <label>Appointment date<DatePicker value={repairDate} onChange={setRepairDate} format={household.date_format} ariaLabel="Choose repair appointment date" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Service company<input value={repairCompany} onChange={(event) => setRepairCompany(event.target.value)} placeholder="Optional" /></label>
              <label>Contact<input value={repairContact} onChange={(event) => setRepairContact(event.target.value)} placeholder="Phone, email or contact name" /></label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>Location
                <input value={repairLocation} onChange={(event) => setRepairLocation(event.target.value)} placeholder="Optional address or service location" />
                {repairLocation.trim() ? <GoogleMapsLink location={repairLocation} label="Open in Google Maps" className="field-map-link" /> : <small className="field-hint">Optional.</small>}
              </label>
              <label>Responsible person<Select value={repairResponsible} onChange={setRepairResponsible} options={profileOptions} ariaLabel="Choose responsible person" /></label>
            </div>

            <label className="home-care-half-field">Expected cost<div className="money-input"><span>€</span><input inputMode="decimal" value={repairExpectedCost} onChange={(event) => setRepairExpectedCost(event.target.value)} placeholder="Optional" /></div></label>
            <label>Description<textarea value={repairDescription} onChange={(event) => setRepairDescription(event.target.value)} rows={3} placeholder="Describe the problem or requested service" /></label>
            <label>Notes<textarea value={repairNotes} onChange={(event) => setRepairNotes(event.target.value)} rows={2} placeholder="Optional notes" /></label>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={repairCalendar} disabled={!canSyncCalendar} onChange={(event) => setRepairCalendar(event.target.checked)} />
                <span><span>Add appointment to Calendar</span><small>{canSyncCalendar ? 'Requires an appointment date.' : 'Calendar write access is required.'}</small></span>
              </label>
              <label className="composer-option">
                <input type="checkbox" checked={repairTask} disabled={!canSyncTasks} onChange={(event) => setRepairTask(event.target.checked)} />
                <span><span>Create linked Task</span><small>{canSyncTasks ? 'Track this repair in Tasks as well.' : 'Tasks write access is required.'}</small></span>
              </label>
            </div>

            <label className="home-care-upload-field">
              <span><Upload size={14} />Photo, quote, invoice or document</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(event) => chooseFile(event, setRepairFile)} />
              <small>{repairFile ? repairFile.name : 'Optional. JPG, PNG, WebP or PDF up to 15 MB.'}</small>
            </label>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : editingRepairId ? 'Save changes' : 'Add repair'}</button>
          </form>
        </div>
      )}

      {completion && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            setCompletion(null)
            setCompletionCost('')
            setCompletionNotes('')
          }
        }}>
          <form className="modal-card home-care-completion-card" onSubmit={completeRecord}>
            <header>
              <div><span className="eyebrow">COMPLETE HOME CARE ITEM</span><h2>{completion.title}</h2></div>
              <button type="button" className="icon-button" aria-label="Close completion form" onClick={() => setCompletion(null)}><X size={18} /></button>
            </header>

            <label>Actual cost<div className="money-input"><span>€</span><input inputMode="decimal" value={completionCost} onChange={(event) => setCompletionCost(event.target.value)} placeholder="Optional" /></div></label>
            <small className="home-care-cost-note">
              {costsEnabled
                ? 'If an amount is entered, it will also be added to Household Costs.'
                : 'The amount will stay in Home Care. Unlock Household Costs to post it there automatically.'}
            </small>
            <label>Completion notes<textarea value={completionNotes} onChange={(event) => setCompletionNotes(event.target.value)} rows={3} placeholder="What was done, replaced or repaired?" /></label>

            {error && <div className="form-message error">{error}</div>}
            <button className="primary-button" disabled={saving}><CheckCircle2 size={15} />{saving ? 'Completing…' : 'Complete'}</button>
          </form>
        </div>
      )}
    </div>
  )
}
