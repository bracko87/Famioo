import {
  CalendarDays,
  Camera,
  Check,
  FileText,
  Image as ImageIcon,
  MapPin,
  Pencil,
  QrCode,
  ScanLine,
  Ticket,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import jsQR from 'jsqr'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { DatePicker } from '../components/ui/DatePicker'
import { GoogleMapsLink } from '../components/ui/GoogleMapsLink'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { Select } from '../components/ui/Select'
import { TimePicker } from '../components/ui/TimePicker'
import { useHousehold } from '../context/HouseholdContext'
import { categoryColor } from '../lib/categoryColors'
import { supabase } from '../lib/supabase'
import type { CalendarRow } from '../lib/types'

type TicketType=
  | 'flight'
  | 'train'
  | 'bus'
  | 'concert'
  | 'cinema'
  | 'sports'
  | 'event'
  | 'attraction'
  | 'parking'
  | 'other'

type TicketStatus='active'|'used'|'archived'
type ScanKind='event'|'ticket'|'link'|'contact'|'wifi'|'reference'

type ScanDraft={
  kind:ScanKind
  title:string
  ticket_type:TicketType
  start_date:string
  start_time:string
  end_date:string
  end_time:string
  location_text:string
  provider_text:string
  booking_reference:string
  notes:string
  raw_value:string
  source_label:string
}

type TicketEntry={
  id:string
  household_id:string
  title:string
  ticket_type:TicketType
  holder_profile_id:string|null
  start_date:string|null
  start_time:string|null
  end_date:string|null
  end_time:string|null
  location_text:string|null
  provider_text:string|null
  booking_reference:string|null
  qr_value:string|null
  notes:string|null
  status:TicketStatus
  calendar_id:string|null
  linked_event_id:string|null
  file_path:string|null
  file_name:string|null
  file_mime_type:string|null
  file_size:number|null
  created_at:string
  updated_at:string
}

type BarcodeResult={
  rawValue:string
  format?:string
}

type BarcodeDetectorInstance={
  detect:(source:HTMLVideoElement|ImageBitmap|HTMLCanvasElement)=>Promise<BarcodeResult[]>
}

type BarcodeDetectorConstructor=new (
  options?:{formats?:string[]},
)=>BarcodeDetectorInstance

const ticketTypes:Array<{value:TicketType;label:string}>=[
  {value:'flight',label:'Flight'},
  {value:'train',label:'Train'},
  {value:'bus',label:'Bus'},
  {value:'concert',label:'Concert'},
  {value:'cinema',label:'Cinema'},
  {value:'sports',label:'Sports'},
  {value:'event',label:'Event'},
  {value:'attraction',label:'Attraction'},
  {value:'parking',label:'Parking'},
  {value:'other',label:'Other'},
]

function ticketTypeLabel(value:TicketType){
  return ticketTypes.find((item)=>item.value===value)?.label??'Other'
}

function formatDate(value:string|null){
  if(!value) return 'No date'
  return new Date(value+'T12:00:00').toLocaleDateString(undefined,{
    day:'2-digit',
    month:'short',
    year:'numeric',
  })
}

function todayKey(){
  return new Date().toISOString().slice(0,10)
}

function unfoldPayloadLines(value:string){
  return value
    .replace(/\r\n/g,'\n')
    .replace(/\r/g,'\n')
    .replace(/\n[ \t]/g,'')
    .split('\n')
    .map((line)=>line.trim())
    .filter(Boolean)
}

function payloadField(lines:string[],name:string){
  const upper=name.toUpperCase()+':'
  const prefix=name.toUpperCase()+';'
  const line=lines.find((item)=>{
    const candidate=item.toUpperCase()
    return candidate.startsWith(upper)||candidate.startsWith(prefix)
  })
  if(!line) return ''
  const colon=line.indexOf(':')
  return colon>=0?line.slice(colon+1).trim():''
}

function unescapePayloadText(value:string){
  return value
    .replace(/\\n/gi,'\n')
    .replace(/\\,/g,',')
    .replace(/\\;/g,';')
    .replace(/\\\\/g,'\\')
    .trim()
}

function parseCompactDateTime(value:string){
  const clean=value.trim()
  const match=clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/)
  if(!match) return {date:'',time:''}
  return {
    date:`${match[1]}-${match[2]}-${match[3]}`,
    time:match[4]&&match[5]?`${match[4]}:${match[5]}`:'',
  }
}

function hostTitle(value:string){
  try{
    const url=new URL(value)
    return url.hostname.replace(/^www\./,'')
  }catch{
    return 'Scanned link'
  }
}

function normalizeScannedDate(value:unknown){
  if(typeof value!=='string') return ''
  const clean=value.trim()

  const iso=clean.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const german=clean.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/)
  if(german){
    return `${german[3]}-${String(Number(german[2])).padStart(2,'0')}-${String(Number(german[1])).padStart(2,'0')}`
  }

  const compact=clean.match(/^(\d{4})(\d{2})(\d{2})$/)
  if(compact) return `${compact[1]}-${compact[2]}-${compact[3]}`

  return ''
}

