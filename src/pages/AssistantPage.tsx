import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, History, RefreshCw, Sparkles, Zap } from 'lucide-react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import './AssistantPage.css'

type UsageSummary = {
  monthly_limit: number
  monthly_used: number
  monthly_remaining: number
  topup_remaining: number
  total_remaining: number
  cycle_start: string
  cycle_end: string
  included_rollover: number
}

type UsageEvent = {
  id: string
  user_id: string | null
  action_type: string
  model: string
  balance_source: 'included' | 'topup'
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  created_at: string
}

const actionLabels: Record<string, string> = {
  receipt_scan: 'Receipt scan',
  qr_page_event: 'QR webpage to event',
  work_calendar_image: 'Calendar screenshot import',
  work_calendar_text: 'Calendar text import',
  quick_assistant: 'Quick Assistant',
}

function toSummary(row: Record<string, unknown>): UsageSummary {
  return {
    monthly_limit: Number(row.monthly_limit ?? 0),
    monthly_used: Number(row.monthly_used ?? 0),
    monthly_remaining: Number(row.monthly_remaining ?? 0),
    topup_remaining: Number(row.topup_remaining ?? 0),
    total_remaining: Number(row.total_remaining ?? 0),
    cycle_start: String(row.cycle_start ?? ''),
    cycle_end: String(row.cycle_end ?? ''),
    included_rollover: Number(row.included_rollover ?? 0),
  }
}

export function AssistantPage() {
  const { household, profiles } = useHousehold()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [history, setHistory] = useState<UsageEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const profileByUserId = useMemo(() => new Map(
    profiles
      .filter((profile) => profile.linked_user_id)
      .map((profile) => [profile.linked_user_id as string, profile.display_name]),
  ), [profiles])

  async function load(foreground = true) {
    if (foreground) setLoading(true)
    else setRefreshing(true)
    setError('')

    const [summaryResult, historyResult] = await Promise.all([
      supabase.rpc('assistant_usage_summary_v1', { p_household_id: household.id }),
      supabase
        .from('assistant_usage_events')
        .select('id,user_id,action_type,model,balance_source,input_tokens,output_tokens,total_tokens,created_at')
        .eq('household_id', household.id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (summaryResult.error) {
      setError(summaryResult.error.message)
    } else if (historyResult.error) {
      setError(historyResult.error.message)
    } else {
      const row = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
      setSummary(row ? toSummary(row as Record<string, unknown>) : null)
      setHistory((historyResult.data ?? []) as UsageEvent[])
    }

    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    void load()
  }, [household.id])

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }), [])

  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }), [])

  const usedPercent = summary?.monthly_limit
    ? Math.min(100, Math.round((summary.monthly_used / summary.monthly_limit) * 100))
    : 0

  if (loading) {
    return (
      <div className="page assistant-page">
        <div className="page-label">ASSISTANT</div>
        <div className="assistant-loading">Opening Assistant usage…</div>
      </div>
    )
  }

  return (
    <div className="page assistant-page">
      <div className="assistant-title-row">
        <div>
          <div className="page-label">ASSISTANT</div>
          <h1>AI Assistant</h1>
          <p>One shared Assistant allowance for everyone in {household.name}.</p>
        </div>
        <button
          className="assistant-refresh"
          type="button"
          disabled={refreshing}
          onClick={() => void load(false)}
        >
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="assistant-error">
          <strong>Assistant usage could not be loaded.</strong>
          <span>{error}</span>
        </div>
      ) : summary ? (
        <>
          <section className="assistant-hero">
            <div className="assistant-hero-main">
              <span className="assistant-icon"><Sparkles size={22} /></span>
              <div>
                <span className="assistant-eyebrow">AVAILABLE THIS PERIOD</span>
                <strong>{summary.total_remaining}</strong>
                <small>Assistant actions remaining</small>
              </div>
            </div>

            <div className="assistant-progress-area">
              <div className="assistant-progress-copy">
                <span>{summary.monthly_used} of {summary.monthly_limit} included actions used</span>
                <strong>{usedPercent}%</strong>
              </div>
              <div className="assistant-progress" aria-label={usedPercent + '% of monthly Assistant actions used'}>
                <span style={{ width: usedPercent + '%' }} />
              </div>
            </div>
          </section>

          <section className="assistant-stat-grid">
            <article>
              <span className="assistant-stat-icon"><Zap size={18} /></span>
              <small>Monthly allowance</small>
              <strong>{summary.monthly_limit}</strong>
              <span>Shared by the whole household</span>
            </article>
            <article>
              <span className="assistant-stat-icon"><History size={18} /></span>
              <small>Used this period</small>
              <strong>{summary.monthly_used}</strong>
              <span>{summary.monthly_remaining} included actions remain</span>
            </article>
            <article>
              <span className="assistant-stat-icon"><CalendarClock size={18} /></span>
              <small>Next reload</small>
              <strong>{summary.cycle_end ? dateFormatter.format(new Date(summary.cycle_end)) : '—'}</strong>
              <span>Included allowance returns to {summary.monthly_limit}</span>
            </article>
          </section>

          <section className="assistant-policy-card">
            <div>
              <strong>Monthly actions do not roll over</strong>
              <p>
                Unused included actions expire when this period ends.
                Transfer to the next period: {summary.included_rollover} included actions.
              </p>
            </div>
            {summary.topup_remaining > 0 && (
              <div className="assistant-topup-balance">
                <span>Purchased actions</span>
                <strong>{summary.topup_remaining}</strong>
              </div>
            )}
          </section>

          <section className="assistant-history">
            <div className="assistant-section-head">
              <div>
                <span className="assistant-eyebrow">HOUSEHOLD</span>
                <h2>Usage history</h2>
              </div>
              <span>{history.length} recent {history.length === 1 ? 'action' : 'actions'}</span>
            </div>

            {history.length === 0 ? (
              <div className="assistant-empty">
                <Sparkles size={22} />
                <strong>No Assistant actions used yet</strong>
                <span>Your first successful receipt, QR or calendar AI request will appear here.</span>
              </div>
            ) : (
              <div className="assistant-history-list">
                {history.map((item) => {
                  const input = item.input_tokens ?? 0
                  const output = item.output_tokens ?? 0
                  return (
                    <div className="assistant-history-row" key={item.id}>
                      <span className="assistant-history-mark"><Sparkles size={15} /></span>
                      <div className="assistant-history-main">
                        <strong>{actionLabels[item.action_type] ?? item.action_type.replaceAll('_', ' ')}</strong>
                        <span>
                          {item.user_id ? (profileByUserId.get(item.user_id) ?? 'Household member') : 'Household member'}
                          {' · '}
                          {dateTimeFormatter.format(new Date(item.created_at))}
                        </span>
                      </div>
                      <div className="assistant-history-meta">
                        <strong>1 action</strong>
                        <span>{item.model}</span>
                        {item.total_tokens != null && (
                          <small>{input.toLocaleString()} in + {output.toLocaleString()} out tokens</small>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="assistant-token-note">
              OpenAI input/output tokens are technical cost data only. They do not change the Famioo rule:
              one successful AI request uses one Assistant action.
            </p>
          </section>
        </>
      ) : (
        <div className="assistant-empty">
          <Sparkles size={22} />
          <strong>No Assistant allowance is configured</strong>
          <span>This household does not currently have an Assistant allowance.</span>
        </div>
      )}
    </div>
  )
}
