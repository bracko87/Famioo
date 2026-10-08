import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Send, Sparkles, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import './MobileAssistantQuick.css'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type UsageSummary = {
  monthly_limit: number
  monthly_used: number
  total_remaining: number
  cycle_end: string
}

export function MobileAssistantQuick() {
  const { household, modules } = useHousehold()
  const location = useLocation()
  const navigate = useNavigate()
  const assistantEnabled = modules.some((module) => module.code === 'assistant' && module.enabled)

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const cycleLabel = useMemo(() => {
    if (!summary?.cycle_end) return ''
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
    }).format(new Date(summary.cycle_end))
  }, [summary?.cycle_end])

  async function loadSummary() {
    const result = await supabase.rpc('assistant_usage_summary_v1', {
      p_household_id: household.id,
    })

    if (result.error) return

    const row = Array.isArray(result.data) ? result.data[0] : result.data
    if (!row) return

    setSummary({
      monthly_limit: Number(row.monthly_limit ?? 0),
      monthly_used: Number(row.monthly_used ?? 0),
      total_remaining: Number(row.total_remaining ?? 0),
      cycle_end: String(row.cycle_end ?? ''),
    })
  }

  useEffect(() => {
    if (open && assistantEnabled) void loadSummary()
  }, [open, household.id, assistantEnabled])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    }, 0)
  }, [chat, open, sending])

  useEffect(() => {
    setOpen(false)
  }, [household.id])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = message.trim()
    if (!value || sending || !assistantEnabled) return

    setError('')
    setMessage('')
    setChat((current) => [...current, { role: 'user', content: value }])
    setSending(true)

    const history = chat.slice(-8)
    const result = await supabase.functions.invoke('assistant-chat', {
      body: {
        household_id: household.id,
        message: value,
        history,
        page_path: location.pathname,
      },
    })

    if (result.error) {
      let detail = result.error.message
      const context = (result.error as { context?: Response }).context
      if (context) {
        try {
          const payload = await context.clone().json() as { error?: string }
          if (payload.error) detail = payload.error
        } catch {
          // Keep the function error message.
        }
      }
      setError(detail)
    } else {
      const payload = result.data as {
        reply?: string
        remaining?: number
        cycle_end?: string
      } | null

      if (payload?.reply) {
        setChat((current) => [...current, { role: 'assistant', content: payload.reply! }])
      }

      if (typeof payload?.remaining === 'number') {
        setSummary((current) => current ? {
          ...current,
          monthly_used: Math.min(current.monthly_limit, current.monthly_used + 1),
          total_remaining: payload.remaining!,
          cycle_end: payload.cycle_end ?? current.cycle_end,
        } : current)
      } else {
        void loadSummary()
      }
    }

    setSending(false)
  }

  if (!assistantEnabled) return null

  return (
    <>
      <button
        className={open ? 'mobile-assistant-tab active' : 'mobile-assistant-tab'}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'}
        aria-expanded={open}
      >
        <Sparkles size={18} />
        <span>AI</span>
      </button>

      {open && (
        <>
          <button
            className="mobile-assistant-backdrop"
            type="button"
            aria-label="Close AI Assistant"
            onClick={() => setOpen(false)}
          />

          <aside className="mobile-assistant-drawer" aria-label="AI Assistant">
            <div className="mobile-assistant-head">
              <div>
                <span className="mobile-assistant-avatar"><Sparkles size={18} /></span>
                <div>
                  <strong>Famioo Assistant</strong>
                  <small>
                    {summary
                      ? `${summary.total_remaining} actions left${cycleLabel ? ` · reloads ${cycleLabel}` : ''}`
                      : 'Household Assistant'}
                  </small>
                </div>
              </div>

              <button type="button" onClick={() => setOpen(false)} aria-label="Close Assistant">
                <X size={19} />
              </button>
            </div>

            <div className="mobile-assistant-chat" ref={listRef}>
              {chat.length === 0 && (
                <div className="mobile-assistant-welcome">
                  <Sparkles size={24} />
                  <strong>What can I help with?</strong>
                  <span>Ask a question, calculate something, plan something, or give Famioo a task to prepare.</span>
                </div>
              )}

              {chat.map((item, index) => (
                <div
                  className={item.role === 'user' ? 'mobile-assistant-bubble user' : 'mobile-assistant-bubble assistant'}
                  key={index}
                >
                  {item.content}
                </div>
              ))}

              {sending && (
                <div className="mobile-assistant-bubble assistant thinking">
                  <span />
                  <span />
                  <span />
                </div>
              )}

              {error && <div className="mobile-assistant-error">{error}</div>}
            </div>

            <form className="mobile-assistant-form" onSubmit={(event) => void submit(event)}>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ask a question or give Famioo a task…"
                rows={2}
                maxLength={4000}
                disabled={sending || summary?.total_remaining === 0}
              />
              <button
                className="mobile-assistant-send"
                type="submit"
                disabled={sending || !message.trim() || summary?.total_remaining === 0}
                aria-label="Send to Assistant"
              >
                <Send size={17} />
              </button>
            </form>

            <button
              className="mobile-assistant-full-link"
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/app/assistant')
              }}
            >
              Usage & history
              <ArrowRight size={15} />
            </button>
          </aside>
        </>
      )}
    </>
  )
}
