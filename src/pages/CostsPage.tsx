import { Plus, Receipt, ShoppingBag, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DatePicker } from '../components/ui/DatePicker'
import { Select } from '../components/ui/Select'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type HouseholdCost = {
  id: string
  title: string
  amount: number
  currency: string
  cost_date: string
  cost_kind: 'regular' | 'additional'
  source_type: 'manual' | 'shopping'
  source_shopping_list_id: string | null
  notes: string | null
  created_at: string
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

export function CostsPage() {
  const { household, modules } = useHousehold()
  const access = modules.find((module) => module.code === 'costs')
  const canWrite = Boolean(access?.can_write)

  const [costs, setCosts] = useState<HouseholdCost[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [costDate, setCostDate] = useState(todayKey())
  const [kind, setKind] = useState<'regular' | 'additional'>('additional')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')

    const result = await supabase
      .from('household_costs')
      .select('id,title,amount,currency,cost_date,cost_kind,source_type,source_shopping_list_id,notes,created_at')
      .eq('household_id', household.id)
      .order('cost_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (result.error) setError(result.error.message)
    else setCosts((result.data ?? []) as HouseholdCost[])
  }

  useEffect(() => { void load() }, [household.id])

  const monthKey = todayKey().slice(0, 7)
  const monthTotal = useMemo(
    () => costs
      .filter((cost) => cost.cost_date.startsWith(monthKey))
      .reduce((sum, cost) => sum + Number(cost.amount), 0),
    [costs, monthKey],
  )

  function resetComposer() {
    setTitle('')
    setAmount('')
    setCostDate(todayKey())
    setKind('additional')
    setNotes('')
    setError('')
  }

  async function createCost(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !title.trim()) return

    const normalized = amount.trim().replace(',', '.')
    const numericAmount = Number(normalized)

    if (!normalized || !Number.isFinite(numericAmount) || numericAmount < 0) {
      setError('Enter a valid amount.')
      return
    }

    setSaving(true)
    setError('')

    const result = await supabase.from('household_costs').insert({
      household_id: household.id,
      title: title.trim(),
      amount: numericAmount,
      currency: 'EUR',
      cost_date: costDate,
      cost_kind: kind,
      source_type: 'manual',
      notes: notes.trim() || null,
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

  return (
    <div className="page costs-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">HOUSEHOLD COSTS</div>
          <h1>Household costs</h1>
          <p className="page-subtitle">Regular and additional household spending. Archived Shopping lists can send their final cost here automatically.</p>
        </div>

        {canWrite && (
          <button className="primary-button compact" onClick={() => setComposerOpen(true)}>
            <Plus size={16} />
            Add cost
          </button>
        )}
      </div>

      {!access?.enabled && <div className="module-access-note">Household Costs is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !composerOpen && <div className="notice error">{error}</div>}

      <section className="cost-summary-grid">
        <article className="list-card cost-summary-card">
          <span>This month</span>
          <strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(monthTotal)}</strong>
          <small>{costs.filter((cost) => cost.cost_date.startsWith(monthKey)).length} entries</small>
        </article>

        <article className="list-card cost-summary-card">
          <span>Total entries</span>
          <strong>{costs.length}</strong>
          <small>Manual and Shopping costs</small>
        </article>
      </section>

      <section className="list-card cost-list">
        {costs.length === 0 ? (
          <div className="empty-state">
            <Receipt size={24} />
            <span className="empty-state-title">No household costs yet.</span>
            <span>Manual costs and completed Shopping trips will appear here.</span>
          </div>
        ) : costs.map((cost) => (
          <div className="cost-row" key={cost.id}>
            <span className="cost-source-icon">
              {cost.source_type === 'shopping' ? <ShoppingBag size={15} /> : <Receipt size={15} />}
            </span>
            <span className="cost-main-copy">
              <span>{cost.title}</span>
              <small>{cost.cost_date} · {cost.cost_kind === 'regular' ? 'Regular' : 'Additional'}{cost.source_type === 'shopping' ? ' · Shopping' : ''}</small>
            </span>
            <strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency: cost.currency || 'EUR' }).format(Number(cost.amount))}</strong>
          </div>
        ))}
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
          <form className="modal-card cost-composer" onSubmit={createCost}>
            <header>
              <div>
                <span className="eyebrow">NEW COST</span>
                <h2>Add household cost</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close cost form" onClick={() => {
                setComposerOpen(false)
                resetComposer()
              }}>
                <X size={18} />
              </button>
            </header>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Name
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Electricity bill" autoFocus required />
                <small className="field-hint">Required.</small>
              </label>

              <label>
                Amount
                <div className="money-input">
                  <span>€</span>
                  <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
                </div>
                <small className="field-hint">Required.</small>
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Date
                <DatePicker value={costDate} onChange={setCostDate} format={household.date_format} ariaLabel="Choose cost date" />
                <small className="field-hint">Date the cost occurred.</small>
              </label>

              <label>
                Type
                <Select
                  value={kind}
                  onChange={(value) => setKind(value as typeof kind)}
                  options={[
                    { value: 'additional', label: 'Additional' },
                    { value: 'regular', label: 'Regular' },
                  ]}
                  ariaLabel="Choose cost type"
                />
                <small className="field-hint">Regular or additional household cost.</small>
              </label>
            </div>

            <label>
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes" rows={3} />
            </label>

            {error && <div className="form-message error">{error}</div>}

            <button className="primary-button" disabled={saving}>
              {saving ? 'Saving…' : 'Add cost'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
