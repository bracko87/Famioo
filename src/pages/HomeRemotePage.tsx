import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CirclePower, Home as HomeIcon, Minus,
  MoreHorizontal, Pause, Plus, RadioTower, Settings2, Square, Volume2, VolumeX, X
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type Room={id:string;name:string;sort_order:number;active:boolean}
type Device={id:string;room_id:string|null;name:string;device_type:'tv'|'streamer'|'audio'|'other';manufacturer:string|null;capabilities:string[];active:boolean}
type Permission={device_id:string;profile_id:string;can_control:boolean}
type Bridge={device_id:string;webhook_url:string;bearer_token:string|null}
type DeviceDraft={id:string;room_id:string;name:string;device_type:Device['device_type'];manufacturer:string;webhook_url:string;bearer_token:string;capabilities:string[]}

const allCapabilities=[
  'power','volume_up','volume_down','mute','home','play_pause','up','down','left','right','select','back',
] as const

const emptyDevice:DeviceDraft={
  id:'',room_id:'',name:'',device_type:'tv',manufacturer:'',webhook_url:'',bearer_token:'',
  capabilities:['power','volume_up','volume_down','mute','home','play_pause','up','down','left','right','select','back'],
}

export function HomeRemotePage(){
  const {household,profiles,user,modules}=useHousehold()
  const access=modules.find(module=>module.code==='home_remote')
  const canConfigure=Boolean(access?.enabled&&access?.can_write&&(household.role==='owner'||household.role==='admin'))
  const currentProfile=profiles.find(profile=>profile.linked_user_id===user.id)??null

  const [rooms,setRooms]=useState<Room[]>([])
  const [devices,setDevices]=useState<Device[]>([])
  const [permissions,setPermissions]=useState<Permission[]>([])
  const [bridges,setBridges]=useState<Bridge[]>([])
  const [roomId,setRoomId]=useState('all')
  const [selectedId,setSelectedId]=useState('')
  const [roomEditor,setRoomEditor]=useState(false)
  const [roomName,setRoomName]=useState('')
  const [deviceEditor,setDeviceEditor]=useState(false)
  const [draft,setDraft]=useState<DeviceDraft>({...emptyDevice})
  const [busyCommand,setBusyCommand]=useState('')
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const bridgeByDevice=useMemo(()=>new Map(bridges.map(row=>[row.device_id,row])),[bridges])
  const selected=devices.find(device=>device.id===selectedId)??devices[0]??null
  const visibleDevices=devices.filter(device=>roomId==='all'||device.room_id===roomId)
  const canControl=(device:Device)=>{
    if(household.role==='owner'||household.role==='admin')return true
    if(!currentProfile)return false
    return permissions.some(item=>item.device_id===device.id&&item.profile_id===currentProfile.id&&item.can_control)
  }

  async function load(){
    setError('')
    const requests=[
      supabase.from('home_remote_rooms').select('id,name,sort_order,active').eq('household_id',household.id).eq('active',true).order('sort_order').order('name'),
      supabase.from('home_remote_devices').select('id,room_id,name,device_type,manufacturer,capabilities,active').eq('household_id',household.id).eq('active',true).order('name'),
      supabase.from('home_remote_device_permissions').select('device_id,profile_id,can_control').eq('household_id',household.id),
    ] as const
    const [roomResult,deviceResult,permissionResult]=await Promise.all(requests)
    if(roomResult.error||deviceResult.error||permissionResult.error){
      setError(roomResult.error?.message||deviceResult.error?.message||permissionResult.error?.message||'Could not load Home Remote.')
      return
    }
    setRooms((roomResult.data??[]) as Room[])
    setDevices(((deviceResult.data??[]) as Device[]).map(row=>({...row,capabilities:row.capabilities??[]})))
    setPermissions((permissionResult.data??[]) as Permission[])
    setSelectedId(current=>deviceResult.data?.some((row:any)=>row.id===current)?current:(deviceResult.data?.[0]?.id??''))

    if(canConfigure){
      const bridgeResult=await supabase.from('home_remote_device_bridges')
        .select('device_id,webhook_url,bearer_token').eq('household_id',household.id)
      if(!bridgeResult.error)setBridges((bridgeResult.data??[]) as Bridge[])
    }
  }

  useEffect(()=>{void load()},[household.id,canConfigure])

  async function send(command:string){
    if(!selected||!canControl(selected))return
    setBusyCommand(command);setError('');setMessage('')
    const result=await supabase.functions.invoke('execute-home-remote',{
      body:{household_id:household.id,device_id:selected.id,command},
    })
    setBusyCommand('')
    if(result.error||result.data?.error){setError(String(result.data?.error||result.error?.message||'Remote command failed.'));return}
    setMessage(command.replace('_',' ')+' sent to '+selected.name+'.')
  }

  async function saveRoom(event:FormEvent){
    event.preventDefault()
    if(!roomName.trim())return
    setSaving(true)
    const result=await supabase.rpc('save_home_remote_room_v1',{
      p_id:null,p_household_id:household.id,p_name:roomName.trim(),p_sort_order:rooms.length,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setRoomName('');setRoomEditor(false);await load()
  }

  function openDevice(device?:Device){
    const bridge=device?bridgeByDevice.get(device.id):null
    setDraft(device?{
      id:device.id,room_id:device.room_id??'',name:device.name,device_type:device.device_type,
      manufacturer:device.manufacturer??'',webhook_url:bridge?.webhook_url??'',bearer_token:bridge?.bearer_token??'',
      capabilities:[...device.capabilities],
    }:{...emptyDevice,capabilities:[...emptyDevice.capabilities]})
    setDeviceEditor(true);setError('');setMessage('')
  }

  async function saveDevice(event:FormEvent){
    event.preventDefault()
    setSaving(true);setError('')
    const result=await supabase.rpc('save_home_remote_device_v1',{
      p_id:draft.id||null,p_household_id:household.id,p_room_id:draft.room_id||null,p_name:draft.name.trim(),
      p_device_type:draft.device_type,p_manufacturer:draft.manufacturer.trim()||null,p_capabilities:draft.capabilities,
      p_webhook_url:draft.webhook_url.trim(),p_bearer_token:draft.bearer_token.trim()||null,
    })
    setSaving(false)
    if(result.error){setError(result.error.message);return}
    setDeviceEditor(false);setMessage('Remote device saved.');await load()
  }

  async function setPermission(deviceId:string,profileId:string,value:boolean){
    const result=await supabase.rpc('set_home_remote_device_permission_v1',{
      p_household_id:household.id,p_device_id:deviceId,p_profile_id:profileId,p_can_control:value,
    })
    if(result.error)setError(result.error.message)
    else await load()
  }

  function has(command:string){return Boolean(selected?.capabilities.includes(command))}
  const cmd=(command:string,label:string,icon:React.ReactNode)=><button type="button" disabled={!selected||!canControl(selected)||!has(command)||Boolean(busyCommand)} onClick={()=>void send(command)} title={label}>{icon}<span>{label}</span></button>

  return <div className="page home-remote-page">
    <div className="page-heading-row remote-heading">
      <div><span className="eyebrow">TV REMOTE / HOME REMOTE</span><h1>Home Remote</h1><p>Control configured TVs and streaming devices through your secure home bridge.</p></div>
      {canConfigure&&<div className="remote-heading-actions"><button className="secondary-button compact" onClick={()=>setRoomEditor(true)}><Plus size={14}/>Room</button><button className="primary-button compact" onClick={()=>openDevice()}><Plus size={14}/>Device</button></div>}
    </div>

    <div className="remote-bridge-note"><RadioTower size={16}/><span><strong>PWA control uses a secure HTTPS bridge.</strong> Famioo sends commands server-side to your configured bridge/webhook. Direct local-network TV discovery can be added later in the native Android/iOS wrappers.</span></div>
    {error&&<div className="notice error">{error}</div>}
    {message&&<div className="notice">{message}</div>}

    <div className="remote-room-tabs">
      <button className={roomId==='all'?'active':''} onClick={()=>setRoomId('all')}>All</button>
      {rooms.map(room=><button key={room.id} className={roomId===room.id?'active':''} onClick={()=>setRoomId(room.id)}>{room.name}</button>)}
    </div>

    <div className="remote-layout">
      <aside className="remote-devices">
        {visibleDevices.length===0?<div className="remote-empty">No devices in this room.</div>:visibleDevices.map(device=><button key={device.id} className={selected?.id===device.id?'active':''} onClick={()=>setSelectedId(device.id)}>
          <span><RadioTower size={18}/></span><div><strong>{device.name}</strong><small>{device.manufacturer||device.device_type}</small></div>{canConfigure&&<Settings2 size={14}/>}
        </button>)}
      </aside>

      <section className="remote-control">
        {!selected?<div className="remote-empty large"><RadioTower size={32}/><strong>No remote device configured.</strong>{canConfigure&&<button className="primary-button compact" onClick={()=>openDevice()}><Plus size={13}/>Add device</button>}</div>:<>
          <header><div><span className="eyebrow">{selected.device_type.toUpperCase()}</span><h2>{selected.name}</h2><small>{rooms.find(room=>room.id===selected.room_id)?.name||'No room'} · {selected.manufacturer||'Custom bridge'}</small></div>{canConfigure&&<button className="icon-button" onClick={()=>openDevice(selected)}><Settings2 size={15}/></button>}</header>
          {!canControl(selected)&&<div className="remote-denied">You do not have control permission for this device.</div>}
          <div className="remote-top-controls">{cmd('power','Power',<CirclePower size={20}/>)}{cmd('mute','Mute',<VolumeX size={20}/>)}{cmd('home','Home',<HomeIcon size={20}/>)}</div>
          <div className="remote-body">
            <div className="remote-dpad">
              <span/>{cmd('up','Up',<ArrowUp size={20}/>)}<span/>
              {cmd('left','Left',<ArrowLeft size={20}/>)}{cmd('select','OK',<Square size={17}/>)}{cmd('right','Right',<ArrowRight size={20}/>)}
              <span/>{cmd('down','Down',<ArrowDown size={20}/>)}<span/>
            </div>
            <div className="remote-side-controls">
              {cmd('volume_up','Volume +',<Plus size={20}/>)}
              {cmd('play_pause','Play / pause',<Pause size={20}/>)}
              {cmd('volume_down','Volume −',<Minus size={20}/>)}
              {cmd('back','Back',<MoreHorizontal size={20}/>)}
            </div>
          </div>

          {canConfigure&&<div className="remote-permissions">
            <span className="eyebrow">CONTROL PERMISSIONS</span>
            {profiles.map(profile=><label key={profile.id}><ProfileAvatar avatarPath={profile.avatar_path} name={profile.display_name} size="sm"/><span>{profile.display_name}</span><input type="checkbox" checked={permissions.some(item=>item.device_id===selected.id&&item.profile_id===profile.id&&item.can_control)} onChange={event=>void setPermission(selected.id,profile.id,event.target.checked)}/></label>)}
          </div>}
        </>}
      </section>
    </div>

    {roomEditor&&<div className="modal-backdrop remote-modal" role="dialog" aria-modal="true"><section className="modal-card remote-editor"><header><h2>Add room</h2><button className="icon-button" onClick={()=>setRoomEditor(false)}><X size={18}/></button></header><form onSubmit={saveRoom}><label><span>Room name</span><input autoFocus required value={roomName} onChange={e=>setRoomName(e.target.value)} placeholder="Living room"/></label><footer><button type="button" className="secondary-button" onClick={()=>setRoomEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>Save room</button></footer></form></section></div>}

    {deviceEditor&&<div className="modal-backdrop remote-modal" role="dialog" aria-modal="true"><section className="modal-card remote-editor device"><header><div><span className="eyebrow">REMOTE DEVICE</span><h2>{draft.id?'Edit device':'Add device'}</h2></div><button className="icon-button" onClick={()=>setDeviceEditor(false)}><X size={18}/></button></header><form onSubmit={saveDevice}>
      <div className="remote-editor-row"><label><span>Name *</span><input required value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} placeholder="Living room TV"/></label><label><span>Room</span><select value={draft.room_id} onChange={e=>setDraft(v=>({...v,room_id:e.target.value}))}><option value="">No room</option>{rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label></div>
      <div className="remote-editor-row"><label><span>Device type</span><select value={draft.device_type} onChange={e=>setDraft(v=>({...v,device_type:e.target.value as Device['device_type']}))}><option value="tv">TV</option><option value="streamer">Streaming device</option><option value="audio">Audio</option><option value="other">Other</option></select></label><label><span>Manufacturer</span><input value={draft.manufacturer} onChange={e=>setDraft(v=>({...v,manufacturer:e.target.value}))} placeholder="Samsung, LG, Roku…"/></label></div>
      <label><span>HTTPS bridge / webhook URL *</span><input required type="url" pattern="https://.*" value={draft.webhook_url} onChange={e=>setDraft(v=>({...v,webhook_url:e.target.value}))} placeholder="https://your-bridge.example/famioo"/></label>
      <label><span>Optional bearer token</span><input type="password" value={draft.bearer_token} onChange={e=>setDraft(v=>({...v,bearer_token:e.target.value}))} placeholder="Stored for owner/admin use"/></label>
      <div className="remote-capabilities"><span>Supported controls</span>{allCapabilities.map(cap=><label key={cap}><input type="checkbox" checked={draft.capabilities.includes(cap)} onChange={e=>setDraft(v=>({...v,capabilities:e.target.checked?[...v.capabilities,cap]:v.capabilities.filter(item=>item!==cap)}))}/><span>{cap.replace('_',' ')}</span></label>)}</div>
      <footer><button type="button" className="secondary-button" onClick={()=>setDeviceEditor(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving…':'Save device'}</button></footer>
    </form></section></div>}
  </div>
}
