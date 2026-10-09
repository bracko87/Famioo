import { Mic, PhoneCall, PhoneOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type SafetyCallContact={
  user_id:string
  display_name:string
}

type SafetyCall={
  id:string
  household_id:string
  alert_id:string
  caller_user_id:string
  recipient_user_id:string
  status:'ringing'|'accepted'|'declined'|'ended'|'failed'
  offer_sdp:string|null
  answer_sdp:string|null
  created_at:string
  answered_at:string|null
  ended_at:string|null
}

type IceRow={
  id:string
  call_id:string
  user_id:string
  candidate_json:RTCIceCandidateInit
}

type Props={
  householdId:string
  userId:string
  contacts:SafetyCallContact[]
  onReady?:(api:{start:(alertId:string,recipientUserId:string)=>Promise<void>})=>void
}

const rtcConfiguration:RTCConfiguration={
  iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
  ],
}

export function SafetyInternetCall({householdId,userId,contacts,onReady}:Props){
  const [calls,setCalls]=useState<SafetyCall[]>([])
  const [activeCallId,setActiveCallId]=useState('')
  const [statusText,setStatusText]=useState('')
  const [error,setError]=useState('')

  const peerRef=useRef<RTCPeerConnection|null>(null)
  const localStreamRef=useRef<MediaStream|null>(null)
  const remoteAudioRef=useRef<HTMLAudioElement|null>(null)
  const seenIceRef=useRef(new Set<string>())

  const contactById=useMemo(
    ()=>new Map(contacts.map((contact)=>[contact.user_id,contact])),
    [contacts],
  )

  const activeCall=calls.find((call)=>call.id===activeCallId)??null
  const incoming=calls.find(
    (call)=>call.recipient_user_id===userId&&call.status==='ringing'&&Boolean(call.offer_sdp),
  )??null

  const stopMedia=useCallback(()=>{
    localStreamRef.current?.getTracks().forEach((track)=>track.stop())
    localStreamRef.current=null
    peerRef.current?.close()
    peerRef.current=null
    seenIceRef.current.clear()
  },[])

  const attachPeer=useCallback(async (callId:string)=>{
    stopMedia()

    if(!navigator.mediaDevices?.getUserMedia){
      throw new Error('Internet calling is not supported on this device/browser.')
    }

    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false})
    localStreamRef.current=stream

    const peer=new RTCPeerConnection(rtcConfiguration)
    peerRef.current=peer

    for(const track of stream.getTracks()) peer.addTrack(track,stream)

    peer.onicecandidate=(event)=>{
      if(!event.candidate) return
      void supabase.rpc('add_safety_call_ice_v1',{
        p_call_id:callId,
        p_candidate_json:event.candidate.toJSON(),
      })
    }

    peer.ontrack=(event)=>{
      const remote=event.streams[0]
      if(!remote||!remoteAudioRef.current) return
      remoteAudioRef.current.srcObject=remote
      void remoteAudioRef.current.play().catch(()=>{})
    }

    peer.onconnectionstatechange=()=>{
      if(peer.connectionState==='connected') setStatusText('Connected')
      if(peer.connectionState==='failed') setStatusText('Connection failed')
      if(peer.connectionState==='disconnected') setStatusText('Connection interrupted')
    }

    return peer
  },[stopMedia])

  const loadCalls=useCallback(async ()=>{
    const result=await supabase
      .from('safety_calls')
      .select('id,household_id,alert_id,caller_user_id,recipient_user_id,status,offer_sdp,answer_sdp,created_at,answered_at,ended_at')
      .eq('household_id',householdId)
      .order('created_at',{ascending:false})
      .limit(20)

    if(result.error) return
    const rows=(result.data??[]) as SafetyCall[]
    setCalls(rows)

    if(activeCallId){
      const current=rows.find((call)=>call.id===activeCallId)
      if(!current||['declined','ended','failed'].includes(current.status)){
        stopMedia()
        setActiveCallId('')
        setStatusText(current?.status==='declined'?'Call declined':'Call ended')
        return
      }

      const peer=peerRef.current
      if(peer&&current.caller_user_id===userId&&current.answer_sdp&&!peer.remoteDescription){
        try{
          await peer.setRemoteDescription({type:'answer',sdp:current.answer_sdp})
        }catch(reason){
          setError(reason instanceof Error?reason.message:'Could not connect internet call.')
        }
      }

      const ice=await supabase
        .from('safety_call_ice')
        .select('id,call_id,user_id,candidate_json')
        .eq('call_id',current.id)
        .order('created_at',{ascending:true})

      if(!ice.error&&peer){
        for(const row of (ice.data??[]) as IceRow[]){
          if(row.user_id===userId||seenIceRef.current.has(row.id)) continue
          try{
            await peer.addIceCandidate(row.candidate_json)
            seenIceRef.current.add(row.id)
          }catch{
            // Candidate can arrive before the remote description; the next poll retries it.
          }
        }
      }
    }
  },[activeCallId,householdId,stopMedia,userId])

  useEffect(()=>{
    void loadCalls()
    const timer=window.setInterval(()=>{ void loadCalls() },2000)
    return ()=>{
      window.clearInterval(timer)
      stopMedia()
    }
  },[loadCalls,stopMedia])

  const start=useCallback(async (alertId:string,recipientUserId:string)=>{
    setError('')
    setStatusText('Starting internet call…')

    try{
      const startResult=await supabase.rpc('start_safety_call_v1',{
        p_alert_id:alertId,
        p_recipient_user_id:recipientUserId,
      })
      if(startResult.error) throw startResult.error

      const callId=String(startResult.data)
      setActiveCallId(callId)

      const peer=await attachPeer(callId)
      const offer=await peer.createOffer()
      await peer.setLocalDescription(offer)

      const saveOffer=await supabase.rpc('set_safety_call_offer_v1',{
        p_call_id:callId,
        p_offer_sdp:offer.sdp??'',
      })
      if(saveOffer.error) throw saveOffer.error

      setStatusText('Calling '+(contactById.get(recipientUserId)?.display_name??'family member')+'…')
      await loadCalls()
    }catch(reason){
      stopMedia()
      setActiveCallId('')
      setStatusText('')
      setError(reason instanceof Error?reason.message:'Could not start internet call.')
    }
  },[attachPeer,contactById,loadCalls,stopMedia])

  useEffect(()=>{
    onReady?.({start})
  },[onReady,start])

  async function answer(call:SafetyCall){
    setError('')
    setStatusText('Connecting…')

    try{
      const peer=await attachPeer(call.id)
      setActiveCallId(call.id)

      await peer.setRemoteDescription({type:'offer',sdp:call.offer_sdp??''})
      const answer=await peer.createAnswer()
      await peer.setLocalDescription(answer)

      const result=await supabase.rpc('answer_safety_call_v1',{
        p_call_id:call.id,
        p_answer_sdp:answer.sdp??'',
      })
      if(result.error) throw result.error

      setStatusText('Connected')
      await loadCalls()
    }catch(reason){
      stopMedia()
      setActiveCallId('')
      setError(reason instanceof Error?reason.message:'Could not answer internet call.')
    }
  }

  async function end(callId:string,status:'declined'|'ended'='ended'){
    await supabase.rpc('end_safety_call_v1',{
      p_call_id:callId,
      p_status:status,
    })
    stopMedia()
    setActiveCallId('')
    setStatusText(status==='declined'?'Call declined':'Call ended')
    await loadCalls()
  }

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline/>

      {incoming&&!activeCall&&(
        <div className="safety-incoming-call">
          <span className="safety-incoming-call-icon"><PhoneCall size={20}/></span>
          <span>
            <strong>Incoming Famioo safety call</strong>
            <small>{contactById.get(incoming.caller_user_id)?.display_name??'Family member'} is calling over the internet.</small>
          </span>
          <div>
            <button type="button" className="primary-button compact" onClick={()=>void answer(incoming)}>
              <Mic size={14}/>Answer
            </button>
            <button type="button" className="secondary-button compact" onClick={()=>void end(incoming.id,'declined')}>
              <PhoneOff size={14}/>Decline
            </button>
          </div>
        </div>
      )}

      {activeCall&&(
        <div className="safety-live-call">
          <span className="safety-live-call-dot"/>
          <span>
            <strong>{statusText||'Safety call active'}</strong>
            <small>
              {activeCall.caller_user_id===userId
                ? contactById.get(activeCall.recipient_user_id)?.display_name??'Family member'
                : contactById.get(activeCall.caller_user_id)?.display_name??'Family member'}
            </small>
          </span>
          <button type="button" className="secondary-button compact" onClick={()=>void end(activeCall.id)}>
            <PhoneOff size={14}/>End call
          </button>
        </div>
      )}

      {!activeCall&&statusText&&<div className="safety-call-status">{statusText}</div>}
      {error&&<div className="notice error safety-call-error">{error}</div>}
    </>
  )
}
