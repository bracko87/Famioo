import { Camera, ExternalLink, QrCode, Upload, X } from 'lucide-react'
import jsQR from 'jsqr'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'

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

export function TicketWalletPage(){
  const [scannerOpen,setScannerOpen]=useState(false)
  const [cameraError,setCameraError]=useState('')
  const [scanMessage,setScanMessage]=useState('')
  const [scannedValue,setScannedValue]=useState('')
  const [scanning,setScanning]=useState(false)

  const videoRef=useRef<HTMLVideoElement|null>(null)
  const canvasRef=useRef<HTMLCanvasElement|null>(null)
  const streamRef=useRef<MediaStream|null>(null)
  const frameRef=useRef<number>(0)

  function stopCamera(){
    if(frameRef.current){
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current=0
    }

    streamRef.current?.getTracks().forEach((track)=>track.stop())
    streamRef.current=null

    if(videoRef.current){
      videoRef.current.srcObject=null
    }

    setScanning(false)
  }

  function closeScanner(){
    stopCamera()
    setScannerOpen(false)
    setCameraError('')
  }

  function handleDecoded(value:string){
    const clean=value.trim()
    if(!clean) return

    stopCamera()
    setScannedValue(clean)

    const website=websiteFromQr(clean)
    if(website){
      setScanMessage('Website found. Opening…')
      window.location.assign(website)
      return
    }

    setScanMessage('QR code scanned, but it does not contain a website link.')
  }

  function scanVideoFrame(){
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
      handleDecoded(code.data)
      return
    }

    frameRef.current=window.requestAnimationFrame(scanVideoFrame)
  }

  async function startCamera(){
    setCameraError('')
    setScanMessage('')
    setScannedValue('')
    setScanning(true)

    if(!navigator.mediaDevices?.getUserMedia){
      setCameraError('Camera scanning is not supported in this browser. You can choose a QR image instead.')
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
      if(!video){
        stopCamera()
        return
      }

      video.srcObject=stream
      await video.play()
      frameRef.current=window.requestAnimationFrame(scanVideoFrame)
    }catch(error){
      stopCamera()
      setCameraError(error instanceof Error
        ? error.message
        : 'Camera access could not be started. You can choose a QR image instead.')
    }
  }

  function openScanner(){
    setScannerOpen(true)
    setCameraError('')
    setScanMessage('')
    setScannedValue('')
  }

  useEffect(()=>{
    if(!scannerOpen) return
    const timer=window.setTimeout(()=>{ void startCamera() },80)
    return ()=>{
      window.clearTimeout(timer)
      stopCamera()
    }
  },[scannerOpen])

  async function scanImageFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]
    event.target.value=''
    if(!file) return

    setCameraError('')
    setScanMessage('')
    setScannedValue('')

    try{
      const bitmap=await createImageBitmap(file)
      const canvas=canvasRef.current
      if(!canvas){
        bitmap.close()
        throw new Error('QR image scanner is unavailable.')
      }

      const maxWidth=1400
      const scale=Math.min(1,maxWidth/bitmap.width)
      canvas.width=Math.max(1,Math.round(bitmap.width*scale))
      canvas.height=Math.max(1,Math.round(bitmap.height*scale))

      const context=canvas.getContext('2d',{willReadFrequently:true})
      if(!context){
        bitmap.close()
        throw new Error('QR image scanner is unavailable.')
      }

      context.drawImage(bitmap,0,0,canvas.width,canvas.height)
      bitmap.close()

      const image=context.getImageData(0,0,canvas.width,canvas.height)
      const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'})

      if(!code?.data){
        setCameraError('No QR code was found in this image.')
        return
      }

      handleDecoded(code.data)
    }catch(error){
      setCameraError(error instanceof Error ? error.message : 'The QR image could not be read.')
    }
  }

  const scannedWebsite=websiteFromQr(scannedValue)

  return (
    <div className="page qr-only-page">
      <div className="page-heading-row">
        <div>
          <span className="eyebrow">QR CODE</span>
          <h1>Scan QR code</h1>
          <p>Scan a QR code and open the website contained in it.</p>
        </div>
      </div>

      <section className="qr-only-card">
        <span className="qr-only-icon"><QrCode size={40}/></span>
        <h2>Scan a QR code</h2>
        <p>Use your camera to scan a QR code. If the QR contains a website link, Famioo opens that page.</p>
        <button type="button" className="primary-button qr-only-start" onClick={openScanner}>
          <Camera size={17}/>Scan QR code
        </button>
      </section>

      {scannerOpen&&(
        <div className="modal-backdrop qr-only-backdrop" role="dialog" aria-modal="true" aria-label="Scan QR code">
          <section className="modal-card qr-only-scanner">
            <header className="qr-only-scanner-head">
              <div>
                <span className="eyebrow">QR SCANNER</span>
                <h2>Scan QR code</h2>
              </div>
              <button type="button" className="icon-button" onClick={closeScanner} aria-label="Close scanner">
                <X size={18}/>
              </button>
            </header>

            <div className="qr-only-camera">
              <video ref={videoRef} playsInline muted/>
              <div className="qr-only-frame" aria-hidden="true">
                <QrCode size={38}/>
              </div>
            </div>

            <canvas ref={canvasRef} className="qr-only-canvas" aria-hidden="true"/>

            <p className="qr-only-help">
              {scanning ? 'Point the camera at a QR code.' : 'Camera is not scanning.'}
            </p>

            {cameraError&&<div className="notice error">{cameraError}</div>}
            {scanMessage&&<div className="notice">{scanMessage}</div>}

            {scannedValue&&!scannedWebsite&&(
              <div className="qr-only-result">
                <strong>Scanned content</strong>
                <p>{scannedValue}</p>
              </div>
            )}

            <label className="secondary-button qr-only-upload">
              <Upload size={16}/>
              Scan QR from image
              <input type="file" accept="image/*" capture="environment" onChange={(event)=>void scanImageFile(event)}/>
            </label>

            {scannedWebsite&&(
              <a className="primary-button qr-only-open-link" href={scannedWebsite}>
                <ExternalLink size={16}/>Open website
              </a>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
