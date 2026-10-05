import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { supabase } from '../../lib/supabase'
import { Select } from '../ui/Select'

type ModuleTypeRow = {
  id: string
  module_code: 'home_care' | 'life_admin'
  group_code: 'asset_type' | 'item_type'
  type_key: string
  label: string
  base_type: string | null
  sort_order: number
  active: boolean
  is_default: boolean
}

type TypeSection = {
  moduleCode: 'home_care' | 'life_admin'
  groupCode: 'asset_type' | 'item_type'
  title: string
  description: string
}

const sections: TypeSection[] = [
  {
    moduleCode: 'home_care',
    groupCode: 'asset_type',
    title: 'Home Care asset types',
    description: 'Controls the Type choices shown when adding or editing a Home Care asset.',
  },
  {
    moduleCode: 'life_admin',
    groupCode: 'item_type',
    title: 'Life Admin item types',
    description: 'Controls the Type choices shown in Life Admin. New types are assigned to one of the existing Life Admin sections.',
  },
]

const lifeAdminSections = [
  { value: 'document', label: 'Documents' },
  { value: 'contract', label: 'Contracts' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'subscription', label: 'Subscriptions' },
  { value: 'deadline', label: 'Deadlines' },
]

export function TypesSettings() {
  const { household } = useHousehold()
  const canWrite = household.role === 'owner' || household.role === 'admin'
  const [rows, setRows] = useState<ModuleTypeRow[]>([])
  const [draftNames, setDraftNames] = useState<Record<string,string>>({})
  const [draftBases, setDraftBases] = useState<Record<string,string>>({
    life_admin: 'document',
  })
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setMessage('')

    const result = await supabase
      .from('household_module_types')
      .select('id,module_code,group_code,type_key,label,base_type,sort_order,active,is_default')
      .eq('household_id',household.id)
      .order('module_code')
      .order('group_code')
      .order('sort_order')
      .order('label')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setRows((result.data ?? []) as ModuleTypeRow[])
  }

  useEffect(() => { void load() }, [household.id])

  const rowsBySection = useMemo(() => {
    const map = new Map<string,ModuleTypeRow[]>()
    for (const section of sections) {
      const key = section.moduleCode + ':' + section.groupCode
      map.set(key,rows.filter((row) => row.module_code === section.moduleCode && row.group_code === section.groupCode))
    }
    return map
  }, [rows])

  async function createType(event: FormEvent,section: TypeSection) {
    event.preventDefault()
    if (!canWrite) return

    const key = section.moduleCode + ':' + section.groupCode
    const name = (draftNames[key] ?? '').trim()
    if (!name) return

    setBusyKey(key)
    setMessage('')

    const result = await supabase.rpc('save_household_module_type_v1',{
      p_household_id: household.id,
      p_module_code: section.moduleCode,
      p_group_code: section.groupCode,
      p_label: name,
      p_base_type: section.moduleCode === 'life_admin'
        ? (draftBases.life_admin || 'document')
        : null,
    })

    setBusyKey('')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setDraftNames((current) => ({ ...current,[key]: '' }))
    setMessage(name + ' added.')
    await load()
  }

  async function setActive(row: ModuleTypeRow,active: boolean) {
    if (!canWrite) return

    setBusyKey(row.id)
    setMessage('')

    const result = await supabase.rpc('set_household_module_type_active_v1',{
      p_id: row.id,
      p_household_id: household.id,
      p_active: active,
    })

    setBusyKey('')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setMessage(row.label + (active ? ' restored.' : ' removed.'))
    await load()
  }

  return (
    <div className="types-settings-page">
      <p className="settings-section-intro">
        Types are separate from Categories. Categories can be shared across modules; Types control the choices inside a specific module.
      </p>

      <div className="types-settings-grid">
        {sections.map((section) => {
          const key = section.moduleCode + ':' + section.groupCode
          const sectionRows = rowsBySection.get(key) ?? []
          const activeRows = sectionRows.filter((row) => row.active)
          const removedRows = sectionRows.filter((row) => !row.active)

          return (
            <section className="settings-card type-settings-card" key={key}>
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">{section.moduleCode === 'home_care' ? 'HOME CARE' : 'LIFE ADMIN'}</span>
                  <h2>{section.title}</h2>
                  <p>{section.description}</p>
                </div>
              </div>

              <div className="type-settings-list">
                {activeRows.map((row) => (
                  <div className="type-settings-row" key={row.id}>
                    <span className="type-settings-mark">{row.label.slice(0,1).toUpperCase()}</span>
                    <div>
                      <strong>{row.label}</strong>
                      <small>
                        {row.module_code === 'life_admin'
                          ? (lifeAdminSections.find((item) => item.value === row.base_type)?.label ?? 'Life Admin')
                          : row.is_default ? 'Default asset type' : 'Custom asset type'}
                      </small>
                    </div>

                    {canWrite && (
                      <button
                        type="button"
                        className="icon-button compact-icon"
                        aria-label={'Remove ' + row.label}
                        disabled={busyKey === row.id}
                        onClick={() => void setActive(row,false)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}

                {activeRows.length === 0 && (
                  <div className="type-settings-empty">No active types. Add one below.</div>
                )}
              </div>

              {canWrite && (
                <form className="type-settings-add" onSubmit={(event) => void createType(event,section)}>
                  <label>
                    New type
                    <input
                      value={draftNames[key] ?? ''}
                      onChange={(event) => setDraftNames((current) => ({ ...current,[key]: event.target.value }))}
                      placeholder={section.moduleCode === 'home_care' ? 'e.g. Solar equipment' : 'e.g. Membership'}
                    />
                  </label>

                  {section.moduleCode === 'life_admin' && (
                    <label>
                      Show under
                      <Select
                        value={draftBases.life_admin ?? 'document'}
                        onChange={(value) => setDraftBases((current) => ({ ...current,life_admin: value }))}
                        options={lifeAdminSections}
                        ariaLabel="Choose Life Admin section"
                      />
                    </label>
                  )}

                  <button className="primary-button compact" disabled={busyKey === key || !(draftNames[key] ?? '').trim()}>
                    <Plus size={14} />
                    {busyKey === key ? 'Adding…' : 'Add type'}
                  </button>
                </form>
              )}

              {removedRows.length > 0 && (
                <details className="type-settings-removed">
                  <summary>{removedRows.length} removed type{removedRows.length === 1 ? '' : 's'}</summary>
                  <div>
                    {removedRows.map((row) => (
                      <button type="button" key={row.id} disabled={!canWrite || busyKey === row.id} onClick={() => void setActive(row,true)}>
                        <RotateCcw size={13} />
                        {row.label}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </section>
          )
        })}
      </div>

      {message && <div className="form-message">{message}</div>}
    </div>
  )
}
