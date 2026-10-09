import {
  Archive,
  Coins,
  Gift,
  History,
  MinusCircle,
  Pencil,
  Plus,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type ChildBalance={
  profile_id:string
  display_name:string
  avatar_path:string|null
  profile_type:string
  project_points:number
  task_points:number
  adjustment_points:number
  spent_points:number
  balance:number
}

type Reward={
  id:string
  title:string
  description:string|null
  emoji:string|null
  cost_points:number
  active:boolean
  sort_order:number
  created_at:string
  updated_at:string
}

type RewardTask={
  task_id:string
  title:string
  assigned_profile_id:string
  assigned_name:string
  reward_points:number
  status:string
  due_date:string|null
}

type HistoryRow={
  entry_id:string
  profile_id:string
  entry_type:'chore'|'task'|'adjustment'|'redemption'
  title:string
  points_delta:number
  occurred_at:string
}

type RewardDraft={
  id:string
  title:string
  description:string
  emoji:string
  cost_points:string
  active:boolean
}

const emptyReward:RewardDraft={
  id:'',
  title:'',
  description:'',
  emoji:'🎁',
  cost_points:'20',
  active:true,
}

function fmtDate(value:string){
  return new Date(value).toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})
}

export function RewardsPage(){
  const {household}=useHousehold()
  const canManage=household.role==='owner'||household.role==='admin'
  const [children,setChildren]=useState<ChildBalance[]>([])
  const [rewards,setRewards]=useState<Reward[]>([])
  const [tasks,setTasks]=useState<RewardTask[]>([])
  const [history,setHistory]=useState<HistoryRow[]>([])
  const [selectedChild,setSelectedChild]=useState('')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [rewardEditorOpen,setRewardEditorOpen]=useState(false)
  const [rewardDraft,setRewardDraft]=useState<RewardDraft>(emptyReward)
  const [saving,setSaving]=useState(false)
  const [taskBusy,setTaskBusy]=useState('')
  const [adjustOpen,setAdjustOpen]=useState(false)
  const [adjustPoints,setAdjustPoints]=useState('5')
  const [adjustNote,setAdjustNote]=useState('Bonus')
  const [historyFilter,setHistoryFilter]=useState<'all'|'earn'|'spend'>('all')

  async function load(foreground=false){
    if(foreground)setLoading(true)
    setError('')
    const [overviewResult,catalogResult,tasksResult,historyResult]=await Promise.all([
      supabase.rpc('child_reward_overview_v1',{p_household_id:household.id}),
      supabase.rpc('child_reward_catalog_v1',{p_household_id:household.id,p_include_inactive:canManage}),
      supabase.rpc('child_reward_tasks_v1',{p_household_id:household.id}),
      supabase.rpc('child_reward_history_v1',{p_household_id:household.id,p_profile_id:null,p_limit:150}),
    ])

    const failure=overviewResult.error||catalogResult.error||tasksResult.error||historyResult.error
    if(failure)setError(failure.message)

    const childRows=((overviewResult.data??[]) as ChildBalance[]).map(row=>({
      ...row,
      project_points:Number(row.project_points??0),
      task_points:Number(row.task_points??0),
      adjustment_points:Number(row.adjustment_points??0),
      spent_points:Number(row.spent_points??0),
      balance:Number(row.balance??0),
    }))
    setChildren(childRows)
    setRewards(((catalogResult.data??[]) as Reward[]).map(row=>({...row,cost_points:Number(row.cost_points)})))
    setTasks(((tasksResult.data??[]) as RewardTask[]).map(row=>({...row,reward_points:Number(row.reward_points??0)})))
    setHistory(((historyResult.data??[]) as HistoryRow[]).map(row=>({...row,points_delta:Number(row.points_delta??0)})))
    setSelectedChild(current=>childRows.some(row=>row.profile_id===current)?current:(childRows[0]?.profile_id??''))
    if(foreground)setLoading(false)
  }

  useEffect(()=>{void load(true)},[household.id])

  const selected=children.find(child=>child.profile_id===selectedChild)??children[0]??null
  const selectedTasks=tasks.filter(task=>!selected||task.assigned_profile_id===selected.profile_id)
  const visibleHistory=history.filter(row=>{
    if(selected&&row.profile_id!==selected.profile_id)return false
    if(historyFilter==='earn'&&row.points_delta<=0)return false
    if(historyFilter==='spend'&&row.points_delta>=0)return false
    return true
  })

  function openNewReward(){
    setRewardDraft({...emptyReward})
    setRewardEditorOpen(true)
    setError('');setMessage('')
  }

  function openEditReward(reward:Reward){
    setRewardDraft({
      id:reward.id,
      title:reward.title,
      description:reward.description??'',
      emoji:reward.emoji??'🎁',
      cost_points:String(reward.cost_points),
      active:reward.active,
    })
    setRewardEditorOpen(true)
    setError('');setMessage('')
  }

  async function saveReward(event:FormEvent){
    event.preventDefault()
    const cost=Number(rewardDraft.cost_points)
    if(!rewardDraft.title.trim()||!Number.isFinite(cost)||cost<1)return
    setSaving(true);setError('');setMessage('')
    const result=await supabase.rpc('save_child_reward_v1',{
      p_household_id:household.id,
      p_id:rewardDraft.id||null,
      p_title:rewardDraft.title.trim(),
      p_description:rewardDraft.description.trim()||null,
      p_emoji:rewardDraft.emoji.trim()||null,
      p_cost_points:Math.round(cost),
      p_active:rewardDraft.active,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setRewardEditorOpen(false)
    setMessage(rewardDraft.id?'Reward updated.':'Reward added to the catalogue.')
    await load(false)
  }

  async function toggleReward(reward:Reward){
    const result=await supabase.rpc('set_child_reward_active_v1',{
      p_household_id:household.id,p_id:reward.id,p_active:!reward.active,
    })
    if(result.error){setError(result.error.message);return}
    await load(false)
  }

  async function setTaskPoints(task:RewardTask,value:string){
    const points=Math.max(0,Math.min(1000,Math.round(Number(value)||0)))
    setTaskBusy(task.task_id);setError('');setMessage('')
    const result=await supabase.rpc('set_task_reward_points_v1',{
      p_household_id:household.id,p_task_id:task.task_id,p_points:points,
    })
    setTaskBusy('')
    if(result.error){setError(result.error.message);return}
    setMessage(points?task.title+' now earns '+points+' points.':'Task reward removed.')
    await load(false)
  }

  async function redeem(reward:Reward){
    if(!selected)return
    if(selected.balance<reward.cost_points)return
    if(!window.confirm(`Redeem “${reward.title}” for ${selected.display_name} for ${reward.cost_points} points?`))return
    setError('');setMessage('')
    const result=await supabase.rpc('redeem_child_reward_v1',{
      p_household_id:household.id,p_profile_id:selected.profile_id,p_reward_id:reward.id,
    })
    if(result.error){setError(result.error.message);return}
    setMessage(reward.title+' redeemed for '+selected.display_name+'.')
    await load(false)
  }

  async function addAdjustment(event:FormEvent){
    event.preventDefault()
    if(!selected)return
    const points=Math.round(Number(adjustPoints))
    if(!points||!adjustNote.trim())return
    setSaving(true);setError('');setMessage('')
    const result=await supabase.rpc('adjust_child_reward_points_v1',{
      p_household_id:household.id,p_profile_id:selected.profile_id,p_points:points,p_note:adjustNote.trim(),
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setAdjustOpen(false)
    setMessage((points>0?'+':'')+points+' points applied to '+selected.display_name+'.')
    await load(false)
  }

  if(loading)return <div className="page rewards-page"><div className="rewards-empty">Loading rewards…</div></div>

  return (
    <div className="page rewards-page">
      <div className="page-heading-row rewards-heading">
        <div>
          <span className="eyebrow">CHILD REWARDS ECONOMY</span>
          <h1>Earn, save & choose rewards</h1>
          <p>Turn completed tasks and chores into points, then let family goals become something children can work toward.</p>
        </div>
        {canManage&&<button type="button" className="primary-button compact" onClick={openNewReward}><Plus size={15}/>Add reward</button>}
      </div>

      {error&&<div className="notice error">{error}</div>}
      {message&&<div className="notice">{message}</div>}

      {children.length===0?(
        <div className="rewards-empty"><Gift size={32}/><strong>No child profiles yet</strong><span>Add a child/profile-only family member first, then rewards can be tracked here.</span></div>
      ):(
        <>
          <section className="rewards-child-strip">
            {children.map(child=>(
              <button type="button" className={child.profile_id===selected?.profile_id?'rewards-child active':'rewards-child'} onClick={()=>setSelectedChild(child.profile_id)} key={child.profile_id}>
                <ProfileAvatar avatarPath={child.avatar_path} name={child.display_name} size="md"/>
                <span><strong>{child.display_name}</strong><small>{child.balance} points available</small></span>
                <b>{child.balance}</b>
              </button>
            ))}
          </section>

          {selected&&<section className="rewards-balance-grid">
            <article className="reward-balance-card primary"><Coins size={19}/><span><small>AVAILABLE</small><strong>{selected.balance}</strong><em>points</em></span></article>
            <article className="reward-balance-card"><Star size={18}/><span><small>CHORES & PROJECTS</small><strong>+{selected.project_points}</strong></span></article>
            <article className="reward-balance-card"><Sparkles size={18}/><span><small>TASKS</small><strong>+{selected.task_points}</strong></span></article>
            <article className="reward-balance-card"><Gift size={18}/><span><small>REDEEMED</small><strong>-{selected.spent_points}</strong></span></article>
          </section>}

          <section className="rewards-section">
            <div className="rewards-section-head">
              <div><span className="eyebrow">REWARD CATALOGUE</span><h2>What points can buy</h2></div>
              {canManage&&<button type="button" className="secondary-button compact" onClick={openNewReward}><Plus size={14}/>New reward</button>}
            </div>
            {rewards.filter(reward=>reward.active||canManage).length===0?(
              <div className="rewards-empty compact"><Gift size={26}/><strong>No rewards yet</strong><span>Create a few simple family rewards to get started.</span></div>
            ):(
              <div className="reward-catalog-grid">
                {rewards.filter(reward=>reward.active||canManage).map(reward=>(
                  <article className={reward.active?'reward-catalog-card':'reward-catalog-card inactive'} key={reward.id}>
                    <span className="reward-emoji">{reward.emoji||'🎁'}</span>
                    <div><small>{reward.active?'AVAILABLE':'PAUSED'}</small><strong>{reward.title}</strong>{reward.description&&<p>{reward.description}</p>}</div>
                    <b>{reward.cost_points}<small> pts</small></b>
                    <footer>
                      {canManage&&<button type="button" onClick={()=>openEditReward(reward)}><Pencil size={13}/>Edit</button>}
                      {canManage&&<button type="button" onClick={()=>void toggleReward(reward)}><Archive size={13}/>{reward.active?'Pause':'Activate'}</button>}
                      {canManage&&reward.active&&selected&&<button type="button" className="reward-redeem" disabled={selected.balance<reward.cost_points} onClick={()=>void redeem(reward)}><Gift size={13}/>Redeem</button>}
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </section>

          {canManage&&<section className="rewards-section">
            <div className="rewards-section-head">
              <div><span className="eyebrow">TASK POINTS</span><h2>Reward assigned tasks</h2><p>Set a point value. It is awarded automatically when the task is completed and removed again if the task is reopened.</p></div>
              {selected&&<button type="button" className="secondary-button compact" onClick={()=>setAdjustOpen(true)}><Plus size={14}/>Adjust points</button>}
            </div>
            <div className="reward-task-list">
              {selectedTasks.length===0?<div className="rewards-empty compact"><strong>No assigned tasks for {selected?.display_name??'this child'}.</strong></div>:selectedTasks.map(task=>(
                <div className={task.status==='done'?'reward-task-row done':'reward-task-row'} key={task.task_id}>
                  <span><strong>{task.title}</strong><small>{task.status==='done'?'Completed':task.due_date?'Due '+new Date(task.due_date+'T12:00:00').toLocaleDateString():'No due date'}</small></span>
                  <label><input type="number" min="0" max="1000" defaultValue={task.reward_points} disabled={taskBusy===task.task_id} onBlur={event=>{if(Number(event.currentTarget.value)!==task.reward_points)void setTaskPoints(task,event.currentTarget.value)}}/><small>points</small></label>
                </div>
              ))}
            </div>
          </section>}

          <section className="rewards-section">
            <div className="rewards-section-head">
              <div><span className="eyebrow">HISTORY</span><h2>Earn & spend activity</h2></div>
              <div className="reward-history-filter">
                {(['all','earn','spend'] as const).map(value=><button type="button" className={historyFilter===value?'active':''} onClick={()=>setHistoryFilter(value)} key={value}>{value==='all'?'All':value==='earn'?'Earned':'Spent'}</button>)}
              </div>
            </div>
            <div className="reward-history">
              {visibleHistory.length===0?<div className="rewards-empty compact"><History size={24}/><strong>No reward activity yet.</strong></div>:visibleHistory.map(row=>(
                <div className="reward-history-row" key={row.entry_id}>
                  <span className={row.points_delta>=0?'reward-history-icon earn':'reward-history-icon spend'}>{row.points_delta>=0?<Star size={14}/>:<Gift size={14}/>}</span>
                  <span><strong>{row.title}</strong><small>{row.entry_type==='chore'?'Chore / project':row.entry_type==='task'?'Task':row.entry_type==='redemption'?'Reward redeemed':'Parent adjustment'} · {fmtDate(row.occurred_at)}</small></span>
                  <b className={row.points_delta>=0?'positive':'negative'}>{row.points_delta>0?'+':''}{row.points_delta}</b>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {rewardEditorOpen&&<div className="modal-backdrop reward-editor-backdrop" role="dialog" aria-modal="true">
        <section className="modal-card reward-editor">
          <header><div><span className="eyebrow">{rewardDraft.id?'EDIT REWARD':'NEW REWARD'}</span><h2>{rewardDraft.id?'Update reward':'Add family reward'}</h2></div><button type="button" className="icon-button" onClick={()=>setRewardEditorOpen(false)}><X size={18}/></button></header>
          <form onSubmit={saveReward}>
            <div className="reward-editor-row"><label><span>Emoji</span><input value={rewardDraft.emoji} onChange={e=>setRewardDraft(current=>({...current,emoji:e.target.value}))} maxLength={8}/></label><label><span>Cost *</span><input type="number" min="1" max="100000" required value={rewardDraft.cost_points} onChange={e=>setRewardDraft(current=>({...current,cost_points:e.target.value}))}/></label></div>
            <label><span>Reward title *</span><input required maxLength={120} value={rewardDraft.title} onChange={e=>setRewardDraft(current=>({...current,title:e.target.value}))} placeholder="e.g. Choose Friday movie"/></label>
            <label><span>Description</span><textarea rows={3} value={rewardDraft.description} onChange={e=>setRewardDraft(current=>({...current,description:e.target.value}))} placeholder="Optional details…"/></label>
            <label className="reward-active-setting"><input type="checkbox" checked={rewardDraft.active} onChange={e=>setRewardDraft(current=>({...current,active:e.target.checked}))}/><span>Available to redeem</span></label>
            <footer><button type="button" className="secondary-button" onClick={()=>setRewardEditorOpen(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save reward'}</button></footer>
          </form>
        </section>
      </div>}

      {adjustOpen&&selected&&<div className="modal-backdrop reward-editor-backdrop" role="dialog" aria-modal="true">
        <section className="modal-card reward-editor small">
          <header><div><span className="eyebrow">PARENT ADJUSTMENT</span><h2>Adjust {selected.display_name}'s points</h2></div><button type="button" className="icon-button" onClick={()=>setAdjustOpen(false)}><X size={18}/></button></header>
          <form onSubmit={addAdjustment}>
            <label><span>Points</span><input type="number" min="-100000" max="100000" value={adjustPoints} onChange={e=>setAdjustPoints(e.target.value)} required/></label>
            <label><span>Reason</span><input value={adjustNote} onChange={e=>setAdjustNote(e.target.value)} maxLength={240} required placeholder="Bonus, correction, special help…"/></label>
            <div className="reward-adjust-hint"><MinusCircle size={14}/><span>Use a negative number to correct points. Balance can never go below zero.</span></div>
            <footer><button type="button" className="secondary-button" onClick={()=>setAdjustOpen(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Apply adjustment'}</button></footer>
          </form>
        </section>
      </div>}
    </div>
  )
}
