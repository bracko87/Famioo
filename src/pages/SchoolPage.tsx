import { CalendarDays, GraduationCap, Paperclip, Pencil, Plus, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { TimePicker } from '../components/ui/TimePicker'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { firstName } from '../lib/personName'
import { supabase } from '../lib/supabase'
import type { EventCategory } from '../lib/types'

type SchoolEntry = {
  id: string
  title: string
  category_id: string | null
  child_profile_id: string | null
  entry_date: string
  all_day: boolean
  start_time: string | null
  end_time: string | null
  location_text: string | null
  notes: string | null
  linked_event_id: string | null
  sync_task: boolean
  linked_task_id: string | null
  status: 'active' | 'archived'
  created_at: string
}

type SchoolAttachment = {
  id: string
  school_entry_id: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
}

function todayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

export function SchoolPage() {
  const { household, modules, profiles } = useHousehold()
  const access = modules.find((module) => module.code === 'school')
  const canWrite = Boolean(access?.can_write)
  const canSyncTasks = Boolean(modules.find((module) => module.code === 'tasks')?.can_write)

  const [entries, setEntries] = useState<SchoolEntry[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [attachments, setAttachments] = useState<SchoolAttachment[]>([])
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const [selectedChild, setSelectedChild] = useState('all')
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [childProfileId, setChildProfileId] = useState('')
  const [entryDate, setEntryDate] = useState(todayKey())
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('09:00')
  const [locationText, setLocationText] = useState('')
  const [notes, setNotes] = useState('')
  const [addToCalendar, setAddToCalendar] = useState(true)
  const [syncTask, setSyncTask] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const childProfiles = useMemo(
    () => profiles.filter((profile) => profile.profile_type === 'child' || profile.profile_type === 'profile_only'),
    [profiles],
  )

  async function load() {
    setError('')

    const [entryResult, categoryResult, availabilityResult, attachmentResult] = await Promise.all([
      supabase
        .from('school_entries')
        .select('id,title,category_id,child_profile_id,entry_date,all_day,start_time,end_time,location_text,notes,linked_event_id,sync_task,linked_task_id,status,created_at')
        .eq('household_id', household.id)
        .eq('status', 'active')
        .order('entry_date')
        .order('start_time', { ascending: true, nullsFirst: true }),
      supabase
        .from('event_categories')
        .select('id,name,color_key')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('sort_order')
        .order('name'),
      supabase
        .from('module_category_availability')
        .select('category_id,enabled')
        .eq('household_id', household.id)
        .eq('module_code', 'school'),
      supabase
        .from('school_attachments')
        .select('id,school_entry_id,file_name,storage_path,mime_type,file_size')
        .eq('household_id', household.id)
        .order('created_at'),
    ])

    if (entryResult.error) setError(entryResult.error.message)
    else setEntries((entryResult.data ?? []) as SchoolEntry[])

    if (categoryResult.error || availabilityResult.error) {
      setError((current) => current || categoryResult.error?.message || availabilityResult.error?.message || 'Could not load School categories.')
    } else {
      const enabled = new Map((availabilityResult.data ?? []).map((row) => [row.category_id, row.enabled]))
      setCategories(((categoryResult.data ?? []) as EventCategory[]).filter((category) => enabled.get(category.id) === true))
    }

    if (attachmentResult.error) {
      setError((current) => current || attachmentResult.error.message)
    } else {
      const rows = (attachmentResult.data ?? []) as SchoolAttachment[]
      setAttachments(rows)

      const signedEntries = await Promise.all(rows.map(async (attachment) => {
        const signed = await supabase.storage
          .from('school-attachments')
          .createSignedUrl(attachment.storage_path, 3600)

        return [attachment.id, signed.data?.signedUrl ?? ''] as const
      }))

      setAttachmentUrls(Object.fromEntries(signedEntries))
    }
  }

  useEffect(() => { void load() }, [household.id])

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  )

  const visibleEntries = useMemo(
    () => entries.filter((entry) => selectedChild === 'all' || entry.child_profile_id === selectedChild),
    [entries, selectedChild],
  )

  const upcomingEntries = useMemo(
    () => visibleEntries.filter((entry) => entry.entry_date >= todayKey()),
    [visibleEntries],
  )

  function resetComposer() {
    setEditingId(null)
    setTitle('')
    setCategoryId(categories[0]?.id ?? '')
    setChildProfileId('')
    setEntryDate(todayKey())
    setAllDay(true)
    setStartTime('08:00')
    setEndTime('09:00')
    setLocationText('')
    setNotes('')
    setAddToCalendar(true)
    setSyncTask(false)
    setPendingFile(null)
    setError('')
  }

  function openComposer() {
    resetComposer()
    setComposerOpen(true)
  }

  function openEdit(entry: SchoolEntry) {
    setEditingId(entry.id)
    setTitle(entry.title)
    setCategoryId(entry.category_id ?? '')
    setChildProfileId(entry.child_profile_id ?? '')
    setEntryDate(entry.entry_date)
    setAllDay(entry.all_day)
    setStartTime(entry.start_time?.slice(0, 5) ?? '08:00')
    setEndTime(entry.end_time?.slice(0, 5) ?? '09:00')
    setLocationText(entry.location_text ?? '')
    setNotes(entry.notes ?? '')
    setAddToCalendar(Boolean(entry.linked_event_id))
    setSyncTask(Boolean(entry.sync_task))
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

    if (file.size > 10 * 1024 * 1024) {
      setError('School attachments can be up to 10 MB.')
      return
    }

    setPendingFile(file)
  }

  async function uploadAttachment(entryId: string, file: File) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
    const path = household.id + '/' + entryId + '/' + Date.now() + '-' + safeName

    const upload = await supabase.storage
      .from('school-attachments')
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      })

    if (upload.error) throw upload.error

    const insert = await supabase.from('school_attachments').insert({
      household_id: household.id,
      school_entry_id: entryId,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      file_size: file.size,
    })

    if (insert.error) {
      await supabase.storage.from('school-attachments').remove([path])
      throw insert.error
    }
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim() || !entryDate) return

    setSaving(true)
    setError('')

    const result = await supabase.rpc('save_school_entry_v2', {
      p_entry_id: editingId,
      p_household_id: household.id,
      p_title: title.trim(),
      p_category_id: categoryId || null,
      p_child_profile_id: childProfileId || null,
      p_entry_date: entryDate,
      p_all_day: allDay,
      p_start_time: allDay ? null : startTime,
      p_end_time: allDay ? null : endTime,
      p_location_text: locationText.trim() || null,
      p_notes: notes.trim() || null,
      p_add_to_calendar: addToCalendar,
      p_sync_task: syncTask,
    })

    if (result.error || !result.data) {
      setSaving(false)
      setError(result.error?.message ?? 'Could not save the School entry.')
      return
    }

    if (pendingFile) {
      try {
        await uploadAttachment(String(result.data), pendingFile)
      } catch (reason) {
        setSaving(false)
        setError(reason instanceof Error ? reason.message : 'The entry was saved, but the attachment could not be uploaded.')
        await load()
        return
      }
    }

    setSaving(false)
    setComposerOpen(false)
    resetComposer()
    await load()
  }

  const formatTime = (entry: SchoolEntry) => {
    if (entry.all_day) return 'All day'
    return (entry.start_time?.slice(0, 5) ?? '') + (entry.end_time ? ' – ' + entry.end_time.slice(0, 5) : '')
  }

  return (
    <div className="page school-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">SCHOOL & KITA</div>
          <h1>School & Kita</h1>
          <p className="page-subtitle">Keep school dates, Kita appointments, kids activities, locations and documents together, with optional Calendar synchronization.</p>
        </div>

        {canWrite && (
          <button className="primary-button compact" onClick={openComposer}>
            <Plus size={16} />
            Add entry
          </button>
        )}
      </div>

      {!access?.enabled && <div className="module-access-note">School & Kita is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !composerOpen && <div className="notice error">{error}</div>}

      <section className="school-summary-grid">
        <article
          className={selectedChild === 'all' ? 'list-card school-summary-card active' : 'list-card school-summary-card'}
          onClick={() => setSelectedChild('all')}
        >
          <span className="school-summary-icon"><GraduationCap size={18} /></span>
          <div>
            <span>All kids</span>
            <strong>{entries.filter((entry) => entry.entry_date >= todayKey()).length}</strong>
            <small>upcoming entries</small>
          </div>
        </article>

        {childProfiles.map((profile) => {
          const count = entries.filter((entry) => entry.child_profile_id === profile.id && entry.entry_date >= todayKey()).length

          return (
            <article
              className={selectedChild === profile.id ? 'list-card school-summary-card active' : 'list-card school-summary-card'}
              key={profile.id}
              onClick={() => setSelectedChild(profile.id)}
            >
              <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
              <div>
                <span>{firstName(profile.display_name)}</span>
                <strong>{count}</strong>
                <small>upcoming entries</small>
              </div>
            </article>
          )
        })}
      </section>

      <section className="school-entry-section">
        <header className="school-section-head">
          <div className="school-section-title-line">
            <span className="eyebrow">UPCOMING</span>
            <h2>{selectedChild === 'all' ? 'Kids overview' : firstName(profileById.get(selectedChild)?.display_name ?? 'Child')}</h2>
          </div>

          <Select
            className="school-child-filter"
            value={selectedChild}
            onChange={setSelectedChild}
            options={[
              { value: 'all', label: 'All kids' },
              ...childProfiles.map((profile) => ({
                value: profile.id,
                label: firstName(profile.display_name),
              })),
            ]}
            ariaLabel="Filter School entries by child"
          />
        </header>

        {upcomingEntries.length === 0 ? (
          <div className="list-card empty-state school-empty">
            <GraduationCap size={24} />
            <span className="empty-state-title">No upcoming School & Kita entries.</span>
            <span>{canWrite ? 'Add the first school, Kita, appointment or kids entry.' : 'Nothing is planned.'}</span>
          </div>
        ) : (
          <div className="school-entry-list">
            {upcomingEntries.map((entry) => {
              const category = entry.category_id ? categoryById.get(entry.category_id) : undefined
              const child = entry.child_profile_id ? profileById.get(entry.child_profile_id) : undefined
              const entryAttachments = attachments.filter((attachment) => attachment.school_entry_id === entry.id)

              return (
                <article className="list-card school-entry-card" key={entry.id}>
                  <div className="school-entry-date">
                    <strong>{new Date(entry.entry_date + 'T12:00:00').getDate()}</strong>
                    <span>{new Date(entry.entry_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' })}</span>
                  </div>

                  <div className="school-entry-main">
                    <div className="school-entry-title-row">
                      <h3>{entry.title}</h3>
                      {canWrite && (
                        <button type="button" className="icon-button compact-icon" aria-label={'Edit ' + entry.title} onClick={() => openEdit(entry)}>
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>

                    <div className="school-entry-meta">
                      {category && (
                        <span><i className="meta-dot" style={{ backgroundColor: categoryColor(category.color_key) }} />{category.name}</span>
                      )}
                      <span>{formatTime(entry)}</span>
                      {child && (
                        <span className="school-child-label">
                          <ProfileAvatar avatarPath={child.avatar_path} name={child.display_name} size="sm" />
                          {firstName(child.display_name)}
                        </span>
                      )}
                      {entry.location_text && <GoogleMapsLink location={entry.location_text} />}
                      {entry.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
                    </div>

                    {entry.notes && <p>{entry.notes}</p>}

                    {entryAttachments.length > 0 && (
                      <div className="school-attachment-list">
                        {entryAttachments.map((attachment) => {
                          const url = attachmentUrls[attachment.id]
                          return url ? (
                            <a href={url} target="_blank" rel="noreferrer" key={attachment.id}>
                              <Paperclip size={12} />
                              {attachment.file_name}
                            </a>
                          ) : null
                        })}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

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
          <form className="modal-card school-composer" onSubmit={saveEntry}>
            <header>
              <div>
                <span className="eyebrow">{editingId ? 'EDIT SCHOOL ENTRY' : 'NEW SCHOOL ENTRY'}</span>
                <h2>{editingId ? 'Edit entry' : 'Add School & Kita entry'}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close School entry form" onClick={() => {
                setComposerOpen(false)
                resetComposer()
              }}>
                <X size={18} />
              </button>
            </header>

            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Parent evening" autoFocus required />
            </label>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Category
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="No category"
                  options={[
                    { value: '', label: 'No category' },
                    ...categories.map((category) => ({
                      value: category.id,
                      label: category.name,
                      dotColor: categoryColor(category.color_key),
                    })),
                  ]}
                  ariaLabel="Choose School category"
                />
                <small className="field-hint">Manage available categories in Settings → Category availability.</small>
              </label>

              <label>
                Child
                <Select
                  value={childProfileId}
                  onChange={setChildProfileId}
                  placeholder="Household / no child"
                  options={[
                    { value: '', label: 'Household / no child' },
                    ...childProfiles.map((profile) => ({
                      value: profile.id,
                      label: firstName(profile.display_name),
                    })),
                  ]}
                  ariaLabel="Choose child"
                />
                <small className="field-hint">Optional.</small>
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Date
                <DatePicker value={entryDate} onChange={setEntryDate} format={household.date_format} ariaLabel="Choose School entry date" />
                <small className="field-hint">Required.</small>
              </label>

              <label>
                Location
                <input value={locationText} onChange={(event) => setLocationText(event.target.value)} placeholder="School, Kita or address" />
                {locationText.trim()
                  ? <GoogleMapsLink location={locationText} label="Open in Google Maps" className="field-map-link" />
                  : <small className="field-hint">Optional.</small>}
              </label>
            </div>

            <label className="school-all-day-control">
              <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
              <span>All-day entry</span>
            </label>

            {!allDay && (
              <div className="composer-grid-two time-range-row">
                <label>
                  Start time
                  <TimePicker value={startTime} onChange={setStartTime} />
                </label>
                <label>
                  End time
                  <TimePicker value={endTime} onChange={setEndTime} />
                </label>
              </div>
            )}

            <label>
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional details, things to bring, teacher information…" />
            </label>

            <label className="school-upload-field">
              <span><Upload size={14} />Photo or document</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={chooseFile} />
              <small>{pendingFile ? pendingFile.name : 'Optional. Photo, scan or PDF up to 10 MB.'}</small>
            </label>

            <div className="composer-option-list">
              <label className="composer-option">
                <input type="checkbox" checked={addToCalendar} onChange={(event) => setAddToCalendar(event.target.checked)} />
                <span>
                  <span>Add to shared Calendar</span>
                  <small>Creates or updates the linked Calendar event with the same date, category, child and location.</small>
                </span>
              </label>

              <label className="composer-option">
                <input type="checkbox" checked={syncTask} disabled={!canSyncTasks || !categoryId} onChange={(event) => setSyncTask(event.target.checked)} />
                <span>
                  <span>Show in Tasks</span>
                  <small>{canSyncTasks ? 'Creates or updates one linked household Task. A category is required.' : 'Tasks write access is required.'}</small>
                </span>
              </label>
            </div>

            {error && <div className="form-message error">{error}</div>}

            <button className="primary-button" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add entry'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
