import {
  AudioLines,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  KeyRound,
  ListChecks,
  RotateCcw,
  ShoppingCart,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type VoiceAction='calendar_query'|'shopping_add'|'task_add'|'reminders_query'
type SettingsRow={
  household_id:string
  provider:'alexa'
  enabled:boolean
  allowed_actions:VoiceAction[]
  token_prefix:string|null
  token_rotated_at:string|null
  updated_at:string
}
type LogRow={
  id:string
  intent:string
  success:boolean
  summary:string|null
  created_at:string
}

const actionMeta:Record<VoiceAction,{label:string;description:string;icon:typeof CalendarDays}>={
  calendar_query:{label:'Calendar queries',description:'Ask what is on the household calendar for a date.',icon:CalendarDays},
  shopping_add:{label:'Add shopping items',description:'Add an item to an active Famioo shopping list.',icon:ShoppingCart},
  task_add:{label:'Create tasks',description:'Create a Famioo task with an optional due date.',icon:ListChecks},
  reminders_query:{label:'Read reminders',description:'Read open Famioo tasks due on a selected date.',icon:Sparkles},
}

function todayKey(){
  return new Date().toISOString().slice(0,10)
}

export function VoiceIntegrationPage(){
  const {household}=useHousehold()
  const canConfigure=household.role==='owner'||household.role==='admin'
  const [settings,setSettings]=useState<SettingsRow|null>(null)
  const [logs,setLogs]=useState<LogRow[]>([])
  const [enabled,setEnabled]=useState(false)
  const [allowed,setAllowed]=useState<VoiceAction[]>(['calendar_query','shopping_add','task_add','reminders_query'])
  const [token,setToken]=useState('')
  const [saving,setSaving]=useState(false)
  const [testing,setTesting]=useState(false)
  const [intent,setIntent]=useState<VoiceAction>('calendar_query')
  const [date,setDate]=useState(todayKey())
  const [itemText,setItemText]=useState('')
  const [quantity,setQuantity]=useState('')
  const [taskTitle,setTaskTitle]=useState('')
  const [result,setResult]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  async function load(){
    setError('')
    if(!canConfigure)return
    const [settingsResult,logResult]=await Promise.all([
      supabase.from('voice_integration_settings')
        .select('household_id,provider,enabled,allowed_actions,token_prefix,token_rotated_at,updated_at')
        .eq('household_id',household.id).maybeSingle(),
      supabase.from('voice_integration_action_log')
        .select('id,intent,success,summary,created_at')
        .eq('household_id',household.id).order('created_at',{ascending:false}).limit(20),
    ])
    if(settingsResult.error){setError(settingsResult.error.message);return}
    const row=settingsResult.data as SettingsRow|null
    setSettings(row)
    setEnabled(Boolean(row?.enabled))
    setAllowed(row?.allowed_actions?.length?row.allowed_actions:['calendar_query','shopping_add','task_add','reminders_query'])
    if(!logResult.error)setLogs((logResult.data??[]) as LogRow[])
  }

  useEffect(()=>{void load()},[household.id,canConfigure])

  function toggleAction(action:VoiceAction,value:boolean){
    setAllowed(current=>value
      ?Array.from(new Set([...current,action]))
      :current.filter(item=>item!==action)
    )
  }

  async function saveSettings(){
    if(!canConfigure)return
    setSaving(true);setError('');setMessage('')
    const response=await supabase.rpc('save_voice_integration_settings_v1',{
      p_household_id:household.id,p_enabled:enabled,p_allowed_actions:allowed,
    })
    setSaving(false)
    if(response.error){setError(response.error.message);return}
    setMessage('Voice permissions saved.')
    await load()
  }

  async function rotateToken(){
    if(!window.confirm(settings?.token_prefix
      ?'Rotate the voice integration token? The previous token will stop working immediately.'
      :'Generate a voice integration token?'
    ))return
    setSaving(true);setError('');setMessage('');setToken('')
    const response=await supabase.rpc('rotate_voice_integration_token_v1',{p_household_id:household.id})
    setSaving(false)
    if(response.error||!response.data){setError(response.error?.message??'Could not generate voice token.');return}
    setToken(String(response.data))
    setMessage('New integration token generated. Copy it now — Famioo will not show the full token again.')
    await load()
  }

  async function copyToken(){
    if(!token)return
    await navigator.clipboard?.writeText(token)
    setMessage('Integration token copied.')
  }

  const slots=useMemo(()=>{
    if(intent==='calendar_query'||intent==='reminders_query')return {date}
    if(intent==='shopping_add')return {item_text:itemText.trim(),quantity:quantity.trim()||null}
    return {title:taskTitle.trim(),due_date:date||null}
  },[date,intent,itemText,quantity,taskTitle])

  async function testVoice(){
    setTesting(true);setError('');setResult('')
    const response=await supabase.functions.invoke('famioo-voice-command',{
      body:{household_id:household.id,intent,slots},
    })
    setTesting(false)
    if(response.error||response.data?.error){
      setError(String(response.data?.error||response.error?.message||'Voice test failed.'))
      await load()
      return
    }
    setResult(String(response.data?.speech||'Voice action completed.'))
    await load()
  }

  if(!canConfigure)return <div className="page voice-page">
    <div className="page-heading-row"><div><span className="eyebrow">ALEXA / VOICE INTEGRATION</span><h1>Alexa & Voice</h1></div></div>
    <div className="voice-owner-only"><KeyRound size={25}/><strong>Owner/admin setup required</strong><span>Only a household owner or admin can connect an external voice assistant or change voice permissions.</span></div>
  </div>

  return <div className="page voice-page">
    <div className="page-heading-row voice-heading">
      <div><span className="eyebrow">ALEXA / VOICE INTEGRATION</span><h1>Alexa & Voice</h1><p>Choose exactly what an external voice assistant may read or create in Famioo.</p></div>
      <span className={enabled?'voice-state enabled':'voice-state'}>{enabled?<><CheckCircle2 size={14}/>Enabled</>:<><XCircle size={14}/>Disabled</>}</span>
    </div>

    <div className="voice-platform-note">
      <AudioLines size={17}/>
      <span><strong>Famioo-side integration is ready.</strong> The command endpoint and secure token are implemented. Publishing the Amazon Alexa Skill and configuring Amazon account linking still require an Alexa Developer account and Amazon-side credentials.</span>
    </div>

    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    <section className="voice-settings-card">
      <header><div><span className="eyebrow">VOICE ACCESS</span><h2>Allowed Alexa actions</h2></div><label className="voice-enable"><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/><span>{enabled?'Integration enabled':'Integration disabled'}</span></label></header>
      <div className="voice-action-grid">
        {(Object.keys(actionMeta) as VoiceAction[]).map(action=>{
          const meta=actionMeta[action]
          const Icon=meta.icon
          return <label key={action} className={allowed.includes(action)?'active':''}>
            <span className="voice-action-icon"><Icon size={18}/></span>
            <span><strong>{meta.label}</strong><small>{meta.description}</small></span>
            <input type="checkbox" checked={allowed.includes(action)} onChange={event=>toggleAction(action,event.target.checked)}/>
          </label>
        })}
      </div>
      <footer><button className="primary-button compact" disabled={saving} onClick={()=>void saveSettings()}>{saving?'Saving…':'Save permissions'}</button></footer>
    </section>

    <section className="voice-token-card">
      <header><div><span className="eyebrow">AMAZON SKILL LINK</span><h2>Integration token</h2></div><button className="secondary-button compact" disabled={saving} onClick={()=>void rotateToken()}><RotateCcw size={13}/>{settings?.token_prefix?'Rotate token':'Generate token'}</button></header>
      {token?<div className="voice-token-value"><code>{token}</code><button onClick={()=>void copyToken()} title="Copy token"><Clipboard size={15}/></button></div>:settings?.token_prefix?<div className="voice-token-existing"><KeyRound size={16}/><span><strong>{settings.token_prefix}••••••••</strong><small>Full token hidden. Rotate it if you need a new value.</small></span></div>:<p>No integration token has been generated yet.</p>}
      <p>The Amazon Skill backend should send this token as <code>Authorization: Bearer &lt;token&gt;</code> when calling the Famioo voice endpoint. The plaintext token is shown only when generated.</p>
    </section>

    <section className="voice-test-card">
      <header><div><span className="eyebrow">TEST BEFORE AMAZON</span><h2>Voice command simulator</h2></div></header>
      <div className="voice-test-form">
        <label><span>Intent</span><select value={intent} onChange={event=>setIntent(event.target.value as VoiceAction)}><option value="calendar_query">Calendar query</option><option value="shopping_add">Add shopping item</option><option value="task_add">Create task</option><option value="reminders_query">Read reminders</option></select></label>
        {(intent==='calendar_query'||intent==='reminders_query'||intent==='task_add')&&<label><span>{intent==='task_add'?'Due date':'Date'}</span><input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>}
        {intent==='shopping_add'&&<><label><span>Item</span><input value={itemText} onChange={event=>setItemText(event.target.value)} placeholder="Milk"/></label><label><span>Quantity</span><input value={quantity} onChange={event=>setQuantity(event.target.value)} placeholder="2"/></label></>}
        {intent==='task_add'&&<label className="voice-test-wide"><span>Task</span><input value={taskTitle} onChange={event=>setTaskTitle(event.target.value)} placeholder="Take bins outside"/></label>}
      </div>
      <button className="secondary-button compact" disabled={testing||!enabled||!allowed.includes(intent)||(intent==='shopping_add'&&!itemText.trim())||(intent==='task_add'&&!taskTitle.trim())} onClick={()=>void testVoice()}><AudioLines size={13}/>{testing?'Testing…':'Run voice test'}</button>
      {result&&<div className="voice-test-result"><Sparkles size={15}/><span>{result}</span></div>}
    </section>

    <section className="voice-log-card">
      <div><span className="eyebrow">RECENT VOICE ACTIONS</span><h2>Integration log</h2></div>
      {logs.length===0?<div className="voice-empty">No voice actions yet.</div>:<div className="voice-log-list">{logs.map(row=><article key={row.id}><span className={row.success?'success':'failed'}>{row.success?<CheckCircle2 size={13}/>:<XCircle size={13}/>}</span><div><strong>{actionMeta[row.intent as VoiceAction]?.label??row.intent}</strong><small>{row.summary||'No summary'} · {new Date(row.created_at).toLocaleString()}</small></div></article>)}</div>}
    </section>
  </div>
}
