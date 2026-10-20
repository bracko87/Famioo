import { useEffect, useRef } from 'react'

/**
 * iOS Safari keeps a separate visual viewport when the virtual keyboard opens.
 * Fixed-position drawers/dialogs otherwise remain sized to the layout viewport
 * and Safari can pan the entire page while focusing a field.
 *
 * Adjust only the active overlay, never the global viewport meta tag or the
 * user's pinch-zoom settings. CSS uses these variables while the keyboard is
 * open and falls back to its normal layout when it closes.
 */
export function useMobileKeyboardViewport<T extends HTMLElement>(active:boolean){
  const ref=useRef<T|null>(null)

  useEffect(()=>{
    if(!active||!window.visualViewport)return
    const vv=window.visualViewport
    // Some installed iOS PWAs resize window.innerHeight together with the
    // keyboard. The initial visual viewport height provides a second signal.
    const initialHeight=vv.height

    function update(){
      const overlay=ref.current
      if(!overlay)return
      const focus=document.activeElement
      const editFocused=focus instanceof HTMLElement
        &&overlay.contains(focus)
        &&focus.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select')
      const hiddenByKeyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop)
      const shrunkenSinceOpening=Math.max(0,initialHeight-vv.height)
      const mobile=window.matchMedia('(max-width: 900px)').matches
      const keyboardOpen=mobile&&editFocused&&(hiddenByKeyboard>120||shrunkenSinceOpening>120)

      if(!keyboardOpen){
        overlay.removeAttribute('data-keyboard-open')
        overlay.style.removeProperty('--famioo-visible-top')
        overlay.style.removeProperty('--famioo-visible-height')
        return
      }

      overlay.setAttribute('data-keyboard-open','true')
      overlay.style.setProperty('--famioo-visible-top',Math.max(0,vv.offsetTop)+'px')
      overlay.style.setProperty('--famioo-visible-height',Math.max(150,vv.height)+'px')
    }

    // Some iOS versions update the visual viewport after the focus event.
    let frame=0
    const schedule=()=>{
      window.cancelAnimationFrame(frame)
      frame=window.requestAnimationFrame(update)
    }
    vv.addEventListener('resize',schedule)
    vv.addEventListener('scroll',schedule)
    window.addEventListener('resize',schedule)
    document.addEventListener('focusin',schedule)
    document.addEventListener('focusout',schedule)
    schedule()
    return()=>{
      window.cancelAnimationFrame(frame)
      vv.removeEventListener('resize',schedule)
      vv.removeEventListener('scroll',schedule)
      window.removeEventListener('resize',schedule)
      document.removeEventListener('focusin',schedule)
      document.removeEventListener('focusout',schedule)
      const overlay=ref.current
      overlay?.removeAttribute('data-keyboard-open')
      overlay?.style.removeProperty('--famioo-visible-top')
      overlay?.style.removeProperty('--famioo-visible-height')
    }
  },[active])
  return ref
}
