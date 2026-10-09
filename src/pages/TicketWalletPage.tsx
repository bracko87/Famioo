import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Camera,
  ExternalLink,
  Link2,
  MapPin,
  QrCode,
  Sparkles,
  Ticket,
  Upload,
  X,
} from 'lucide-react'
import jsQR from 'jsqr'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type QrItemType='link'|'event'|'ticket'
type QrTab=QrItemType|'archived'

type QrScanItem={
  id:string
  household_id:string
  qr_value:string
  source_url:string|null
  item_type:QrItemType
  title:string
  summary:string|null
  page_description:string|null
  image_url:string|null
  event_date:string|null
  event_end_date:string|null
  event_start_time:string|null
  event_end_time:string|null
  event_all_day:boolean
  location_text:string|null
  ai_model:string|null
  ai_confidence:number|null
  analysis_status:'pending'|'analyzed'|'metadata'|'unreadable'|'not_applicable'
  status:'active'|'archived'
  created_at:string
}

type QrAnalysis={
  ok?:boolean
  source_url?:string
  page_title?:string|null
  page_description?:string|null
  model?:string|null
  summary?:string|null
  suggest_ticket?:boolean
  image_url?:string|null
  event?:{
    found_event?:boolean
    title?:string|null
    date?:string|null
    end_date?:string|null
    start_time?:string|null
    end_time?:string|null
    all_day?:boolean
    location?:string|null
    description?:string|null
    confidence?:number|null
  }
  metadata?:{
    title?:string|null
    description?:string|null
    source_url?:string|null
    image_url?:string|null
  }
  error?:string
}

function websiteFromQr(value:string){
  const trimmed=value.trim()
  if(!trimmed) return ''

  const candidates=[trimmed]
  if(/^www\./i.test(trimmed)){
    candidates.push('https://'+trimmed)
  }else if(/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)){
    candidates.push('https://'+trimmed)
  }

  for(const candidate of candidates){
    try{
      const url=new URL(candidate)
      if(url.protocol==='https:'||url.protocol==='http:') return url.toString()
    }catch{
      // Try the next normalized form.
    }
  }
  return ''
}

function hostTitle(url:string){
  try{return new URL(url).hostname.replace(/^www\./,'')}
  catch{return 'Scanned QR link'}
}

function dateLabel(value:string|null){
  if(!value)return ''
  const date=new Date(value+'T12:00:00')
  if(Number.isNaN(date.getTime()))return value
  return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(date)
}

function timeLabel(value:string|null){
  return value?value.slice(0,5):''
}

function typeLabel(type:QrItemType){
  if(type==='ticket')return 'Digital ticket'
  if(type==='event')return 'Event'
  return 'Link'
}

function typeIcon(type:QrItemType){
  if(type==='ticket')return <Ticket size={18}/>
  if(type==='event')return <CalendarDays size={18}/>
  return <Link2 size={18}/>
}

