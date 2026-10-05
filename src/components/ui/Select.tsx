import { Check, ChevronDown } from 'lucide-react'
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
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

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
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
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

      {open && (
        <div className="custom-select-menu" role="listbox" ref={menuRef}>
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
              {option.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
