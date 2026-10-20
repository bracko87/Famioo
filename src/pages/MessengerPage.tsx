import {
  ArrowLeft,
  Camera,
  ImagePlus,
  MessageCircle,
  Mic,
  MicOff,
  Plus,
  Send,
  Users,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type ThreadRow={
  id:string
  thread_type:'household'|'direct'
  display_title:string
  other_user_id:string|null
  other_avatar_path:string|null
  last_message_body:string|null
  last_message_type:'text'|'photo'|'voice'|null
  last_message_at:string|null
  unread_count:number
}

type MessageRow={
  id:string
  sender_user_id:string
  sender_profile_id:string|null
  sender_name:string
  sender_avatar_path:string|null
  message_type:'text'|'photo'|'voice'
  body:string|null
  media_path:string|null
  media_name:string|null
  media_mime:string|null
  media_duration_s:number|null
  created_at:string
  edited_at:string|null
  is_mine:boolean
}

type HouseholdUser={
  profile_id:string
  user_id:string|null
  display_name:string
  avatar_path:string|null
  profile_type:string
  status:string
}

function threadPreview(thread:ThreadRow){
  if(thread.last_message_type==='photo') return '📷 Photo'
  if(thread.last_message_type==='voice') return '🎤 Voice message'
  return thread.last_message_body?.trim()||'No messages yet'
}

function formatThreadTime(value:string|null){
  if(!value) return ''
  const date=new Date(value)
  const now=new Date()
  const sameDay=date.toDateString()===now.toDateString()
  if(sameDay){
    return date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})
  }
  return date.toLocaleDateString(undefined,{day:'2-digit',month:'2-digit'})
}

function formatMessageTime(value:string){
  return new Date(value).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})
}

function extensionFor(name:string,mime:string,type:'photo'|'voice'){
  const named=name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1]
  if(named) return named
  if(type==='photo'){
    if(mime==='image/png') return 'png'
    if(mime==='image/webp') return 'webp'
    if(mime==='image/heic') return 'heic'
    if(mime==='image/heif') return 'heif'
    return 'jpg'
  }
  if(mime==='audio/mp4'||mime==='audio/x-m4a') return 'm4a'
  if(mime==='audio/ogg') return 'ogg'
  if(mime==='audio/wav') return 'wav'
  if(mime==='audio/mpeg') return 'mp3'
  return 'webm'
}

function recordingMime(){
  if(typeof MediaRecorder==='undefined') return ''
  const candidates=[
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/webm',
  ]
  return candidates.find((mime)=>MediaRecorder.isTypeSupported?.(mime))??''
}