export function TicketWalletPage(){
  const {household,modules}=useHousehold()
  const ticketModule=modules.find(module=>module.code==='tickets')
  const canWrite=Boolean(ticketModule?.can_write)
  const assistantEnabled=modules.some(module=>module.code==='assistant'&&module.enabled)

  const [items,setItems]=useState<QrScanItem[]>([])
  const [tab,setTab]=useState<QrTab>('link')
  const [loading,setLoading]=useState(true)
  const [scannerOpen,setScannerOpen]=useState(false)
  const [cameraError,setCameraError]=useState('')
  const [scanMessage,setScanMessage]=useState('')
  const [scanning,setScanning]=useState(false)
  const [analyzing,setAnalyzing]=useState(false)
  const [busyId,setBusyId]=useState('')
  const [error,setError]=useState('')

  const videoRef=useRef<HTMLVideoElement|null>(null)
  const canvasRef=useRef<HTMLCanvasElement|null>(null)
  const streamRef=useRef<MediaStream|null>(null)
  const frameRef=useRef<number>(0)
  const processingRef=useRef(false)

  const load=useCallback(async(foreground=false)=>{
    if(foreground)setLoading(true)
    const result=await supabase
      .from('qr_scan_items')
      .select('*')
      .eq('household_id',household.id)
      .order('created_at',{ascending:false})

    if(result.error)setError(result.error.message)
    else setItems((result.data??[]) as QrScanItem[])
    if(foreground)setLoading(false)
  },[household.id])

  useEffect(()=>{void load(true)},[load])

  const counts=useMemo(()=>({
    link:items.filter(item=>item.status==='active'&&item.item_type==='link').length,
    event:items.filter(item=>item.status==='active'&&item.item_type==='event').length,
    ticket:items.filter(item=>item.status==='active'&&item.item_type==='ticket').length,
    archived:items.filter(item=>item.status==='archived').length,
  }),[items])

  const visible=useMemo(()=>{
    if(tab==='archived')return items.filter(item=>item.status==='archived')
    return items.filter(item=>item.status==='active'&&item.item_type===tab)
  },[items,tab])

  function stopCamera(){
    if(frameRef.current){
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current=0
    }
    streamRef.current?.getTracks().forEach(track=>track.stop())
    streamRef.current=null
    if(videoRef.current)videoRef.current.srcObject=null
    setScanning(false)
  }

  function closeScanner(){
    if(analyzing)return
    stopCamera()
    processingRef.current=false
    setScannerOpen(false)
    setCameraError('')
  }

  async function saveScan(
    qrValue:string,
    website:string,
    analysis:QrAnalysis|null,
    analysisStatus:QrScanItem['analysis_status'],
  ){
    const event=analysis?.event
    const itemType:QrItemType=analysis?.suggest_ticket
      ?'ticket'
      :event?.found_event
        ?'event'
        :'link'

    const metadata=analysis?.metadata
    const sourceUrl=analysis?.source_url||metadata?.source_url||website||null
    const title=(
      event?.title
      ||analysis?.page_title
      ||metadata?.title
      ||(sourceUrl?hostTitle(sourceUrl):'Scanned QR content')
    ).trim().slice(0,180)

    const insert=await supabase.from('qr_scan_items').insert({
      household_id:household.id,
      qr_value:qrValue,
      source_url:sourceUrl,
      item_type:itemType,
      title,
      summary:(analysis?.summary||event?.description||metadata?.description||(!website?qrValue:null))?.slice(0,1400)??null,
      page_description:(analysis?.page_description||metadata?.description||null)?.slice(0,700)??null,
      image_url:analysis?.image_url||metadata?.image_url||null,
      event_date:event?.date||null,
      event_end_date:event?.end_date||null,
      event_start_time:event?.start_time||null,
      event_end_time:event?.end_time||null,
      event_all_day:Boolean(event?.all_day),
      location_text:event?.location||null,
      ai_model:analysis?.model||null,
      ai_confidence:event?.confidence==null?null:Number(event.confidence),
      analysis_status:analysisStatus,
      status:'active',
    }).select('id').single()

    if(insert.error)throw insert.error

    setTab(itemType)
    setScanMessage('Saved under '+typeLabel(itemType)+(itemType==='ticket'?'s':'s')+'.')
    await load(false)
  }

  async function analyzeAndSave(value:string){
    const clean=value.trim()
    if(!clean||processingRef.current)return

    processingRef.current=true
    stopCamera()
    setAnalyzing(true)
    setCameraError('')
    setError('')
    setScanMessage('')

    const website=websiteFromQr(clean)

    try{
      if(!website){
        await saveScan(clean,'',null,'not_applicable')
      }else if(assistantEnabled){
        const analyzed=await supabase.functions.invoke('extract-qr-page',{
          body:{
            household_id:household.id,
            url:website,
            timezone:household.timezone,
          },
        })

        if(!analyzed.error&&!analyzed.data?.error){
          await saveScan(clean,website,analyzed.data as QrAnalysis,'analyzed')
        }else{
          const metadata=await supabase.functions.invoke('extract-qr-page',{
            body:{household_id:household.id,url:website,timezone:household.timezone,metadata_only:true},
          })
          if(!metadata.error&&!metadata.data?.error){
            await saveScan(clean,website,metadata.data as QrAnalysis,'metadata')
          }else{
            await saveScan(clean,website,null,'unreadable')
          }
        }
      }else{
        const metadata=await supabase.functions.invoke('extract-qr-page',{
          body:{household_id:household.id,url:website,timezone:household.timezone,metadata_only:true},
        })
        if(!metadata.error&&!metadata.data?.error){
          await saveScan(clean,website,metadata.data as QrAnalysis,'metadata')
        }else{
          await saveScan(clean,website,null,'unreadable')
        }
      }

      setScannerOpen(false)
    }catch(reason){
      setCameraError(reason instanceof Error?reason.message:'QR code could not be saved.')
    }finally{
      processingRef.current=false
      setAnalyzing(false)
    }
  }

  function scanVideoFrame(){
    if(processingRef.current)return
    const video=videoRef.current
    const canvas=canvasRef.current
    if(!video||!canvas||video.readyState<2){
      frameRef.current=window.requestAnimationFrame(scanVideoFrame)
      return
    }

    const width=video.videoWidth
    const height=video.videoHeight
    if(!width||!height){
      frameRef.current=window.requestAnimationFrame(scanVideoFrame)
      return
    }

    const maxWidth=900
    const scale=Math.min(1,maxWidth/width)
    canvas.width=Math.max(1,Math.round(width*scale))
    canvas.height=Math.max(1,Math.round(height*scale))

    const context=canvas.getContext('2d',{willReadFrequently:true})
    if(!context){
      setCameraError('QR scanner could not start on this device.')
      stopCamera()
      return
    }

    context.drawImage(video,0,0,canvas.width,canvas.height)
    const image=context.getImageData(0,0,canvas.width,canvas.height)
    const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'})

    if(code?.data){
      void analyzeAndSave(code.data)
      return
    }
    frameRef.current=window.requestAnimationFrame(scanVideoFrame)
  }

  async function startCamera(){
    setCameraError('')
    setScanning(true)

    if(!navigator.mediaDevices?.getUserMedia){
      setCameraError('Camera scanning is not supported in this browser. Choose a QR image instead.')
      setScanning(false)
      return
    }

    try{
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{
          facingMode:{ideal:'environment'},
          width:{ideal:1280},
          height:{ideal:1280},
        },
        audio:false,
      })

      streamRef.current=stream
      const video=videoRef.current
      if(!video){stopCamera();return}
      video.srcObject=stream
      await video.play()
      frameRef.current=window.requestAnimationFrame(scanVideoFrame)
    }catch(reason){
      stopCamera()
      setCameraError(reason instanceof Error?reason.message:'Camera access could not be started.')
    }
  }

  function openScanner(){
    if(!canWrite)return
    setScannerOpen(true)
    setCameraError('')
    setScanMessage('')
    processingRef.current=false
  }

  useEffect(()=>{
    if(!scannerOpen)return
    const timer=window.setTimeout(()=>{void startCamera()},80)
    return()=>{
      window.clearTimeout(timer)
      stopCamera()
    }
  },[scannerOpen])

  async function scanImageFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]
    event.target.value=''
    if(!file)return

    setCameraError('')
    try{
      const bitmap=await createImageBitmap(file)
      const canvas=canvasRef.current
      if(!canvas){bitmap.close();throw new Error('QR image scanner is unavailable.')}

      const maxWidth=1400
      const scale=Math.min(1,maxWidth/bitmap.width)
      canvas.width=Math.max(1,Math.round(bitmap.width*scale))
      canvas.height=Math.max(1,Math.round(bitmap.height*scale))

      const context=canvas.getContext('2d',{willReadFrequently:true})
      if(!context){bitmap.close();throw new Error('QR image scanner is unavailable.')}

      context.drawImage(bitmap,0,0,canvas.width,canvas.height)
      bitmap.close()
      const image=context.getImageData(0,0,canvas.width,canvas.height)
      const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'})

      if(!code?.data){
        setCameraError('No QR code was found in this image.')
        return
      }
      await analyzeAndSave(code.data)
    }catch(reason){
      setCameraError(reason instanceof Error?reason.message:'The QR image could not be read.')
    }
  }

  async function setArchived(item:QrScanItem,archived:boolean){
    setBusyId(item.id);setError('')
    const result=await supabase.from('qr_scan_items')
      .update({status:archived?'archived':'active',updated_at:new Date().toISOString()})
      .eq('id',item.id)
      .eq('household_id',household.id)
    setBusyId('')
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  async function archiveCurrentTab(){
    if(tab==='archived'||!canWrite)return
    setBusyId('bulk');setError('')
    const result=await supabase.from('qr_scan_items')
      .update({status:'archived',updated_at:new Date().toISOString()})
      .eq('household_id',household.id)
      .eq('item_type',tab)
      .eq('status','active')
    setBusyId('')
    if(result.error)setError(result.error.message)
    else await load(false)
  }

  return <div className="page qr-repository-page">
    <div className="page-heading-row qr-repository-heading">
      <div>
        <h1>QR Scanner & Wallet</h1>
        <p>Scan a QR code. Famioo reads public destination pages when possible and files the result automatically.</p>
      </div>
      {canWrite&&<button type="button" className="primary-button compact" onClick={openScanner}><Camera size={16}/>Scan QR code</button>}
    </div>

    <section className="qr-scan-hero">
      <span className="qr-scan-hero-icon"><QrCode size={31}/></span>
      <div>
        <strong>Scan once. Famioo sorts it.</strong>
        <p>{assistantEnabled
          ?'AI can inspect readable public webpages and decide whether the QR belongs under Links, Events or Digital Tickets.'
          :'Links are still stored. Enable AI Assistant if you want page reading and automatic event/ticket classification.'}</p>
      </div>
      {canWrite&&<button type="button" className="secondary-button compact" onClick={openScanner}><Sparkles size={15}/>Scan now</button>}
    </section>

    {scanMessage&&<div className="notice">{scanMessage}</div>}
    {error&&<div className="notice error">{error}</div>}

    <div className="qr-repository-tab-row">
      <nav className="qr-repository-tabs" aria-label="QR repository sections">
        <button type="button" className={tab==='link'?'active':''} onClick={()=>setTab('link')}><Link2 size={14}/>Links <span>{counts.link}</span></button>
        <button type="button" className={tab==='event'?'active':''} onClick={()=>setTab('event')}><CalendarDays size={14}/>Events <span>{counts.event}</span></button>
        <button type="button" className={tab==='ticket'?'active':''} onClick={()=>setTab('ticket')}><Ticket size={14}/>Digital tickets <span>{counts.ticket}</span></button>
        <button type="button" className={tab==='archived'?'active':''} onClick={()=>setTab('archived')}><Archive size={14}/>Archive <span>{counts.archived}</span></button>
      </nav>
      {canWrite&&tab!=='archived'&&visible.length>0&&<button type="button" className="secondary-button compact qr-archive-all" disabled={busyId==='bulk'} onClick={()=>void archiveCurrentTab()}><Archive size={13}/>{busyId==='bulk'?'Archiving…':'Archive all'}</button>}
    </div>

    {loading?<div className="qr-repository-empty">Loading scanned QR items…</div>
      :visible.length===0?<div className="qr-repository-empty">
        {tab==='link'?<Link2 size={29}/>:tab==='event'?<CalendarDays size={29}/>:tab==='ticket'?<Ticket size={29}/>:<Archive size={29}/>}
        <strong>No {tab==='archived'?'archived items':tab==='ticket'?'digital tickets':tab+'s'} yet.</strong>
        <span>{tab==='archived'?'Archived QR items will appear here.':'Scan a QR code and Famioo will place it in the correct section.'}</span>
      </div>
      :<section className="qr-repository-grid">
        {visible.map(item=><article className={'qr-repository-card '+item.item_type} key={item.id}>
          <div className="qr-repository-card-top">
            <span className={'qr-repository-kind '+item.item_type}>{typeIcon(item.item_type)}</span>
            <div>
              <small>{typeLabel(item.item_type).toUpperCase()}</small>
              <h2>{item.title}</h2>
            </div>
            <span className={'qr-analysis-chip '+item.analysis_status}>
              {item.analysis_status==='analyzed'?'AI read':item.analysis_status==='metadata'?'Page read':item.analysis_status==='unreadable'?'Saved only':'QR data'}
            </span>
          </div>

          {item.image_url&&<div className="qr-repository-image"><img src={item.image_url} alt=""/></div>}
          {item.summary&&<p className="qr-repository-summary">{item.summary}</p>}

          {(item.event_date||item.location_text)&&<div className="qr-event-facts">
            {item.event_date&&<span><CalendarDays size={13}/><b>{dateLabel(item.event_date)}</b>{!item.event_all_day&&item.event_start_time?<em>{timeLabel(item.event_start_time)}</em>:item.event_all_day?<em>All day</em>:null}</span>}
            {item.location_text&&<span><MapPin size={13}/><b>{item.location_text}</b></span>}
          </div>}

          <div className="qr-repository-source">
            <QrCode size={13}/>
            <span>{item.source_url||item.qr_value}</span>
          </div>

          <footer>
            {item.source_url&&<a className="secondary-button compact" href={item.source_url} target="_blank" rel="noreferrer"><ExternalLink size={13}/>Open</a>}
            {item.status==='archived'
              ?<button type="button" className="secondary-button compact" disabled={busyId===item.id} onClick={()=>void setArchived(item,false)}><ArchiveRestore size={13}/>Restore</button>
              :<button type="button" className="secondary-button compact" disabled={busyId===item.id} onClick={()=>void setArchived(item,true)}><Archive size={13}/>Archive</button>}
          </footer>
        </article>)}
      </section>}

    {scannerOpen&&<div className="modal-backdrop qr-only-backdrop" role="dialog" aria-modal="true" aria-label="Scan QR code">
      <section className="modal-card qr-only-scanner qr-repository-scanner">
        <header className="qr-only-scanner-head">
          <div><h2>{analyzing?'Reading QR destination…':'Scan QR code'}</h2></div>
          <button type="button" className="icon-button" onClick={closeScanner} disabled={analyzing} aria-label="Close scanner"><X size={18}/></button>
        </header>

        <div className="qr-only-camera">
          <video ref={videoRef} playsInline muted/>
          <div className="qr-only-frame" aria-hidden="true"><QrCode size={38}/></div>
          {analyzing&&<div className="qr-analyzing-overlay"><Sparkles size={24}/><strong>Famioo is reading this page…</strong><span>Checking whether it is a link, event or digital ticket.</span></div>}
        </div>
        <canvas ref={canvasRef} className="qr-only-canvas" aria-hidden="true"/>

        <p className="qr-only-help">
          {analyzing?'Please wait while the QR is analyzed.':scanning?'Point the camera at a QR code.':'Camera is not scanning.'}
        </p>

        {cameraError&&<div className="notice error">{cameraError}</div>}

        <label className="secondary-button qr-only-upload">
          <Upload size={16}/>
          Scan QR from image
          <input type="file" accept="image/*" capture="environment" disabled={analyzing} onChange={(event)=>void scanImageFile(event)}/>
        </label>
      </section>
    </div>}
  </div>
}
