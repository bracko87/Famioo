import { AlertTriangle, Edit3, Phone, Plus, ShieldAlert, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import '../emergency-services.css'

type DirectoryContact = {
  id: string
  contact_type: string
  display_name: string
  relation_label: string | null
  organisation: string | null
  phone: string | null
  secondary_phone: string | null
  email: string | null
  address_line: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  website: string | null
  notes: string | null
  is_favourite: boolean
  is_emergency: boolean
}

type ServiceDraft = {
  display_name: string
  organisation: string
  phone: string
  secondary_phone: string
  notes: string
}

const blankDraft: ServiceDraft = {
  display_name: '',
  organisation: '',
  phone: '',
  secondary_phone: '',
  notes: '',
}

function isEmergencyService(contact: DirectoryContact) {
  // An emergency-flagged relative or babysitter stays in Family Contacts.
  return contact.contact_type === 'emergency'
    || (contact.contact_type === 'service' && contact.is_emergency)
}

function validNumber(value: string) {
  return !value || (value.length <= 32 && /^[+]?[0-9 ()/.-]+$/.test(value) && /[0-9]/.test(value))
}

/**
 * Directory of public emergency services only. The legacy per-person medical
 * records and guardian assignments remain in the database, but are not shown
 * or modified here. Phone numbers are chosen by the household, not guessed
 * from the browser locale (emergency numbers differ between countries).
 */
export function EmergencyPage() {
  const { household, modules } = useHousehold()
  const canWrite = Boolean(
    modules.find(module => module.code === 'contacts')?.can_write
    ?? modules.find(module => module.code === 'emergency_info')?.can_write
  )

  const [contacts, setContacts] = useState<DirectoryContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<DirectoryContact | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<ServiceDraft>(blankDraft)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  const load = useCallback(async () => {
    const result = await supabase.rpc('family_contacts_v1', { p_household_id: household.id })
    if (result.error) setError(result.error.message)
    else {
      setContacts((result.data ?? []) as DirectoryContact[])
      setError('')
    }
    setLoading(false)
  }, [household.id])

  useEffect(() => { void load() }, [load])

  const services = useMemo(() => contacts
    .filter(isEmergencyService)
    .sort((a, b) => a.display_name.localeCompare(b.display_name)),
  [contacts])

  function addService() {
    setEditing(null)
    setDraft({ ...blankDraft })
    setError('')
    setMessage('')
    setEditorOpen(true)
  }

  function editService(service: DirectoryContact) {
    setEditing(service)
    setDraft({
      display_name: service.display_name,
      organisation: service.organisation ?? '',
      phone: service.phone ?? '',
      secondary_phone: service.secondary_phone ?? '',
      notes: service.notes ?? '',
    })
    setError('')
    setMessage('')
    setEditorOpen(true)
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = draft.display_name.trim()
    const phone = draft.phone.trim()
    const secondary = draft.secondary_phone.trim()
    if (!name || (!phone && !secondary) || !validNumber(phone) || !validNumber(secondary)) {
      setError('Enter a service name and at least one valid phone number.')
      return
    }
    setSaving(true)
    setError('')
    const result = await supabase.rpc('save_family_contact_v1', {
      p_household_id: household.id,
      p_id: editing?.id ?? null,
      p_contact_type: editing?.contact_type ?? 'emergency',
      p_display_name: name,
      p_relation_label: editing?.relation_label ?? null,
      p_organisation: draft.organisation.trim() || null,
      p_phone: phone || null,
      p_secondary_phone: secondary || null,
      p_email: editing?.email ?? null,
      p_address_line: editing?.address_line ?? null,
      p_postal_code: editing?.postal_code ?? null,
      p_city: editing?.city ?? null,
      p_country: editing?.country ?? null,
      p_website: editing?.website ?? null,
      p_notes: draft.notes.trim() || null,
      p_is_favourite: editing?.is_favourite ?? false,
      p_is_emergency: true,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setEditorOpen(false)
    setMessage(editing ? 'Emergency service updated.' : 'Emergency service added.')
    await load()
  }

  async function removeService(service: DirectoryContact) {
    if (!window.confirm('Remove ' + service.display_name + ' from the shared emergency numbers directory?')) return
    setDeletingId(service.id)
    setError('')
    const result = await supabase.rpc('archive_family_contact_v1', {
      p_household_id: household.id,
      p_id: service.id,
    })
    setDeletingId('')
    if (result.error) {
      setError(result.error.message)
      return
    }
    setMessage('Emergency service removed from the directory.')
    await load()
  }

  return (
    <div className="page emergency-services-page">
      <div className="page-heading-row services-heading">
        <div>
          <span className="eyebrow">MEDICAL & SAFETY</span>
          <h1>Emergency numbers</h1>
          <p>Police, ambulance, fire brigade and other emergency services — ready to call.</p>
        </div>
        {canWrite && <button type="button" className="primary-button compact" onClick={addService}>
          <Plus size={16} /> Add service
        </button>}
      </div>

      <div className="services-disclaimer">
        <AlertTriangle size={19} />
        <span>Only call numbers verified for your country or region. Famioo does not automatically contact emergency services.</span>
      </div>

      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}

      {loading ? <div className="services-empty">Loading emergency numbers…</div>
        : services.length === 0 ? (
          <div className="services-empty">
            <ShieldAlert size={30} />
            <h2>No emergency numbers saved yet</h2>
            <p>Add the official ambulance, police, fire brigade or other emergency service numbers for your location.</p>
            {canWrite && <button type="button" className="primary-button compact" onClick={addService}>
              <Plus size={16} /> Add emergency number
            </button>}
          </div>
        ) : (
          <section className="services-directory" aria-label="Emergency services phone numbers">
            {services.map(service => (
              <article className="services-card" key={service.id}>
                <div className="services-card-top">
                  <span className="services-card-symbol"><ShieldAlert size={22}/></span>
                  <div className="services-card-title">
                    <strong>{service.display_name}</strong>
                    {service.organisation && <small>{service.organisation}</small>}
                  </div>
                </div>
                {service.notes && <p className="services-card-notes">{service.notes}</p>}
                <div className="services-phone-list">
                  {service.phone && <a className="services-call-button" href={'tel:' + service.phone}>
                    <Phone size={17}/><span>Call {service.phone}</span>
                  </a>}
                  {service.secondary_phone && <a className="services-call-button alternate" href={'tel:' + service.secondary_phone}>
                    <Phone size={17}/><span>Call {service.secondary_phone}</span>
                  </a>}
                </div>
                {canWrite && <div className="services-edit-actions">
                  <button type="button" onClick={() => editService(service)}><Edit3 size={14}/> Edit</button>
                  <button type="button" disabled={deletingId === service.id} onClick={() => void removeService(service)}>
                    <Trash2 size={14}/> Remove
                  </button>
                </div>}
              </article>
            ))}
          </section>
        )}

      {editorOpen && <div className="modal-backdrop services-modal-backdrop" role="dialog" aria-modal="true" aria-label={editing ? 'Edit emergency service' : 'Add emergency service'}>
        <section className="modal-card services-editor">
          <header>
            <div><span className="eyebrow">EMERGENCY NUMBER</span><h2>{editing ? 'Edit service' : 'Add emergency service'}</h2></div>
            <button type="button" className="icon-button" aria-label="Close" onClick={() => setEditorOpen(false)}><X size={18}/></button>
          </header>
          <form onSubmit={event => void saveService(event)}>
            <label><span>Service name *</span><input required autoFocus value={draft.display_name} onChange={event => setDraft(current => ({ ...current, display_name: event.target.value }))} placeholder="e.g. Ambulance, Police, Fire brigade"/></label>
            <label><span>Organisation (optional)</span><input value={draft.organisation} onChange={event => setDraft(current => ({ ...current, organisation: event.target.value }))} placeholder="Local agency"/></label>
            <div className="services-form-row">
              <label><span>Phone number</span><input type="tel" value={draft.phone} onChange={event => setDraft(current => ({ ...current, phone: event.target.value }))} placeholder="Official emergency number" maxLength={32}/></label>
              <label><span>Alternative number</span><input type="tel" value={draft.secondary_phone} onChange={event => setDraft(current => ({ ...current, secondary_phone: event.target.value }))} placeholder="Optional" maxLength={32}/></label>
            </div>
            <label><span>Notes (optional)</span><textarea rows={2} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} placeholder="When to use this number"/></label>
            <p className="services-form-hint">Enter at least one verified phone number. Service contacts are shared with Family Contacts and the SOS setup.</p>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save service'}</button>
            </footer>
          </form>
        </section>
      </div>}
    </div>
  )
}
