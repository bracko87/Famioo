import { Download, Send, Share2, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export type ScanShareTarget={value:string;label:string}

type ScanPreset={
  id:string
  label:string
  filter:string
  background?:string
}

const presets:ScanPreset[]=[
  {id:'original',label:'Original',filter:'none'},
  {id:'auto',label:'Auto',filter:'brightness(1.05) contrast(1.16) saturate(.92)'},
  {id:'document',label:'Document',filter:'brightness(1.14) contrast(1.32) saturate(.65)'},
  {id:'bw',label:'B&W',filter:'grayscale(1) contrast(1.58) brightness(1.08)'},
  {id:'gray',label:'Grayscale',filter:'grayscale(1) contrast(1.18) brightness(1.04)'},
  {id:'contrast',label:'High contrast',filter:'contrast(1.48) brightness(1.04) saturate(.8)'},
  {id:'bright',label:'Bright paper',filter:'brightness(1.22) contrast(1.16) saturate(.8)'},
  {id:'warm',label:'Warm paper',filter:'sepia(.18) brightness(1.08) contrast(1.14) saturate(.9)'},
  {id:'cool',label:'Cool paper',filter:'brightness(1.08) contrast(1.2) saturate(.72) hue-rotate(8deg)'},
  {id:'soft',label:'Soft clean',filter:'brightness(1.08) contrast(1.08) saturate(.82)'},
]

async function imageForFile(file:File){
  if('createImageBitmap' in window){
    return await createImageBitmap(file)
  }
  const url=URL.createObjectURL(file)
  try{
    const img=new Image()
    await new Promise<void>((resolve,reject)=>{
      img.onload=()=>resolve()
      img.onerror=()=>reject(new Error('Could not read scan image.'))
      img.src=url
    })
    return img
  }finally{
    URL.revokeObjectURL(url)
  }
}

async function renderScan(file:File,preset:ScanPreset){
  const image=await imageForFile(file)
  const width='naturalWidth' in image?image.naturalWidth:image.width
  const height='naturalHeight' in image?image.naturalHeight:image.height
  const maxSide=2600
  const scale=Math.min(1,maxSide/Math.max(width,height))
  const canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(width*scale))
  canvas.height=Math.max(1,Math.round(height*scale))
  const ctx=canvas.getContext('2d')
  if(!ctx)throw new Error('Image processing is not available in this browser.')
  ctx.fillStyle=preset.background||'#fff'
  ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.filter=preset.filter
  ctx.drawImage(image as CanvasImageSource,0,0,canvas.width,canvas.height)
  if('close' in image&&typeof image.close==='function')image.close()
  const blob=await new Promise<Blob>((resolve,reject)=>{
    canvas.toBlob(result=>result?resolve(result):reject(new Error('Could not create scanned image.')),'image/jpeg',.92)
  })
  return blob
}

export function DocumentScannerModal({
  file,
  shareTargets,
  busy=false,
  onClose,
  onSave,
  onSendFamioo,
}:{
  file:File
  shareTargets:ScanShareTarget[]
  busy?:boolean
  onClose:()=>void
  onSave:(file:File)=>Promise<boolean>
  onSendFamioo:(file:File,target:string)=>Promise<boolean>
}){
  const [presetId,setPresetId]=useState('auto')
  const [previewUrl,setPreviewUrl]=useState('')
  const [processing,setProcessing]=useState(false)
  const [target,setTarget]=useState('family')
  const [message,setMessage]=useState('')
  const preset=presets.find(item=>item.id===presetId)??presets[0]

  useEffect(()=>{
    const url=URL.createObjectURL(file)
    setPreviewUrl(url)
    return()=>URL.revokeObjectURL(url)
  },[file])

  const outputName=useMemo(()=>{
    const base=(file.name||'scan').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,80)||'scan'
    return base+'-scanned.jpg'
  },[file.name])

  async function processedFile(){
    const blob=await renderScan(file,preset)
    return new File([blob],outputName,{type:'image/jpeg',lastModified:Date.now()})
  }

  async function save(){
    setProcessing(true);setMessage('')
    try{
      const ok=await onSave(await processedFile())
      if(ok)setMessage('Scan saved in Famioo.')
    }finally{setProcessing(false)}
  }

  async function download(){
    setProcessing(true);setMessage('')
    try{
      const next=await processedFile()
      const url=URL.createObjectURL(next)
      const a=document.createElement('a')
      a.href=url;a.download=next.name;document.body.appendChild(a);a.click();a.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),1000)
      setMessage('Download started.')
    }finally{setProcessing(false)}
  }

  async function share(){
    setProcessing(true);setMessage('')
    try{
      const next=await processedFile()
      if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[next]}))){
        await navigator.share({title:'Famioo scan',text:'Scanned with Famioo',files:[next]})
      }else{
        const url=URL.createObjectURL(next)
        const a=document.createElement('a');a.href=url;a.download=next.name;document.body.appendChild(a);a.click();a.remove()
        window.setTimeout(()=>URL.revokeObjectURL(url),1000)
        setMessage('Sharing is not supported here, so the scan was downloaded instead.')
      }
    }catch(reason){
      if((reason as DOMException)?.name!=='AbortError')setMessage(reason instanceof Error?reason.message:'Could not share scan.')
    }finally{setProcessing(false)}
  }

  async function sendFamioo(){
    setProcessing(true);setMessage('')
    try{
      const ok=await onSendFamioo(await processedFile(),target)
      if(ok)setMessage('Scan sent in Famioo Messenger.')
    }finally{setProcessing(false)}
  }

  const disabled=busy||processing

  return <div className="modal-backdrop document-scanner-backdrop" role="dialog" aria-modal="true" aria-label="Document scanner">
    <section className="modal-card document-scanner-modal">
      <header>
        <div><h2>Document scanner</h2><p>Choose a scan look before you save or share.</p></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={disabled} aria-label="Close scanner"><X size={18}/></button>
      </header>

      <div className="document-scanner-preview">
        {previewUrl&&<img src={previewUrl} alt="Document scan preview" style={{filter:preset.filter}}/>}
        <span><Sparkles size={13}/>{preset.label}</span>
      </div>

      <div className="document-scanner-presets" aria-label="Scan presets">
        {presets.map(item=><button type="button" className={item.id===presetId?'active':''} onClick={()=>setPresetId(item.id)} disabled={disabled} key={item.id}>{item.label}</button>)}
      </div>

      <div className="document-scanner-actions">
        <button type="button" className="primary-button" onClick={()=>void save()} disabled={disabled}><Sparkles size={15}/>{disabled?'Processing…':'Save in Famioo'}</button>
        <button type="button" className="secondary-button" onClick={()=>void download()} disabled={disabled}><Download size={15}/>Download</button>
        <button type="button" className="secondary-button" onClick={()=>void share()} disabled={disabled}><Share2 size={15}/>Share</button>
      </div>

      <div className="document-scanner-internal-share">
        <div><strong>Send inside Famioo</strong><small>Send the scanned image to family chat or directly to a household member.</small></div>
        <select value={target} onChange={event=>setTarget(event.target.value)} disabled={disabled}>
          <option value="family">Family chat</option>
          {shareTargets.map(item=><option value={item.value} key={item.value}>{item.label}</option>)}
        </select>
        <button type="button" className="secondary-button" onClick={()=>void sendFamioo()} disabled={disabled}><Send size={14}/>Send</button>
      </div>

      {message&&<div className="notice">{message}</div>}
    </section>
  </div>
}
