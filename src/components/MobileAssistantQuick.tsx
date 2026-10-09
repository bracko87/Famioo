import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Mic, Send, Sparkles, X } from 'lucide-react'
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
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [keyboardOpen,setKeyboardOpen]=useState(false)
  const [autoSendVoice,setAutoSendVoice]=useState(false)
  const speechRef=useRef<any>(null)
  const speechFinalRef=useRef('')
  const voiceModeRef=useRef<'live'|'recording'|null>(null)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const voiceBaseMessageRef = useRef('')
  const conversationIdRef = useRef(crypto.randomUUID())

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
    if (!open) return

    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [open])

  useEffect(() => {
    if(!open || !window.visualViewport)return
    const viewport=window.visualViewport
    const update=()=>{
      document.documentElement.style.setProperty('--famioo-viewport-height',viewport.height+'px')
      setKeyboardOpen(viewport.height < window.innerHeight-110)
    }
    update()
    viewport.addEventListener('resize',update)
    return ()=>{viewport.removeEventListener('resize',update);document.documentElement.style.removeProperty('--famioo-viewport-height')}
  },[open])

  useEffect(() => {
    setOpen(false)
  }, [household.id])

  useEffect(() => {
    function handlePrefill(event: Event) {
      const detail=(event as CustomEvent<{ message?: string }>).detail
      const nextMessage=detail?.message?.trim()
      if(nextMessage) setMessage(nextMessage)
      setOpen(true)
    }

    window.addEventListener('famioo:assistant-prefill',handlePrefill)
    return ()=>window.removeEventListener('famioo:assistant-prefill',handlePrefill)
  }, [])

  useEffect(() => () => {
    try {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    } catch {
      // Recorder may already be stopped.
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  function playMicStartSound() {
    try {
      const AudioContextCtor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

      if (!AudioContextCtor) return

      const audioContext = new AudioContextCtor()
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime)
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.11, audioContext.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12)

      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.13)
      oscillator.onended = () => {
        void audioContext.close()
      }
    } catch {
      // Sound feedback is optional and should never block voice input.
    }
  }

  async function transcribeRecording(blob: Blob, mimeType: string) {
    if (!blob.size) {
      setError('No speech was recorded.')
      return
    }

    setTranscribing(true)
    setError('')

    const extension = mimeType.includes('mp4') || mimeType.includes('m4a')
      ? 'm4a'
      : mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('wav')
          ? 'wav'
          : 'webm'

    const formData = new FormData()
    formData.append('household_id', household.id)
    formData.append('file', new File([blob], 'famioo-voice.' + extension, {
      type: mimeType || 'audio/webm',
    }))

    const result = await supabase.functions.invoke('assistant-transcribe', {
      body: formData,
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
      const payload = result.data as { text?: string } | null
      const spoken = payload?.text?.trim()
      if (spoken) {
        const base = voiceBaseMessageRef.current
        setMessage(base ? base + ' ' + spoken : spoken)
      }
    }

    setTranscribing(false)
  }

  function stopLiveVoice(){
    if(speechRef.current){speechRef.current.stop();speechRef.current=null}
    setListening(false)
    voiceModeRef.current=null
  }

  async function toggleVoiceInput() {
    if (listening) {
      if(voiceModeRef.current==='live'){stopLiveVoice();return}
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state === 'recording') {
        recorder.stop()
      }
      return
    }

    const SpeechRecognitionCtor=(window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if(SpeechRecognitionCtor){
      try{
        const recognition=new SpeechRecognitionCtor()
        speechFinalRef.current=''
        voiceBaseMessageRef.current=message.trim()
        recognition.continuous=true
        recognition.interimResults=true
        recognition.lang=navigator.language||'en-US'
        recognition.onresult=(event:any)=>{
          let interim=''
          for(let i=event.resultIndex;i<event.results.length;i++){
            const phrase=event.results[i][0]?.transcript||''
            if(event.results[i].isFinal)speechFinalRef.current+=(speechFinalRef.current?' ':'')+phrase.trim()
            else interim+=phrase
          }
          setMessage([voiceBaseMessageRef.current,speechFinalRef.current,interim].filter(Boolean).join(' ').trim())
        }
        recognition.onerror=(event:any)=>{
          setError(event.error==='not-allowed'?'Microphone permission is required.':'Live transcription interrupted. Please try again.')
          setListening(false);speechRef.current=null;voiceModeRef.current=null
        }
        recognition.onend=()=>{
          setListening(false);speechRef.current=null;voiceModeRef.current=null
        }
        speechRef.current=recognition
        voiceModeRef.current='live'
        recognition.start()
        setListening(true)
        playMicStartSound()
        return
      }catch{speechRef.current=null;voiceModeRef.current=null}
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported by this browser.')
      return
    }

    try {
      setError('')
      voiceBaseMessageRef.current = message.trim()

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      audioChunksRef.current = []

      const candidates = [
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ]
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      voiceModeRef.current='recording'
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      recorder.onstart = () => {
        setListening(true)
        playMicStartSound()
      }

      recorder.onstop = () => {
        setListening(false)
        const finalType = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: finalType })
        audioChunksRef.current = []
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        voiceModeRef.current=null
        void transcribeRecording(blob, finalType)
      }

      recorder.onerror = () => {
        setListening(false)
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setError('Voice recording failed. Please try again.')
      }

      recorder.start(250)
    } catch {
      setListening(false)
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      setError('Microphone permission is required for voice input.')
    }
  }

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
        conversation_id: conversationIdRef.current,
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

          <aside className={keyboardOpen?"mobile-assistant-drawer keyboard-open":"mobile-assistant-drawer"} aria-label="AI Assistant">
            <div className="mobile-assistant-head">
              <div>
                <span className="mobile-assistant-avatar"><Sparkles size={18} /></span>
                <div>
                  <strong>Famioo Assistant</strong>
                  <small>
                    {transcribing
                      ? 'Transcribing voice…'
                      : listening
                        ? 'Listening · words appear as you speak'
                        : summary
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
                  <span>Ask a question, calculate something, or tell Famioo what you want it to do.</span>
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
                disabled={sending || transcribing || summary?.total_remaining === 0}
              />
              <button
                className={listening ? 'mobile-assistant-mic listening' : 'mobile-assistant-mic'}
                type="button"
                onClick={toggleVoiceInput}
                disabled={sending || transcribing || summary?.total_remaining === 0}
                aria-label={listening ? 'Stop recording' : transcribing ? 'Transcribing voice' : 'Use microphone'}
                title={listening ? 'Stop recording' : transcribing ? 'Transcribing…' : 'Use microphone'}
              >
                {listening ? <span aria-hidden="true" style={{width:12,height:12,background:'currentColor',borderRadius:2}} /> : <Mic size={17} />}
              </button>
              <button
                className="mobile-assistant-send"
                type="submit"
                disabled={sending || transcribing || !message.trim() || summary?.total_remaining === 0}
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