function normalizeScannedTime(value:unknown){
  if(typeof value!=='string') return ''
  const match=value.trim().match(/^(\d{1,2}):(\d{2})/)
  if(!match) return ''
  const hour=Number(match[1])
  const minute=Number(match[2])
  if(hour>23||minute>59) return ''
  return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`
}

function ticketTypeFromText(value:string):TicketType{
  if(/flight|airline|boarding|airport/i.test(value)) return 'flight'
  if(/train|rail|bahn/i.test(value)) return 'train'
  if(/\bbus\b|coach/i.test(value)) return 'bus'
  if(/concert|gig|festival/i.test(value)) return 'concert'
  if(/cinema|movie|film/i.test(value)) return 'cinema'
  if(/sport|match|stadium/i.test(value)) return 'sports'
  if(/museum|attraction|zoo|park/i.test(value)) return 'attraction'
  if(/parking/i.test(value)) return 'parking'
  if(/ticket|event|booking|reservation|pass/i.test(value)) return 'event'
  return 'other'
}

function objectValue(record:Record<string,unknown>,names:string[]){
  const entries=Object.entries(record)
  for(const name of names){
    const direct=entries.find(([key])=>key.toLowerCase()===name.toLowerCase())
    if(direct&&direct[1]!=null) return String(direct[1])
  }
  return ''
}

function parseJsonScan(raw:string):ScanDraft|null{
  if(!raw.startsWith('{')||!raw.endsWith('}')) return null

  try{
    const value=JSON.parse(raw)
    if(!value||typeof value!=='object'||Array.isArray(value)) return null
    const record=value as Record<string,unknown>

    const title=objectValue(record,['title','name','event','eventName','summary','description'])
    const provider=objectValue(record,['provider','organizer','organisation','airline','carrier','issuer'])
    const location=objectValue(record,['location','venue','address','airport','station'])
    const reference=objectValue(record,['reference','bookingReference','booking_reference','pnr','booking','ticketId','ticket_id','id'])
    const date=normalizeScannedDate(objectValue(record,['date','startDate','start_date','eventDate','departureDate']))
    const time=normalizeScannedTime(objectValue(record,['time','startTime','start_time','departureTime']))
    const endDate=normalizeScannedDate(objectValue(record,['endDate','end_date','arrivalDate']))
    const endTime=normalizeScannedTime(objectValue(record,['endTime','end_time','arrivalTime']))
    const typeText=objectValue(record,['type','ticketType','ticket_type','category'])+' '+title+' '+provider
    const type=ticketTypeFromText(typeText)

    return {
      kind:type==='other'?'reference':'ticket',
      title:title||provider||'Scanned information',
      ticket_type:type,
      start_date:date,
      start_time:time,
      end_date:endDate,
      end_time:endTime,
      location_text:location,
      provider_text:provider,
      booking_reference:reference,
      notes:'',
      raw_value:raw,
      source_label:'Structured QR data',
    }
  }catch{
    return null
  }
}

function parseKeyValueScan(raw:string):ScanDraft|null{
  if(/BEGIN:(VCALENDAR|VEVENT|VCARD)/i.test(raw)||/^WIFI:/i.test(raw)) return null

  const pairs=new Map<string,string>()
  raw
    .replace(/\r/g,'\n')
    .split(/[\n;]+/)
    .forEach((part)=>{
      const match=part.trim().match(/^([A-Za-z][A-Za-z _-]{1,30})\s*[:=]\s*(.+)$/)
      if(match) pairs.set(match[1].trim().toLowerCase().replace(/[ _-]+/g,''),match[2].trim())
    })

  if(pairs.size<2) return null

  const get=(...keys:string[])=>{
    for(const key of keys){
      const value=pairs.get(key.toLowerCase().replace(/[ _-]+/g,''))
      if(value) return value
    }
    return ''
  }

  const title=get('title','event','name','summary')
  const provider=get('provider','organizer','organisation','airline','carrier')
  const location=get('location','venue','address','airport','station')
  const reference=get('reference','bookingreference','booking','pnr','ticketid')
  const date=normalizeScannedDate(get('date','startdate','eventdate','departuredate'))
  const time=normalizeScannedTime(get('time','starttime','departuretime'))
  const endDate=normalizeScannedDate(get('enddate','arrivaldate'))
  const endTime=normalizeScannedTime(get('endtime','arrivaltime'))
  const type=ticketTypeFromText(get('type','tickettype','category')+' '+title+' '+provider)

  return {
    kind:type==='other'?'reference':'ticket',
    title:title||provider||'Scanned information',
    ticket_type:type,
    start_date:date,
    start_time:time,
    end_date:endDate,
    end_time:endTime,
    location_text:location,
    provider_text:provider,
    booking_reference:reference,
    notes:'',
    raw_value:raw,
    source_label:'Structured QR data',
  }
}

function qrWifiField(raw:string,key:string){
  const body=raw.replace(/^WIFI:/i,'').replace(/;;$/,'')
  const parts=body.split(/(?<!\\);/)
  const prefix=key+':'
  const part=parts.find((item)=>item.startsWith(prefix))
  return part?part.slice(prefix.length).replace(/\\;/g,';').replace(/\\:/g,':').replace(/\\\\/g,'\\'):''
}

function parseScannedPayload(rawValue:string):ScanDraft{
  const raw=rawValue.trim()
  const lines=unfoldPayloadLines(raw)
  const blank:ScanDraft={
    kind:'reference',
    title:'Scanned reference',
    ticket_type:'other',
    start_date:'',
    start_time:'',
    end_date:'',
    end_time:'',
    location_text:'',
    provider_text:'',
    booking_reference:'',
    notes:'',
    raw_value:raw,
    source_label:'QR / barcode',
  }

  const jsonDraft=parseJsonScan(raw)
  if(jsonDraft) return jsonDraft

  const keyValueDraft=parseKeyValueScan(raw)
  if(keyValueDraft) return keyValueDraft

  if(/BEGIN:(VCALENDAR|VEVENT)/i.test(raw)){
    const summary=unescapePayloadText(payloadField(lines,'SUMMARY'))
    const location=unescapePayloadText(payloadField(lines,'LOCATION'))
    const description=unescapePayloadText(payloadField(lines,'DESCRIPTION'))
    const start=parseCompactDateTime(payloadField(lines,'DTSTART'))
    const end=parseCompactDateTime(payloadField(lines,'DTEND'))

    return {
      ...blank,
      kind:'event',
      title:summary||'Scanned event',
      ticket_type:/flight|boarding|airline/i.test(summary+' '+description)
        ?'flight'
        :/train|rail/i.test(summary+' '+description)
          ?'train'
          :'event',
      start_date:start.date,
      start_time:start.time,
      end_date:end.date,
      end_time:end.time,
      location_text:location,
      notes:description,
      source_label:'Calendar event',
    }
  }

  if(/^BEGIN:VCARD/i.test(raw)){
    const name=unescapePayloadText(payloadField(lines,'FN'))
      ||unescapePayloadText(payloadField(lines,'N')).replace(/;/g,' ').trim()
    const org=unescapePayloadText(payloadField(lines,'ORG'))
    const phone=unescapePayloadText(payloadField(lines,'TEL'))
    const email=unescapePayloadText(payloadField(lines,'EMAIL'))
    return {
      ...blank,
      kind:'contact',
      title:name||org||'Scanned contact',
      provider_text:org,
      notes:[phone&&`Phone: ${phone}`,email&&`Email: ${email}`].filter(Boolean).join('\n'),
      source_label:'Contact card',
    }
  }

  if(/^WIFI:/i.test(raw)){
    const network=qrWifiField(raw,'S')
    const security=qrWifiField(raw,'T')
    return {
      ...blank,
      kind:'wifi',
      title:network?`Wi-Fi · ${network}`:'Wi-Fi network',
      provider_text:network,
      notes:security?`Security: ${security}`:'',
      source_label:'Wi-Fi information',
    }
  }

  if(/^https?:\/\//i.test(raw)){
    const host=hostTitle(raw)
    let params=new URLSearchParams()
    try{ params=new URL(raw).searchParams }catch{ /* keep empty params */ }
    const param=(...names:string[])=>{
      for(const name of names){
        const value=params.get(name)
        if(value) return value
      }
      return ''
    }
    const paramTitle=param('title','name','event','summary')
    const paramProvider=param('provider','organizer','airline','carrier')
    const paramLocation=param('location','venue','address')
    const paramReference=param('reference','ref','booking','pnr','ticket')
    const paramDate=normalizeScannedDate(param('date','startDate','start_date'))
    const paramTime=normalizeScannedTime(param('time','startTime','start_time'))
    const inferredType=ticketTypeFromText(raw+' '+paramTitle+' '+paramProvider)
    const looksTicket=inferredType!=='other'
    return {
      ...blank,
      kind:looksTicket?'ticket':'link',
      title:paramTitle||(looksTicket?`Ticket · ${host}`:host),
      ticket_type:inferredType,
      start_date:paramDate,
      start_time:paramTime,
      location_text:paramLocation,
      provider_text:paramProvider||host,
      booking_reference:paramReference,
      notes:raw,
      source_label:looksTicket?'Ticket link':'Web link',
    }
  }

  if(/^mailto:/i.test(raw)){
    const email=raw.replace(/^mailto:/i,'').split('?')[0]
    return {
      ...blank,
      kind:'contact',
      title:email||'Email address',
      notes:raw,
      source_label:'Email address',
    }
  }

  if(/^tel:/i.test(raw)){
    return {
      ...blank,
      kind:'contact',
      title:raw.replace(/^tel:/i,'')||'Phone number',
      notes:raw,
      source_label:'Phone number',
    }
  }

  if(/^otpauth:/i.test(raw)){
    return {
      ...blank,
      kind:'reference',
      title:'Security credential',
      notes:'Famioo will not automatically store authentication secrets from this QR code. Review the raw value carefully before saving anything.',
      source_label:'Sensitive security code',
    }
  }

  if(/^M\d/.test(raw)&&raw.length>50){
    return {
      ...blank,
      kind:'ticket',
      title:'Boarding pass',
      ticket_type:'flight',
      notes:'A boarding-pass barcode was detected. Some airline barcodes contain compact industry data, but Famioo will not guess fields it cannot verify.',
      source_label:'Boarding pass barcode',
    }
  }

  const ticketLike=/flight|boarding|train|ticket|concert|cinema|event|booking|reservation/i.test(raw)
  return {
    ...blank,
    kind:ticketLike?'ticket':'reference',
    title:ticketLike?'Scanned ticket':'Scanned reference',
    ticket_type:/flight|boarding/i.test(raw)?'flight':/train|rail/i.test(raw)?'train':ticketLike?'event':'other',
    notes:raw.length<=500?raw:'',
    source_label:ticketLike?'Ticket information':'General information',
  }
}

function zonedLocalToIso(date:string,time:string,timezone:string){
  const [year,month,day]=date.split('-').map(Number)
  const [hour,minute]=time.split(':').map(Number)
  let guess=Date.UTC(year,month-1,day,hour,minute,0)

  for(let pass=0;pass<3;pass+=1){
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:timezone,
      year:'numeric',
      month:'2-digit',
      day:'2-digit',
      hour:'2-digit',
      minute:'2-digit',
      second:'2-digit',
      hourCycle:'h23',
    }).formatToParts(new Date(guess))
    const get=(type:string)=>Number(parts.find((part)=>part.type===type)?.value??0)
    const represented=Date.UTC(
      get('year'),get('month')-1,get('day'),
      get('hour'),get('minute'),get('second'),
    )
    const desired=Date.UTC(year,month-1,day,hour,minute,0)
    guess+=desired-represented
  }

  return new Date(guess).toISOString()
}

function safeFileName(name:string){
  const clean=name.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-')
  return clean.slice(0,120)||'ticket'
}

function getBarcodeDetector(){
  return (window as typeof window&{BarcodeDetector?:BarcodeDetectorConstructor}).BarcodeDetector
}

function canvasFromVideo(video:HTMLVideoElement,maxSide=960){
  if(!video.videoWidth||!video.videoHeight) return null

  const scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight))
  const canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale))
  canvas.height=Math.max(1,Math.round(video.videoHeight*scale))
  const context=canvas.getContext('2d',{willReadFrequently:true})
  if(!context) return null

  context.drawImage(video,0,0,canvas.width,canvas.height)
  return canvas
}

function detectQrInCanvas(canvas:HTMLCanvasElement){
  const context=canvas.getContext('2d',{willReadFrequently:true})
  if(!context) return ''

  const image=context.getImageData(0,0,canvas.width,canvas.height)
  const result=jsQR(image.data,image.width,image.height,{
    inversionAttempts:'attemptBoth',
  })

  return result?.data?.trim()??''
}

async function canvasFromImageFile(file:File,maxSide=1600){
  const objectUrl=URL.createObjectURL(file)

  try{
    const image=new Image()
    await new Promise<void>((resolve,reject)=>{
      image.onload=()=>resolve()
      image.onerror=()=>reject(new Error('Ticket image could not be opened.'))
      image.src=objectUrl
    })

    const scale=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale))
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale))
    const context=canvas.getContext('2d',{willReadFrequently:true})
    if(!context) return null

    context.drawImage(image,0,0,canvas.width,canvas.height)
    return canvas
  }finally{
    URL.revokeObjectURL(objectUrl)
  }
}

async function captureVideoFrame(video:HTMLVideoElement){
  if(!video.videoWidth||!video.videoHeight) return null

  const canvas=document.createElement('canvas')
  canvas.width=video.videoWidth
  canvas.height=video.videoHeight
  const context=canvas.getContext('2d')
  if(!context) return null

  context.drawImage(video,0,0,canvas.width,canvas.height)

  const blob=await new Promise<Blob|null>((resolve)=>{
    canvas.toBlob(resolve,'image/jpeg',.9)
  })
  if(!blob) return null

  return new File([blob],`ticket-scan-${Date.now()}.jpg`,{type:'image/jpeg'})
}

export function TicketWalletPage(){
  const { household,modules,profiles,user }=useHousehold()
  const access=modules.find((module)=>module.code==='tickets')
  const canWrite=Boolean(access?.enabled&&access.can_write)
  const canWriteCalendar=Boolean(modules.find((module)=>module.code==='calendar')?.can_write)
  const canWriteLifeAdmin=Boolean(modules.find((module)=>module.code==='life_admin')?.can_write)

  const [tickets,setTickets]=useState<TicketEntry[]>([])
  const [calendars,setCalendars]=useState<CalendarRow[]>([])
  const [fileUrls,setFileUrls]=useState<Record<string,string>>({})
  const [filter,setFilter]=useState<'active'|'used'|'archived'|'all'>('active')

  const [composerOpen,setComposerOpen]=useState(false)
  const [editing,setEditing]=useState<TicketEntry|null>(null)
  const [title,setTitle]=useState('')
  const [ticketType,setTicketType]=useState<TicketType>('event')
  const [holderProfileId,setHolderProfileId]=useState('')
  const [startDate,setStartDate]=useState('')
  const [startTime,setStartTime]=useState('09:00')
  const [hasStartTime,setHasStartTime]=useState(false)
  const [endDate,setEndDate]=useState('')
  const [endTime,setEndTime]=useState('11:00')
  const [hasEndTime,setHasEndTime]=useState(false)
  const [locationText,setLocationText]=useState('')
  const [providerText,setProviderText]=useState('')
  const [bookingReference,setBookingReference]=useState('')
  const [qrValue,setQrValue]=useState('')
  const [notes,setNotes]=useState('')
  const [status,setStatus]=useState<TicketStatus>('active')
  const [calendarId,setCalendarId]=useState('')
  const [syncCalendar,setSyncCalendar]=useState(false)
  const [pendingFile,setPendingFile]=useState<File|null>(null)
  const [existingFilePath,setExistingFilePath]=useState<string|null>(null)
  const [existingFileName,setExistingFileName]=useState<string|null>(null)
  const [existingFileMime,setExistingFileMime]=useState<string|null>(null)
  const [existingFileSize,setExistingFileSize]=useState<number|null>(null)
  const [removeExistingFile,setRemoveExistingFile]=useState(false)

  const [scannerOpen,setScannerOpen]=useState(false)
  const [scannerError,setScannerError]=useState('')
  const [scannerMessage,setScannerMessage]=useState('')
  const [scanReviewOpen,setScanReviewOpen]=useState(false)
  const [scanDraft,setScanDraft]=useState<ScanDraft|null>(null)
  const [scanFile,setScanFile]=useState<File|null>(null)
  const [scanSaving,setScanSaving]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [archiveTarget,setArchiveTarget]=useState<TicketEntry|null>(null)

  const fileInputRef=useRef<HTMLInputElement>(null)
  const scanFileInputRef=useRef<HTMLInputElement>(null)
  const videoRef=useRef<HTMLVideoElement>(null)

  const currentProfile=useMemo(
    ()=>profiles.find((profile)=>profile.linked_user_id===user.id)??null,
    [profiles,user.id],
  )

  const profileById=useMemo(
    ()=>new Map(profiles.map((profile)=>[profile.id,profile])),
    [profiles],
  )

  async function load(){
    if(!access?.enabled) return

    setError('')
    const [ticketResult,calendarResult]=await Promise.all([
      supabase
        .from('ticket_wallet_entries')
        .select('id,household_id,title,ticket_type,holder_profile_id,start_date,start_time,end_date,end_time,location_text,provider_text,booking_reference,qr_value,notes,status,calendar_id,linked_event_id,file_path,file_name,file_mime_type,file_size,created_at,updated_at')
        .eq('household_id',household.id)
        .order('start_date',{ascending:true,nullsFirst:false})
        .order('created_at',{ascending:false}),
      supabase
        .from('calendars')
        .select('id,name,color_key,is_default')
        .eq('household_id',household.id)
        .eq('active',true)
        .order('is_default',{ascending:false})
        .order('name'),
    ])

    if(ticketResult.error){
      setError(ticketResult.error.message)
    }else{
      const rows=(ticketResult.data??[]) as TicketEntry[]
      setTickets(rows)

      const urls:Record<string,string>={}
      await Promise.all(rows.map(async(row)=>{
        if(!row.file_path) return
        const signed=await supabase.storage
          .from('ticket-wallet')
          .createSignedUrl(row.file_path,3600)
        if(signed.data?.signedUrl) urls[row.id]=signed.data.signedUrl
      }))
      setFileUrls(urls)
    }

    if(calendarResult.error){
      setError((current)=>current||calendarResult.error.message)
    }else{
      const rows=(calendarResult.data??[]) as CalendarRow[]
      setCalendars(rows)
      setCalendarId((current)=>rows.some((row)=>row.id===current)
        ?current
        :rows.find((row)=>row.is_default)?.id??rows[0]?.id??'')
    }
  }

  useEffect(()=>{ void load() },[household.id,access?.enabled])

  function resetForm(){
    setEditing(null)
    setTitle('')
    setTicketType('event')
    setHolderProfileId(currentProfile?.id??'')
    setStartDate('')
    setStartTime('09:00')
    setHasStartTime(false)
    setEndDate('')
    setEndTime('11:00')
    setHasEndTime(false)
    setLocationText('')
    setProviderText('')
    setBookingReference('')
    setQrValue('')
    setNotes('')
    setStatus('active')
    setCalendarId(calendars.find((calendar)=>calendar.is_default)?.id??calendars[0]?.id??'')
    setSyncCalendar(false)
    setPendingFile(null)
    setExistingFilePath(null)
    setExistingFileName(null)
    setExistingFileMime(null)
    setExistingFileSize(null)
    setRemoveExistingFile(false)
    setScannerError('')
    setScannerMessage('')
    setError('')
  }

  function openNew(scan=false){
    resetForm()
    setScanDraft(null)
    setScanFile(null)
    setScanReviewOpen(false)
    if(scan){
      setComposerOpen(false)
      setScannerOpen(true)
    }else{
      setComposerOpen(true)
    }
  }

  function openEdit(ticket:TicketEntry){
    setEditing(ticket)
    setTitle(ticket.title)
    setTicketType(ticket.ticket_type)
    setHolderProfileId(ticket.holder_profile_id??'')
    setStartDate(ticket.start_date??'')
    setStartTime(ticket.start_time?.slice(0,5)??'09:00')
    setHasStartTime(Boolean(ticket.start_time))
    setEndDate(ticket.end_date??'')
    setEndTime(ticket.end_time?.slice(0,5)??'11:00')
    setHasEndTime(Boolean(ticket.end_time))
    setLocationText(ticket.location_text??'')
    setProviderText(ticket.provider_text??'')
    setBookingReference(ticket.booking_reference??'')
    setQrValue(ticket.qr_value??'')
    setNotes(ticket.notes??'')
    setStatus(ticket.status)
    setCalendarId(ticket.calendar_id??calendars.find((calendar)=>calendar.is_default)?.id??calendars[0]?.id??'')
    setSyncCalendar(Boolean(ticket.linked_event_id))
    setPendingFile(null)
    setExistingFilePath(ticket.file_path)
    setExistingFileName(ticket.file_name)
    setExistingFileMime(ticket.file_mime_type)
    setExistingFileSize(ticket.file_size)
    setRemoveExistingFile(false)
    setScannerError('')
    setScannerMessage('')
    setError('')
    setComposerOpen(true)
  }

  useEffect(()=>{
    if(!scannerOpen) return

    const Detector=getBarcodeDetector()

    if(!navigator.mediaDevices?.getUserMedia){
      setScannerError('Camera access is not available in this browser. Upload a ticket image instead.')
      return
    }

    let cancelled=false
    let timer=0
    let stream:MediaStream|null=null
    const detector=Detector?new Detector():null

    async function scanLoop(){
      if(cancelled) return
      const video=videoRef.current
      if(!video||video.readyState<2){
        timer=window.setTimeout(()=>void scanLoop(),300)
        return
      }

      let raw=''

      if(detector){
        try{
          const results=await detector.detect(video)
          raw=results.find((item)=>item.rawValue?.trim())?.rawValue?.trim()??''
        }catch{
          // Native detection is optional; the QR fallback below still runs.
        }
      }

      if(!raw){
        try{
          const canvas=canvasFromVideo(video)
          if(canvas) raw=detectQrInCanvas(canvas)
        }catch{
          // Keep trying while the camera is active.
        }
      }

      if(raw){
        const snapshot=await captureVideoFrame(video)
        const draft=parseScannedPayload(raw)
        setScanFile(snapshot)
        setScanDraft(draft)
        setScannerMessage('Code detected. Famioo recognized the information below.')
        setScannerOpen(false)
        setScanReviewOpen(true)
        return
      }

      timer=window.setTimeout(()=>void scanLoop(),350)
    }

    async function start(){
      setScannerError('')
      try{
        stream=await navigator.mediaDevices.getUserMedia({
          audio:false,
          video:{facingMode:{ideal:'environment'}},
        })

        if(cancelled){
          stream.getTracks().forEach((track)=>track.stop())
          return
        }

        const video=videoRef.current
        if(!video) return

        video.srcObject=stream
        await video.play()
        void scanLoop()
      }catch(reason){
        setScannerError(reason instanceof Error
          ?reason.message
          :'Camera permission could not be opened. Upload a ticket image instead.')
      }
    }

    void start()

    return ()=>{
      cancelled=true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((track)=>track.stop())
      if(videoRef.current) videoRef.current.srcObject=null
    }
  },[scannerOpen])

  async function detectCodeInImage(file:File){
    if(!file.type.startsWith('image/')) return false

    let raw=''
    const Detector=getBarcodeDetector()

    if(Detector&&'createImageBitmap' in window){
      try{
        const bitmap=await createImageBitmap(file)
        const detector=new Detector()
        const results=await detector.detect(bitmap)
        bitmap.close()
        raw=results.find((item)=>item.rawValue?.trim())?.rawValue?.trim()??''
      }catch{
        // Fall through to the browser-independent QR decoder.
      }
    }

    if(!raw){
      try{
        const canvas=await canvasFromImageFile(file)
        if(canvas) raw=detectQrInCanvas(canvas)
      }catch{
        // The ticket can still be saved even if no QR is readable.
      }
    }

    if(raw){
      const draft=parseScannedPayload(raw)
      setQrValue(raw)
      setScanDraft(draft)
      setScanFile(file)
      setScannerMessage('Code detected from the uploaded image. Famioo recognized the information below.')
      setScanReviewOpen(true)
      return true
    }

    return false
  }

  async function chooseFile(file:File|null){
    setError('')
    if(!file) return

    if(file.size>15*1024*1024){
      setError('Ticket files can be up to 15 MB.')
      return
    }

    if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){
      setError('Use a JPG, PNG, WebP or PDF ticket file.')
      return
    }

    setPendingFile(file)
    setRemoveExistingFile(false)
    const detected=await detectCodeInImage(file)

    if(!detected&&!composerOpen){
      resetForm()
      setPendingFile(file)
      setComposerOpen(true)
      setScannerMessage('No readable code was found in the file. Add or confirm the ticket details manually.')
    }
  }

  function scanNotes(draft:ScanDraft){
    const pieces=[
      draft.notes.trim(),
      draft.raw_value&&draft.notes.trim()!==draft.raw_value
        ?'Scanned value:\n'+draft.raw_value
        :'',
    ].filter(Boolean)
    return pieces.join('\n\n')
  }

  function openFullEditorFromScan(){
    if(!scanDraft) return

    resetForm()
    setTitle(scanDraft.title)
    setTicketType(scanDraft.ticket_type)
    setHolderProfileId(currentProfile?.id??'')
    setStartDate(scanDraft.start_date)
    setStartTime(scanDraft.start_time||'09:00')
    setHasStartTime(Boolean(scanDraft.start_time))
    setEndDate(scanDraft.end_date)
    setEndTime(scanDraft.end_time||'11:00')
    setHasEndTime(Boolean(scanDraft.end_time))
    setLocationText(scanDraft.location_text)
    setProviderText(scanDraft.provider_text)
    setBookingReference(scanDraft.booking_reference)
    setQrValue(scanDraft.raw_value)
    setNotes(scanDraft.notes)
    setPendingFile(scanFile)
    setSyncCalendar(false)
    setScanReviewOpen(false)
    setComposerOpen(true)
  }

  async function uploadScanFile(){
    if(!scanFile) return {
      path:null as string|null,
      name:null as string|null,
      mime:null as string|null,
      size:null as number|null,
    }

    const path=`${household.id}/${crypto.randomUUID()}/${safeFileName(scanFile.name)}`
    const upload=await supabase.storage
      .from('ticket-wallet')
      .upload(path,scanFile,{
        contentType:scanFile.type,
        upsert:false,
      })

    if(upload.error) throw upload.error

    return {
      path,
      name:scanFile.name,
      mime:scanFile.type,
      size:scanFile.size,
    }
  }

  async function saveScanToWallet(withCalendar:boolean){
    if(!scanDraft||scanSaving) return
    if(withCalendar&&!scanDraft.start_date){
      setError('Add the event or ticket date before saving it to Calendar.')
      return
    }

    setScanSaving(true)
    setError('')
    setMessage('')

    let uploaded:{path:string|null;name:string|null;mime:string|null;size:number|null}|null=null

    try{
      uploaded=await uploadScanFile()

      const result=await supabase.rpc('save_ticket_wallet_entry_v1',{
        p_id:null,
        p_household_id:household.id,
        p_title:scanDraft.title.trim()||'Scanned ticket',
        p_ticket_type:scanDraft.ticket_type,
        p_holder_profile_id:currentProfile?.id??null,
        p_start_date:scanDraft.start_date||null,
        p_start_time:scanDraft.start_time||null,
        p_end_date:scanDraft.end_date||null,
        p_end_time:scanDraft.end_time||null,
        p_location_text:scanDraft.location_text.trim()||null,
        p_provider_text:scanDraft.provider_text.trim()||null,
        p_booking_reference:scanDraft.booking_reference.trim()||null,
        p_qr_value:scanDraft.raw_value,
        p_notes:scanDraft.notes.trim()||null,
        p_status:'active',
        p_calendar_id:withCalendar?(calendarId||null):null,
        p_sync_calendar:withCalendar,
        p_file_path:uploaded.path,
        p_file_name:uploaded.name,
        p_file_mime_type:uploaded.mime,
        p_file_size:uploaded.size,
      })

      if(result.error) throw result.error

      setScanReviewOpen(false)
      setComposerOpen(false)
      setScanDraft(null)
      setScanFile(null)
      setMessage(withCalendar
        ?'Scan saved to Ticket Wallet and Calendar.'
        :'Scan saved to Ticket Wallet.')
      await load()
    }catch(reason){
      if(uploaded?.path){
        await supabase.storage.from('ticket-wallet').remove([uploaded.path])
      }
      setError(reason instanceof Error?reason.message:'Could not save the scanned ticket.')
    }finally{
      setScanSaving(false)
    }
  }

  async function saveScanToCalendar(){
    if(!scanDraft||scanSaving) return
    if(!scanDraft.start_date){
      setError('Add a date before saving this scan to Calendar.')
      return
    }

    const targetCalendar=calendars.find((calendar)=>calendar.id===calendarId)
      ??calendars.find((calendar)=>calendar.is_default)
      ??calendars[0]

    if(!targetCalendar){
      setError('No active Calendar is available.')
      return
    }

    setScanSaving(true)
    setError('')
    setMessage('')

    const allDay=!scanDraft.start_time
    const startAt=allDay
      ?null
      :zonedLocalToIso(scanDraft.start_date,scanDraft.start_time,household.timezone)

    let endAt:string|null=null
    if(startAt){
      if(scanDraft.end_time){
        endAt=zonedLocalToIso(
          scanDraft.end_date||scanDraft.start_date,
          scanDraft.end_time,
          household.timezone,
        )
      }else{
        endAt=new Date(new Date(startAt).getTime()+2*60*60*1000).toISOString()
      }
    }

    const participants=currentProfile
      ?[{profile_id:currentProfile.id,participant_role:'participant',can_edit:false}]
      :[]

    const result=await supabase.rpc('save_event_v1',{
      p_event_id:null,
      p_household_id:household.id,
      p_calendar_id:targetCalendar.id,
      p_title:scanDraft.title.trim()||'Scanned event',
      p_description:scanNotes(scanDraft)||null,
      p_all_day:allDay,
      p_start_at:startAt,
      p_end_at:endAt,
      p_start_date:allDay?scanDraft.start_date:null,
      p_end_date:allDay?(scanDraft.end_date||scanDraft.start_date):null,
      p_timezone:household.timezone,
      p_location_text:scanDraft.location_text.trim()||null,
      p_category_id:null,
      p_visibility:'household',
      p_participants:participants,
      p_rrule:null,
      p_reminders:[],
    })

    setScanSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    setScanReviewOpen(false)
    setComposerOpen(false)
    setScanDraft(null)
    setScanFile(null)
    setMessage('Scanned information saved to Calendar.')
  }

  async function saveScanToLifeAdmin(){
    if(!scanDraft||scanSaving) return

    setScanSaving(true)
    setError('')
    setMessage('')

    const result=await supabase.rpc('save_life_admin_item_v2',{
      p_id:null,
      p_household_id:household.id,
      p_item_type:'reference',
      p_title:scanDraft.title.trim()||'Scanned reference',
      p_provider:scanDraft.provider_text.trim()||null,
      p_reference_number:scanDraft.booking_reference.trim()||null,
      p_start_date:scanDraft.start_date||null,
      p_due_date:null,
      p_renewal_date:null,
      p_expiry_date:null,
      p_amount:null,
      p_currency:'EUR',
      p_frequency:'none',
      p_auto_renew:false,
      p_cancellation_notice_days:null,
      p_responsible_profile_id:currentProfile?.id??null,
      p_notes:scanNotes(scanDraft)||null,
      p_add_to_calendar:false,
      p_flow_type:'expense',
      p_include_in_finance:false,
      p_sync_task:false,
    })

    setScanSaving(false)

    if(result.error){
      setError(result.error.message)
      return
    }

    setScanReviewOpen(false)
    setComposerOpen(false)
    setScanDraft(null)
    setScanFile(null)
    setMessage('Scanned information saved to Life Admin · Reference.')
  }

  async function saveTicket(event:FormEvent){
    event.preventDefault()
    if(!canWrite||saving||!title.trim()) return

    if(syncCalendar&&!startDate){
      setError('Add a ticket date before synchronizing it to Calendar.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    let uploadedPath:string|null=null
    let finalPath=removeExistingFile?null:existingFilePath
    let finalName=removeExistingFile?null:existingFileName
    let finalMime=removeExistingFile?null:existingFileMime
    let finalSize=removeExistingFile?null:existingFileSize

    if(pendingFile){
      const path=`${household.id}/${crypto.randomUUID()}/${safeFileName(pendingFile.name)}`
      const upload=await supabase.storage
        .from('ticket-wallet')
        .upload(path,pendingFile,{
          contentType:pendingFile.type,
          upsert:false,
        })

      if(upload.error){
        setSaving(false)
        setError(upload.error.message)
        return
      }

      uploadedPath=path
      finalPath=path
      finalName=pendingFile.name
      finalMime=pendingFile.type
      finalSize=pendingFile.size
    }

    const result=await supabase.rpc('save_ticket_wallet_entry_v1',{
      p_id:editing?.id??null,
      p_household_id:household.id,
      p_title:title.trim(),
      p_ticket_type:ticketType,
      p_holder_profile_id:holderProfileId||null,
      p_start_date:startDate||null,
      p_start_time:hasStartTime?startTime:null,
      p_end_date:endDate||null,
      p_end_time:hasStartTime&&hasEndTime?endTime:null,
      p_location_text:locationText.trim()||null,
      p_provider_text:providerText.trim()||null,
      p_booking_reference:bookingReference.trim()||null,
      p_qr_value:qrValue.trim()||null,
      p_notes:notes.trim()||null,
      p_status:status,
      p_calendar_id:syncCalendar?(calendarId||null):null,
      p_sync_calendar:syncCalendar,
      p_file_path:finalPath,
      p_file_name:finalName,
      p_file_mime_type:finalMime,
      p_file_size:finalSize,
    })

    if(result.error){
      if(uploadedPath){
        await supabase.storage.from('ticket-wallet').remove([uploadedPath])
      }
      setSaving(false)
      setError(result.error.message)
      return
    }

    if(existingFilePath&&existingFilePath!==finalPath){
      await supabase.storage.from('ticket-wallet').remove([existingFilePath])
    }

    setSaving(false)
    setComposerOpen(false)
    setMessage(editing?'Ticket updated.':'Ticket saved to the family wallet.')
    resetForm()
    await load()
  }

  async function archiveTicket(){
    if(!archiveTarget||!canWrite) return

    const target=archiveTarget
    setArchiveTarget(null)
    setError('')

    const result=await supabase.rpc('archive_ticket_wallet_entry_v1',{
      p_id:target.id,
      p_household_id:household.id,
    })

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage('Ticket archived.')
    await load()
  }

  const visibleTickets=useMemo(()=>{
    const filtered=filter==='all'
      ?tickets
      :tickets.filter((ticket)=>ticket.status===filter)

    return [...filtered].sort((a,b)=>{
      const aDate=a.start_date??'9999-12-31'
      const bDate=b.start_date??'9999-12-31'
      return aDate.localeCompare(bDate)||a.title.localeCompare(b.title)
    })
  },[tickets,filter])

  const activeTickets=tickets.filter((ticket)=>ticket.status==='active')
  const upcomingTickets=activeTickets.filter((ticket)=>!ticket.start_date||ticket.start_date>=todayKey())
  const datedUpcoming=activeTickets
    .filter((ticket)=>ticket.start_date&&ticket.start_date>=todayKey())
    .sort((a,b)=>(a.start_date??'').localeCompare(b.start_date??''))
  const nextTicket=datedUpcoming[0]??null

  if(!access?.enabled){
    return (
      <div className="page ticket-wallet-page">
        <div className="page-label">TICKET WALLET</div>
        <section className="list-card module-placeholder-card">
          <Ticket size={24}/>
          <strong>Ticket Wallet is not enabled for this household.</strong>
          <span>Store travel and event tickets, QR codes and Calendar appointments in one place.</span>
        </section>
      </div>
    )
  }

  return (
    <div className="page ticket-wallet-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">TICKET WALLET</div>
          <h1>Ticket Wallet</h1>
          <p className="page-subtitle">Keep family travel, event and admission tickets together. Scan a QR/barcode, upload the original ticket and connect the appointment to Calendar.</p>
        </div>

        {canWrite&&(
          <div className="ticket-wallet-heading-actions">
            <button type="button" className="secondary-button compact" onClick={()=>openNew(true)}>
              <ScanLine size={15}/>Scan ticket
            </button>
            <button type="button" className="secondary-button compact" onClick={()=>{
              resetForm()
              scanFileInputRef.current?.click()
            }}>
              <Upload size={15}/>Import file
            </button>
            <button type="button" className="primary-button compact" onClick={()=>openNew(false)}>
              <Ticket size={15}/>Add ticket
            </button>
          </div>
        )}
      </div>

      <input
        ref={scanFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        hidden
        onChange={(event)=>{
          const file=event.target.files?.[0]??null
          event.target.value=''
          void chooseFile(file)
        }}
      />

      <section className="list-card ticket-wallet-security">
        <QrCode size={18}/>
        <div>
          <strong>Private ticket data</strong>
          <p>Ticket files and saved QR/barcode values are stored in private household storage. Access follows Famioo household permissions and the normal database security rules.</p>
        </div>
      </section>

      {error&&!composerOpen&&<div className="notice error">{error}</div>}
      {message&&<div className="notice success">{message}</div>}

      <section className="ticket-wallet-summary-grid">
        <article className="list-card ticket-wallet-summary">
          <span><Ticket size={18}/></span>
          <div><strong>{upcomingTickets.length}</strong><small>active tickets</small></div>
        </article>
        <article className="list-card ticket-wallet-summary">
          <span><QrCode size={18}/></span>
          <div><strong>{tickets.filter((ticket)=>Boolean(ticket.qr_value)).length}</strong><small>codes stored</small></div>
        </article>
        <article className="list-card ticket-wallet-summary wide">
          <span><CalendarDays size={18}/></span>
          <div>
            <small>Next ticket</small>
            <strong>{nextTicket?.title??'No dated ticket yet'}</strong>
            <small>{nextTicket?.start_date
              ?formatDate(nextTicket.start_date)+(nextTicket.start_time?' · '+nextTicket.start_time.slice(0,5):'')
              :'Add a date to see the next ticket here'}</small>
          </div>
        </article>
      </section>

      <section className="ticket-wallet-section">
        <header className="ticket-wallet-section-head">
          <div>
            <span className="eyebrow">FAMILY WALLET</span>
            <h2>Saved tickets</h2>
          </div>

          <Select
            value={filter}
            onChange={(value)=>setFilter(value as typeof filter)}
            options={[
              {value:'active',label:'Active'},
              {value:'used',label:'Used'},
              {value:'archived',label:'Archived'},
              {value:'all',label:'All tickets'},
            ]}
            ariaLabel="Filter Ticket Wallet"
            className="ticket-wallet-filter"
          />
        </header>

        {visibleTickets.length===0 ? (
          <div className="list-card empty-state ticket-wallet-empty">
            <Ticket size={26}/>
            <span className="empty-state-title">No tickets here yet.</span>
            <span>{canWrite?'Scan a QR code, upload a ticket or add the first ticket manually.':'No tickets are available.'}</span>
          </div>
        ) : (
          <div className="ticket-wallet-list">
            {visibleTickets.map((ticket)=>{
              const holder=ticket.holder_profile_id?profileById.get(ticket.holder_profile_id):undefined
              const fileUrl=fileUrls[ticket.id]

              return (
                <article className={'list-card ticket-wallet-card '+ticket.status} key={ticket.id}>
                  <div className="ticket-wallet-card-mark">
                    <Ticket size={18}/>
                  </div>

                  <div className="ticket-wallet-card-main">
                    <div className="ticket-wallet-card-title">
                      <div>
                        <span>{ticketTypeLabel(ticket.ticket_type)}</span>
                        <h3>{ticket.title}</h3>
                      </div>
                      <em>{ticket.status}</em>
                    </div>

                    <div className="ticket-wallet-meta">
                      {ticket.start_date&&(
                        <span><CalendarDays size={12}/>{formatDate(ticket.start_date)}{ticket.start_time?' · '+ticket.start_time.slice(0,5):''}</span>
                      )}
                      {ticket.location_text&&<GoogleMapsLink location={ticket.location_text}/>}
                      {holder&&(
                        <span className="ticket-holder">
                          <ProfileAvatar avatarPath={holder.avatar_path} name={holder.display_name} size="sm"/>
                          {holder.display_name}
                        </span>
                      )}
                      {ticket.provider_text&&<span>{ticket.provider_text}</span>}
                      {ticket.qr_value&&<span><QrCode size={12}/>Code saved</span>}
                      {ticket.linked_event_id&&<span><CalendarDays size={12}/>In Calendar</span>}
                    </div>

                    {(ticket.booking_reference||ticket.notes)&&(
                      <div className="ticket-wallet-details">
                        {ticket.booking_reference&&<small>Reference: {ticket.booking_reference}</small>}
                        {ticket.notes&&<p>{ticket.notes}</p>}
                      </div>
                    )}

                    {fileUrl&&(
                      <a className="ticket-wallet-file" href={fileUrl} target="_blank" rel="noreferrer">
                        {ticket.file_mime_type?.startsWith('image/')?<ImageIcon size={13}/>:<FileText size={13}/>}
                        {ticket.file_name??'Open ticket file'}
                      </a>
                    )}
                  </div>

                  {canWrite&&ticket.status!=='archived'&&(
                    <div className="ticket-wallet-card-actions">
                      <button type="button" className="icon-button compact-icon" onClick={()=>openEdit(ticket)} aria-label={'Edit '+ticket.title}>
                        <Pencil size={14}/>
                      </button>
                      <button type="button" className="icon-button compact-icon" onClick={()=>setArchiveTarget(ticket)} aria-label={'Archive '+ticket.title}>
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {composerOpen&&canWrite&&(
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event)=>{
            if(event.currentTarget===event.target&&!scannerOpen){
              setComposerOpen(false)
              resetForm()
            }
          }}
        >
          <form className="modal-card ticket-wallet-composer" onSubmit={saveTicket}>
            <header>
              <div>
                <span className="eyebrow">{editing?'EDIT TICKET':'NEW TICKET'}</span>
                <h2>{editing?'Edit Ticket Wallet entry':'Add to Ticket Wallet'}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close Ticket Wallet form" onClick={()=>{
                setComposerOpen(false)
                resetForm()
              }}>
                <X size={18}/>
              </button>
            </header>

            {scannerMessage&&<div className="notice success">{scannerMessage}</div>}

            <div className="composer-grid-two aligned-field-row">
              <label>
                Ticket name
                <input
                  value={title}
                  onChange={(event)=>setTitle(event.target.value)}
                  placeholder="e.g. Flight to Mallorca"
                  autoFocus
                  required
                />
              </label>

              <label>
                Type
                <Select
                  value={ticketType}
                  onChange={(value)=>setTicketType(value as TicketType)}
                  options={ticketTypes}
                  ariaLabel="Choose ticket type"
                />
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Ticket holder
                <Select
                  value={holderProfileId}
                  onChange={setHolderProfileId}
                  options={[
                    {value:'',label:'Household / no specific holder'},
                    ...profiles.map((profile)=>({value:profile.id,label:profile.display_name})),
                  ]}
                  ariaLabel="Choose ticket holder"
                />
              </label>

              <label>
                Provider / organizer
                <input
                  value={providerText}
                  onChange={(event)=>setProviderText(event.target.value)}
                  placeholder="Airline, venue, railway…"
                />
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Date
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                  format={household.date_format}
                  ariaLabel="Choose ticket date"
                />
              </label>

              <label>
                End date
                <DatePicker
                  value={endDate}
                  onChange={setEndDate}
                  min={startDate||undefined}
                  format={household.date_format}
                  ariaLabel="Choose ticket end date"
                />
                <small className="field-hint">Optional for multi-day or travel tickets.</small>
              </label>
            </div>

            <div className="ticket-wallet-time-row">
              <label className="ticket-wallet-checkbox">
                <input type="checkbox" checked={hasStartTime} onChange={(event)=>{
                  setHasStartTime(event.target.checked)
                  if(!event.target.checked) setHasEndTime(false)
                }}/>
                <span>Specific start time</span>
              </label>

              {hasStartTime&&(
                <label>
                  Start
                  <TimePicker value={startTime} onChange={setStartTime}/>
                </label>
              )}

              {hasStartTime&&(
                <label className="ticket-wallet-checkbox">
                  <input type="checkbox" checked={hasEndTime} onChange={(event)=>setHasEndTime(event.target.checked)}/>
                  <span>Specific end time</span>
                </label>
              )}

              {hasStartTime&&hasEndTime&&(
                <label>
                  End
                  <TimePicker value={endTime} onChange={setEndTime}/>
                </label>
              )}
            </div>

            <label>
              Location
              <input
                value={locationText}
                onChange={(event)=>setLocationText(event.target.value)}
                placeholder="Airport, station, venue or address"
              />
              {locationText.trim()&&<GoogleMapsLink location={locationText} label="Open in Google Maps" className="field-map-link"/>}
            </label>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Booking / ticket reference
                <input
                  value={bookingReference}
                  onChange={(event)=>setBookingReference(event.target.value)}
                  placeholder="Optional reference"
                />
              </label>

              <label>
                Status
                <Select
                  value={status}
                  onChange={(value)=>setStatus(value as TicketStatus)}
                  options={[
                    {value:'active',label:'Active'},
                    {value:'used',label:'Used'},
                    {value:'archived',label:'Archived'},
                  ]}
                  ariaLabel="Choose ticket status"
                />
              </label>
            </div>

            <section className="ticket-wallet-code-panel">
              <header>
                <div>
                  <span className="eyebrow">QR / BARCODE</span>
                  <strong>{qrValue?'Code captured':'Scan or enter a code'}</strong>
                </div>
                <button type="button" className="secondary-button compact" onClick={()=>setScannerOpen(true)}>
                  <Camera size={14}/>Open camera
                </button>
              </header>

              <textarea
                value={qrValue}
                onChange={(event)=>setQrValue(event.target.value)}
                placeholder="QR/barcode value is filled automatically when supported, or it can be pasted here."
              />

              <small>QR recognition runs locally in the browser and does not use AI. Other barcode formats use the browser’s native detector when available.</small>
            </section>

            <section className="ticket-wallet-file-panel">
              <header>
                <div>
                  <span className="eyebrow">TICKET FILE</span>
                  <strong>{pendingFile?.name??(!removeExistingFile?existingFileName:null)??'No file attached'}</strong>
                </div>
                <button type="button" className="secondary-button compact" onClick={()=>fileInputRef.current?.click()}>
                  <Upload size={14}/>Choose file
                </button>
              </header>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                hidden
                onChange={(event)=>void chooseFile(event.target.files?.[0]??null)}
              />

              {(pendingFile||existingFilePath)&&!removeExistingFile&&(
                <button type="button" className="text-button ticket-remove-file" onClick={()=>{
                  setPendingFile(null)
                  setRemoveExistingFile(Boolean(existingFilePath))
                }}>
                  Remove attached file
                </button>
              )}

              <small>JPG, PNG, WebP or PDF · maximum 15 MB. Ticket images are checked locally for QR codes; supported browsers can also detect additional barcode formats.</small>
            </section>

            <label>
              Notes
              <textarea
                value={notes}
                onChange={(event)=>setNotes(event.target.value)}
                placeholder="Seat, gate, meeting point or anything useful for the family"
              />
            </label>

            <section className="ticket-wallet-calendar-panel">
              <label className="ticket-wallet-checkbox">
                <input
                  type="checkbox"
                  checked={syncCalendar}
                  onChange={(event)=>setSyncCalendar(event.target.checked)}
                />
                <span>Add this ticket to Calendar</span>
              </label>

              {syncCalendar&&(
                <label>
                  Calendar
                  <Select
                    value={calendarId}
                    onChange={setCalendarId}
                    options={calendars.map((calendar)=>({
                      value:calendar.id,
                      label:calendar.name+(calendar.is_default?' · Default':''),
                      dotColor:categoryColor(calendar.color_key),
                    }))}
                    ariaLabel="Choose Calendar for ticket"
                  />
                </label>
              )}
            </section>

            {error&&<div className="notice error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={()=>{
                setComposerOpen(false)
                resetForm()
              }}>Cancel</button>
              <button className="primary-button" disabled={saving||!title.trim()||(syncCalendar&&!startDate)}>
                {saving?'Saving…':'Save ticket'}
              </button>
            </div>
          </form>
        </div>
      )}

      {scanReviewOpen&&scanDraft&&(
        <div
          className="modal-backdrop ticket-scan-review-backdrop"
          role="presentation"
          onMouseDown={(event)=>{
            if(event.currentTarget===event.target&&!scanSaving){
              setScanReviewOpen(false)
              setScanDraft(null)
              setScanFile(null)
              setError('')
            }
          }}
        >
          <section className="modal-card ticket-scan-review-card">
            <header>
              <div>
                <span className="eyebrow">RECOGNIZED FROM CODE</span>
                <h2>Review scanned information</h2>
                <p>{scanDraft.source_label} · edit anything that is missing or incorrect.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close scanned information"
                onClick={()=>{
                  if(scanSaving) return
                  setScanReviewOpen(false)
                  setScanDraft(null)
                  setScanFile(null)
                  setError('')
                }}
              >
                <X size={18}/>
              </button>
            </header>

            {scanDraft.source_label==='Sensitive security code'&&(
              <div className="notice error">
                This looks like an authentication/2FA secret. Famioo will not offer automatic saving for security credentials.
              </div>
            )}

            <div className="ticket-scan-recognition-strip">
              <span><Check size={14}/>{scanDraft.source_label}</span>
              {scanDraft.start_date&&<span><CalendarDays size={14}/>Date found</span>}
              {scanDraft.location_text&&<span><MapPin size={14}/>Location found</span>}
              {scanDraft.provider_text&&<span><FileText size={14}/>Provider found</span>}
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Title
                <input
                  value={scanDraft.title}
                  onChange={(event)=>setScanDraft((current)=>current?{...current,title:event.target.value}:current)}
                  placeholder="What is this?"
                  autoFocus
                />
              </label>

              <label>
                Best match
                <Select
                  value={scanDraft.ticket_type}
                  onChange={(value)=>setScanDraft((current)=>current?{...current,ticket_type:value as TicketType}:current)}
                  options={ticketTypes}
                  ariaLabel="Choose recognized ticket or event type"
                />
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Date
                <DatePicker
                  value={scanDraft.start_date}
                  onChange={(value)=>setScanDraft((current)=>current?{...current,start_date:value}:current)}
                  format={household.date_format}
                  ariaLabel="Choose recognized date"
                />
              </label>

              <label>
                Start time
                <TimePicker
                  value={scanDraft.start_time||'09:00'}
                  onChange={(value)=>setScanDraft((current)=>current?{...current,start_time:value}:current)}
                />
                <button
                  type="button"
                  className="text-button ticket-scan-clear-time"
                  onClick={()=>setScanDraft((current)=>current?{...current,start_time:'',end_time:''}:current)}
                >
                  No exact time
                </button>
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                End date
                <DatePicker
                  value={scanDraft.end_date}
                  onChange={(value)=>setScanDraft((current)=>current?{...current,end_date:value}:current)}
                  min={scanDraft.start_date||undefined}
                  format={household.date_format}
                  ariaLabel="Choose recognized end date"
                />
              </label>

              <label>
                End time
                <TimePicker
                  value={scanDraft.end_time||scanDraft.start_time||'11:00'}
                  onChange={(value)=>setScanDraft((current)=>current?{...current,end_time:value}:current)}
                />
                <button
                  type="button"
                  className="text-button ticket-scan-clear-time"
                  onClick={()=>setScanDraft((current)=>current?{...current,end_time:''}:current)}
                >
                  No exact end time
                </button>
              </label>
            </div>

            <div className="composer-grid-two aligned-field-row">
              <label>
                Provider / organizer
                <input
                  value={scanDraft.provider_text}
                  onChange={(event)=>setScanDraft((current)=>current?{...current,provider_text:event.target.value}:current)}
                  placeholder="Airline, railway, venue, organization…"
                />
              </label>

              <label>
                Booking / reference
                <input
                  value={scanDraft.booking_reference}
                  onChange={(event)=>setScanDraft((current)=>current?{...current,booking_reference:event.target.value}:current)}
                  placeholder="Optional"
                />
              </label>
            </div>

            <label>
              Location
              <input
                value={scanDraft.location_text}
                onChange={(event)=>setScanDraft((current)=>current?{...current,location_text:event.target.value}:current)}
                placeholder="Airport, station, venue or address"
              />
              {scanDraft.location_text.trim()&&(
                <GoogleMapsLink
                  location={scanDraft.location_text}
                  label="Open in Google Maps"
                  className="field-map-link"
                />
              )}
            </label>

            <label>
              Notes
              <textarea
                value={scanDraft.notes}
                onChange={(event)=>setScanDraft((current)=>current?{...current,notes:event.target.value}:current)}
                placeholder="Any extra information"
              />
            </label>

            <details className="ticket-scan-raw">
              <summary><QrCode size={13}/>Raw scanned value</summary>
              <pre>{scanDraft.raw_value}</pre>
            </details>

            {(canWriteCalendar&&scanDraft.start_date)&&(
              <label className="ticket-scan-calendar-select">
                Calendar
                <Select
                  value={calendarId}
                  onChange={setCalendarId}
                  options={calendars.map((calendar)=>({
                    value:calendar.id,
                    label:calendar.name+(calendar.is_default?' · Default':''),
                    dotColor:categoryColor(calendar.color_key),
                  }))}
                  ariaLabel="Choose Calendar for scanned information"
                />
              </label>
            )}

            {error&&<div className="notice error">{error}</div>}

            {scanDraft.source_label!=='Sensitive security code'&&(
              <div className="ticket-scan-destinations">
                <button
                  type="button"
                  className="ticket-scan-destination"
                  disabled={scanSaving||!canWrite}
                  onClick={()=>void saveScanToWallet(false)}
                >
                  <Ticket size={19}/>
                  <span>
                    <strong>Ticket Wallet</strong>
                    <small>Save the code and recognized ticket information.</small>
                  </span>
                </button>

                <button
                  type="button"
                  className="ticket-scan-destination primary"
                  disabled={scanSaving||!canWrite||!canWriteCalendar||!scanDraft.start_date}
                  onClick={()=>void saveScanToWallet(true)}
                >
                  <Ticket size={19}/>
                  <span>
                    <strong>Wallet + Calendar</strong>
                    <small>{scanDraft.start_date?'Keep the ticket and create its Calendar event.':'Add a date first.'}</small>
                  </span>
                </button>

                <button
                  type="button"
                  className="ticket-scan-destination"
                  disabled={scanSaving||!canWriteCalendar||!scanDraft.start_date}
                  onClick={()=>void saveScanToCalendar()}
                >
                  <CalendarDays size={19}/>
                  <span>
                    <strong>Calendar only</strong>
                    <small>{scanDraft.start_date?'Create an event without keeping a wallet ticket.':'Add a date first.'}</small>
                  </span>
                </button>

                <button
                  type="button"
                  className="ticket-scan-destination"
                  disabled={scanSaving||!canWriteLifeAdmin}
                  onClick={()=>void saveScanToLifeAdmin()}
                >
                  <FileText size={19}/>
                  <span>
                    <strong>Life Admin · Reference</strong>
                    <small>{canWriteLifeAdmin?'Keep useful non-event information as a household reference.':'Life Admin write access is required.'}</small>
                  </span>
                </button>
              </div>
            )}

            <div className="ticket-scan-review-footer">
              <button
                type="button"
                className="secondary-button"
                disabled={scanSaving||scanDraft.source_label==='Sensitive security code'}
                onClick={openFullEditorFromScan}
              >
                More ticket details
              </button>
              <button
                type="button"
                className="text-button"
                disabled={scanSaving}
                onClick={()=>{
                  setScanReviewOpen(false)
                  setScanDraft(null)
                  setScanFile(null)
                  setError('')
                }}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {scannerOpen&&(
        <div className="modal-backdrop ticket-scanner-backdrop" role="presentation">
          <section className="modal-card ticket-scanner-card">
            <header>
              <div>
                <span className="eyebrow">LIVE SCANNER</span>
                <h2>Scan QR or barcode</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close ticket scanner" onClick={()=>setScannerOpen(false)}>
                <X size={18}/>
              </button>
            </header>

            {!scannerError&&(
              <div className="ticket-scanner-video-wrap">
                <video ref={videoRef} muted playsInline/>
                <span className="ticket-scanner-frame"><ScanLine size={30}/></span>
              </div>
            )}

            {scannerError ? (
              <div className="ticket-scanner-fallback">
                <QrCode size={26}/>
                <strong>Camera scanning unavailable</strong>
                <p>{scannerError}</p>
                <button type="button" className="primary-button compact" onClick={()=>{
                  setScannerOpen(false)
                  window.setTimeout(()=>scanFileInputRef.current?.click(),0)
                }}>
                  <Upload size={14}/>Upload ticket image
                </button>
              </div>
            ) : (
              <p className="ticket-scanner-help">Point the camera at the ticket code. Famioo fills the code automatically when it is detected.</p>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archive this ticket?"
        message="The ticket will move to the archive. If it is linked to Calendar, the linked Calendar event will also be removed."
        confirmLabel="Archive"
        danger
        onCancel={()=>setArchiveTarget(null)}
        onConfirm={()=>void archiveTicket()}
      />
    </div>
  )
}
