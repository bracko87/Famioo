import { CalendarClock, Plus, Receipt, ShoppingBag, WalletCards, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DatePicker } from '../components/ui/DatePicker'
import { Select } from '../components/ui/Select'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type CostRange = 'week' | 'month' | 'year' | 'all'
type ScheduleType = 'one_time' | 'scheduled'
type CostFlow = 'expense' | 'income'
type CostFilterPeriod = 'all' | 'week' | 'month' | 'year'

type HouseholdCost = {
  id: string
  title: string
  amount: number
  currency: string
  cost_date: string
  cost_kind: 'regular' | 'additional'
  source_type: 'manual' | 'shopping' | 'shopping_receipt' | 'task' | 'home_care' | 'life_admin' | 'projects' | 'vehicle' | 'pet'
  source_shopping_list_id: string | null
  source_task_id: string | null
  source_home_care_activity_id: string | null
  schedule_type: ScheduleType
  schedule_day: number | null
  schedule_interval_months: number
  flow_type: CostFlow
  notes: string | null
  created_at: string
}

type FinanceSettings = {
  household_id: string
  monthly_income: number | null
  monthly_budget: number | null
  currency: string
}

type CostOccurrence = {
  key: string
  cost: HouseholdCost
  date: string
  amount: number
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function fromKey(value: string) {
  return new Date(value + 'T12:00:00')
}

function todayKey() {
  return dateKey(new Date())
}

function startOfWeek(date: Date, mondayFirst: boolean) {
  const next = new Date(date)
  next.setHours(12, 0, 0, 0)
  const offset = mondayFirst ? (next.getDay() + 6) % 7 : next.getDay()
  next.setDate(next.getDate() - offset)
  return next
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function money(amount: number, currency = 'EUR') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function CostsPage() {
  const { household, modules } = useHousehold()
  const access = modules.find((module) => module.code === 'costs')
  const canWrite = Boolean(access?.can_write)
  const mondayFirst = household.week_starts_on === 1

  const [costs, setCosts] = useState<HouseholdCost[]>([])
  const [finance, setFinance] = useState<FinanceSettings | null>(null)
  const [range, setRange] = useState<CostRange>('month')
  const [listSource, setListSource] = useState('all')
  const [listTiming, setListTiming] = useState('all')
  const [listFlow, setListFlow] = useState('all')
  const [listPeriod, setListPeriod] = useState<CostFilterPeriod>('all')
  const [listPage, setListPage] = useState(1)
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [costDate, setCostDate] = useState(todayKey())
  const [scheduleType, setScheduleType] = useState<ScheduleType>('one_time')
  const [notes, setNotes] = useState('')
  const [incomeDraft, setIncomeDraft] = useState('')
  const [budgetDraft, setBudgetDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingFinance, setSavingFinance] = useState(false)
  const [error, setError] = useState('')
  const [mobilePanel,setMobilePanel]=useState<'plan'|'entries'|null>(null)

  async function load() {
    setError('')

    const [costResult, financeResult] = await Promise.all([
      supabase
        .from('household_costs')
        .select('id,title,amount,currency,cost_date,cost_kind,source_type,source_shopping_list_id,source_task_id,source_home_care_activity_id,source_home_care_asset_id,source_life_admin_item_id,schedule_type,schedule_day,schedule_interval_months,flow_type,notes,created_at')
        .eq('household_id', household.id)
        .order('cost_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('household_finance_settings')
        .select('household_id,monthly_income,monthly_budget,currency')
        .eq('household_id', household.id)
        .maybeSingle(),
    ])

    if (costResult.error) setError(costResult.error.message)
    else setCosts((costResult.data ?? []) as HouseholdCost[])

    if (financeResult.error) {
      setError((current) => current || financeResult.error.message)
    } else {
      const nextFinance = financeResult.data as FinanceSettings | null
      setFinance(nextFinance)
      setIncomeDraft(nextFinance?.monthly_income != null ? String(nextFinance.monthly_income) : '')
      setBudgetDraft(nextFinance?.monthly_budget != null ? String(nextFinance.monthly_budget) : '')
    }
  }

  useEffect(() => { void load() }, [household.id])

  const rangeBounds = useMemo(() => {
    const now = new Date()
    now.setHours(12, 0, 0, 0)

    if (range === 'week') {
      const start = startOfWeek(now, mondayFirst)
      return { start: dateKey(start), end: dateKey(addDays(start, 6)) }
    }

    if (range === 'month') {
      return {
        start: dateKey(new Date(now.getFullYear(), now.getMonth(), 1, 12)),
        end: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0, 12)),
      }
    }

    if (range === 'year') {
      return {
        start: dateKey(new Date(now.getFullYear(), 0, 1, 12)),
        end: dateKey(new Date(now.getFullYear(), 11, 31, 12)),
      }
    }

    const earliest = costs.length
      ? costs.reduce((min, cost) => cost.cost_date < min ? cost.cost_date : min, costs[0].cost_date)
      : dateKey(new Date(now.getFullYear(), 0, 1, 12))

    return {
      start: earliest,
      end: dateKey(new Date(now.getFullYear(), 11, 31, 12)),
    }
  }, [range, costs, mondayFirst])

  const occurrences = useMemo<CostOccurrence[]>(() => {
    const rows: CostOccurrence[] = []

    for (const cost of costs) {
      if (cost.schedule_type !== 'scheduled') {
        if (cost.cost_date >= rangeBounds.start && cost.cost_date <= rangeBounds.end) {
          rows.push({
            key: cost.id + ':' + cost.cost_date,
            cost,
            date: cost.cost_date,
            amount: Number(cost.amount),
          })
        }
        continue
      }

      const scheduleStart = fromKey(cost.cost_date)
      const rangeStart = fromKey(rangeBounds.start)
      const rangeEnd = fromKey(rangeBounds.end)
      const interval = Math.max(1,cost.schedule_interval_months ?? 1)
      const scheduleMonth = new Date(scheduleStart.getFullYear(),scheduleStart.getMonth(),1,12)
      const rangeMonth = new Date(rangeStart.getFullYear(),rangeStart.getMonth(),1,12)
      const monthsToRange = Math.max(0,(rangeMonth.getFullYear() - scheduleMonth.getFullYear()) * 12 + (rangeMonth.getMonth() - scheduleMonth.getMonth()))
      const stepsToRange = Math.ceil(monthsToRange / interval)
      const cursor = new Date(scheduleMonth)
      cursor.setMonth(cursor.getMonth() + stepsToRange * interval)

      const day = cost.schedule_day ?? scheduleStart.getDate()

      while (cursor <= rangeEnd) {
        const occurrenceDay = Math.min(day, lastDayOfMonth(cursor.getFullYear(), cursor.getMonth()))
        const occurrence = new Date(cursor.getFullYear(), cursor.getMonth(), occurrenceDay, 12)
        const occurrenceKey = dateKey(occurrence)

        if (occurrence >= scheduleStart && occurrenceKey >= rangeBounds.start && occurrenceKey <= rangeBounds.end) {
          rows.push({
            key: cost.id + ':' + occurrenceKey,
            cost,
            date: occurrenceKey,
            amount: Number(cost.amount),
          })
        }

        cursor.setMonth(cursor.getMonth() + Math.max(1, cost.schedule_interval_months ?? 1))
      }
    }

    return rows.sort((a, b) => a.date.localeCompare(b.date))
  }, [costs, rangeBounds])

  const periodTotal = useMemo(
    () => occurrences
      .filter((item) => item.cost.flow_type !== 'income')
      .reduce((sum, item) => sum + item.amount, 0),
    [occurrences],
  )

  const periodIncome = useMemo(
    () => occurrences
      .filter((item) => item.cost.flow_type === 'income')
      .reduce((sum, item) => sum + item.amount, 0),
    [occurrences],
  )

  const currentMonthBounds = useMemo(() => {
    const now = new Date()
    return {
      start: dateKey(new Date(now.getFullYear(), now.getMonth(), 1, 12)),
      end: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0, 12)),
    }
  }, [])

  const currentMonthSpend = useMemo(() => {
    const rows: CostOccurrence[] = []

    for (const cost of costs) {
      if (cost.schedule_type === 'scheduled') {
        const start = fromKey(cost.cost_date)
        const monthStart = fromKey(currentMonthBounds.start)
        if (start <= fromKey(currentMonthBounds.end)) {
          const day = Math.min(cost.schedule_day ?? start.getDate(), lastDayOfMonth(monthStart.getFullYear(), monthStart.getMonth()))
          const date = dateKey(new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 12))
          const monthsFromStart = (monthStart.getFullYear() - start.getFullYear()) * 12 + (monthStart.getMonth() - start.getMonth())
          const interval = Math.max(1, cost.schedule_interval_months ?? 1)
          if (
            monthsFromStart >= 0
            && monthsFromStart % interval === 0
            && date >= currentMonthBounds.start
            && date <= currentMonthBounds.end
            && fromKey(date) >= start
          ) {
            rows.push({ key: cost.id + ':' + date, cost, date, amount: Number(cost.amount) })
          }
        }
      } else if (cost.cost_date >= currentMonthBounds.start && cost.cost_date <= currentMonthBounds.end) {
        rows.push({ key: cost.id + ':' + cost.cost_date, cost, date: cost.cost_date, amount: Number(cost.amount) })
      }
    }

    return rows.filter((item) => item.cost.flow_type !== 'income').reduce((sum, item) => sum + item.amount, 0)
  }, [costs, currentMonthBounds])

  const monthlyLimit = finance?.monthly_budget ?? finance?.monthly_income ?? null
  const monthRemaining = monthlyLimit != null ? Number(monthlyLimit) - currentMonthSpend : null

  const chartBuckets = useMemo(() => {
    const map = new Map<string, number>()

    if (range === 'week' || range === 'month') {
      const start = fromKey(rangeBounds.start)
      const end = fromKey(rangeBounds.end)
      for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
        map.set(dateKey(cursor), 0)
      }

      for (const item of occurrences) {
        map.set(item.date, (map.get(item.date) ?? 0) + item.amount)
      }

      return Array.from(map.entries()).map(([key, value]) => ({
        key,
        label: fromKey(key).toLocaleDateString(undefined, range === 'week'
          ? { weekday: 'short' }
          : { day: 'numeric' }),
        value,
      }))
    }

    const start = fromKey(rangeBounds.start)
    const end = fromKey(rangeBounds.end)
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12)

    while (cursor <= end) {
      const key = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0')
      map.set(key, 0)
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12)
    }

    for (const item of occurrences) {
      const key = item.date.slice(0, 7)
      map.set(key, (map.get(key) ?? 0) + item.amount)
    }

    return Array.from(map.entries()).map(([key, value]) => ({
      key,
      label: new Date(key + '-01T12:00:00').toLocaleDateString(undefined, { month: 'short', year: range === 'all' ? '2-digit' : undefined }),
      value,
    }))
  }, [range, rangeBounds, occurrences])

  const chartMax = Math.max(1, ...chartBuckets.map((item) => item.value))

  const sourceBreakdown = useMemo(() => {
    const totals = new Map<string, number>([
      ['manual', 0],
      ['shopping', 0],
    ['shopping_receipt', 0],
      ['task', 0],
      ['home_care', 0],
      ['life_admin', 0],
      ['projects', 0],
      ['vehicle', 0],
      ['pet', 0],
    ])

    for (const occurrence of occurrences) {
      if (occurrence.cost.flow_type !== 'income') totals.set(occurrence.cost.source_type, (totals.get(occurrence.cost.source_type) ?? 0) + occurrence.amount)
    }

    return Array.from(totals.entries()).map(([key, value]) => ({
      key,
      label: key === 'shopping'
        ? 'Shopping'
        : key === 'task'
          ? 'Tasks'
          : key === 'home_care'
            ? 'Home Care'
            : key === 'life_admin'
              ? 'Life Admin'
              : key === 'projects'
                ? 'Projects & Chores'
                : key === 'vehicle'
                  ? 'Vehicles'
                  : key === 'pet'
                    ? 'Pets'
                    : 'Other costs',
      value,
    }))
  }, [occurrences])

  const sourceMax = Math.max(1, ...sourceBreakdown.map((item) => item.value))

  const timingBreakdown = useMemo(() => {
    const scheduled = occurrences
      .filter((item) => item.cost.flow_type !== 'income' && item.cost.schedule_type === 'scheduled')
      .reduce((sum, item) => sum + item.amount, 0)
    const oneTime = occurrences
      .filter((item) => item.cost.flow_type !== 'income' && item.cost.schedule_type !== 'scheduled')
      .reduce((sum, item) => sum + item.amount, 0)

    return [
      { key: 'scheduled', label: 'Scheduled', value: scheduled },
      { key: 'one_time', label: 'One-time', value: oneTime },
    ]
  }, [occurrences])

  const timingMax = Math.max(1, ...timingBreakdown.map((item) => item.value))

  const listPeriodBounds = useMemo(() => {
    if (listPeriod === 'all') return null

    const now = new Date()
    now.setHours(12,0,0,0)

    if (listPeriod === 'week') {
      const start = startOfWeek(now,mondayFirst)
      return { start: dateKey(start), end: dateKey(addDays(start,6)) }
    }

    if (listPeriod === 'month') {
      return {
        start: dateKey(new Date(now.getFullYear(),now.getMonth(),1,12)),
        end: dateKey(new Date(now.getFullYear(),now.getMonth()+1,0,12)),
      }
    }

    return {
      start: dateKey(new Date(now.getFullYear(),0,1,12)),
      end: dateKey(new Date(now.getFullYear(),11,31,12)),
    }
  }, [listPeriod,mondayFirst])

  const filteredCosts = useMemo(() => {
    return costs.filter((cost) => {
      if (listSource !== 'all' && cost.source_type !== listSource) return false
      if (listTiming !== 'all' && cost.schedule_type !== listTiming) return false
      if (listFlow !== 'all' && cost.flow_type !== listFlow) return false
      if (listPeriodBounds && (cost.cost_date < listPeriodBounds.start || cost.cost_date > listPeriodBounds.end)) return false
      return true
    })
  }, [costs,listSource,listTiming,listFlow,listPeriodBounds])

  const pageSize = 15
  const listPageCount = Math.max(1,Math.ceil(filteredCosts.length / pageSize))
  const visibleCosts = useMemo(
    () => filteredCosts.slice((listPage - 1) * pageSize,listPage * pageSize),
    [filteredCosts,listPage],
  )

  useEffect(() => {
    setListPage(1)
  }, [listSource,listTiming,listFlow,listPeriod])

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount)
  }, [listPage,listPageCount])

  function sourceLabel(source: HouseholdCost['source_type']) {
    if (source === 'shopping') return 'Shopping'
    if (source === 'shopping_receipt') return 'Shopping receipt'
    if (source === 'task') return 'Task'
    if (source === 'home_care') return 'Home Care'
    if (source === 'life_admin') return 'Life Admin'
    if (source === 'projects') return 'Projects & Chores'
    if (source === 'vehicle') return 'Vehicles'
    if (source === 'pet') return 'Pets'
    return 'Manual'
  }

  function scheduleLabel(cost: HouseholdCost) {
    if (cost.schedule_type !== 'scheduled') return 'One-time'
    const interval = Math.max(1,cost.schedule_interval_months ?? 1)
    if (interval === 1) return 'Scheduled monthly'
    if (interval === 3) return 'Scheduled quarterly'
    if (interval === 12) return 'Scheduled yearly'
    return 'Scheduled every ' + interval + ' months'
  }

  function resetComposer() {
    setTitle('')
    setAmount('')
    setCostDate(todayKey())
    setScheduleType('one_time')
    setNotes('')
    setError('')
  }

  async function saveFinance(event: FormEvent) {
    event.preventDefault()
    if (!canWrite) return

    const normalizedIncome = incomeDraft.trim().replace(',', '.')
    const normalizedBudget = budgetDraft.trim().replace(',', '.')
    const income = normalizedIncome ? Number(normalizedIncome) : null
    const budget = normalizedBudget ? Number(normalizedBudget) : null

    if ((income != null && (!Number.isFinite(income) || income < 0))
      || (budget != null && (!Number.isFinite(budget) || budget < 0))) {
      setError('Income and budget must be valid positive amounts.')
      return
    }

    setSavingFinance(true)
    setError('')

    const result = await supabase
      .from('household_finance_settings')
      .upsert({
        household_id: household.id,
        monthly_income: income,
        monthly_budget: budget,
        currency: 'EUR',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'household_id' })

    setSavingFinance(false)

    if (result.error) setError(result.error.message)
    else await load()
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
      cost_kind: scheduleType === 'scheduled' ? 'regular' : 'additional',
      source_type: 'manual',
      schedule_type: scheduleType,
      schedule_day: scheduleType === 'scheduled' ? fromKey(costDate).getDate() : null,
      notes: notes.trim() || null,
      flow_type: 'expense',
      schedule_interval_months: 1,
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
    <div className={'page costs-page mobile-cost-panel-'+(mobilePanel??'closed')}>
      <div className="page-heading-row">
        <div>
          <div className="page-label">HOUSEHOLD COSTS</div>
          <h1>Household costs</h1>
          <p className="page-subtitle">Plan the family budget, track one-time spending and keep monthly scheduled costs visible before they happen.</p>
        </div>

        {canWrite && (
          <button className="primary-button compact" onClick={() => setComposerOpen(true)}>
            <Plus size={16} />
            Add cost
          </button>
        )}
      </div>

      <div className="cost-privacy-top"><PrivacyNotice compact /></div>

      {!access?.enabled && <div className="module-access-note">Household Costs is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && !composerOpen && <div className="notice error">{error}</div>}

      <nav className="mobile-cost-side-tabs" aria-label="Household cost shortcuts">
        <button type="button" className={mobilePanel==='plan'?'active':''} onClick={()=>setMobilePanel((current)=>current==='plan'?null:'plan')} aria-label="Budget and income" title="Budget & income">
          <WalletCards size={20}/>
          <span>Budget</span>
        </button>
        <button type="button" className={mobilePanel==='entries'?'active':''} onClick={()=>setMobilePanel((current)=>current==='entries'?null:'entries')} aria-label="Cost entries" title="Cost entries">
          <Receipt size={20}/>
          <span>Entries</span>
        </button>
      </nav>

      <section className="finance-overview-grid">
        <form className="list-card finance-plan-card" onSubmit={saveFinance}>
          <button type="button" className="mobile-cost-drawer-close" onClick={()=>setMobilePanel(null)} aria-label="Close budget and income"><X size={19}/></button>
          <div className="finance-card-heading">
            <div>
              <span className="eyebrow">MONTHLY PLAN</span>
              <h2>Budget & income</h2>
              <p>Income is optional. If you prefer not to store it, enter only the monthly household budget.</p>
            </div>
            <WalletCards size={21} />
          </div>

          <div className="finance-plan-fields">
            <label>
              Monthly income
              <div className="money-input">
                <span>€</span>
                <input
                  inputMode="decimal"
                  value={incomeDraft}
                  onChange={(event) => setIncomeDraft(event.target.value)}
                  placeholder="Optional"
                  disabled={!canWrite}
                />
              </div>
            </label>

            <label>
              Monthly budget
              <div className="money-input">
                <span>€</span>
                <input
                  inputMode="decimal"
                  value={budgetDraft}
                  onChange={(event) => setBudgetDraft(event.target.value)}
                  placeholder="e.g. 2500"
                  disabled={!canWrite}
                />
              </div>
            </label>
          </div>

          {canWrite && (
            <button className="secondary-button compact finance-save-button" disabled={savingFinance}>
              {savingFinance ? 'Saving…' : 'Save monthly plan'}
            </button>
          )}
        </form>

        <div className="cost-summary-panel">
          <article className="list-card cost-summary-card">
            <span>This month</span>
            <strong>{money(currentMonthSpend)}</strong>
            <small>Including scheduled monthly costs</small>
          </article>

          <article className="list-card cost-summary-card">
            <span>{finance?.monthly_budget != null ? 'Budget' : 'Income'}</span>
            <strong>{monthlyLimit != null ? money(Number(monthlyLimit)) : '—'}</strong>
            <small>{finance?.monthly_budget != null ? 'Monthly budget' : finance?.monthly_income != null ? 'Monthly income' : 'Add a budget or income'}</small>
          </article>

          <article className="list-card cost-summary-card">
            <span>Remaining</span>
            <strong className={monthRemaining != null && monthRemaining < 0 ? 'negative' : ''}>
              {monthRemaining != null ? money(monthRemaining) : '—'}
            </strong>
            <small>Based on this month</small>
          </article>
        </div>
      </section>

      <section className="cost-report-card list-card">
        <div className="cost-report-head">
          <div>
            <span className="eyebrow">REPORTING</span>
            <h2>Cost overview</h2>
          </div>

          <div className="cost-range-tabs" aria-label="Cost range">
            {(['week','month','year','all'] as CostRange[]).map((item) => (
              <button
                type="button"
                className={range === item ? 'active' : ''}
                key={item}
                onClick={() => setRange(item)}
              >
                {item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="cost-report-total">
          <span>Total expenses in selected period</span>
          <strong>{money(periodTotal)}</strong>
          {periodIncome > 0 && <small>{money(periodIncome)} income recorded</small>}
        </div>

        <div className="cost-chart-grid">
          <div className="cost-chart">
            <h3>Spending over time</h3>
            <div className="cost-bar-chart">
              {chartBuckets.map((item) => (
                <div className="cost-bar-column" key={item.key} title={item.label + ': ' + money(item.value)}>
                  <div className="cost-bar-track">
                    <div className="cost-bar-fill" style={{ height: Math.max(item.value > 0 ? 4 : 0, (item.value / chartMax) * 100) + '%' }} />
                  </div>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="cost-side-charts">
            <div className="cost-chart source-chart">
              <h3>Where costs came from</h3>
              <div className="cost-source-bars">
                {sourceBreakdown.map((item) => (
                  <div className="cost-source-row" key={item.key}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{money(item.value)}</strong>
                    </div>
                    <div className="cost-source-track">
                      <div style={{ width: (item.value / sourceMax) * 100 + '%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="cost-chart timing-chart">
              <h3>Scheduled vs one-time</h3>
              <div className="cost-source-bars">
                {timingBreakdown.map((item) => (
                  <div className="cost-source-row" key={item.key}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{money(item.value)}</strong>
                    </div>
                    <div className="cost-source-track">
                      <div style={{ width: (item.value / timingMax) * 100 + '%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="list-card cost-list">
        <button type="button" className="mobile-cost-drawer-close" onClick={()=>setMobilePanel(null)} aria-label="Close cost entries"><X size={19}/></button>
        <div className="mobile-cost-entry-actions">
          {canWrite && (
            <button type="button" className="primary-button compact" onClick={()=>setComposerOpen(true)}>
              <Plus size={15}/>Add cost
            </button>
          )}
        </div>
        <div className="cost-list-head">
          <div>
            <span className="eyebrow">COST ENTRIES</span>
            <h2>All costs</h2>
          </div>
          <span>{filteredCosts.length}</span>
        </div>

        <div className="cost-list-filters">
          <label>
            Source / category
            <Select
              value={listSource}
              onChange={setListSource}
              options={[
                { value: 'all', label: 'All sources' },
                { value: 'manual', label: 'Manual' },
                { value: 'shopping', label: 'Shopping' },
                { value: 'task', label: 'Tasks' },
                { value: 'home_care', label: 'Home Care' },
                { value: 'life_admin', label: 'Life Admin' },
                { value: 'projects', label: 'Projects & Chores' },
              ]}
              ariaLabel="Filter costs by source"
            />
          </label>

          <label>
            Period
            <Select
              value={listPeriod}
              onChange={(value) => setListPeriod(value as CostFilterPeriod)}
              options={[
                { value: 'all', label: 'All dates' },
                { value: 'week', label: 'This week' },
                { value: 'month', label: 'This month' },
                { value: 'year', label: 'This year' },
              ]}
              ariaLabel="Filter costs by period"
            />
          </label>

          <label>
            Timing
            <Select
              value={listTiming}
              onChange={setListTiming}
              options={[
                { value: 'all', label: 'All timing' },
                { value: 'one_time', label: 'One-time / non-scheduled' },
                { value: 'scheduled', label: 'Scheduled / recurring' },
              ]}
              ariaLabel="Filter costs by timing"
            />
          </label>

          <label>
            Direction
            <Select
              value={listFlow}
              onChange={setListFlow}
              options={[
                { value: 'all', label: 'Costs & income' },
                { value: 'expense', label: 'Costs only' },
                { value: 'income', label: 'Income only' },
              ]}
              ariaLabel="Filter costs by direction"
            />
          </label>
        </div>

        {filteredCosts.length === 0 ? (
          <div className="empty-state">
            <Receipt size={24} />
            <span className="empty-state-title">No matching household entries.</span>
            <span>Change the filters or add a new household cost.</span>
          </div>
        ) : visibleCosts.map((cost) => (
          <div className="cost-row" key={cost.id}>
            <span className="cost-source-icon">
              {(cost.source_type === 'shopping' || cost.source_type === 'shopping_receipt')
                ? <ShoppingBag size={15} />
                : cost.schedule_type === 'scheduled'
                  ? <CalendarClock size={15} />
                  : <Receipt size={15} />}
            </span>
            <span className="cost-main-copy">
              <span>{cost.title}</span>
              <small>
                {cost.cost_date}
                {' · '}
                {scheduleLabel(cost)}
                {' · '}
                {sourceLabel(cost.source_type)}
                {cost.flow_type === 'income' ? ' · Income' : ''}
              </small>
            </span>
            <strong className={cost.flow_type === 'income' ? 'income' : ''}>
              {cost.flow_type === 'income' ? '+' : ''}{money(Number(cost.amount), cost.currency || 'EUR')}
            </strong>
          </div>
        ))}

        {filteredCosts.length > pageSize && (
          <div className="cost-pagination">
            <span>15 per page · Page {listPage} of {listPageCount}</span>
            <div>
              <button type="button" className="secondary-button compact" disabled={listPage <= 1} onClick={() => setListPage((page) => Math.max(1,page - 1))}>Previous</button>
              <button type="button" className="secondary-button compact" disabled={listPage >= listPageCount} onClick={() => setListPage((page) => Math.min(listPageCount,page + 1))}>Next</button>
            </div>
          </div>
        )}
      </section>

      <div className="cost-privacy-bottom"><PrivacyNotice compact /></div>

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
                <small className="field-hint">{scheduleType === 'scheduled' ? 'First month and recurring day.' : 'Date the cost occurred.'}</small>
              </label>

              <label>
                Cost timing
                <Select
                  value={scheduleType}
                  onChange={(value) => setScheduleType(value as ScheduleType)}
                  options={[
                    { value: 'one_time', label: 'One-time / non-scheduled' },
                    { value: 'scheduled', label: 'Scheduled every month' },
                  ]}
                  ariaLabel="Choose cost timing"
                />
                <small className="field-hint">{scheduleType === 'scheduled' ? 'Included automatically in every following month.' : 'Recorded only once.'}</small>
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
