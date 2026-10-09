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
  const speechRef=useRef<any>(null)
  const speechFinalRef=useRef('')
  const voiceModeRef=useRef<'live'|'recording'|null>(null)
  const sendAfterStopRef=useRef(false)
  const liveTranscriptRef=useRef('')
  const previewTimerRef=useRef<ReturnType<typeof setInterval>|null>(null)
  const previewInFlightRef=useRef(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const voiceBaseMessageRef = useRef('')
  const conversationIdRef = useRef(crypto.randomUUID())
  // Invalidate asynchronous replies and transcription callbacks when the popup closes.
  const openRef = useRef(false)
  const sessionRef = useRef(0)
  const voiceGenerationRef = useRef(0)
  const sendingRef = useRef(false)

  const cycleLabel = useMemo(() => {
    if (!summary?.cycle_end) return ''
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
    }).format(new Date(summary.cycle_end))
  }, [summary?.cycle_end])

  async function loadSummary() {
    const session = sessionRef.current
    const result = await supabase.rpc('assistant_usage_summary_v1', {
      p_household_id: household.id,
    })

    if (result.error || !openRef.current || sessionRef.current !== session) return

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
    closeConversation()
  }, [household.id])

  useEffect(() => {
    function handlePrefill(event: Event) {
      const detail=(event as CustomEvent<{ message?: string }>).detail
      const nextMessage=detail?.message?.trim()
      if (!openRef.current) openConversation(nextMessage ?? '')
      else if (nextMessage) setMessage(nextMessage)
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
    speechRef.current?.abort()
    if(previewTimerRef.current)clearInterval(previewTimerRef.current)
  }, [])

  function cancelVoice() {
    voiceGenerationRef.current += 1
    sendAfterStopRef.current = false
    if (previewTimerRef.current) {
      clearInterval(previewTimerRef.current)
      previewTimerRef.current = null
    }
    const recognition = speechRef.current
    speechRef.current = null
    if (recognition) {
      recognition.onresult = null
      recognition.onend = null
      recognition.onerror = null
      try { recognition.abort() } catch { /* Already stopped. */ }
    }
    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstart = null
      recorder.onstop = null
      recorder.onerror = null
      try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* Already stopped. */ }
    }
    mediaStreamRef.current?.getTracks().forEach(track => track.stop())
    mediaStreamRef.current = null
    audioChunksRef.current = []
    voiceModeRef.current = null
    voiceBaseMessageRef.current = ''
    liveTranscriptRef.current = ''
    speechFinalRef.current = ''
    setListening(false)
    setTranscribing(false)
  }

  function closeConversation() {
    // Closing really ends the chat session, including in-flight responses and voice recognition.
    openRef.current = false
    sessionRef.current += 1
    cancelVoice()
    sendingRef.current = false
    setOpen(false)
    setChat([])
    setMessage('')
    setError('')
    setSummary(null)
    setSending(false)
    setKeyboardOpen(false)
    conversationIdRef.current = crypto.randomUUID()
  }

  function openConversation(initialMessage = '') {
    openRef.current = true
    sessionRef.current += 1
    setChat([])
    setMessage(initialMessage)
    setError('')
    setSummary(null)
    setSending(false)
    sendingRef.current = false
    conversationIdRef.current = crypto.randomUUID()
    setOpen(true)
  }

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
    const session = sessionRef.current
    const voiceGeneration = voiceGenerationRef.current
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
    if (!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration) return

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
      if (sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration) return
      setError(detail)
      sendAfterStopRef.current=false
    } else {
      const payload = result.data as { text?: string } | null
      const spoken = payload?.text?.trim()
      if (spoken) {
        const base = voiceBaseMessageRef.current
        const completed=base ? base + ' ' + spoken : spoken
        liveTranscriptRef.current=completed
        setMessage(completed)
        if(sendAfterStopRef.current){sendAfterStopRef.current=false;void sendText(completed)}
      }else if(sendAfterStopRef.current){sendAfterStopRef.current=false;setError('No speech was detected. Please try again.')}
    }

    setTranscribing(false)
  }

  async function previewRecordedSpeech(mimeType:string){
    const session = sessionRef.current
    const voiceGeneration = voiceGenerationRef.current
    if(previewInFlightRef.current||voiceModeRef.current!=='recording'||audioChunksRef.current.length===0)return
    previewInFlightRef.current=true
    try{
      const blob=new Blob(audioChunksRef.current,{type:mimeType||'audio/webm'})
      if(blob.size===0 || blob.size>20*1024*1024)return
      const ext=mimeType.includes('mp4')?'m4a':mimeType.includes('ogg')?'ogg':'webm'
      const payload=new FormData()
      payload.append('household_id',household.id)
      payload.append('file',new File([blob],'interim.'+ext,{type:mimeType||'audio/webm'}))
      const result=await supabase.functions.invoke('assistant-transcribe',{body:payload})
      const text=(result.data as {text?:string}|null)?.text?.trim()
      if(!result.error&&text&&openRef.current&&sessionRef.current===session&&voiceGenerationRef.current===voiceGeneration&&voiceModeRef.current==='recording'){
        const preview=[voiceBaseMessageRef.current,text].filter(Boolean).join(' ')
        liveTranscriptRef.current=preview
        setMessage(preview)
      }
    }catch{/* Live preview may be unavailable for incomplete container audio; final recording remains intact. */}
    finally{previewInFlightRef.current=false}
  }

  function stopAndSendVoice(){
    sendAfterStopRef.current=true
    if(listening){void toggleVoiceInput();return}
    if(!transcribing){sendAfterStopRef.current=false;const text=liveTranscriptRef.current||message;if(text.trim())void sendText(text)}
  }

  function stopLiveVoice(){
    if(speechRef.current){speechRef.current.stop();speechRef.current=null}
    setListening(false)
    voiceModeRef.current=null
  }

  async function toggleVoiceInput() {
    if (listening) {
      if(previewTimerRef.current){clearInterval(previewTimerRef.current);previewTimerRef.current=null}
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
        const session = sessionRef.current
        const voiceGeneration = voiceGenerationRef.current
        speechFinalRef.current=''
        liveTranscriptRef.current=''
        sendAfterStopRef.current=false
        voiceBaseMessageRef.current=message.trim()
        recognition.continuous=true
        recognition.interimResults=true
        recognition.lang=navigator.language||'en-US'
        recognition.onresult=(event:any)=>{
          if(!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration)return
          let interim=''
          for(let i=event.resultIndex;i<event.results.length;i++){
            const phrase=event.results[i][0]?.transcript||''
            if(event.results[i].isFinal)speechFinalRef.current+=(speechFinalRef.current?' ':'')+phrase.trim()
            else interim+=phrase
          }
          const liveText=[voiceBaseMessageRef.current,speechFinalRef.current,interim].filter(Boolean).join(' ').trim()
          liveTranscriptRef.current=liveText
          setMessage(liveText)
        }
        recognition.onerror=(event:any)=>{
          if(!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration)return
          sendAfterStopRef.current=false
          setError(event.error==='not-allowed'?'Microphone permission is required.':'Live transcription interrupted. Please try again.')
          setListening(false);speechRef.current=null;voiceModeRef.current=null
        }
        recognition.onend=()=>{
          if(!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration)return
          setListening(false);speechRef.current=null;voiceModeRef.current=null
          if(sendAfterStopRef.current){
            sendAfterStopRef.current=false
            if(liveTranscriptRef.current.trim())void sendText(liveTranscriptRef.current)
            else setError('No speech was detected. Please try again.')
          }
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
      const session = sessionRef.current
      const voiceGeneration = voiceGenerationRef.current
      setError('')
      voiceBaseMessageRef.current = message.trim()
      liveTranscriptRef.current=message.trim()
      sendAfterStopRef.current=false

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration) {
        stream.getTracks().forEach(track=>track.stop())
        return
      }
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
        if (!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration) return
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      recorder.onstart = () => {
        if (!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration) return
        setListening(true)
        playMicStartSound()
        // Request cumulative audio periodically to show interim text on browsers without SpeechRecognition.
        previewTimerRef.current=setInterval(()=>{
          if(recorder.state==='recording'){
            recorder.requestData()
            window.setTimeout(()=>void previewRecordedSpeech(recorder.mimeType||mimeType),250)
          }
        },5000)
      }

      recorder.onstop = () => {
        if (!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration) return
        if(previewTimerRef.current){clearInterval(previewTimerRef.current);previewTimerRef.current=null}
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
        if (!openRef.current || sessionRef.current !== session || voiceGenerationRef.current !== voiceGeneration) return
        if(previewTimerRef.current){clearInterval(previewTimerRef.current);previewTimerRef.current=null}
        sendAfterStopRef.current=false
        setListening(false)
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setError('Voice recording failed. Please try again.')
      }

      recorder.start(250)
    } catch {
      if (!openRef.current) return
      setListening(false)
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      setError('Microphone permission is required for voice input.')
    }
  }

  async function sendText(text:string) {
    const value=text.trim()
    if (!value || !openRef.current || sendingRef.current || !assistantEnabled || summary?.total_remaining===0) return

    const session = sessionRef.current
    sendingRef.current = true
    // Prevent a late SpeechRecognition result or audio upload from restoring the sent text.
    cancelVoice()
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
    if (!openRef.current || sessionRef.current !== session) return

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
      if (!openRef.current || sessionRef.current !== session) return
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

    sendingRef.current = false
    setSending(false)
  }

  function submit(event:FormEvent){event.preventDefault();void sendText(message)}

  if (!assistantEnabled) return null

  return (
    <>
      <button
        className={open ? 'mobile-assistant-tab active' : 'mobile-assistant-tab'}
        type="button"
        onClick={() => { if (openRef.current) closeConversation(); else openConversation() }}
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
            onClick={closeConversation}
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

              <button type="button" onClick={closeConversation} aria-label="Close Assistant">
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

            {(listening||transcribing)&&<div className="mobile-assistant-record-actions"><span>{transcribing?'Finishing transcription…':'Recording · words appear as available'}</span><button type="button" onClick={()=>{if(listening)void toggleVoiceInput()}} disabled={!listening}>Stop to edit</button><button type="button" className="send-now" onClick={stopAndSendVoice} disabled={!listening&&transcribing}>Stop &amp; send</button></div>}
            <form className="mobile-assistant-form" onSubmit={submit}>
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
                disabled={sending || listening || transcribing || !message.trim() || summary?.total_remaining === 0}
                aria-label="Send to Assistant"
              >
                <Send size={17} />
              </button>
            </form>

            <button
              className="mobile-assistant-full-link"
              type="button"
              onClick={() => {
                closeConversation()
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
