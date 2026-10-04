import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useHousehold } from '../../context/HouseholdContext'
import { categoryColor, categoryColorOptions } from '../../lib/categoryColors'
import { supabase } from '../../lib/supabase'

type CategoryRow = {
  id: string
  name: string
  color_key: string
  is_system: boolean
  sort_order: number
}

export function CategoriesSettings() {
  const { household, modules, user } = useHousehold()
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [name, setName] = useState('')
  const [colorKey, setColorKey] = useState('purple')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const calendarModule = modules.find((module) => module.code === 'calendar')
  const canWrite = Boolean(calendarModule?.can_write)

  const nextSortOrder = useMemo(() => {
    return (categories.reduce((max, item) => Math.max(max, item.sort_order), 0) || 0) + 10
  }, [categories])

  async function loadCategories() {
    const result = await supabase
      .from('event_categories')
      .select('id,name,color_key,is_system,sort_order')
      .eq('household_id', household.id)
      .eq('active', true)
      .order('sort_order')
      .order('name')

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setCategories((result.data ?? []) as CategoryRow[])
  }

  useEffect(() => {
    void loadCategories()
  }, [household.id])

  async function createCategory(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !name.trim()) return

    setBusy(true)
    setMessage('')

    const result = await supabase.from('event_categories').insert({
      household_id: household.id,
      name: name.trim(),
      color_key: colorKey,
      icon_key: 'custom',
      sort_order: nextSortOrder,
      is_system: false,
      created_by_user_id: user.id,
    })

    setBusy(false)

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setName('')
    setColorKey('purple')
    setMessage('Category created.')
    await loadCategories()
  }

  async function removeCategory(category: CategoryRow) {
    if (!canWrite || category.is_system) return

    setMessage('')
    const result = await supabase
      .from('event_categories')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', category.id)

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    await loadCategories()
  }

  return (
    <div className="category-settings-layout">
      <section className="settings-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">CATEGORIES</span>
            <h2>Calendar categories</h2>
            <p>These categories are used when creating calendar events.</p>
          </div>
        </div>

        <div className="category-list">
          {categories.map((category) => (
            <div className="category-row" key={category.id}>
              <span
                className="category-dot"
                style={{ backgroundColor: categoryColor(category.color_key) }}
              />
              <span className="category-name">
                <strong>{category.name}</strong>
                <small>{category.is_system ? 'Default category' : 'Custom category'}</small>
              </span>
              <span className="category-color-label">{category.color_key}</span>
              {canWrite && !category.is_system ? (
                <button
                  className="icon-button category-delete"
                  type="button"
                  aria-label={'Remove ' + category.name}
                  onClick={() => void removeCategory(category)}
                >
                  <Trash2 size={14} />
                </button>
              ) : <span />}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card add-category-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">NEW CATEGORY</span>
            <h2>Create category</h2>
          </div>
        </div>

        {canWrite ? (
          <form className="add-category-form" onSubmit={createCategory}>
            <label>
              Category name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Music lesson" required />
            </label>

            <label>
              Color
              <select value={colorKey} onChange={(event) => setColorKey(event.target.value)}>
                {categoryColorOptions.map((color) => (
                  <option value={color.key} key={color.key}>{color.label}</option>
                ))}
              </select>
            </label>

            <div className="category-color-preview">
              <span style={{ backgroundColor: categoryColor(colorKey) }} />
              <strong>{name.trim() || 'New category'}</strong>
            </div>

            <button className="primary-button" disabled={busy}>
              <Plus size={16} />
              {busy ? 'Creating…' : 'Create category'}
            </button>
          </form>
        ) : (
          <div className="module-access-note">Read-only access</div>
        )}
      </section>

      {message && <div className="form-message category-message">{message}</div>}
    </div>
  )
}
