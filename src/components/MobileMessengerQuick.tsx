import { MessageCircle, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'
import { MessengerPage } from '../pages/MessengerPage'
import './MobileMessengerQuick.css'

type ThreadSummary={
  id:string
  unread_count:number
}

export function MobileMessengerQuick(){
  const {household,modules}=useHousehold()
  const enabled=modules.some(module=>module.code==='messenger'&&module.enabled)
  const compactWithSafety = !modules.some(module=>module.code==='assistant'&&module.enabled)
    && modules.some(module=>module.code==='safety'&&module.enabled)
  const [open,setOpen]=useState(false)
  const [initialThreadId,setInitialThreadId]=useState('')
  const [threads,setThreads]=useState<ThreadSummary[]>([])

  const unread=useMemo(
    ()=>threads.reduce((sum,row)=>sum+Number(row.unread_count??0),0),
    [threads],
  )

  async function loadUnread(){
    if(!enabled)return
    const result=await supabase.rpc('messenger_threads_v1',{p_household_id:household.id})
    if(result.error)return
    setThreads(((result.data??[]) as ThreadSummary[]).map(row=>({
      id:String(row.id),
      unread_count:Number(row.unread_count??0),
    })))
  }

  useEffect(()=>{
    if(!enabled)return
    void loadUnread()
    const timer=window.setInterval(()=>{void loadUnread()},4000)
    return()=>window.clearInterval(timer)
  },[household.id,enabled])

  useEffect(()=>{
    setOpen(false)
    setInitialThreadId('')
  },[household.id])

  useEffect(()=>{
    function openMessenger(event:Event){
      const detail=(event as CustomEvent<{threadId?:string}>).detail
      setInitialThreadId(detail?.threadId??'')
      setOpen(true)
      window.setTimeout(()=>void loadUnread(),500)
    }
    window.addEventListener('famioo:open-messenger',openMessenger)
    return()=>window.removeEventListener('famioo:open-messenger',openMessenger)
  },[household.id,enabled])

  useEffect(()=>{
    if(!open)return
    const previousOverflow=document.body.style.overflow
    const previousOverscroll=document.body.style.overscrollBehavior
    document.body.style.overflow='hidden'
    document.body.style.overscrollBehavior='none'
    return()=>{
      document.body.style.overflow=previousOverflow
      document.body.style.overscrollBehavior=previousOverscroll
      void loadUnread()
    }
  },[open])

  if(!enabled)return null

  return <>
    <button
      type="button"
      className={(open?'mobile-messenger-tab active':'mobile-messenger-tab')+(compactWithSafety?' no-ai-gap':'')}
      onClick={()=>setOpen(current=>!current)}
      aria-label={open?'Close Family Messenger':'Open Family Messenger'}
      aria-expanded={open}
    >
      <MessageCircle size={18}/>
      <span>Chat</span>
      {unread>0&&<b>{unread>99?'99+':unread}</b>}
    </button>

    {open&&<>
      <button type="button" className="mobile-messenger-backdrop" aria-label="Close Family Messenger" onClick={()=>setOpen(false)}/>
      <aside className="mobile-messenger-drawer" aria-label="Family Messenger">
        <header className="mobile-messenger-head">
          <span>
            <i><MessageCircle size={18}/></i>
            <span><strong>Family Messenger</strong><small>{unread>0?unread+' unread message'+(unread===1?'':'s'):'Household chat'}</small></span>
          </span>
          <button type="button" onClick={()=>setOpen(false)} aria-label="Close Family Messenger"><X size={19}/></button>
        </header>
        <div className="mobile-messenger-body">
          <MessengerPage embedded initialThreadId={initialThreadId}/>
        </div>
      </aside>
    </>}
  </>
}
