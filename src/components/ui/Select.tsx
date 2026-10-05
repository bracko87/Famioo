import { Check, ChevronDown, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

export type SelectOption = {
  value: string
  label: string
  dotColor?: string
  disabled?: boolean
}

type SelectProps = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
}

export function Select({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Choose…',
  className = '',
  ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [mobile, setMobile] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const sync = () => setMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        const selectedNode = menuRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
        selectedNode?.scrollIntoView({ block: 'center' })
      })
    }
  }, [open, value])

  useEffect(() => {
    function close(event: MouseEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }

    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', keydown)
    }
  }, [])

  useEffect(() => {
    if (!open || !mobile) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open, mobile])

  function optionRows(extraClass = '') {
    return (
      <div className={'custom-select-menu ' + extraClass} role="listbox" ref={menuRef}>
        {options.map((option) => (
          <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            data-selected={option.value === value ? 'true' : 'false'}
            className={option.value === value ? 'selected' : ''}
            disabled={option.disabled}
            key={option.value}
            onClick={() => {
              onChange(option.value)
              setOpen(false)
            }}
          >
            <span className="custom-select-option-label">
              {option.dotColor && <span className="custom-select-dot" style={{ backgroundColor: option.dotColor }} />}
              <span>{option.label}</span>
            </span>
            {option.value === value && <Check size={16} />}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={'custom-select ' + className + (open ? ' open' : '') + (disabled ? ' disabled' : '')} ref={rootRef}>
      <button
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="custom-select-value">
          {selected?.dotColor && <span className="custom-select-dot" style={{ backgroundColor: selected.dotColor }} />}
          <span>{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown size={15} />
      </button>

      {open && !mobile && optionRows()}

      {open && mobile && typeof document !== 'undefined' && createPortal(
        <div className="mobile-select-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setOpen(false)
        }}>
          <section className="mobile-select-sheet" aria-label={ariaLabel ?? 'Choose option'}>
            <header>
              <div>
                <span className="eyebrow">CHOOSE</span>
                <strong>{ariaLabel ?? 'Select option'}</strong>
              </div>
              <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close options">
                <X size={18} />
              </button>
            </header>
            {optionRows('mobile-select-menu')}
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
