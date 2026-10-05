import { Archive, CalendarDays, ClipboardList, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { firstName } from '../lib/personName'
import { supabase } from '../lib/supabase'
import type { CalendarOccurrence, EventCategory } from '../lib/types'

type Checklist = {
  id: string
  title: string
  category_id: string | null
  due_date: string | null
  location_text: string | null
  linked_event_id: string | null
  linked_task_id: string | null
  status: 'active' | 'archived'
  archived_at: string | null
  created_at: string
}

type Item = { id: string; checklist_id: string; item_text: string; checked: boolean }
type ChecklistParticipant = { checklist_id: string; profile_id: string }
type TaskSource = {
  id: string
  title: string
  category_id: string | null
  due_date: string | null
  location_text: string | null
}

type ChecklistTemplate = {
  id: string
  name: string
  title: string
  category_id: string | null
  location_text: string | null
}

type SourceType = 'standalone' | 'event' | 'task'

function dateFromOccurrence(event: CalendarOccurrence) {
  if (event.occurrence_start_date) return event.occurrence_start_date
  if (event.occurrence_start_at) return event.occurrence_start_at.slice(0, 10)
  return ''
}

export function ChecklistsPage() {
  const { household, modules, profiles } = useHousehold()
  const canWrite = Boolean(modules.find((module) => module.code === 'checklists')?.can_write)

  const [lists, setLists] = useState<Checklist[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [participants, setParticipants] = useState<ChecklistParticipant[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [eventSources, setEventSources] = useState<CalendarOccurrence[]>([])
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [taskSources, setTaskSources] = useState<TaskSource[]>([])
  const [eventParticipants, setEventParticipants] = useState<{ event_id: string; profile_id: string }[]>([])
  const [taskParticipants, setTaskParticipants] = useState<{ task_id: string; profile_id: string }[]>([])
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({})
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null)
  const [sourceType, setSourceType] = useState<SourceType>('standalone')
  const [templateId, setTemplateId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [locationText, setLocationText] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [addToCalendar, setAddToCalendar] = useState(false)
  const [addToTask, setAddToTask] = useState(false)
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')

    const today = new Date().toISOString().slice(0, 10)
    const future = new Date()
    future.setDate(future.getDate() + 365)

    const [
      listResult,
      itemResult,
      participantResult,
      categoryResult,
      availabilityResult,
      eventResult,
      taskResult,
      eventParticipantResult,
      taskParticipantResult,
      templateResult,
    ] = await Promise.all([
      supabase
        .from('checklists')
        .select('id,title,category_id,due_date,location_text,linked_event_id,linked_task_id,status,archived_at,created_at')
        .eq('household_id', household.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('checklist_items')
        .select('id,checklist_id,item_text,checked')
        .eq('household_id', household.id)
        .order('sort_order'),
      supabase
        .from('checklist_participants')
        .select('checklist_id,profile_id')
        .eq('household_id', household.id),
      supabase
        .from('event_categories')
        .select('id,name,color_key')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('module_category_availability')
        .select('category_id,enabled')
        .eq('household_id', household.id)
        .eq('module_code', 'checklists'),
      supabase.rpc('calendar_occurrences_v1', {
        p_household_id: household.id,
        p_range_start: today,
        p_range_end: future.toISOString().slice(0, 10),
      }),
      supabase
        .from('tasks')
        .select('id,title,category_id,due_date,location_text')
        .eq('household_id', household.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('event_participants')
        .select('event_id,profile_id')
        .eq('household_id', household.id),
      supabase
        .from('task_participants')
        .select('task_id,profile_id')
        .eq('household_id', household.id),
      supabase
        .from('checklist_templates')
        .select('id,name,title,category_id,location_text')
        .eq('household_id', household.id)
        .eq('active', true)
        .order('name'),
    ])

    if (listResult.error) setError(listResult.error.message)
    else setLists((listResult.data ?? []) as Checklist[])

    if (itemResult.error) setError((current) => current || itemResult.error.message)
    else setItems((itemResult.data ?? []) as Item[])

    if (participantResult.error) setError((current) => current || participantResult.error.message)
    else setParticipants((participantResult.data ?? []) as ChecklistParticipant[])

    if (categoryResult.error || availabilityResult.error) {
      setError((current) => current || categoryResult.error?.message || availabilityResult.error?.message || 'Could not load checklist categories.')
    } else {
      const enabled = new Map((availabilityResult.data ?? []).map((row) => [row.category_id, row.enabled]))
      const rows = ((categoryResult.data ?? []) as EventCategory[])
        .filter((item) => enabled.get(item.id) ?? true)
      const allowed = rows.filter((item) => !['shopping', 'shoping'].includes(item.name.trim().toLowerCase()))
      setCategories(rows)
      setCategoryId((current) => allowed.some((item) => item.id === current) ? current : allowed[0]?.id ?? '')
    }

    if (!eventResult.error) {
      const unique = new Map<string, CalendarOccurrence>()
      for (const event of (eventResult.data ?? []) as CalendarOccurrence[]) {
        if (!unique.has(event.event_id)) unique.set(event.event_id, event)
      }
      setEventSources(Array.from(unique.values()))
    }

    if (!taskResult.error) setTaskSources((taskResult.data ?? []) as TaskSource[])
    if (!eventParticipantResult.error) setEventParticipants(eventParticipantResult.data ?? [])
    if (!taskParticipantResult.error) setTaskParticipants(taskParticipantResult.data ?? [])
    if (!templateResult.error) setTemplates((templateResult.data ?? []) as ChecklistTemplate[])
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

  const shoppingCategoryIds = useMemo(
    () => new Set(
      categories
        .filter((category) => ['shopping', 'shoping'].includes(category.name.trim().toLowerCase()))
        .map((category) => category.id),
    ),
    [categories],
  )

  const checklistCategories = useMemo(
    () => categories.filter((category) => !shoppingCategoryIds.has(category.id)),
    [categories, shoppingCategoryIds],
  )

  const allowedEventSources = useMemo(
    () => eventSources.filter((event) => !event.category_id || !shoppingCategoryIds.has(event.category_id)),
    [eventSources, shoppingCategoryIds],
  )

  const allowedTaskSources = useMemo(
    () => taskSources.filter((task) => !task.category_id || !shoppingCategoryIds.has(task.category_id)),
    [taskSources, shoppingCategoryIds],
  )

  const allowedTemplates = useMemo(
    () => templates.filter((template) => !template.category_id || !shoppingCategoryIds.has(template.category_id)),
    [templates, shoppingCategoryIds],
  )

  const activeLists = useMemo(
    () => lists.filter((list) => list.status === 'active' && (!list.category_id || !shoppingCategoryIds.has(list.category_id))),
    [lists, shoppingCategoryIds],
  )

  const archivedCount = useMemo(
    () => lists.filter((list) => list.status === 'archived' && (!list.category_id || !shoppingCategoryIds.has(list.category_id))).length,
    [lists, shoppingCategoryIds],
  )

  function resetComposer() {
    setEditingChecklistId(null)
    setSourceType('standalone')
    setTemplateId('')
    setSourceId('')
    setTitle('')
    setDueDate('')
    setLocationText('')
    setParticipantIds([])
    setAddToCalendar(false)
    setAddToTask(false)
    setSaveTemplate(false)
    setError('')
  }

  function openComposer() {
    resetComposer()
    setCategoryId(checklistCategories[0]?.id ?? '')
    setComposerOpen(true)
  }

  function openEdit(list: Checklist) {
    setEditingChecklistId(list.id)
    setSourceType('standalone')
    setTemplateId('')
    setSourceId('')
    setTitle(list.title)
    setCategoryId(
      list.category_id && !shoppingCategoryIds.has(list.category_id)
        ? list.category_id
        : checklistCategories[0]?.id ?? '',
    )
    setDueDate(list.due_date ?? '')
    setLocationText(list.location_text ?? '')
    setParticipantIds(
      participants
        .filter((item) => item.checklist_id === list.id)
        .map((item) => item.profile_id),
    )
    setAddToCalendar(false)
    setAddToTask(false)
    setSaveTemplate(false)
    setError('')
    setComposerOpen(true)
  }

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId)
    if (!nextTemplateId) return

    const template = allowedTemplates.find((item) => item.id === nextTemplateId)
    if (!template) return

    setTitle(template.title)
    setCategoryId(template.category_id ?? checklistCategories[0]?.id ?? '')
    setLocationText(template.location_text ?? '')
  }

  function applySource(nextType: SourceType, nextId: string) {
    setSourceType(nextType)
    setSourceId(nextId)
    setAddToCalendar(false)
    setAddToTask(false)
    setSaveTemplate(false)

    if (nextType === 'event') {
      const event = allowedEventSources.find((item) => item.event_id === nextId)
      if (!event) return
      setTitle(event.title)
      setCategoryId(event.category_id ?? checklistCategories[0]?.id ?? '')
      setDueDate(dateFromOccurrence(event))
      setLocationText(event.location_text ?? '')
      setParticipantIds(eventParticipants.filter((item) => item.event_id === nextId).map((item) => item.profile_id))
      return
    }

    if (nextType === 'task') {
      const task = allowedTaskSources.find((item) => item.id === nextId)
      if (!task) return
      setTitle(task.title)
      setCategoryId(task.category_id ?? checklistCategories[0]?.id ?? '')
      setDueDate(task.due_date ?? '')
      setLocationText(task.location_text ?? '')
      setParticipantIds(taskParticipants.filter((item) => item.task_id === nextId).map((item) => item.profile_id))
    }
  }

  async function saveList(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim() || !categoryId) return

    if (shoppingCategoryIds.has(categoryId)) {
      setError('Shopping lists belong in the Shopping module. Choose another category.')
      return
    }

    if (!editingChecklistId && sourceType === 'standalone' && addToCalendar && !dueDate) {
      setError('Choose a date before adding this checklist to Calendar.')
      return
    }

    setSaving(true)
    setError('')

    const participantPayload = participantIds.map((profileId) => ({ profile_id: profileId }))

    const result = editingChecklistId
      ? await supabase.rpc('update_checklist_v1', {
          p_checklist_id: editingChecklistId,
          p_household_id: household.id,
          p_title: title.trim(),
          p_category_id: categoryId,
          p_due_date: dueDate || null,
          p_location_text: locationText.trim() || null,
          p_participants: participantPayload,
        })
      : await supabase.rpc('create_checklist_v1', {
          p_household_id: household.id,
          p_title: title.trim(),
          p_category_id: categoryId,
          p_due_date: dueDate || null,
          p_location_text: locationText.trim() || null,
          p_participants: participantPayload,
          p_linked_event_id: sourceType === 'event' ? sourceId || null : null,
          p_linked_task_id: sourceType === 'task' ? sourceId || null : null,
          p_add_to_calendar: sourceType === 'standalone' ? addToCalendar : false,
          p_add_to_task: sourceType === 'standalone' ? addToTask : false,
          p_create_template: sourceType === 'standalone' ? saveTemplate : false,
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
    if (!canWrite) return

    const checked = !item.checked
    const user = (await supabase.auth.getUser()).data.user
    const result = await supabase.from('checklist_items').update({
      checked,
      checked_at: checked ? new Date().toISOString() : null,
      checked_by_user_id: checked ? user?.id ?? null : null,
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)

    if (result.error) setError(result.error.message)
    else await load()
  }

  async function setArchived(list: Checklist, archived: boolean) {
    if (!canWrite) return

    setError('')
    const result = await supabase.rpc('set_checklist_archived_v1', {
      p_checklist_id: list.id,
      p_household_id: household.id,
      p_archived: archived,
    })

    if (result.error) setError(result.error.message)
    else await load()
  }

  function renderChecklistCard(list: Checklist) {
    const listItems = items.filter((item) => item.checklist_id === list.id)
    const category = list.category_id ? categoryById.get(list.category_id) : undefined
    const shoppingLegacy = Boolean(list.category_id && shoppingCategoryIds.has(list.category_id))
    const listProfiles = participants
      .filter((item) => item.checklist_id === list.id)
      .map((item) => profileById.get(item.profile_id))
      .filter(Boolean)

    return (
      <article className="list-card checklist-card" key={list.id}>
        <header>
          <div>
            <h2>{list.title}</h2>
            <div className="checklist-meta">
              {category && <span><i className="meta-dot" style={{ backgroundColor: categoryColor(category.color_key) }} />{category.name}</span>}
              {list.due_date && <span>{list.due_date}</span>}
              {list.location_text && <GoogleMapsLink location={list.location_text} />}
              {list.linked_event_id && <span><CalendarDays size={11} />Calendar</span>}
              {list.linked_task_id && <span><ClipboardList size={11} />Task</span>}
            </div>
          </div>

          <div className="checklist-card-controls">
            {canWrite && (
              <>
                <button type="button" className="icon-button compact-icon" aria-label={'Edit ' + list.title} onClick={() => openEdit(list)}>
                  <Pencil size={14} />
                </button>
                <button type="button" className="icon-button compact-icon" aria-label={'Archive ' + list.title} onClick={() => void setArchived(list, true)}>
                  <Archive size={14} />
                </button>
              </>
            )}
            <small>{listItems.filter((item) => item.checked).length}/{listItems.length}</small>
          </div>
        </header>

        {shoppingLegacy && (
          <div className="checklist-shopping-warning">
            This older checklist uses the Shopping category. Shopping items now belong in the Shopping module. Edit this checklist and choose another category, or archive it.
          </div>
        )}

        {listProfiles.length > 0 && (
          <div className="checklist-participants">
            {listProfiles.map((profile) => profile && (
              <span className="participant-badge" key={profile.id}>
                <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
                <span>{firstName(profile.display_name)}</span>
              </span>
            ))}
          </div>
        )}

        <>
            <div className="checklist-items">
              {listItems.map((item) => (
                <button
                  className={item.checked ? 'checklist-item checked' : 'checklist-item'}
                  key={item.id}
                  onClick={() => void toggle(item)}
                  disabled={!canWrite}
                >
                  <span>{item.checked ? '✓' : ''}</span>{item.item_text}
                </button>
              ))}
            </div>

            {canWrite && !shoppingLegacy && (
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
                <button className="secondary-button compact" onClick={() => void addItem(list.id)}>Add item</button>
              </div>
            )}
        </>
      </article>
    )
  }

  return (
    <div className="page checklists-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">CHECKLISTS</div>
          <h1>Shared checklists</h1>
          <p className="page-subtitle">Checklists are for reusable steps and shared to-do lists. Grocery and shopping lists stay in the Shopping module.</p>
        </div>

        {canWrite && (
          <button className="primary-button compact" onClick={openComposer}>
            <Plus size={16} />
            Create checklist
          </button>
        )}
      </div>

      {!canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !composerOpen && <div className="notice error">{error}</div>}

      <section className="checklist-grid">
        {activeLists.length === 0 ? (
          <div className="list-card empty-state">
            <span className="empty-state-title">No active checklists.</span>
            <span>{canWrite ? 'Create the first shared checklist.' : 'There are no checklists to show.'}</span>
          </div>
        ) : activeLists.map((list) => renderChecklistCard(list))}
      </section>

      <div className="archive-repository-bar">
        <Link
          className="secondary-button compact archive-repository-button"
          to="/app/checklists/archive"
        >
          <Archive size={14} />
          Archived checklists
          <span>{archivedCount}</span>
        </Link>
      </div>

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
          <form className="modal-card checklist-composer" onSubmit={saveList}>
            <header>
              <div>
                <span className="eyebrow">{editingChecklistId ? 'EDIT CHECKLIST' : 'NEW CHECKLIST'}</span>
                <h2>{editingChecklistId ? 'Edit checklist' : 'Create checklist'}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close checklist form"
                onClick={() => {
                  setComposerOpen(false)
                  resetComposer()
                }}
              >
                <X size={18} />
              </button>
            </header>

            {!editingChecklistId && sourceType === 'standalone' && (
              <label>
                Saved template
                <Select
                  value={templateId}
                  onChange={applyTemplate}
                  placeholder="Blank checklist"
                  options={[
                    { value: '', label: 'Blank checklist' },
                    ...allowedTemplates.map((template) => ({
                      value: template.id,
                      label: template.name,
                    })),
                  ]}
                  ariaLabel="Choose checklist template"
                />
              </label>
            )}

            {!editingChecklistId && (
              <div className="composer-grid-two">
                <label>
                  Start from
                  <Select
                    value={sourceType}
                    onChange={(value) => {
                      const next = value as SourceType
                      setSourceType(next)
                      setSourceId('')
                      setAddToCalendar(false)
                      setAddToTask(false)
                      setSaveTemplate(false)
                      if (next === 'standalone') {
                        setTitle('')
                        setDueDate('')
                        setLocationText('')
                        setParticipantIds([])
                        setCategoryId(checklistCategories[0]?.id ?? '')
                      }
                    }}
                    options={[
                      { value: 'standalone', label: 'New standalone checklist' },
                      { value: 'event', label: 'Existing calendar event' },
                      { value: 'task', label: 'Existing task' },
                    ]}
                    ariaLabel="Checklist source"
                  />
                </label>

                {sourceType !== 'standalone' && (
                  <label>
                    {sourceType === 'event' ? 'Calendar event' : 'Task'}
                    <Select
                      value={sourceId}
                      onChange={(value) => applySource(sourceType, value)}
                      placeholder={sourceType === 'event' ? 'Choose event…' : 'Choose task…'}
                      options={(sourceType === 'event' ? allowedEventSources : allowedTaskSources).map((item) => ({
                        value: sourceType === 'event' ? (item as CalendarOccurrence).event_id : (item as TaskSource).id,
                        label: item.title,
                      }))}
                      ariaLabel={sourceType === 'event' ? 'Choose calendar event' : 'Choose task'}
                    />
                  </label>
                )}
              </div>
            )}

            <div className="composer-grid-two">
              <label>
                Checklist name
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </label>

              <label>
                Category
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  options={checklistCategories.map((item) => ({
                    value: item.id,
                    label: item.name,
                    dotColor: categoryColor(item.color_key),
                  }))}
                  ariaLabel="Choose checklist category"
                />
                <small className="field-hint">Shopping is managed separately in the Shopping module.</small>
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Date
                <DatePicker
                  value={dueDate}
                  onChange={setDueDate}
                  format={household.date_format}
                  ariaLabel="Choose checklist date"
                />
                <small className="field-hint">Optional unless this checklist is added to Calendar.</small>
              </label>

              <label>
                Location
                <input value={locationText} onChange={(event) => setLocationText(event.target.value)} placeholder="Optional location" />
                {locationText.trim()
                  ? <GoogleMapsLink location={locationText} label="Open in Google Maps" className="field-map-link" />
                  : <small className="field-hint">Optional.</small>}
              </label>
            </div>

            <fieldset className="participant-fieldset">
              <legend>Participants</legend>
              <div className="profile-choice-grid profile-choice-grid-wide">
                {profiles.map((profile) => (
                  <label className="profile-choice profile-choice-plain" key={profile.id}>
                    <input
                      type="checkbox"
                      checked={participantIds.includes(profile.id)}
                      onChange={(event) => {
                        setParticipantIds((current) => event.target.checked
                          ? [...current, profile.id]
                          : current.filter((id) => id !== profile.id))
                      }}
                    />
                    <ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm" />
                    <span className="profile-choice-name">{firstName(profile.display_name)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {!editingChecklistId && sourceType === 'standalone' ? (
              <div className="composer-option-list">
                <label className="composer-option">
                  <input type="checkbox" checked={addToCalendar} onChange={(event) => setAddToCalendar(event.target.checked)} />
                  <span>
                    <span>Add to Calendar</span>
                    <small>Creates one all-day calendar event. A date is required.</small>
                  </span>
                </label>

                <label className="composer-option">
                  <input type="checkbox" checked={addToTask} onChange={(event) => setAddToTask(event.target.checked)} />
                  <span>
                    <span>Create a matching task</span>
                    <small>Creates one task and links this checklist to it.</small>
                  </span>
                </label>

                <label className="composer-option">
                  <input type="checkbox" checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />
                  <span>
                    <span>Save as checklist template</span>
                    <small>Reuse this checklist setup later.</small>
                  </span>
                </label>
              </div>
            ) : !editingChecklistId && sourceType !== 'standalone' ? (
              <div className="composer-source-note">
                This checklist is linked to an existing {sourceType === 'event' ? 'calendar event' : 'task'}, so Famioo will not create a duplicate task, event, or template.
              </div>
            ) : null}

            {error && <div className="form-message error">{error}</div>}

            <button className="primary-button" disabled={saving || (!editingChecklistId && sourceType !== 'standalone' && !sourceId)}>
              {saving ? 'Saving…' : editingChecklistId ? 'Save changes' : 'Create checklist'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