function cleanMime(value:string,type:'photo'|'voice'){
  const base=value.split(';')[0].trim().toLowerCase()
  if(type==='photo'){
    return ['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(base)
      ? base
      : 'image/jpeg'
  }
  return ['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a'].includes(base)
    ? base
    : 'audio/webm'
}

export function MessengerPage({embedded=false,initialThreadId=''}:{embedded?:boolean;initialThreadId?:string}={}){
  const {household,user}=useHousehold()

  const [threads,setThreads]=useState<ThreadRow[]>([])
  const [selectedThreadId,setSelectedThreadId]=useState('')
  const [messages,setMessages]=useState<MessageRow[]>([])
  const [householdUsers,setHouseholdUsers]=useState<HouseholdUser[]>([])
  const [mediaUrls,setMediaUrls]=useState<Record<string,string>>({})
  const [draft,setDraft]=useState('')
  const [loading,setLoading]=useState(true)
  const [sending,setSending]=useState(false)
  const [error,setError]=useState('')
  const [newChatOpen,setNewChatOpen]=useState(false)
  const [uploading,setUploading]=useState(false)
  const [recording,setRecording]=useState(false)
  const [recordingSeconds,setRecordingSeconds]=useState(0)

  const messagesEndRef=useRef<HTMLDivElement|null>(null)
  const fileInputRef=useRef<HTMLInputElement|null>(null)
  const recorderRef=useRef<MediaRecorder|null>(null)
  const recorderStreamRef=useRef<MediaStream|null>(null)
  const recorderChunksRef=useRef<Blob[]>([])
  const recordingStartedRef=useRef(0)
  const recordingTimerRef=useRef<number>(0)

  const selectedThread=threads.find((thread)=>thread.id===selectedThreadId)??null

  useEffect(()=>{
    if(initialThreadId) setSelectedThreadId(initialThreadId)
  },[initialThreadId])

  const directCandidates=useMemo(
    ()=>householdUsers.filter(
      (member):member is HouseholdUser&{user_id:string}=>
        Boolean(member.user_id)
        && member.user_id!==user.id
        && member.status==='active',
    ),
    [householdUsers,user.id],
  )

  const signMedia=useCallback(async (rows:MessageRow[])=>{
    const needed=rows
      .filter((message)=>message.media_path&&!mediaUrls[message.media_path])
      .map((message)=>message.media_path!)
    if(!needed.length) return

    const unique=[...new Set(needed)]
    const pairs=await Promise.all(unique.map(async (path)=>{
      const result=await supabase.storage.from('messenger-media').createSignedUrl(path,3600)
      return [path,result.data?.signedUrl??''] as const
    }))

    setMediaUrls((current)=>{
      const next={...current}
      for(const [path,url] of pairs){
        if(url) next[path]=url
      }
      return next
    })
  },[mediaUrls])

  const loadThreads=useCallback(async (foreground=false)=>{
    if(foreground) setLoading(true)

    const [threadResult,userResult]=await Promise.all([
      supabase.rpc('messenger_threads_v1',{p_household_id:household.id}),
      supabase.rpc('household_users_v1',{p_household_id:household.id}),
    ])

    if(threadResult.error){
      setError(threadResult.error.message)
    }else{
      const rows=((threadResult.data??[]) as ThreadRow[]).map((row)=>({
        ...row,
        unread_count:Number(row.unread_count??0),
      }))
      setThreads(rows)
      setSelectedThreadId((current)=>{
        if(current&&rows.some((row)=>row.id===current)) return current
        if(initialThreadId&&rows.some((row)=>row.id===initialThreadId)) return initialThreadId
        if(embedded){
          return rows.find((row)=>row.thread_type==='household')?.id??rows[0]?.id??''
        }
        const mobile=window.matchMedia('(max-width: 760px)').matches
        return mobile?'':rows[0]?.id??''
      })
    }

    if(!userResult.error){
      setHouseholdUsers((userResult.data??[]) as HouseholdUser[])
    }

    if(foreground) setLoading(false)
  },[household.id,embedded,initialThreadId])

  const loadMessages=useCallback(async (threadId:string,scroll=false)=>{
    if(!threadId){
      setMessages([])
      return
    }

    const result=await supabase.rpc('messenger_messages_v1',{
      p_thread_id:threadId,
      p_before:null,
      p_limit:80,
    })

    if(result.error){
      setError(result.error.message)
      return
    }

    const rows=[...((result.data??[]) as MessageRow[])].reverse()
    setMessages(rows)
    void signMedia(rows)

    await supabase.rpc('mark_messenger_thread_read_v1',{p_thread_id:threadId})

    if(scroll){
      window.setTimeout(()=>{
        // Scroll just the chat message list: scrollIntoView can pan the entire
        // iOS visual viewport when the keyboard is open inside a fixed drawer.
        const list=messagesEndRef.current?.parentElement
        if(list?.classList.contains('messenger-message-list'))list.scrollTop=list.scrollHeight
      },30)
    }
  },[signMedia])

  useEffect(()=>{
    void loadThreads(true)
    const timer=window.setInterval(()=>{ void loadThreads(false) },5000)
    return ()=>window.clearInterval(timer)
  },[loadThreads])

  useEffect(()=>{
    if(!selectedThreadId) return
    void loadMessages(selectedThreadId,true)

    const timer=window.setInterval(()=>{
      void loadMessages(selectedThreadId,false)
    },3000)

    return ()=>window.clearInterval(timer)
  },[loadMessages,selectedThreadId])

  useEffect(()=>{
    return ()=>{
      if(recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
      recorderRef.current?.state!=='inactive'&&recorderRef.current?.stop()
      recorderStreamRef.current?.getTracks().forEach((track)=>track.stop())
    }
  },[])

  async function sendMessage(
    messageType:'text'|'photo'|'voice',
    body:string|null,
    mediaPath:string|null=null,
    mediaName:string|null=null,
    mediaMime:string|null=null,
    mediaDuration:number|null=null,
  ){
    if(!selectedThreadId||sending) return

    setSending(true)
    setError('')

    const result=await supabase.rpc('send_messenger_message_v1',{
      p_thread_id:selectedThreadId,
      p_body:body,
      p_message_type:messageType,
      p_media_path:mediaPath,
      p_media_name:mediaName,
      p_media_mime:mediaMime,
      p_media_duration_s:mediaDuration,
    })

    setSending(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    setDraft('')
    await Promise.all([
      loadMessages(selectedThreadId,true),
      loadThreads(false),
    ])
  }

  function submitText(){
    const text=draft.trim()
    if(!text) return
    void sendMessage('text',text)
  }

  function onDraftKeyDown(event:KeyboardEvent<HTMLTextAreaElement>){
    if(event.key==='Enter'&&!event.shiftKey){
      event.preventDefault()
      submitText()
    }
  }

  async function uploadMedia(
    blob:Blob,
    filename:string,
    type:'photo'|'voice',
    duration:number|null=null,
  ){
    if(!selectedThreadId) return

    const mime=cleanMime(blob.type,type)
    const extension=extensionFor(filename,mime,type)
    const path=`${household.id}/${selectedThreadId}/${user.id}/${crypto.randomUUID()}.${extension}`

    setUploading(true)
    setError('')

    const upload=await supabase.storage
      .from('messenger-media')
      .upload(path,blob,{
        contentType:mime,
        upsert:false,
        cacheControl:'3600',
      })

    if(upload.error){
      setUploading(false)
      setError(upload.error.message)
      return
    }

    const sendResult=await supabase.rpc('send_messenger_message_v1',{
      p_thread_id:selectedThreadId,
      p_body:null,
      p_message_type:type,
      p_media_path:path,
      p_media_name:filename,
      p_media_mime:mime,
      p_media_duration_s:duration,
    })

    setUploading(false)

    if(sendResult.error){
      setError(sendResult.error.message)
      return
    }

    await Promise.all([
      loadMessages(selectedThreadId,true),
      loadThreads(false),
    ])
  }

  function choosePhoto(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]
    event.target.value=''
    if(!file) return
    if(!file.type.startsWith('image/')){
      setError('Choose an image file.')
      return
    }
    if(file.size>15*1024*1024){
      setError('Photos can be up to 15 MB.')
      return
    }
    void uploadMedia(file,file.name||'photo.jpg','photo')
  }

  async function startRecording(){
    if(recording||uploading) return
    setError('')

    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
      setError('Voice recording is not supported in this browser.')
      return
    }

    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false})
      const mime=recordingMime()
      const recorder=mime
        ?new MediaRecorder(stream,{mimeType:mime})
        :new MediaRecorder(stream)

      recorderStreamRef.current=stream
      recorderRef.current=recorder
      recorderChunksRef.current=[]
      recordingStartedRef.current=Date.now()
      setRecordingSeconds(0)

      recorder.ondataavailable=(event)=>{
        if(event.data.size) recorderChunksRef.current.push(event.data)
      }

      recorder.onstop=()=>{
        if(recordingTimerRef.current){
          window.clearInterval(recordingTimerRef.current)
          recordingTimerRef.current=0
        }

        const duration=Math.max(1,Math.ceil((Date.now()-recordingStartedRef.current)/1000))
        const baseMime=cleanMime(recorder.mimeType||recorderChunksRef.current[0]?.type||'audio/webm','voice')
        const blob=new Blob(recorderChunksRef.current,{type:baseMime})

        recorderStreamRef.current?.getTracks().forEach((track)=>track.stop())
        recorderStreamRef.current=null
        recorderRef.current=null
        recorderChunksRef.current=[]
        setRecording(false)

        if(blob.size){
          const extension=extensionFor('',baseMime,'voice')
          void uploadMedia(blob,`voice-${Date.now()}.${extension}`,'voice',duration)
        }
      }

      recorder.start(350)
      setRecording(true)
      recordingTimerRef.current=window.setInterval(()=>{
        setRecordingSeconds(Math.floor((Date.now()-recordingStartedRef.current)/1000))
      },500)
    }catch(reason){
      recorderStreamRef.current?.getTracks().forEach((track)=>track.stop())
      recorderStreamRef.current=null
      setRecording(false)
      setError(reason instanceof Error?reason.message:'Microphone permission was not available.')
    }
  }

  function stopRecording(){
    if(recorderRef.current?.state==='recording'){
      recorderRef.current.stop()
    }
  }

  async function createDirectChat(member:HouseholdUser&{user_id:string}){
    setError('')

    const result=await supabase.rpc('create_direct_messenger_thread_v1',{
      p_household_id:household.id,
      p_other_user_id:member.user_id,
    })

    if(result.error){
      setError(result.error.message)
      return
    }

    const threadId=String(result.data)
    setNewChatOpen(false)
    await loadThreads(false)
    setSelectedThreadId(threadId)
  }

  return (
    <div className={embedded?'messenger-page messenger-page-embedded':'page messenger-page'}>
      {!embedded&&<div className="page-heading-row messenger-page-heading">
        <div>
          <span className="eyebrow">FAMILY MESSENGER</span>
          <h1>Family Messenger</h1>
          <p>Private messages for your household — family chat, direct conversations, photos and voice notes.</p>
        </div>
        <button type="button" className="primary-button compact" onClick={()=>setNewChatOpen(true)}>
          <Plus size={15}/>New chat
        </button>
      </div>}

      {error&&<div className="notice error messenger-notice">{error}</div>}

      <section className={selectedThread?'messenger-shell has-thread':'messenger-shell'}>
        <aside className="messenger-conversations">
          <header>
            <span>
              <strong>Conversations</strong>
              <small>{threads.length} {threads.length===1?'chat':'chats'}</small>
            </span>
            <button type="button" className="icon-button" onClick={()=>setNewChatOpen(true)} aria-label="Start new chat">
              <Plus size={17}/>
            </button>
          </header>

          <div className="messenger-thread-list">
            {loading?(
              <div className="messenger-list-empty">Loading chats…</div>
            ):threads.length===0?(
              <div className="messenger-list-empty">No conversations yet.</div>
            ):threads.map((thread)=>(
              <button
                type="button"
                className={thread.id===selectedThreadId?'messenger-thread active':'messenger-thread'}
                onClick={()=>setSelectedThreadId(thread.id)}
                key={thread.id}
              >
                <span className={thread.thread_type==='household'?'messenger-thread-avatar family':'messenger-thread-avatar'}>
                  {thread.thread_type==='household'
                    ?<Users size={19}/>
                    :<ProfileAvatar avatarPath={thread.other_avatar_path} name={thread.display_title} size="sm"/>}
                </span>
                <span className="messenger-thread-copy">
                  <strong>{thread.display_title}</strong>
                  <small>{threadPreview(thread)}</small>
                </span>
                <span className="messenger-thread-meta">
                  <small>{formatThreadTime(thread.last_message_at)}</small>
                  {thread.unread_count>0&&<b>{Math.min(thread.unread_count,99)}</b>}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="messenger-chat">
          {!selectedThread?(
            <div className="messenger-chat-empty">
              <MessageCircle size={34}/>
              <strong>Select a conversation</strong>
              <span>Your household Family Chat is created automatically.</span>
            </div>
          ):(
            <>
              <header className="messenger-chat-head">
                <button type="button" className="messenger-mobile-back" onClick={()=>setSelectedThreadId('')} aria-label="Back to conversations">
                  <ArrowLeft size={18}/>
                </button>
                <span className={selectedThread.thread_type==='household'?'messenger-chat-avatar family':'messenger-chat-avatar'}>
                  {selectedThread.thread_type==='household'
                    ?<Users size={20}/>
                    :<ProfileAvatar avatarPath={selectedThread.other_avatar_path} name={selectedThread.display_title} size="sm"/>}
                </span>
                <span>
                  <strong>{selectedThread.display_title}</strong>
                  <small>{selectedThread.thread_type==='household'?'Everyone with a Famioo household login':'Private family conversation'}</small>
                </span>
              </header>

              <div className="messenger-message-list">
                {messages.length===0?(
                  <div className="messenger-first-message">
                    <MessageCircle size={26}/>
                    <strong>Start the conversation</strong>
                    <span>Send a message, photo or voice note.</span>
                  </div>
                ):messages.map((message)=>{
                  const mediaUrl=message.media_path?mediaUrls[message.media_path]:''
                  return (
                    <div className={message.is_mine?'messenger-message-row mine':'messenger-message-row'} key={message.id}>
                      {!message.is_mine&&(
                        <ProfileAvatar avatarPath={message.sender_avatar_path} name={message.sender_name} size="sm"/>
                      )}
                      <div className={message.is_mine?'messenger-bubble mine':'messenger-bubble'}>
                        {!message.is_mine&&<span className="messenger-sender-name">{message.sender_name}</span>}

                        {message.message_type==='photo'&&(
                          mediaUrl
                            ?<a href={mediaUrl} target="_blank" rel="noreferrer" className="messenger-photo-link">
                              <img src={mediaUrl} alt={message.media_name||'Shared photo'}/>
                            </a>
                            :<div className="messenger-media-loading">Loading photo…</div>
                        )}

                        {message.message_type==='voice'&&(
                          mediaUrl
                            ?<div className="messenger-voice">
                              <Mic size={15}/>
                              <audio controls preload="metadata" src={mediaUrl}/>
                              {message.media_duration_s!=null&&<small>{message.media_duration_s}s</small>}
                            </div>
                            :<div className="messenger-media-loading">Loading voice message…</div>
                        )}

                        {message.body&&<p>{message.body}</p>}
                        <time>{formatMessageTime(message.created_at)}</time>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef}/>
              </div>

              <footer className="messenger-composer">
                {recording&&(
                  <div className="messenger-recording">
                    <span className="messenger-recording-dot"/>
                    <strong>Recording… {recordingSeconds}s</strong>
                    <button type="button" onClick={stopRecording}><MicOff size={14}/>Stop & send</button>
                  </div>
                )}

                <div className="messenger-compose-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    onChange={choosePhoto}
                    hidden
                  />
                  <button
                    type="button"
                    className="messenger-compose-action"
                    onClick={()=>fileInputRef.current?.click()}
                    disabled={uploading||sending||recording}
                    aria-label="Send photo"
                  >
                    <ImagePlus size={18}/>
                  </button>
                  <button
                    type="button"
                    className={recording?'messenger-compose-action recording':'messenger-compose-action'}
                    onClick={recording?stopRecording:()=>void startRecording()}
                    disabled={uploading||sending}
                    aria-label={recording?'Stop voice recording':'Record voice message'}
                  >
                    {recording?<MicOff size={18}/>:<Mic size={18}/>}
                  </button>
                  <textarea
                    value={draft}
                    onChange={(event)=>setDraft(event.target.value)}
                    onKeyDown={onDraftKeyDown}
                    placeholder={uploading?'Uploading…':'Message your family…'}
                    rows={1}
                    disabled={uploading||recording}
                    maxLength={4000}
                  />
                  <button
                    type="button"
                    className="messenger-send"
                    onClick={submitText}
                    disabled={!draft.trim()||sending||uploading||recording}
                    aria-label="Send message"
                  >
                    <Send size={18}/>
                  </button>
                </div>

                <small className="messenger-compose-hint">
                  <Camera size={12}/>Photos up to 15 MB · Enter sends · Shift+Enter adds a new line
                </small>
              </footer>
            </>
          )}
        </div>
      </section>

      {newChatOpen&&(
        <div className="modal-backdrop messenger-new-chat-backdrop" role="dialog" aria-modal="true" aria-label="Start new family chat">
          <section className="modal-card messenger-new-chat">
            <header>
              <div>
                <span className="eyebrow">NEW CHAT</span>
                <h2>Message a family member</h2>
              </div>
              <button type="button" className="icon-button" onClick={()=>setNewChatOpen(false)} aria-label="Close">
                <X size={18}/>
              </button>
            </header>

            <button
              type="button"
              className="messenger-new-chat-family"
              onClick={()=>{
                const family=threads.find((thread)=>thread.thread_type==='household')
                if(family) setSelectedThreadId(family.id)
                setNewChatOpen(false)
              }}
            >
              <span><Users size={20}/></span>
              <span>
                <strong>Family chat</strong>
                <small>Message everyone in the household.</small>
              </span>
            </button>

            <div className="messenger-new-chat-members">
              {directCandidates.length?directCandidates.map((member)=>(
                <button type="button" onClick={()=>void createDirectChat(member)} key={member.user_id}>
                  <ProfileAvatar avatarPath={member.avatar_path} name={member.display_name} size="md"/>
                  <span>
                    <strong>{member.display_name}</strong>
                    <small>{member.profile_type==='child'?'Child account':'Family member'}</small>
                  </span>
                  <b>›</b>
                </button>
              )):<div className="messenger-list-empty">No other logged-in household members are available yet.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
